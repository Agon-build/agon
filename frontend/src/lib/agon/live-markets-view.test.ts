import assert from "node:assert/strict";
import test from "node:test";

import { checkRequest, liveMarketRow, liveReadLine } from "./live-markets-view.ts";

const market = { question: "Will the Fed cut rates in December?", url: "https://polymarket.com/event/fed/will-the-fed-cut", yesBps: 6230, volume24h: 811_652, liquidity: 120_000, endsAt: "2026-12-16T19:00:00Z" };

// 2026-11-10: Hire shows what is trading on Polymarket now; one press sends a market to Agon's market agents.
test("a live market reads as its question, the Yes price and what traded today", () => {
  assert.deepEqual(liveMarketRow(market), { question: "Will the Fed cut rates in December?", yes: "62%", traded: "$812K traded in 24 hours" });
  assert.equal(liveMarketRow({ ...market, volume24h: 2_340_000 }).traded, "$2.3M traded in 24 hours");
  assert.equal(liveMarketRow({ ...market, volume24h: 950 }).traded, "$950 traded in 24 hours");
});

test("checking a live market asks about that exact market by its link", () => {
  assert.equal(checkRequest(market), "Is this market worth trading? https://polymarket.com/event/fed/will-the-fed-cut");
});

test("the list says when Polymarket was read", () => {
  assert.equal(liveReadLine("2026-11-10T09:41:07.000Z"), "Read from Polymarket at 09:41:07 UTC");
  assert.equal(liveReadLine("nonsense"), null);
});
