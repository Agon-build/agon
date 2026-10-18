import assert from "node:assert/strict";
import test from "node:test";

import { findMarkets, pickMarket, priceFromPayload, searchQueryFor } from "../../src/agon/lead-agent/market-parse.ts";

const a = `0x${"aa".repeat(32)}`;
const b = `0x${"bb".repeat(32)}`;
const now = new Date("2026-10-27T12:00:00Z");

test("markets are found in the stand-in shape and in nested unknown shapes", () => {
  const standin = { markets: [{ conditionId: a, question: "Will the price of Bitcoin be above $82,000 on October 30?", slug: "s", endDate: "2026-10-30T16:00:00Z", yesPriceBps: 4100 }] };
  assert.deepEqual(findMarkets(standin), [{ conditionId: a, question: "Will the price of Bitcoin be above $82,000 on October 30?", slug: "s", endDate: "2026-10-30T16:00:00Z", yesPriceBps: 4100 }]);
  const nested = { data: { results: [{ venue: "polymarket", market: { conditionId: b, question: "Will ETH be above $2,600 on October 30?", outcomes: '["Yes","No"]', outcomePrices: '["0.25","0.75"]', endDate: "2026-10-30T16:00:00Z" } }] } };
  assert.equal(findMarkets(nested)[0]!.yesPriceBps, 2500);
  assert.deepEqual(findMarkets("not json"), []);
  assert.deepEqual(findMarkets({ conditionId: "0x12", question: "short id" }), []);
});

test("prices are read from DefiLlama-shaped payloads, also when wrapped", () => {
  assert.equal(priceFromPayload({ coins: { "coingecko:bitcoin": { price: 82953.31 } } }, "coingecko:bitcoin"), 82953.31);
  assert.equal(priceFromPayload({ data: { coins: { "coingecko:bitcoin": { price: 1 } } } }, "coingecko:bitcoin"), 1);
  assert.equal(priceFromPayload({ coins: {} }, "coingecko:bitcoin"), null);
});

test("the search query keeps the meaningful words and normalises prices", () => {
  assert.equal(searchQueryFor("What's the real chance BTC closes above $82k on Friday? Spend up to 0.50"), "bitcoin above 82000");
});

// 2026-10-18: every web hire refunded. Words about trading itself ("market", "Polymarket",
// "worth trading") went into the search and narrowed it to one closed event.
test("words about trading are not searched for, only the subject of the question", () => {
  assert.equal(searchQueryFor("Is the Arsenal Premier League market on Polymarket worth trading"), "arsenal premier league");
  assert.equal(searchQueryFor("Should I bet on the odds that Bitcoin is above $74k?"), "bitcoin above 74000");
});

test("a broad team question picks an open market about that team and league", () => {
  const markets = [
    { conditionId: a as `0x${string}`, question: "Will Arsenal win the 2026-27 English Premier League (EPL) Championship?", slug: "", endDate: "2027-05-30T23:59:00Z", yesPriceBps: 4200 },
    { conditionId: b as `0x${string}`, question: "Will Nottingham Forest FC vs. Arsenal FC end in a draw?", slug: "", endDate: "2026-10-28T15:30:00Z", yesPriceBps: 2500 },
  ];
  assert.equal(pickMarket(markets, "Is the Arsenal Premier League market on Polymarket worth trading", now)!.conditionId, a);
});

test("the best market overlaps the question most, is still open, and prefers a known price", () => {
  const markets = [
    { conditionId: a as `0x${string}`, question: "Will the price of Bitcoin be above $82,000 on October 30?", slug: "", endDate: "2026-10-30T16:00:00Z", yesPriceBps: 4100 },
    { conditionId: b as `0x${string}`, question: "Will the price of Ethereum be above $2,600 on October 30?", slug: "", endDate: "2026-10-30T16:00:00Z", yesPriceBps: 2500 },
    { conditionId: `0x${"cc".repeat(32)}` as `0x${string}`, question: "Will the price of Bitcoin be above $82,000 on October 20?", slug: "", endDate: "2026-10-20T16:00:00Z", yesPriceBps: 9900 },
  ];
  assert.equal(pickMarket(markets, "What's the real chance BTC closes above $82k on Friday?", now)!.conditionId, a);
  assert.equal(pickMarket(markets, "Will it rain in Dubai?", now), null);
});
