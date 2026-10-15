import assert from "node:assert/strict";
import test from "node:test";
import type { MiddlewareHandler } from "hono";

import { createBuilderRoutes } from "../../src/agon/builder-routes.ts";
import type { AccessTokenRecord, AccessTokenStore } from "../../src/agon/access-tokens.ts";

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const auth = (signedIn: boolean): MiddlewareHandler<{ Variables: { address: string } }> => async (c, next) => {
  if (!signedIn) return c.json({ error: "unauthorized" }, 401);
  c.set("address", OWNER);
  await next();
};

function fakeTokens(): AccessTokenStore {
  const records: AccessTokenRecord[] = [];
  return {
    async create(input) {
      if (records.filter((r) => !r.revokedAt).length >= 10) return { ok: false, code: "too_many_tokens" };
      const record: AccessTokenRecord = { id: `00000000-0000-4000-8000-0000000000${String(records.length).padStart(2, "0")}`, owner: input.owner, name: input.name, level: input.level, createdAt: input.now, expiresAt: new Date(input.now.getTime() + input.days * 86_400_000), lastUsedAt: null, revokedAt: null };
      records.push(record);
      return { ok: true, token: "agon_pat_secret", record };
    },
    async list() { return records; },
    async revoke(_o, id, now) { const r = records.find((x) => x.id === id); if (!r) return false; r.revokedAt = now; return true; },
    async verify() { return { ok: false, reason: "unknown" }; },
  };
}
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const now = new Date("2026-10-16T12:00:00Z");

test("a signed-in builder creates, lists and revokes tokens; the token is returned only on create", async () => {
  const app = createBuilderRoutes({ tokens: fakeTokens(), requireAuth: auth(true), now: () => now });
  const made = await app.request("http://x/tokens", json({ name: "Claude Code", level: "listing", days: 30 }));
  assert.equal(made.status, 201);
  const body = (await made.json()) as { token: string; record: { id: string } };
  assert.equal(body.token, "agon_pat_secret");
  const listed = (await (await app.request("http://x/tokens")).json()) as { tokens: Record<string, unknown>[] };
  assert.equal(JSON.stringify(listed).includes("agon_pat_secret"), false);
  assert.equal(listed.tokens[0]!.active, true);
  assert.equal((await app.request(`http://x/tokens/${body.record.id}/revoke`, json({}))).status, 200);
  const after = (await (await app.request("http://x/tokens")).json()) as { tokens: Record<string, unknown>[] };
  assert.equal(after.tokens[0]!.active, false);
  assert.equal((await app.request("http://x/tokens/00000000-0000-4000-8000-000000000099/revoke", json({}))).status, 404);
});

test("bad input, too many tokens and signed-out callers are refused", async () => {
  const tokens = fakeTokens();
  const app = createBuilderRoutes({ tokens, requireAuth: auth(true), now: () => now });
  for (const bad of [{ name: "", level: "listing", days: 30 }, { name: "x", level: "admin", days: 30 }, { name: "x", level: "read", days: 365 }, { name: "x".repeat(81), level: "read", days: 30 }]) {
    assert.equal((await app.request("http://x/tokens", json(bad))).status, 400, JSON.stringify(bad));
  }
  for (let i = 0; i < 10; i += 1) await app.request("http://x/tokens", json({ name: `t${i}`, level: "read", days: 90 }));
  assert.equal((await app.request("http://x/tokens", json({ name: "eleventh", level: "read", days: 90 }))).status, 409);
  const out = createBuilderRoutes({ tokens, requireAuth: auth(false) });
  assert.equal((await out.request("http://x/tokens")).status, 401);
});

const draftBody = { name: "Atlas", logoUrl: "https://agon.surf/agents/atlas.svg", outcome: "Forecasts one market.", category: "3", inputs: ["market"], outputs: ["probability"], priceUSDC: "0.22", expectedLatencyMs: 60000, privacy: "p", failurePolicy: "f", endpoint: "https://api.agon.surf/agon/agents/house/atlas/forecast" };

function listingFakes(opts: { checks?: boolean; publisher?: boolean } = {}) {
  const drafts = new Map<string, typeof draftBody>();
  const access = {
    async startListing(_actor: string, input: unknown) {
      const d = input as typeof draftBody;
      if (!d || !d.name) return { ok: false as const, code: "invalid_request", message: "Name is required" };
      drafts.set("draft-1", d);
      return { ok: true as const, value: { draftId: "draft-1", draft: d, nextAction: "run_listing_checks" } };
    },
    async checkListing() {
      return opts.checks === false
        ? { ok: false as const, code: "rate_limited", message: "Up to 10 checks an hour. Try again later." }
        : { ok: true as const, value: { draftId: "draft-1", checks: [], requiredPassed: true, certificationScore: 100, nextAction: "approve_publication" } };
    },
  };
  const store = {
    async list() { return [...drafts.entries()].map(([draftId, draft]) => ({ draftId, draft, state: "draft" })); },
    async get(_a: string, id: string) { const d = drafts.get(id); return d ? { draftId: id, draft: d, state: "draft" } : null; },
  };
  const result = (status: string) => ({ status, nextAction: "x", draftId: "draft-1", chainId: 5042002, fundingAddress: "0x" + "2".repeat(40), fundingAsset: "Arc Testnet native USDC", balanceUSDC: "0", termsDigest: "0x" + "d".repeat(64), custody: "AGON-managed Circle developer-controlled wallet", agentId: null, reference: null, txHash: null });
  const publisher = opts.publisher === false ? undefined : {
    async setup() { return result("review_terms"); },
    async approve(_a: string, _d: string, digest: string) { if (digest !== "0x" + "d".repeat(64)) throw new Error("The exact draft digest and explicit approval are required"); return result("ready"); },
    async status() { return result("review_terms"); },
    async advance() { throw new Error("secret internal detail"); },
  };
  return { access, drafts: store, publisher } as never;
}

test("a builder drafts, checks, sets up, approves and advances a listing from the browser", async () => {
  const app = createBuilderRoutes({ tokens: fakeTokens(), requireAuth: auth(true), listing: listingFakes() });
  const made = await app.request("http://x/drafts", json(draftBody));
  assert.equal(made.status, 201);
  assert.deepEqual(await made.json(), { draftId: "draft-1" });
  const mine = (await (await app.request("http://x/drafts")).json()) as { drafts: { draftId: string; name: string; publishing: { status: string } | null }[] };
  assert.equal(mine.drafts[0]!.draftId, "draft-1");
  assert.equal(mine.drafts[0]!.name, "Atlas");
  assert.equal(mine.drafts[0]!.publishing!.status, "review_terms");
  const one = (await (await app.request("http://x/drafts/draft-1")).json()) as { feeUSDC: string; draft: { name: string } };
  assert.equal(one.feeUSDC, "0.50");
  assert.equal(one.draft.name, "Atlas");
  assert.equal((await app.request("http://x/drafts/draft-1/check", json({}))).status, 200);
  const setup = (await (await app.request("http://x/drafts/draft-1/setup", json({}))).json()) as { feeUSDC: string; status: string };
  assert.equal(setup.feeUSDC, "0.50");
  assert.equal(setup.status, "review_terms");
  assert.equal((await app.request("http://x/drafts/draft-1/approve", json({ termsDigest: "0x" + "d".repeat(64) }))).status, 200);
  const wrong = await app.request("http://x/drafts/draft-1/approve", json({ termsDigest: "0x" + "e".repeat(64) }));
  assert.equal(wrong.status, 400);
  assert.match(await wrong.text(), /exact draft digest/);
  const hidden = await app.request("http://x/drafts/draft-1/advance", json({}));
  assert.equal(hidden.status, 400);
  assert.doesNotMatch(await hidden.text(), /secret internal detail/);
  assert.equal((await app.request("http://x/drafts/nope")).status, 404);
  assert.equal((await app.request("http://x/drafts", json({}))).status, 400);
});

test("rate-limited checks and missing publishing get clear answers", async () => {
  const limited = createBuilderRoutes({ tokens: fakeTokens(), requireAuth: auth(true), listing: listingFakes({ checks: false, publisher: false }) });
  await limited.request("http://x/drafts", json(draftBody));
  assert.equal((await limited.request("http://x/drafts/draft-1/check", json({}))).status, 429);
  const unavailable = await limited.request("http://x/drafts/draft-1/setup", json({}));
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /publishing_unavailable/);
  const one = (await (await limited.request("http://x/drafts/draft-1")).json()) as { publishing: unknown };
  assert.equal(one.publishing, null);
});
