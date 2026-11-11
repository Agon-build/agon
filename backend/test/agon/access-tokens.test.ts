import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { ACCESS_LEVEL_SCOPES, PostgresAccessTokenStore, createMcpTokenVerifier, hashAccessToken, newAccessToken } from "../../src/agon/access-tokens.ts";
import { authorizeMcpRequest } from "../../src/agon/mcp-oauth/edge.ts";
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
    budget: ["agon:read", "budget:spend"],
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

// Standing budgets (2026-11-11): a budget token carries its own caps and a ledger of what it spent.
test("a budget token stores its caps, verifies with them, and never holds wallet:execute", async () => {
  const owner = "0xdddddddddddddddddddddddddddddddddddddddd";
  const budget = { perHireCap: 500_000n, dailyCap: 1_000_000n, categories: ["prediction"], allowOutside: false };
  const out = await store.create({ owner, name: "research agent", level: "budget", days: 7, now, budget });
  assert.ok(out.ok);
  assert.deepEqual(out.record.budget, budget);
  assert.equal(out.record.expiresAt.toISOString(), "2026-10-23T12:00:00.000Z");
  const v = await store.verify(out.token, now);
  assert.ok(v.ok);
  assert.deepEqual(v.claims.scopes, ["agon:read", "budget:spend"]);
  assert.deepEqual(v.claims.budget, { ...budget, tokenId: out.record.id });
  assert.deepEqual((await store.list(owner))[0]!.budget, budget);
  // A token of another level carries no budget, and its claims say nothing of one.
  const plain = await store.create({ owner, name: "hiring", level: "hiring", days: 30, now });
  assert.ok(plain.ok);
  const pv = await store.verify(plain.token, now);
  assert.ok(pv.ok && pv.claims.budget === undefined && plain.record.budget === null);
  // What the store refuses.
  assert.deepEqual(await store.create({ owner, name: "x", level: "budget", days: 30, now }), { ok: false, code: "budget_required" });
  assert.deepEqual(await store.create({ owner, name: "x", level: "full", days: 30, now, budget }), { ok: false, code: "budget_not_allowed" });
  assert.deepEqual(await store.create({ owner, name: "x", level: "budget", days: 30, now, budget: { ...budget, perHireCap: 6_000_000n, dailyCap: 6_000_000n } }), { ok: false, code: "caps_too_high" });
  assert.deepEqual(await store.create({ owner, name: "x", level: "budget", days: 30, now, budget: { ...budget, dailyCap: 100_000n } }), { ok: false, code: "invalid_caps" });
  assert.deepEqual(await store.create({ owner, name: "x", level: "budget", days: 30, now, budget: { ...budget, categories: ["gambling"] } }), { ok: false, code: "invalid_categories" });
  // The table itself refuses a budget token without caps.
  await assert.rejects(db.pool.query("update agon_access_tokens set per_hire_cap = null where id = $1", [out.record.id]));
});

test("the budget ledger holds a token to its daily cap, even when two hires arrive at once", async () => {
  const owner = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const made = await store.create({ owner, name: "agent", level: "budget", days: 30, now, budget: { perHireCap: 500_000n, dailyCap: 1_000_000n, categories: null, allowOutside: true } });
  assert.ok(made.ok);
  const tokenId = made.record.id;
  const job = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
  const reserve = (n: number, amount = 300_000n, at = now) => store.reserve({ tokenId, jobId: job(n), amount, dailyCap: 1_000_000n, now: at });
  assert.deepEqual([await reserve(1), await reserve(2), await reserve(3)], ["reserved", "reserved", "reserved"]);
  assert.equal(await reserve(4), "over_daily");
  assert.equal(await reserve(1, 1n), "duplicate");
  assert.equal(await store.spentToday(tokenId, now), 900_000n);
  // Releasing a hire that moved no money gives the room back.
  await store.release(tokenId, job(3));
  assert.equal(await store.spentToday(tokenId, now), 600_000n);
  // Two at once for the last 0.40: exactly one is reserved.
  const both = await Promise.all([reserve(5, 400_000n), reserve(6, 400_000n)]);
  assert.deepEqual([...both].sort(), ["over_daily", "reserved"]);
  // The next UTC day starts again from nothing.
  const tomorrow = new Date("2026-10-17T00:00:01Z");
  assert.equal(await store.spentToday(tokenId, tomorrow), 0n);
  assert.equal(await reserve(7, 500_000n, tomorrow), "reserved");
  // Revoking stops the token at once; an expired or unknown token is not usable either.
  assert.equal(await store.usable(tokenId, now), true);
  assert.equal(await store.usable(tokenId, new Date("2027-01-01T00:00:00Z")), false);
  await store.revoke(owner, tokenId, now);
  assert.equal(await store.usable(tokenId, now), false);
  assert.equal(await store.usable("00000000-0000-4000-8000-0000000000ff", now), false);
  assert.deepEqual(await store.verify(made.token, now), { ok: false, reason: "revoked" });
});

test("the MCP edge hands a budget token's caps to the tools", async () => {
  const made = await store.create({ owner: "0xffffffffffffffffffffffffffffffffffffffff", name: "edge", level: "budget", days: 30, now, budget: { perHireCap: 500_000n, dailyCap: 5_000_000n, categories: null, allowOutside: false } });
  assert.ok(made.ok);
  const verify = createMcpTokenVerifier(store, async () => null, () => now);
  const request = new Request("https://api.agon.surf/agon/mcp", { method: "POST", headers: { authorization: `Bearer ${made.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hire_service", arguments: {} } }) });
  const auth = await authorizeMcpRequest(request, { verify, resourceMetadataUrl: "https://api.agon.surf/.well-known/oauth-protected-resource/agon/mcp" });
  assert.ok(auth.ok);
  assert.deepEqual(auth.authInfo.extra?.budget, { tokenId: made.record.id, perHireCap: 500_000n, dailyCap: 5_000_000n, categories: null, allowOutside: false });
  assert.deepEqual(auth.authInfo.scopes, ["agon:read", "budget:spend"]);
  // confirm_hire needs wallet:execute, which a budget token never has: the edge asks to step up.
  const confirm = new Request("https://api.agon.surf/agon/mcp", { method: "POST", headers: { authorization: `Bearer ${made.token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "confirm_hire", arguments: {} } }) });
  const refused = await authorizeMcpRequest(confirm, { verify, resourceMetadataUrl: "https://x" });
  assert.ok(!refused.ok && refused.response.status === 403);
});
