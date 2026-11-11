import assert from "node:assert/strict";
import test from "node:test";

import { createEventReader, createMarketFinder, eventLinkIn, marketInText, outcomeIn, outcomeQuestion, type EventMarkets } from "../../src/agon/routing/live-market.ts";

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

// 2026-11-10 production: "https://polymarket.com/event/who-will-leave-trump-administration-before-2027" was
// refused as not found. It is an event holding 21 markets; Agon read the event's name as a market's.
const TRUMP = "https://polymarket.com/event/who-will-leave-trump-administration-before-2027";
const eventMarket = (label: string, yes: string, volume: number, over: Record<string, unknown> = {}) => ({
  conditionId: `0x${"a".repeat(64)}`, question: `Will ${label} leave the Trump administration before 2027?`, groupItemTitle: label,
  slug: `will-${label.toLowerCase().replace(/[^a-z]+/g, "-")}-leave`, outcomes: '["Yes","No"]', outcomePrices: `["${yes}","0.5"]`, volume24hr: volume, closed: false, ...over,
});

test("an event link is told apart from a market link", () => {
  assert.deepEqual(eventLinkIn(`Will this happen? ${TRUMP}`), { link: TRUMP, slug: "who-will-leave-trump-administration-before-2027" });
  assert.equal(eventLinkIn("https://polymarket.com/event/fed-decision/will-the-fed-cut-rates"), null, "a link that names the market is a market link");
  assert.equal(eventLinkIn("no link here"), null);
});

test("an event is read from Polymarket with its open Yes or No markets, busiest first", async () => {
  const calls: string[] = [];
  const read = createEventReader({ fetchImpl: (async (url: string | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify([{ title: "Who will leave Trump Administration before 2027?", slug: "who-will-leave-trump-administration-before-2027", closed: false, markets: [
      eventMarket("Marco Rubio", "0.105", 3383), eventMarket("Pete Hegseth", "0.275", 43620), eventMarket("Gone", "0.5", 99999, { closed: true }), eventMarket("Odd", "0.5", 50000, { outcomes: '["Up","Down"]' }),
    ] }]), { status: 200 });
  }) as typeof fetch });
  const ev = await read("who-will-leave-trump-administration-before-2027");
  assert.match(calls[0]!, /^https:\/\/gamma-api\.polymarket\.com\/events\?slug=who-will-leave-trump-administration-before-2027$/);
  assert.deepEqual(ev?.markets.map((m) => [m.label, m.yesBps, m.ref]), [
    ["Pete Hegseth", 2750, "https://polymarket.com/event/who-will-leave-trump-administration-before-2027/will-pete-hegseth-leave"],
    ["Marco Rubio", 1050, "https://polymarket.com/event/who-will-leave-trump-administration-before-2027/will-marco-rubio-leave"],
  ]);
  const broken = createEventReader({ fetchImpl: (async () => new Response("no", { status: 502 })) as typeof fetch });
  assert.equal(await broken("x"), null);
});

const EVENT: EventMarkets = { title: "Who will leave Trump Administration before 2027?", markets: [
  { label: "Pete Hegseth", question: "Will Pete Hegseth leave?", ref: `${TRUMP}/will-pete-hegseth-leave`, yesBps: 2750, volume24h: 43620 },
  { label: "Kash Patel", question: "Will Kash Patel leave?", ref: `${TRUMP}/will-kash-patel-leave`, yesBps: 2000, volume24h: 1478 },
  { label: "Robert F. Kennedy Jr.", question: "Will RFK Jr. leave?", ref: `${TRUMP}/will-rfk-leave`, yesBps: 1100, volume24h: 4730 },
] };

test("the outcome a person names picks its market; none named picks nothing", () => {
  assert.equal(outcomeIn(EVENT, "Will Hegseth go?")?.label, "Pete Hegseth");
  assert.equal(outcomeIn(EVENT, "kash patel")?.label, "Kash Patel");
  assert.equal(outcomeIn(EVENT, "Robert F. Kennedy Jr.")?.label, "Robert F. Kennedy Jr.");
  assert.equal(outcomeIn(EVENT, "Will this happen?"), null);
});

test("an event with several markets asks which one, naming the busiest with their prices", () => {
  assert.equal(outcomeQuestion(EVENT), "That link is a group of 3 markets. Which one? Pete Hegseth 28%, Kash Patel 20%, Robert F. Kennedy Jr. 11%. Name one, or paste its own link.");
});

// 2026-11-11 production: a link pasted without https was refused as not found.
test("a link typed without https is still read, and a market link comes back with https", () => {
  assert.equal(marketInText("worth it? polymarket.com/event/fed-decision/will-the-fed-cut-rates."), "https://polymarket.com/event/fed-decision/will-the-fed-cut-rates");
  assert.equal(marketInText("see notpolymarket.com/event/fed-decision/will-the-fed-cut-rates"), null);
  assert.deepEqual(eventLinkIn("polymarket.com/event/fed-decision?tid=1"), { link: "polymarket.com/event/fed-decision", slug: "fed-decision" });
});
