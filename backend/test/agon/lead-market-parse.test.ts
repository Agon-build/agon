import assert from "node:assert/strict";
import test from "node:test";

import { fallbackQueryFor, findMarkets, matchMarket, pickMarket, priceFromPayload, searchQueryFor } from "../../src/agon/lead-agent/market-parse.ts";

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

// 2026-10-20: "Who will win between Barcelona and PSG" was refunded although Polymarket had
// "Paris Saint-Germain FC vs. FC Barcelona" open. Filler words and the short club name went into
// the search ("who win between barcelona psg"), which Polymarket matched to Senate markets.
test("filler words are not searched for, and short club names are spelled the way Polymarket does", () => {
  assert.equal(searchQueryFor("Who will win between Barcelona and PSG"), "barcelona paris saint germain");
  assert.equal(searchQueryFor("Will Barça beat Real Madrid?"), "barcelona real madrid");
  assert.equal(searchQueryFor("Will Arsenal win against Bayern?"), "arsenal bayern");
});

test("a wider search uses the first name in the question when it differs from the full search", () => {
  assert.equal(fallbackQueryFor("Who will win between Barcelona and PSG"), "barcelona");
  assert.equal(fallbackQueryFor("Will Trump win?"), null);
});

const psgWin = { conditionId: a as `0x${string}`, question: "Will Paris Saint-Germain FC win on 2026-10-28?", slug: "", endDate: "2026-10-28T19:00:00Z", yesPriceBps: 4600, eventTitle: "Paris Saint-Germain FC vs. FC Barcelona" };
const barcaWin = { conditionId: b as `0x${string}`, question: "Will FC Barcelona win on 2026-10-28?", slug: "", endDate: "2026-10-28T19:00:00Z", yesPriceBps: 3100, eventTitle: "Paris Saint-Germain FC vs. FC Barcelona" };
const draw = { conditionId: `0x${"cc".repeat(32)}` as `0x${string}`, question: "Will Paris Saint-Germain FC vs. FC Barcelona end in a draw?", slug: "", endDate: "2026-10-28T19:00:00Z", yesPriceBps: 2300, eventTitle: "Paris Saint-Germain FC vs. FC Barcelona" };
const barcaMadrid = { conditionId: `0x${"dd".repeat(32)}` as `0x${string}`, question: "Will FC Barcelona win on 2026-11-02?", slug: "", endDate: "2026-11-02T20:00:00Z", yesPriceBps: 5000, eventTitle: "FC Barcelona vs. Real Madrid CF" };

test("a match question picks that match, and the first team named in the question", () => {
  assert.equal(pickMarket([psgWin, draw, barcaWin, barcaMadrid], "Who will win between Barcelona and PSG", now)!.conditionId, b);
  assert.equal(pickMarket([psgWin, draw, barcaWin, barcaMadrid], "Will PSG beat Barcelona?", now)!.conditionId, a);
});

test("the event title is read with the market, and accents do not stop a match", () => {
  const alaves = { conditionId: a as `0x${string}`, question: "Will FC Barcelona win on 2026-10-31?", slug: "", endDate: "2026-10-31T20:00:00Z", yesPriceBps: 7800, eventTitle: "FC Barcelona vs. Deportivo Alavés" };
  assert.equal(pickMarket([barcaMadrid, alaves], "Will Barcelona beat Alaves?", now)!.conditionId, a);
  assert.equal(findMarkets({ markets: [alaves] })[0]!.eventTitle, "FC Barcelona vs. Deportivo Alavés");
});

test("a match that already started is reported, not swapped for a weaker match", () => {
  const started = { ...barcaWin, endDate: "2026-10-27T11:00:00Z" };
  const startedPsg = { ...psgWin, endDate: "2026-10-27T11:00:00Z" };
  const found = matchMarket([startedPsg, started, barcaMadrid], "Who will win between Barcelona and PSG", now);
  assert.equal(found.market, null);
  assert.equal(found.started!.conditionId, b);
  assert.deepEqual(matchMarket([barcaWin, barcaMadrid], "Who will win between Barcelona and PSG", now), { market: barcaWin, started: null });
});

// A question about $120k must not be answered with the $84,600 market just because both say Bitcoin above.
test("a number in the question must be in the market", () => {
  const low = { conditionId: a as `0x${string}`, question: "Bitcoin above 84,600 on October 30, 5PM ET?", slug: "", endDate: "2026-10-30T21:00:00Z", yesPriceBps: 2250 };
  assert.equal(pickMarket([low], "What's the real chance BTC closes above $120k on Friday?", now), null);
  assert.equal(pickMarket([low], "Will Bitcoin be above $84.6k on October 30?", now)!.conditionId, a);
});

test("Democrats match the party name Polymarket uses, and control reads as win", () => {
  const party = { conditionId: b as `0x${string}`, question: "Will the Democratic Party control the Senate after the 2026 Midterm elections?", slug: "", endDate: "2026-11-04T05:00:00Z", yesPriceBps: 3000 };
  assert.equal(pickMarket([party], "Will the Democrats take the Senate?", now)!.conditionId, b);
  assert.equal(pickMarket([party], "Will the Dems win?", now)!.conditionId, b);
});

test("across events a market whose own question covers more of the question wins", () => {
  const where = { conditionId: a as `0x${string}`, question: "Will Trump and Putin meet next in Belarus?", slug: "", endDate: "2027-01-01T05:00:00Z", yesPriceBps: 5, eventTitle: "Where will Trump and Putin meet next in 2026?" };
  const meet = { conditionId: b as `0x${string}`, question: "Will Trump meet with Vladimir Putin in 2026?", slug: "", endDate: "2027-01-01T05:00:00Z", yesPriceBps: 8350, eventTitle: "Who will Trump meet with in 2026?" };
  assert.equal(pickMarket([where, meet], "Will Trump meet Putin in 2026?", now)!.conditionId, b);
});

test("across events a tie goes to the market the search ranked first", () => {
  const control = { conditionId: a as `0x${string}`, question: "Will the Democratic Party control the Senate after the 2026 Midterm elections?", slug: "", endDate: "2026-11-04T05:00:00Z", yesPriceBps: 4100, eventTitle: "Which party will win the Senate in 2026?" };
  const texas = { conditionId: b as `0x${string}`, question: "Will the Democratic Party candidate win the 2026 Texas Senate election by 0%-3%?", slug: "", endDate: "2026-11-04T05:00:00Z", yesPriceBps: 3350, eventTitle: "Texas Senate margin" };
  assert.equal(pickMarket([control, texas], "Will the Democrats win the Senate?", now)!.conditionId, a);
  assert.equal(pickMarket([texas, control], "Will the Democrats win the Senate?", now)!.conditionId, b);
});

test("a matchup question needs a market that names every side", () => {
  const ucl = { conditionId: a as `0x${string}`, question: "Will Manchester City win the 2026-27 UEFA Champions League Championship?", slug: "", endDate: "2027-06-01T00:00:00Z", yesPriceBps: 650, eventTitle: "UEFA Champions League Winner" };
  assert.equal(pickMarket([ucl], "Will Man City beat Liverpool?", now), null);
  const game = { conditionId: b as `0x${string}`, question: "Will Manchester City FC win on 2026-11-08?", slug: "", endDate: "2026-11-08T16:00:00Z", yesPriceBps: 4800, eventTitle: "Manchester City FC vs. Liverpool FC" };
  assert.equal(pickMarket([ucl, game], "Will Man City beat Liverpool?", now)!.conditionId, b);
});

test("a combined market loses a tie to the plain one, and keep reads as win", () => {
  const combo = { conditionId: a as `0x${string}`, question: "Will there be another US government shutdown by January 31 and will the Democratic Party win the House in 2026?", slug: "", endDate: "2027-01-31T00:00:00Z", yesPriceBps: 9100 };
  const plain = { conditionId: b as `0x${string}`, question: "Will there be another US government shutdown by January 31?", slug: "", endDate: "2027-01-31T00:00:00Z", yesPriceBps: 3000 };
  assert.equal(pickMarket([combo, plain], "Will there be a US government shutdown?", now)!.conditionId, b);
  const lose = { conditionId: a as `0x${string}`, question: "Will Republicans lose House majority before the midterms?", slug: "", endDate: "2026-11-03T00:00:00Z", yesPriceBps: 130 };
  const control = { conditionId: b as `0x${string}`, question: "Will the Republican Party control the House after the 2026 Midterm elections?", slug: "", endDate: "2026-11-04T00:00:00Z", yesPriceBps: 2000 };
  assert.equal(pickMarket([lose, control], "Will Republicans keep the House?", now)!.conditionId, b);
});

test("a market that joins two questions is not used for a single question", () => {
  const combo = { conditionId: a as `0x${string}`, question: "Will there be another US government shutdown by January 31 and will the Democratic Party win the House in 2026?", slug: "", endDate: "2027-01-31T00:00:00Z", yesPriceBps: 9100 };
  assert.equal(pickMarket([combo], "Will there be a US government shutdown?", now), null);
  assert.equal(pickMarket([combo], "Will there be a US government shutdown and will Democrats win the House?", now)!.conditionId, a);
});

test("the market must contain the question's most specific word, not just its common ones", () => {
  const ai = { conditionId: a as `0x${string}`, question: "US government bans an open source AI model in 2026?", slug: "", endDate: "2027-01-01T00:00:00Z", yesPriceBps: 1150 };
  const combo = { conditionId: b as `0x${string}`, question: "Will there be another US government shutdown by January 31 and will the Republican Party win the House in 2026?", slug: "", endDate: "2027-01-31T00:00:00Z", yesPriceBps: 500 };
  assert.equal(pickMarket([combo, ai], "Will there be a US government shutdown?", now), null);
});

test("hit reads as reach, and this year adds nothing", () => {
  const eth = { conditionId: a as `0x${string}`, question: "Will Ethereum reach $5,000 by December 31, 2026?", slug: "", endDate: "2027-01-01T05:00:00Z", yesPriceBps: 285 };
  assert.equal(searchQueryFor("Will Ethereum hit $5000 this year?"), "ethereum reach 5000");
  assert.equal(pickMarket([eth], "Will Ethereum hit $5000 this year?", now)!.conditionId, a);
});

test("a win question is not answered by a market about finishing places", () => {
  const markets = [
    { conditionId: b as `0x${string}`, question: "Will Arsenal finish in the top 4 of the 2026-27 English Premier League season?", eventTitle: "English Premier League Top 4 Finishers (2026-27)", slug: "", endDate: "2027-06-14T03:59:00Z", yesPriceBps: 9620 },
  ];
  assert.equal(pickMarket(markets, "Will Arsenal win the Premier League this season?", now), null);
  markets.push({ conditionId: a as `0x${string}`, question: "Will Arsenal win the 2026-27 English Premier League (EPL) Championship?", eventTitle: "EPL: 2027 Champion", slug: "", endDate: "2027-05-30T23:59:00Z", yesPriceBps: 4200 });
  assert.equal(pickMarket(markets, "Will Arsenal win the Premier League this season?", now)!.conditionId, a);
});

test("this season is not searched for: Polymarket names seasons by year", () => {
  assert.equal(searchQueryFor("Will Arsenal win the Premier League this season?"), "arsenal premier league");
});
