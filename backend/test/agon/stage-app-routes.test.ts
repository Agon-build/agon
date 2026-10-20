import assert from "node:assert/strict";
import test from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { createAppRoutes } from "../../src/agon/stage/app-routes.ts";
import type { Router } from "../../src/agon/routing/router.ts";
import type { StageServices } from "../../src/agon/stage/services.ts";
import { CUSTODY_TERMS_VERSION, type CustodyTerms } from "../../src/agon/stage/custody-terms.ts";
import { createLeaderboardReader } from "../../src/agon/stage/leaderboard.ts";
import { createRateLimiter } from "../../src/agon/stage/rate-limit.ts";
import { QUESTION, SITE, stageWorld } from "./stage-test-world.ts";

const ALICE = `0x${"1".repeat(40)}`;
const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  const address = c.req.header("x-test-address");
  if (!address) return c.json({ error: "unauthorized" }, 401);
  c.set("address", address.toLowerCase());
  await next();
};

function fakeTerms(acceptedByDefault: boolean): CustodyTerms & { accepted: Set<string> } {
  const accepted = new Set<string>();
  return {
    accepted,
    isAccepted: async (ref) => acceptedByDefault || accepted.has(ref),
    accept: async (ref, version) => { if (version !== CUSTODY_TERMS_VERSION) return false; accepted.add(ref); return true; },
  };
}

function setup(opts: { off?: boolean; askLimit?: (key: string) => boolean; termsAccepted?: boolean; router?: Router; outside?: StageServices } = {}) {
  const world = stageWorld();
  const terms = fakeTerms(opts.termsAccepted ?? true);
  const app = new Hono();
  app.route("/agon/app", createAppRoutes({ services: world.services, requireAuth, off: () => opts.off ?? false, askLimit: opts.askLimit, terms, router: opts.router, outside: opts.outside }));
  const call = (path: string, init: { method?: string; body?: unknown; as?: string | null } = {}) =>
    app.request(`/agon/app${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...(init.as === null ? {} : { "x-test-address": init.as ?? ALICE }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  return { ...world, app, call, terms };
}

test("public config shows the network and the lead agent price without sign-in", async () => {
  const { call } = setup();
  const res = await call("/config", { as: null });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { network: "Arc Testnet", testnet: true, leadPrice: "0.30", leadPriceAtomic: "300000", siteUrl: SITE });
});

test("wallet, ask and history need a browser session", async () => {
  const { call } = setup();
  assert.equal((await call("/wallet", { as: null })).status, 401);
  assert.equal((await call("/ask", { body: { question: QUESTION }, as: null })).status, 401);
  assert.equal((await call("/history", { as: null })).status, 401);
});

test("ask, confirm and the live view run the whole story", async () => {
  const { call } = setup();
  const askRes = await call("/ask", { body: { question: QUESTION, maxPrice: "0.50" } });
  assert.equal(askRes.status, 200);
  const quote = (await askRes.json()) as { ok: boolean; step: string; jobId: string; amount: string; amountAtomic: string; code: string; network: string; testnet: boolean; expiresAt: string };
  assert.deepEqual([quote.ok, quote.step, quote.amount, quote.amountAtomic, quote.network, quote.testnet], [true, "confirm_code", "0.30", "300000", "Arc Testnet", true]);
  assert.ok(!Number.isNaN(Date.parse(quote.expiresAt)));
  const confirmRes = await call(`/hires/${quote.jobId}/confirm`, { body: { code: quote.code } });
  const confirmed = (await confirmRes.json()) as { ok: boolean; jobId: string; amount: string; txHash: string };
  assert.deepEqual([confirmed.ok, confirmed.jobId, confirmed.amount], [true, quote.jobId, "0.30"]);
  assert.match(confirmed.txHash, /^0x[0-9a-f]{64}$/);
  const live = (await (await call(`/live/${quote.jobId}`, { as: null })).json()) as { phase: string; answer: { probabilityBps: number }; events: unknown[]; receiptUrl: string };
  assert.equal(live.phase, "answered");
  assert.equal(live.answer.probabilityBps, 3400);
  assert.equal(live.events.length, 3);
  assert.equal(live.receiptUrl, `${SITE}/r/${quote.jobId}`);
  const history = (await (await call("/history")).json()) as { items: { jobId: string; state: string }[]; page: number; hasMore: boolean };
  assert.deepEqual(history.items.map((i) => [i.jobId, i.state]), [[quote.jobId, "delivered"]]);
  assert.equal(history.page, 1);
  assert.equal(history.hasMore, false);
  const one = (await (await call("/history?limit=1&page=1")).json()) as { items: unknown[]; hasMore: boolean };
  assert.equal(one.items.length, 1);
  const past = (await (await call("/history?limit=1&page=2")).json()) as { items: unknown[]; hasMore: boolean };
  assert.deepEqual([past.items.length, past.hasMore], [0, false]);
  assert.equal((await call("/history?page=0")).status, 400);
  assert.equal((await call("/live/00000000-0000-4000-8000-000000000000", { as: null })).status, 404);
});

test("two confirmations of one quote pay once", async () => {
  const { call, settler } = setup();
  const quote = (await (await call("/ask", { body: { question: QUESTION } })).json()) as { jobId: string; code: string };
  const [a, b] = await Promise.all([
    call(`/hires/${quote.jobId}/confirm`, { body: { code: quote.code } }),
    call(`/hires/${quote.jobId}/confirm`, { body: { code: quote.code } }),
  ]);
  const results = [(await a.json()) as { ok: boolean; code?: string }, (await b.json()) as { ok: boolean; code?: string }];
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.ok(results.some((r) => !r.ok && ["already_processed", "already_used"].includes(r.code!)), JSON.stringify(results));
  assert.equal(settler.calls.length, 1);
});

test("a bad body, a bad max price, the off switch and the rate limit are refused before any quote", async () => {
  const { call, store } = setup();
  assert.equal((await call("/ask", { body: { question: 42 } })).status, 400);
  assert.equal((await call("/ask", { body: { question: QUESTION, maxPrice: "lots" } })).status, 400);
  assert.equal(store.jobs.size, 0);
  const off = setup({ off: true });
  const offRes = await off.call("/ask", { body: { question: QUESTION } });
  assert.equal(offRes.status, 503);
  assert.deepEqual(await offRes.json(), { error: "web_off" });
  const limited = setup({ askLimit: () => false });
  assert.equal((await limited.call("/ask", { body: { question: QUESTION } })).status, 429);
});

test("the wallet view, lower limits, freeze, unfreeze and withdraw work from the browser", async () => {
  const { call, services } = setup();
  const none = await call("/wallet");
  assert.equal(none.status, 404, "reading the wallet never creates one");
  await services.wallet(`op:${ALICE}`);
  const wallet = (await (await call("/wallet")).json()) as Record<string, unknown>;
  assert.deepEqual(
    [wallet.network, wallet.testnet, wallet.balance, wallet.perHire, wallet.daily, wallet.leftToday, wallet.frozen],
    ["Arc Testnet", true, "5.00", "0.50", "2.00", "2.00", false],
  );
  assert.match(String(wallet.address), /^0x[0-9a-f]{40}$/);
  assert.deepEqual(await (await call("/wallet/limits", { body: { perHire: "0.20" } })).json(), { ok: true });
  assert.deepEqual(await (await call("/wallet/limits", { body: { perHire: "5" } })).json(), { ok: false, code: "above_default" });
  assert.equal((await call("/wallet/limits", { body: { perHire: "abc" } })).status, 400);
  assert.deepEqual(await (await call("/wallet/freeze", { body: {} })).json(), { frozen: true });
  const unfreeze = (await (await call("/wallet/unfreeze", { body: {} })).json()) as { approvalUrl: string };
  assert.match(unfreeze.approvalUrl, /^https:\/\/agon\.surf\/approve\?t=/);
  const withdraw = (await (await call("/wallet/withdraw", { body: { to: `0x${"7".repeat(40)}`, amount: "1.5" } })).json()) as { ok: boolean; approvalUrl: string };
  assert.ok(withdraw.ok && withdraw.approvalUrl.startsWith(`${SITE}/approve?t=`));
  assert.equal((await call("/wallet/withdraw", { body: { to: "nope", amount: "1" } })).status, 400);
});

test("the rate limiter allows the limit per window and then refuses", () => {
  const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.deepEqual([allow("a", 0), allow("a", 10), allow("a", 20), allow("b", 20), allow("a", 1011)], [true, true, false, true, true]);
});

test("the leaderboard reader caches for the window and is null without a season", async () => {
  let reads = 0;
  let clock = 0;
  const reader = createLeaderboardReader(
    { store: { scoringRaw: async () => { reads += 1; return { entries: [], rounds: [], markets: [], forecasts: [], results: [] }; } }, season: { seasonId: 1n } },
    60_000,
    () => clock,
  );
  await reader(5);
  await reader(5);
  assert.equal(reads, 1);
  clock = 61_000;
  await reader(5);
  assert.equal(reads, 2);
  assert.equal(await createLeaderboardReader(null)(5), null);
});

test("a new account accepts the wallet terms once before the first hire creates its agent wallet", async () => {
  const { call } = setup({ termsAccepted: false });
  const terms = (await (await call("/terms")).json()) as { version: string; lines: string[]; accepted: boolean };
  assert.equal(terms.accepted, false);
  assert.equal(terms.version, CUSTODY_TERMS_VERSION);
  assert.ok(terms.lines.some((l) => /withdraw/i.test(l)));
  assert.deepEqual(await (await call("/ask", { body: { question: QUESTION } })).json(), { ok: false, code: "terms_required" });
  assert.equal((await call("/wallet")).status, 404, "no agent wallet was created");
  assert.equal((await call("/terms", { body: { version: "old" } })).status, 400);
  assert.deepEqual(await (await call("/terms", { body: { version: CUSTODY_TERMS_VERSION } })).json(), { accepted: true });
  assert.equal(((await (await call("/terms")).json()) as { accepted: boolean }).accepted, true);
  assert.equal(((await (await call("/ask", { body: { question: QUESTION } })).json()) as { ok: boolean }).ok, true);
  assert.equal((await call("/terms", { as: null })).status, 401);
});

const PICK = {
  source: "circle" as const, reference: "circle:https://analyst.example/ratings", name: "Analyst ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS",
  description: "Analyst ratings", url: "https://analyst.example/ratings", method: "GET" as const, inputSchema: null, price: 10_000n, payTo: null, network: "arc" as const,
  rating: { tier: "unrated" as const, score: null }, latencyMs: null, tags: [], fee: 150n, total: 10_150n, reason: "Not rated by Agon, from LoneStarOracle on Circle",
};
function fakeRouter(calls: string[]): Router {
  return {
    route: async () => ({ kind: "pick", routeId: "r1", intent: { kind: "market_data", query: "ratings", values: {} }, pick: PICK, alternatives: [], sources: [{ id: "agon", status: "ok" }, { id: "circle", status: "ok" }] }),
    quote: async (_o, routeId, reference) => { calls.push(`quote:${routeId}:${reference}`); return { ok: true, step: "confirm_code", jobId: "j1", amount: 10_000n, fee: 150n, total: 10_150n, providerLabel: "Analyst ratings", network: "Arc", testnet: false, expiresAt: new Date(Date.now() + 60_000), code: "4242", input: { symbol: "AAPL" }, source: "circle", reason: PICK.reason }; },
    confirm: async (_o, code) => { calls.push(`confirm:${code}`); return { ok: true, jobId: "j1", amount: 10_000n, txHash: null, result: { price: 1 } }; },
    direct: async (_o, reference, text) => {
      calls.push(`direct:${reference}:${text}`);
      return reference === "gone" ? { kind: "not_hireable" } : { kind: "pick", routeId: "r2", intent: { kind: "other", query: text, values: {} }, pick: { ...PICK, fee: 0n, total: PICK.price, reason: "You chose this agent" }, alternatives: [], sources: [{ id: "agon", status: "ok" }] };
    },
  } as Router;
}

test("a direct hire returns the one chosen agent with no fee, needs sign-in, and says when an agent cannot be hired", async () => {
  const calls: string[] = [];
  const { call } = setup({ router: fakeRouter(calls) });
  const out = (await (await call("/route/direct", { body: { reference: PICK.reference, request: "Forecast the Fed market" } })).json()) as { kind: string; pick: { fee: string; total: string; price: string; reason: string }; alternatives: unknown[] };
  assert.deepEqual([out.kind, out.pick.fee, out.pick.total, out.pick.reason, out.alternatives.length], ["pick", "0.00", "0.01", "You chose this agent", 0]);
  assert.deepEqual(calls, [`direct:${PICK.reference}:Forecast the Fed market`]);
  assert.deepEqual(await (await call("/route/direct", { body: { reference: "gone", request: "anything" } })).json(), { ok: false, code: "not_hireable" });
  assert.equal((await call("/route/direct", { body: { reference: PICK.reference, request: "Forecast it" }, as: null })).status, 401);
});

test("route returns the pick with price, fee, total, network and source", async () => {
  const { call } = setup({ router: fakeRouter([]) });
  const out = (await (await call("/route", { body: { request: "Analyst ratings for AAPL" } })).json()) as { kind: string; routeId: string; pick: { price: string; fee: string; total: string; network: string; source: string; reason: string; rating: { tier: string } } };
  assert.equal(out.kind, "pick");
  assert.deepEqual([out.pick.price, out.pick.fee, out.pick.total, out.pick.network, out.pick.source, out.pick.rating.tier], ["0.01", "0.00015", "0.01015", "arc", "circle", "unrated"]);
});

test("quote then confirm go through the router", async () => {
  const calls: string[] = [];
  const { call } = setup({ router: fakeRouter(calls) });
  const q = (await (await call("/route/quote", { body: { routeId: "r1", reference: PICK.reference } })).json()) as { ok: boolean; total: string; fee: string; code: string; input: Record<string, unknown> };
  assert.deepEqual([q.ok, q.total, q.fee, q.code, q.input.symbol], [true, "0.01015", "0.00015", "4242", "AAPL"]);
  const c = (await (await call("/hires/j1/confirm", { body: { code: "4242" } })).json()) as { ok: boolean };
  assert.equal(c.ok, true);
  assert.deepEqual(calls, [`quote:r1:${PICK.reference}`, "confirm:4242"]);
});

test("route needs the wallet terms and a session; wallet with network=arc uses the outside wallet", async () => {
  const noTerms = setup({ router: fakeRouter([]), termsAccepted: false });
  assert.deepEqual(await (await noTerms.call("/route", { body: { request: "Analyst ratings for AAPL" } })).json(), { ok: false, code: "terms_required" });
  assert.equal((await noTerms.call("/route", { body: { request: "x".repeat(20) }, as: null })).status, 401);
  const outside = { findWallet: async () => ({ networkId: "arc", network: "Arc", testnet: false, explorer: "https://explorer.arc.io", address: `0x${"9".repeat(40)}`, balance: 2_000_000n, perHireCap: 250_000n, dailyCap: 1_000_000n, spentToday: 0n, leftToday: 1_000_000n, frozen: false }) } as unknown as StageServices;
  const t = setup({ router: fakeRouter([]), outside });
  const w = (await (await t.call("/wallet?network=arc")).json()) as { network: string; perHire: string; testnet: boolean };
  assert.deepEqual([w.network, w.perHire, w.testnet], ["Arc", "0.25", false]);
});

test("the Lead's quote carries the routing fee as its own line and the limit counts the total", async () => {
  const world = stageWorld({ fee: { bps: 150, address: `0x${"fe".repeat(20)}` as `0x${string}` } });
  const app = new Hono();
  const terms = { isAccepted: async () => true, accept: async () => true };
  app.route("/agon/app", createAppRoutes({ services: world.services, requireAuth, off: () => false, terms }));
  const res = await app.request("/agon/app/ask", { method: "POST", headers: { "content-type": "application/json", "x-test-address": ALICE }, body: JSON.stringify({ question: QUESTION }) });
  const quote = (await res.json()) as { ok: boolean; amount: string; fee: string; total: string };
  assert.deepEqual([quote.ok, quote.amount, quote.fee, quote.total], [true, "0.30", "0.0045", "0.3045"]);
});

test("final I5 and C2: a routed quote is rate limited, and confirm returns the service's answer", async () => {
  const limited = setup({ router: fakeRouter([]), askLimit: () => false });
  assert.equal((await limited.call("/route/quote", { body: { routeId: "r1", reference: PICK.reference } })).status, 429);
  const { call } = setup({ router: fakeRouter([]) });
  const c = (await (await call("/hires/j1/confirm", { body: { code: "4242" } })).json()) as { ok: boolean; result: unknown };
  assert.deepEqual(c.result, { price: 1 });
});

test("final I1: a failed routed quote never echoes the raw network error", async () => {
  const router = { ...fakeRouter([]), quote: async () => ({ ok: false, code: "network_error", detail: "connect ECONNREFUSED 127.0.0.1:6379" }) } as unknown as Router;
  const { call } = setup({ router });
  const out = (await (await call("/route/quote", { body: { routeId: "r1", reference: PICK.reference } })).json()) as Record<string, unknown>;
  assert.deepEqual(out, { ok: false, code: "network_error" });
});
