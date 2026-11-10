import assert from "node:assert/strict";
import test from "node:test";

import { createLiveMarkets } from "../../src/agon/stage/live-markets.ts";

const NOW = new Date("2026-11-10T09:00:00Z");
const m = (over: Record<string, unknown>) => ({
  question: "Will the Fed cut rates in December?", slug: "will-the-fed-cut-rates-in-december", outcomes: '["Yes", "No"]', outcomePrices: '["0.62", "0.38"]',
  volume24hr: 900_000, liquidityNum: 120_000, endDate: "2026-12-16T19:00:00Z", closed: false, events: [{ slug: "fed-decision-in-december" }], ...over,
});

// 2026-11-10: nothing on Hire showed what is trading on Polymarket right now.
test("the busiest open Yes or No markets are read from Polymarket, one per event, with when they were read", async () => {
  const calls: string[] = [];
  const rows = [
    m({}),
    m({ question: "Will the Fed raise rates in December?", slug: "raise", volume24hr: 800_000 }),
    m({ question: "Will Shawn Fain win the nomination?", slug: "fain", outcomePrices: '["0.0025", "0.9975"]', events: [{ slug: "dem-nom" }] }),
    m({ question: "Bitcoin up or down today?", slug: "btc-up", outcomes: '["Up", "Down"]', events: [{ slug: "btc" }] }),
    m({ question: "Will Arsenal win tonight?", slug: "ars", endDate: "2026-11-10T09:20:00Z", events: [{ slug: "ars-match" }] }),
    m({ question: "Thin market?", slug: "thin", liquidityNum: 900, events: [{ slug: "thin" }] }),
    m({ question: "Will Bitcoin reach $150,000 this year?", slug: "btc-150k", outcomePrices: '["0.21", "0.79"]', volume24hr: 400_000, events: [{ slug: "btc-price" }] }),
  ];
  const live = createLiveMarkets({ now: () => NOW, fetchImpl: (async (url: string | URL) => { calls.push(String(url)); return new Response(JSON.stringify(rows), { status: 200 }); }) as typeof fetch });
  const out = await live();
  assert.ok(out);
  assert.equal(out.readAt, NOW.toISOString());
  assert.deepEqual(out.markets, [
    { question: "Will the Fed cut rates in December?", url: "https://polymarket.com/event/fed-decision-in-december/will-the-fed-cut-rates-in-december", yesBps: 6200, volume24h: 900_000, liquidity: 120_000, endsAt: "2026-12-16T19:00:00Z" },
    { question: "Will Bitcoin reach $150,000 this year?", url: "https://polymarket.com/event/btc-price/btc-150k", yesBps: 2100, volume24h: 400_000, liquidity: 120_000, endsAt: "2026-12-16T19:00:00Z" },
  ]);
  assert.match(calls[0]!, /^https:\/\/gamma-api\.polymarket\.com\/markets\?/);
  assert.match(calls[0]!, /closed=false/);
  assert.match(calls[0]!, /order=volume24hr/);
  await live();
  assert.equal(calls.length, 1, "a second read inside half a minute reuses the first");
});

test("when Polymarket does not answer, the last good read is kept; with none there is nothing to show", async () => {
  let ok = true;
  let t = NOW.getTime();
  const live = createLiveMarkets({ now: () => new Date(t), ttlMs: 1_000, fetchImpl: (async () => (ok ? new Response(JSON.stringify([m({})]), { status: 200 }) : new Response("no", { status: 502 }))) as typeof fetch });
  const first = await live();
  ok = false;
  t += 5_000;
  assert.deepEqual(await live(), first);
  const never = createLiveMarkets({ fetchImpl: (async () => { throw new Error("down"); }) as typeof fetch });
  assert.equal(await never(), null);
});
