import assert from "node:assert/strict";
import test from "node:test";

import { createMarketFinder, marketInText } from "../../src/agon/routing/live-market.ts";

const NOW = new Date("2026-11-10T09:00:00Z");
const gammaMarket = (over: Record<string, unknown>) => ({
  conditionId: `0x${"a".repeat(64)}`, question: "Will the Fed cut rates in December?", slug: "will-the-fed-cut-rates-in-december",
  endDate: "2026-12-16T19:00:00Z", outcomes: '["Yes","No"]', outcomePrices: '["0.62","0.38"]', closed: false, ...over,
});
const search = (events: unknown[]) => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ events }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, find: createMarketFinder({ fetchImpl }) };
};

// 2026-11-10: Scout, Pitch and Resolution Watch asked for a market link even when the person had named the event.
test("a request that names an event is matched to the live Polymarket market, with its link", async () => {
  const { calls, find } = search([{ title: "Fed decision in December?", slug: "fed-decision-in-december", markets: [gammaMarket({}), gammaMarket({ question: "Will the Fed raise rates in December?", slug: "will-the-fed-raise-rates-in-december" })] }]);
  const found = await find("Check the Polymarket market on a Fed rate cut in December", NOW);
  assert.deepEqual(found, { ref: "https://polymarket.com/event/fed-decision-in-december/will-the-fed-cut-rates-in-december", question: "Will the Fed cut rates in December?", yesBps: 6200 });
  assert.match(calls[0]!, /^https:\/\/gamma-api\.polymarket\.com\/public-search\?/);
  assert.match(calls[0]!, /events_status=active/, "only open events are searched");
});

test("closed markets, markets that are not Yes or No, and a failed search give no match", async () => {
  const closed = search([{ title: "Fed decision", slug: "fed", markets: [gammaMarket({ closed: true }), gammaMarket({ outcomes: '["Up","Down"]' })] }]);
  assert.equal(await closed.find("Fed rate cut in December", NOW), null);
  const broken = createMarketFinder({ fetchImpl: (async () => new Response("no", { status: 502 })) as typeof fetch });
  assert.equal(await broken("Fed rate cut in December", NOW), null);
  assert.equal(await search([]).find("Fed rate cut in December", NOW), null);
});

test("a Polymarket link or condition id the person typed is used as it is", () => {
  assert.equal(marketInText("Is https://polymarket.com/event/fed-decision/will-the-fed-cut-rates worth trading?"), "https://polymarket.com/event/fed-decision/will-the-fed-cut-rates");
  assert.equal(marketInText(`check 0x${"B".repeat(64)} please`), `0x${"b".repeat(64)}`);
  assert.equal(marketInText("Check the Fed market, see https://example.com/polymarket.com/x"), null);
  assert.equal(marketInText("Check the Fed rate cut market"), null);
});
