import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_ALERT_FINGERPRINT, PolymarketUnavailable, contractAlerts, runContractCheck, type Market, type Polymarket } from "../../src/agon/polymarket/index.ts";

const market = (over: Partial<Market> = {}): Market => ({
  conditionId: `0x${"b9".repeat(32)}`, slug: "fed-december", url: "https://polymarket.com/event/fed/fed-december", question: "Will the Fed cut rates in December?",
  endAt: new Date("2026-12-10T00:00:00Z"), outcomes: [{ label: "Yes", tokenId: "111", price: 0.6 }, { label: "No", tokenId: "222", price: 0.4 }], yesNo: true, yesBps: 6000,
  bestBid: 0.59, bestAsk: 0.61, spread: 0.02, liquidity: 90_000, volume24h: 2_000_000, weekChange: 0, description: "", tags: [], closed: false, umaStatuses: [],
  tickSize: 0.01, minOrderSize: 5, acceptingOrders: true, negRisk: false, ...over,
});
const read = <T>(value: T) => ({ value, readAt: "2026-11-11T00:00:00.000Z", source: "test", ageMs: 0 });
const NOW = () => new Date("2026-11-11T06:00:00.000Z");

/// A Polymarket that answers every read; a test replaces the reads it wants to break.
const healthy = (over: Partial<Polymarket> = {}): Polymarket => ({
  resolve: async () => ({ ok: true, market: market() }),
  topMarkets: async () => read([market({ slug: "paused", acceptingOrders: false }), market()]),
  book: async () => read({ tokenId: "111", bids: [{ price: 0.59, size: 10 }], asks: [{ price: 0.61, size: 10 }], tickSize: 0.01, minOrderSize: 5, lastTradePrice: 0.6 }),
  history: async () => read([{ at: 1_794_000_000, price: 0.6 }]),
  trades: async () => read([{ wallet: "0xa", side: "buy" as const, tokenId: "111", outcome: "Yes", outcomeIndex: 0, shares: 10, price: 0.6, usd: 6, at: 1_794_000_000, txHash: "" }]),
  holders: async () => read([{ tokenId: "111", holders: [{ wallet: "0xa", name: "", shares: 10, outcomeIndex: 0 }] }]),
  openInterest: async () => read(55_908),
  ...over,
});

test("every read of the busiest open market passes, and nothing is raised", async () => {
  const result = await runContractCheck({ polymarket: healthy(), now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.market, "fed-december", "a market that is not taking orders is passed over");
  assert.equal(result.checkedAt, "2026-11-11T06:00:00.000Z");
  assert.deepEqual(result.lines.map((l) => [l.name, l.ok]), [
    ["market list", true], ["market lookup", true], ["order book", true], ["price history", true], ["trades", true], ["holders", true], ["open interest", true],
  ]);
  assert.deepEqual(contractAlerts(result), []);
});

test("a retired endpoint and an empty read are both named in one alert to the operator", async () => {
  const result = await runContractCheck({
    polymarket: healthy({
      book: async () => { throw new PolymarketUnavailable("clob.polymarket.com/book answered 410"); },
      trades: async () => read([]),
    }),
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.lines.filter((l) => !l.ok).map((l) => l.name), ["order book", "trades"]);
  const alerts = contractAlerts(result);
  assert.equal(alerts.length, 1);
  assert.deepEqual([alerts[0]!.fingerprint, alerts[0]!.severity, alerts[0]!.title], [CONTRACT_ALERT_FINGERPRINT, "critical", "Polymarket data check failed"]);
  assert.ok(alerts[0]!.body.includes("order book (clob.polymarket.com/book answered 410)"), alerts[0]!.body);
  assert.ok(alerts[0]!.body.includes("trades (0 trades)"), alerts[0]!.body);
});

test("when the market list cannot be read the check stops there and says so", async () => {
  const result = await runContractCheck({ polymarket: healthy({ topMarkets: async () => { throw new PolymarketUnavailable("gamma-api.polymarket.com/markets did not answer in 3000 ms"); } }), now: NOW });
  assert.deepEqual([result.ok, result.market, result.lines.length], [false, null, 1]);
  assert.match(result.lines[0]!.detail, /did not answer/);
  const none = await runContractCheck({ polymarket: healthy({ topMarkets: async () => read([market({ acceptingOrders: false })]) }), now: NOW });
  assert.deepEqual([none.ok, none.market], [false, null]);
});

test("a market the lookup no longer finds fails the check with the reason", async () => {
  const result = await runContractCheck({ polymarket: healthy({ resolve: async () => ({ ok: false, code: "market_unavailable" }) }), now: NOW });
  assert.deepEqual(result.lines.filter((l) => !l.ok).map((l) => [l.name, l.detail]), [["market lookup", "market_unavailable"]]);
});
