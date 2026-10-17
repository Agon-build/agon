import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ACCESS_LEVEL_SCOPES, PostgresAccessTokenStore, createMcpTokenVerifier, hashAccessToken, newAccessToken } from "../../src/agon/access-tokens.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresAccessTokenStore;
const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const now = new Date("2026-10-16T12:00:00Z");
before(async () => { db = await createAgonTestDatabase("access_tokens"); store = new PostgresAccessTokenStore(db.pool); });
after(async () => db.close());

test("tokens are opaque, prefixed and hashed; each level grants exactly its scopes", () => {
  const t = newAccessToken();
  assert.match(t, /^agon_pat_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newAccessToken(), t);
  assert.match(hashAccessToken(t), /^[0-9a-f]{64}$/);
  assert.equal(hashAccessToken(`  ${t}\n`), hashAccessToken(t), "surrounding whitespace is ignored");
  assert.deepEqual(ACCESS_LEVEL_SCOPES, {
    read: ["agon:read"],
    listing: ["agon:read", "listing:prepare", "listing:write", "listing:confirm"],
    hiring: ["agon:read", "wallet:execute"],
    full: ["agon:read", "listing:prepare", "listing:write", "listing:confirm", "wallet:execute"],
  });
});

test("a full access token is stored and verifies with listing and hiring scopes", async () => {
  const out = await store.create({ owner: OWNER, name: "everything", level: "full", days: 90, now });
  assert.ok(out.ok);
  const v = await store.verify(out.token, now);
  assert.ok(v.ok);
  assert.deepEqual(v.claims.scopes, ["agon:read", "listing:prepare", "listing:write", "listing:confirm", "wallet:execute"]);
});

test("a created token verifies once stored; only its hash is in the table", async () => {
  const out = await store.create({ owner: OWNER, name: "Claude Code on laptop", level: "listing", days: 30, now });
  assert.ok(out.ok);
  assert.equal(out.record.expiresAt.toISOString(), "2026-11-15T12:00:00.000Z");
  const { rows } = await db.pool.query("select * from agon_access_tokens where id = $1", [out.record.id]);
  assert.equal(JSON.stringify(rows[0]).includes(out.token), false, "raw token never stored");
  const v = await store.verify(`  ${out.token}\n`, now);
  assert.deepEqual(v, { ok: true, claims: { address: OWNER, client: "agon-cli", scopes: ["agon:read", "listing:prepare", "listing:write", "listing:confirm"] } });
  assert.ok((await store.list(OWNER)).find((r) => r.id === out.record.id)!.lastUsedAt, "last used is recorded");
});

test("revoked and expired tokens are refused with their reason", async () => {
  const a = await store.create({ owner: OWNER, name: "revoke me", level: "read", days: 30, now });
  assert.ok(a.ok);
  assert.equal(await store.revoke(OWNER, a.record.id, now), true);
  assert.deepEqual(await store.verify(a.token, now), { ok: false, reason: "revoked" });
  assert.equal(await store.revoke("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", a.record.id, now), false, "only the owner revokes");
  const b = await store.create({ owner: OWNER, name: "old", level: "hiring", days: 90, now });
  assert.ok(b.ok);
  assert.deepEqual(await store.verify(b.token, new Date("2027-02-01T00:00:00Z")), { ok: false, reason: "expired" });
  assert.deepEqual(await store.verify("agon_pat_nope", now), { ok: false, reason: "unknown" });
});

test("an account holds at most 10 active tokens; revoked and expired ones do not count", async () => {
  const owner = "0xcccccccccccccccccccccccccccccccccccccccc";
  const made = [];
  for (let i = 0; i < 10; i += 1) made.push(await store.create({ owner, name: `t${i}`, level: "read", days: 30, now }));
  assert.ok(made.every((m) => m.ok));
  assert.deepEqual(await store.create({ owner, name: "eleventh", level: "read", days: 30, now }), { ok: false, code: "too_many_tokens" });
  const first = made[0]!;
  assert.ok(first.ok);
  await store.revoke(owner, first.record.id, now);
  assert.ok((await store.create({ owner, name: "after revoke", level: "read", days: 30, now })).ok);
});

test("the MCP verifier accepts access tokens and session tokens, and reports token problems", async () => {
  const jwt = async (t: string) => (t === "jwt-ok" ? { address: OWNER, client: "agon-cli", scopes: ["agon:read"] } : null);
  const verify = createMcpTokenVerifier(store, jwt, () => now);
  const made = await store.create({ owner: OWNER, name: "mcp", level: "hiring", days: 30, now });
  assert.ok(made.ok);
  assert.deepEqual(await verify(made.token), { address: OWNER, client: "agon-cli", scopes: ["agon:read", "wallet:execute"] });
  assert.deepEqual(await verify("jwt-ok"), { address: OWNER, client: "agon-cli", scopes: ["agon:read"] });
  assert.equal(await verify("garbage"), null);
  await store.revoke(OWNER, made.record.id, now);
  assert.deepEqual(await verify(made.token), { problem: "revoked" });
});
