import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseBook, parseHistory } from "../../src/agon/polymarket/clob.ts";
import { parseHolders, parseOpenInterest, parseTrades } from "../../src/agon/polymarket/data.ts";
import { PolymarketUnavailable, costToTrade, createPolymarket, depthWithin, flowOf, type Book, type Trade } from "../../src/agon/polymarket/index.ts";

// Payloads recorded from Polymarket on 2026-11-11 and trimmed (see the phase 1 plan).
const recorded = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/polymarket/${name}.json`, import.meta.url), "utf8"));
const TOKEN = "17640596861394454242836532536014033416733783473450136742726948856144855149507";
const CONDITION = `0x${"b9".repeat(32)}`;

const book = (over: Partial<Book> = {}): Book => ({
  tokenId: TOKEN, tickSize: 0.01, minOrderSize: 5, lastTradePrice: 0.49,
  bids: [{ price: 0.48, size: 200 }, { price: 0.45, size: 100 }],
  asks: [{ price: 0.5, size: 100 }, { price: 0.52, size: 100 }],
  ...over,
});

test("a buy takes the cheapest asks first and reports the price it would really get", () => {
  assert.deepEqual(costToTrade(book(), "buy", 60), {
    side: "buy", requestedUsd: 60, filledUsd: 60, shares: 119.2308, averagePrice: 0.50323, bestPrice: 0.5, slippageCents: 0.32, levelsUsed: 2, unfilledUsd: 0,
  });
  const small = costToTrade(book(), "buy", 10);
  assert.equal(small.averagePrice, 0.5);
  assert.equal(small.slippageCents, 0);
  assert.equal(small.levelsUsed, 1);
});

test("a size larger than the whole book reports what could not be filled", () => {
  const cost = costToTrade(book(), "buy", 200);
  assert.equal(cost.filledUsd, 102);
  assert.equal(cost.unfilledUsd, 98);
  assert.equal(cost.shares, 200);
});

test("an empty side of the book fills nothing and divides by nothing", () => {
  assert.deepEqual(costToTrade(book({ asks: [] }), "buy", 50), {
    side: "buy", requestedUsd: 50, filledUsd: 0, shares: 0, averagePrice: null, bestPrice: null, slippageCents: null, levelsUsed: 0, unfilledUsd: 50,
  });
  assert.equal(costToTrade(book(), "buy", 0).filledUsd, 0);
  assert.equal(costToTrade(book(), "buy", Number.NaN).requestedUsd, 0);
});

test("a sell takes the highest bids first", () => {
  const cost = costToTrade(book(), "sell", 100);
  assert.equal(cost.filledUsd, 100);
  assert.equal(cost.shares, 208.8889);
  assert.equal(cost.averagePrice, 0.47872);
  assert.equal(cost.bestPrice, 0.48);
  assert.equal(cost.slippageCents, 0.13);
});

test("depth counts the money resting within some cents of the best price", () => {
  assert.deepEqual(depthWithin(book(), 2), { bidUsd: 96, askUsd: 102 });
  assert.deepEqual(depthWithin(book({ bids: [], asks: [] }), 2), { bidUsd: 0, askUsd: 0 });
});

test("a recorded order book is read with the best price first on both sides", () => {
  const b = parseBook(recorded("book"));
  assert.equal(b.bids[0]!.price, 0.002);
  assert.equal(b.asks[0]!.price, 0.003);
  assert.ok(b.bids.every((l, i) => i === 0 || l.price <= b.bids[i - 1]!.price), "bids fall");
  assert.ok(b.asks.every((l, i) => i === 0 || l.price >= b.asks[i - 1]!.price), "asks rise");
  assert.equal(b.tickSize, 0.001);
  assert.ok(b.minOrderSize > 0);
  assert.match(b.tokenId, /^\d+$/);
});

test("an order book or history Agon cannot read is unavailable, never guessed", () => {
  assert.throws(() => parseBook({ bids: "none" }), PolymarketUnavailable);
  assert.throws(() => parseBook(null), PolymarketUnavailable);
  assert.throws(() => parseHistory({ history: [{ t: "soon", p: 2 }] }), PolymarketUnavailable);
});

test("recorded price history is read oldest first", () => {
  const points = parseHistory(recorded("prices-history"));
  assert.equal(points.length, 8);
  assert.ok(points.every((p, i) => p.price >= 0 && p.price <= 1 && (i === 0 || p.at >= points[i - 1]!.at)));
});

test("recorded trades, holders and open interest are read", () => {
  const trades = parseTrades(recorded("trades"));
  assert.equal(trades.length, 4);
  for (const t of trades) {
    assert.match(t.wallet, /^0x[0-9a-f]{40}$/);
    assert.ok(t.side === "buy" || t.side === "sell");
    assert.equal(t.usd, Math.round(t.shares * t.price * 100) / 100);
    assert.ok(t.at > 1_700_000_000);
    assert.ok(t.outcomeIndex === 0 || t.outcomeIndex === 1);
  }
  assert.ok(trades.every((t, i) => i === 0 || t.at <= trades[i - 1]!.at), "newest first");

  const holders = parseHolders(recorded("holders"));
  assert.ok(holders.length >= 1);
  assert.deepEqual(holders[0]!.holders[0], { wallet: "0x947208f83ad6b0a80a22557d3a0d4ae56c0ff660", name: "K80PRO", shares: 399404.170582, outcomeIndex: 0 });
  assert.ok(holders.every((g) => g.holders.every((h, i) => i === 0 || h.shares <= g.holders[i - 1]!.shares)), "largest first");

  assert.equal(parseOpenInterest(recorded("oi")), 55908.09897);
  assert.throws(() => parseTrades({ rows: [] }), PolymarketUnavailable);
  assert.throws(() => parseTrades({ data: [{ nothing: true }] }), PolymarketUnavailable);
  assert.deepEqual(parseTrades({ data: [] }), []);
  assert.throws(() => parseOpenInterest({ data: [] }), PolymarketUnavailable);
});

test("buying an outcome or selling the other one is money toward that outcome", () => {
  const t = (over: Partial<Trade>): Trade => ({ wallet: "0xa", side: "buy", tokenId: TOKEN, outcome: "", outcomeIndex: 0, shares: 0, price: 0, usd: 0, at: 1_000, txHash: "", ...over });
  const flow = flowOf([
    t({ usd: 100, wallet: "0xa", at: 1_000 }),
    t({ usd: 30, wallet: "0xb", side: "sell", at: 1_001 }),
    t({ usd: 50, wallet: "0xa", outcomeIndex: 1, at: 1_002 }),
    t({ usd: 20, wallet: "0xc", outcomeIndex: 1, side: "sell", at: 1_003 }),
    t({ usd: 999, wallet: "0xd", at: 10 }),
  ], 500);
  assert.equal(flow.towardFirstUsd, 120);
  assert.equal(flow.towardSecondUsd, 80);
  assert.equal(flow.netTowardFirstUsd, 40);
  assert.equal(flow.count, 4);
  assert.equal(flow.wallets, 3);
  assert.deepEqual(flow.largest.map((x) => x.usd), [100, 50, 30]);
});

function fakePolymarket(opts: { timeoutMs?: number } = {}) {
  const state = { now: 1_800_000_000_000, down: false, hang: false, calls: [] as string[] };
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    state.calls.push(url.toString());
    if (state.hang) return new Promise<Response>(() => {});
    if (state.down) return new Response("no", { status: 503 });
    if (url.pathname === "/book") return Response.json(recorded("book"));
    if (url.pathname === "/prices-history") return Response.json(recorded("prices-history"));
    if (url.pathname === "/v2/trades") return Response.json(recorded("trades"));
    if (url.pathname === "/v2/holders") return Response.json(recorded("holders"));
    if (url.pathname === "/v2/oi") return Response.json(recorded("oi"));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { state, pm: createPolymarket({ fetchImpl, now: () => state.now, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) }) };
}

test("every read says when and where it was read, and asks Polymarket's own addresses", async () => {
  const { state, pm } = fakePolymarket();
  const b = await pm.book(TOKEN);
  assert.equal(b.source, "https://clob.polymarket.com/book");
  assert.equal(b.readAt, new Date(state.now).toISOString());
  assert.equal(b.ageMs, 0);
  assert.equal((await pm.trades(CONDITION)).value.length, 4);
  assert.equal((await pm.history(TOKEN, "1w")).value.length, 8);
  assert.ok((await pm.holders(CONDITION, 3)).value.length >= 1);
  assert.equal((await pm.openInterest(CONDITION)).value, 55908.09897);
  assert.deepEqual(state.calls, [
    `https://clob.polymarket.com/book?token_id=${TOKEN}`,
    `https://data-api.polymarket.com/v2/trades?condition_id=${CONDITION}&limit=200`,
    `https://clob.polymarket.com/prices-history?market=${TOKEN}&interval=1w&fidelity=60`,
    `https://data-api.polymarket.com/v2/holders?condition_id=${CONDITION}&limit=3`,
    `https://data-api.polymarket.com/v2/oi?condition_id=${CONDITION}`,
  ]);
  await assert.rejects(pm.book("not-a-token"), TypeError);
  await assert.rejects(pm.trades("0x12"), TypeError);
});

test("a read inside its keep time does not ask Polymarket again", async () => {
  const { state, pm } = fakePolymarket();
  await pm.book(TOKEN);
  state.now += 1_000;
  const again = await pm.book(TOKEN);
  assert.equal(state.calls.length, 1);
  assert.equal(again.ageMs, 1_000);
  state.now += 1_500;
  assert.equal((await pm.book(TOKEN)).ageMs, 0);
  assert.equal(state.calls.length, 2);
  const both = await Promise.all([pm.openInterest(CONDITION), pm.openInterest(CONDITION)]);
  assert.equal(state.calls.length, 3, "two callers share one read");
  assert.equal(both[0].value, both[1].value);
});

test("when Polymarket fails a kept copy is served with its age, and with no copy the read fails", async () => {
  const { state, pm } = fakePolymarket();
  const first = await pm.book(TOKEN);
  state.down = true;
  state.now += 10_000;
  const kept = await pm.book(TOKEN);
  assert.equal(kept.ageMs, 10_000);
  assert.equal(kept.readAt, first.readAt);
  state.now += 30_000;
  await assert.rejects(pm.book(TOKEN), PolymarketUnavailable, "a copy older than its limit is not served");
  await assert.rejects(pm.openInterest(CONDITION), PolymarketUnavailable);
});

test("a call that hangs fails inside the time limit", async () => {
  const { state, pm } = fakePolymarket({ timeoutMs: 20 });
  state.hang = true;
  const started = Date.now();
  await assert.rejects(pm.book(TOKEN), (error: unknown) => error instanceof PolymarketUnavailable && /did not answer in 20 ms/.test(error.message));
  assert.ok(Date.now() - started < 1_000);
});
