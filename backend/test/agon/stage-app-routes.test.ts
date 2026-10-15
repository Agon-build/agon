import assert from "node:assert/strict";
import test from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { createAppRoutes } from "../../src/agon/stage/app-routes.ts";
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

function setup(opts: { off?: boolean; askLimit?: (key: string) => boolean } = {}) {
  const world = stageWorld();
  const app = new Hono();
  app.route("/agon/app", createAppRoutes({ services: world.services, requireAuth, off: () => opts.off ?? false, askLimit: opts.askLimit }));
  const call = (path: string, init: { method?: string; body?: unknown; as?: string | null } = {}) =>
    app.request(`/agon/app${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...(init.as === null ? {} : { "x-test-address": init.as ?? ALICE }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  return { ...world, app, call };
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
