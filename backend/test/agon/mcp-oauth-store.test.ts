import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";

import { ACCESS_LEVEL_SCOPES } from "../../src/agon/access-tokens.ts";
import { PostgresOAuthStore } from "../../src/agon/mcp-oauth/store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresOAuthStore;
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const RESOURCE = "https://api.agon.surf/agon/mcp";
const REDIRECT = "http://127.0.0.1:33418/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const t0 = new Date("2026-10-17T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

before(async () => { db = await createAgonTestDatabase("mcp_oauth"); store = new PostgresOAuthStore(db.pool); });
after(async () => db.close());

async function approved(level: "read" | "listing" | "hiring" | "full" = "listing", owner = OWNER) {
  const client = await store.registerClient({ clientName: "Claude Code", redirectUris: [REDIRECT], source: "dcr" });
  const req = await store.createRequest({ clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE, state: "s1", requestedScopes: [], resource: RESOURCE, now: t0 });
  const decided = await store.decide(req.id, { address: owner, level, now: t0 });
  assert.ok(decided);
  return { client, req, code: decided.code };
}

test("a decided request issues one code; a second decide on the same request returns null", async () => {
  const { req } = await approved();
  assert.equal(await store.decide(req.id, { address: OWNER, level: "read", now: t0 }), null);
  assert.equal(await store.getRequest(req.id, t0), null, "a decided request is no longer pending");
});

test("code redeems once with the right verifier and resource, and never twice", async () => {
  const bad = await approved();
  const base = { code: bad.code, clientId: bad.client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 };
  assert.deepEqual(await store.redeemCode({ ...base, codeVerifier: `${VERIFIER.slice(0, -1)}A` }), { error: "invalid_grant" });
  const a = await approved();
  const ok = { code: a.code, clientId: a.client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 };
  assert.deepEqual(await store.redeemCode({ ...ok, resource: "https://other.example/mcp" }), { error: "invalid_grant" });
  const b = await approved();
  assert.deepEqual(await store.redeemCode({ ...ok, code: b.code, clientId: b.client.clientId, redirectUri: "http://127.0.0.1:1/other" }), { error: "invalid_grant" });
  const c = await approved();
  assert.deepEqual(await store.redeemCode({ ...ok, code: c.code, clientId: c.client.clientId, now: at(61_000) }), { error: "invalid_grant" });
  const d = await approved();
  const pair = await store.redeemCode({ ...ok, code: d.code, clientId: d.client.clientId });
  assert.ok("accessToken" in pair);
  assert.equal(pair.expiresIn, 3600);
  assert.equal(pair.scope, ACCESS_LEVEL_SCOPES.listing.join(" "));
  assert.deepEqual(await store.redeemCode({ ...ok, code: d.code, clientId: d.client.clientId }), { error: "invalid_grant" });
});

async function tokens(level: "read" | "listing" | "hiring" | "full" = "listing") {
  const a = await approved(level);
  const pair = await store.redeemCode({ code: a.code, clientId: a.client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 });
  assert.ok("accessToken" in pair);
  return { ...a, pair };
}

test("refresh rotates; reusing the old refresh token revokes the connection and its access token", async () => {
  const { client, pair } = await tokens();
  const next = await store.refresh({ refreshToken: pair.refreshToken, clientId: client.clientId, resource: RESOURCE, now: at(1000) });
  assert.ok("accessToken" in next);
  assert.notEqual(next.refreshToken, pair.refreshToken);
  assert.ok(await store.verifyAccess(next.accessToken, RESOURCE, at(2000)));
  assert.deepEqual(await store.refresh({ refreshToken: pair.refreshToken, clientId: client.clientId, resource: RESOURCE, now: at(3000) }), { error: "invalid_grant" });
  assert.equal(await store.verifyAccess(next.accessToken, RESOURCE, at(4000)), null, "reuse revokes the whole connection");
  assert.deepEqual(await store.refresh({ refreshToken: next.refreshToken, clientId: client.clientId, resource: RESOURCE, now: at(5000) }), { error: "invalid_grant" });
});

test("access token scopes follow the level; a token for another resource is refused; it expires after an hour", async () => {
  const { pair } = await tokens("hiring");
  const claims = await store.verifyAccess(pair.accessToken, RESOURCE, at(1000));
  assert.deepEqual(claims?.scopes, [...ACCESS_LEVEL_SCOPES.hiring]);
  assert.equal(claims?.address, OWNER);
  assert.equal(claims?.clientName, "Claude Code");
  assert.equal(await store.verifyAccess(pair.accessToken, "https://other.example/mcp", at(1000)), null);
  assert.equal(await store.verifyAccess(pair.accessToken, RESOURCE, at(3_600_001)), null);
});

test("a connection unused for 90 days cannot refresh", async () => {
  const { client, pair } = await tokens();
  assert.deepEqual(await store.refresh({ refreshToken: pair.refreshToken, clientId: client.clientId, resource: RESOURCE, now: at(90 * 86_400_000 + 1000) }), { error: "invalid_grant" });
});

test("approving the same app on a second device keeps the first one connected", async () => {
  const owner = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const client = await store.registerClient({ clientName: "Codex", redirectUris: [REDIRECT], source: "cimd", clientId: "https://codex.example/client.json" });
  const issued = [];
  for (const level of ["read", "full"] as const) {
    const req = await store.createRequest({ clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE, state: null, requestedScopes: [], resource: RESOURCE, now: t0 });
    const d = await store.decide(req.id, { address: owner, level, now: t0 });
    const pair = await store.redeemCode({ code: d!.code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 });
    assert.ok("accessToken" in pair);
    issued.push(pair);
  }
  assert.ok(await store.verifyAccess(issued[0]!.accessToken, RESOURCE, at(1)), "the first device still works");
  assert.ok("accessToken" in await store.refresh({ refreshToken: issued[0]!.refreshToken, clientId: client.clientId, resource: RESOURCE, now: at(2) }));
  const list = await store.listConnections(owner);
  assert.deepEqual(list.map((c) => c.level).sort(), ["full", "read"]);
});

test("expired requests and dead tokens are purged", async () => {
  const client = await store.registerClient({ clientName: "Old", redirectUris: [REDIRECT], source: "dcr" });
  const req = await store.createRequest({ clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE, state: null, requestedScopes: [], resource: RESOURCE, now: t0 });
  const removed = await store.purgeExpired(at(2 * 86_400_000));
  assert.ok(removed.requests >= 1);
  assert.equal((await db.pool.query("select 1 from agon_oauth_requests where id = $1", [req.id])).rowCount, 0);
});

test("a token request for the same resource with a trailing slash or upper-case host still works", async () => {
  const { client, code } = await approved();
  const pair = await store.redeemCode({ code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: "https://API.agon.surf/agon/mcp/", now: t0 });
  assert.ok("accessToken" in pair);
});

test("disconnect makes a valid access token fail at once", async () => {
  const owner = "0xcccccccccccccccccccccccccccccccccccccccc";
  const client = await store.registerClient({ clientName: "Cursor", redirectUris: [REDIRECT], source: "dcr" });
  const req = await store.createRequest({ clientId: client.clientId, redirectUri: REDIRECT, codeChallenge: CHALLENGE, state: null, requestedScopes: [], resource: RESOURCE, now: t0 });
  const d = await store.decide(req.id, { address: owner, level: "read", now: t0 });
  const pair = await store.redeemCode({ code: d!.code, clientId: client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 });
  assert.ok("accessToken" in pair);
  const [conn] = await store.listConnections(owner);
  assert.equal(await store.disconnect("0xdddddddddddddddddddddddddddddddddddddddd", conn!.id, t0), false, "only the owner can disconnect");
  assert.equal(await store.disconnect(owner, conn!.id, t0), true);
  assert.equal(await store.verifyAccess(pair.accessToken, RESOURCE, at(1)), null);
  assert.equal((await store.listConnections(owner)).length, 0);
});

test("revoking a token stops it", async () => {
  const { pair } = await tokens();
  await store.revokeToken(pair.accessToken, t0);
  assert.equal(await store.verifyAccess(pair.accessToken, RESOURCE, at(1)), null);
});

test("database rows hold only hashes", async () => {
  const { pair, code } = await tokens();
  const rows = JSON.stringify((await db.pool.query("select * from agon_oauth_tokens")).rows) + JSON.stringify((await db.pool.query("select * from agon_oauth_requests")).rows);
  for (const secret of [pair.accessToken, pair.refreshToken, code]) assert.equal(rows.includes(secret), false);
});

test("a code used a second time cancels the tokens it already issued", async () => {
  const a = await approved();
  const input = { code: a.code, clientId: a.client.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER, resource: RESOURCE, now: t0 };
  const pair = await store.redeemCode(input);
  assert.ok("accessToken" in pair);
  assert.deepEqual(await store.redeemCode(input), { error: "invalid_grant" });
  assert.equal(await store.verifyAccess(pair.accessToken, RESOURCE, at(1)), null);
});

test("last used is written at most once a minute", async () => {
  const { pair } = await tokens();
  const lastUsed = async () => (await db.pool.query<{ last_used_at: Date }>("select c.last_used_at from agon_oauth_tokens t join agon_oauth_connections c on c.id = t.connection_id where t.kind = 'access' and t.token_hash = encode(sha256($1::bytea), 'hex')", [pair.accessToken])).rows[0]!.last_used_at;
  await store.verifyAccess(pair.accessToken, RESOURCE, at(1_000));
  assert.equal((await lastUsed()).getTime(), at(1_000).getTime());
  await store.verifyAccess(pair.accessToken, RESOURCE, at(30_000));
  assert.equal((await lastUsed()).getTime(), at(1_000).getTime(), "no write within a minute");
  await store.verifyAccess(pair.accessToken, RESOURCE, at(62_000));
  assert.equal((await lastUsed()).getTime(), at(62_000).getTime());
});
