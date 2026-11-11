import assert from "node:assert/strict";
import test from "node:test";

import { answerView, hasFee, hasNamedInputs, inputRows, mainnetInView, mergeAnswers, networkLabel, priceLines, sourceLabel, sourcesNote } from "./route-view.ts";

test("an agent you chose yourself shows no routing fee", () => {
  assert.deepEqual(priceLines({ price: "0.10", fee: "0.00", total: "0.10" }), [{ label: "Price", value: "0.10 USDC" }, { label: "Agon routing fee", value: "None" }]);
  assert.equal(hasFee("0.00"), false);
  assert.equal(hasFee("0.0045"), true);
  assert.equal(hasFee(undefined), false);
});

test("only a listing that names its inputs can be hired from its page", () => {
  assert.equal(hasNamedInputs({ invocation: { requestSchema: { type: "object", properties: { market: { type: "string", description: "a link" } }, required: ["market"] } } }), true);
  assert.equal(hasNamedInputs({ invocation: { requestSchema: { type: "object", required: ["market-a-polymarket-market-link"] } } }), false);
  assert.equal(hasNamedInputs(undefined), false);
});

test("price lines, source and network labels read as specified", () => {
  assert.deepEqual(priceLines({ price: "0.30", fee: "0.0045", total: "0.3045" }), [
    { label: "Price", value: "0.30 USDC" }, { label: "Agon routing fee", value: "0.0045 USDC" }, { label: "Total", value: "0.3045 USDC" },
  ]);
  assert.deepEqual(priceLines({ price: "0.30" }), [{ label: "Price", value: "0.30 USDC" }]);
  assert.equal(sourceLabel({ source: "agon", provider: "Agon", rating: { tier: "scored", score: 82 } }), "Agon, Verified, score 82");
  assert.equal(sourceLabel({ source: "agon", provider: "Agon", rating: { tier: "verified", score: null } }), "Agon, Verified");
  assert.equal(sourceLabel({ source: "agon", provider: "Agon", rating: { tier: "listed", score: null } }), "Agon, Listed");
  assert.equal(sourceLabel({ source: "circle", provider: "LoneStarOracle", rating: { tier: "unrated", score: null } }), "Circle, LoneStarOracle, Not rated by Agon");
  assert.equal(networkLabel("arc-testnet"), "Test USDC on Arc Testnet");
  assert.equal(networkLabel("arc"), "Real USDC on Arc mainnet");
  assert.deepEqual(inputRows({ symbol: "AAPL", limit: 5, nested: { a: 1 } }), [{ label: "symbol", value: "AAPL" }, { label: "limit", value: "5" }, { label: "nested", value: '{"a":1}' }]);
});

test("final C2: a routed answer reads as text, as rows, or as a file description", () => {
  assert.deepEqual(answerView({ contentType: "text/plain", text: "Apple: Buy" }), { kind: "text", text: "Apple: Buy" });
  assert.deepEqual(answerView({ contentType: "image/png", bytes: 2048 }), { kind: "text", text: "The service sent a file: image/png, 2048 bytes." });
  assert.deepEqual(answerView({ symbol: "AAPL", rating: "buy", targets: [250, 260] }), { kind: "rows", rows: [{ label: "symbol", value: "AAPL" }, { label: "rating", value: "buy" }, { label: "targets", value: "[250,260]" }] });
  assert.deepEqual(answerView([1, 2]), { kind: "text", text: JSON.stringify([1, 2], null, 1) });
  assert.equal(answerView(null), null);
});

test("final I8: every answer given so far is kept and sent together", () => {
  const one = mergeAnswers({}, { symbol: "AAPL" });
  const two = mergeAnswers(one, { date: "2026-10-17" });
  assert.deepEqual(two, { symbol: "AAPL", date: "2026-10-17" });
  assert.deepEqual(mergeAnswers(two, undefined), two);
  assert.deepEqual(mergeAnswers(two, { symbol: "MSFT" }), { symbol: "MSFT", date: "2026-10-17" });
});

test("minor: an unreachable source is named, and a reachable set says nothing", () => {
  assert.equal(sourcesNote([{ id: "agon", status: "ok" }, { id: "circle", status: "unavailable" }]), "Circle's marketplace could not be reached just now, so only Agon agents were searched.");
  assert.equal(sourcesNote([{ id: "agon", status: "ok" }, { id: "circle", status: "ok" }]), null);
  assert.equal(sourcesNote(undefined), null);
});

test("minor: the mainnet wallet stays in view through paying and the answer", () => {
  assert.equal(mainnetInView({ kind: "run", mainnet: true }), true);
  assert.equal(mainnetInView({ kind: "run", mainnet: false }), false);
  assert.equal(mainnetInView({ kind: "routed", pickNetwork: "arc" }), true);
  assert.equal(mainnetInView({ kind: "quote", testnet: false }), true);
  assert.equal(mainnetInView({ kind: "refused", network: "arc" }), true);
  assert.equal(mainnetInView({ kind: "idle" }), false);
});

test("a Rules Check answer reads as dispute risk, what decides it and each trap with its quote", () => {
  const view = answerView({
    agent: "Rules Check", market: { question: "Will the Democratic Party control the Senate?", url: "https://polymarket.com/event/x/y" }, risk: "medium",
    decides: { source: { text: "State electoral authorities and Congress", quote: "official information from relevant state electoral authorities" }, cutoff: null, threshold: { text: "A majority of voting seats", quote: "wins a majority of the chamber’s voting seats" } },
    traps: [
      { category: "definition", kind: "fine_print", quote: "wins half of the voting seats and holds the Vice Presidency", explain: "A 50-50 split goes to the Vice President's party." },
      { category: "fallback", kind: "ambiguous", quote: "first selected President Pro Tempore", explain: "If still unclear, a different test decides." },
    ],
    signals: { source: "mixed", discretion: false, fallback: true, timezone: true, disputes: 0 }, model: "m",
  });
  assert.ok(view && view.kind === "rules");
  assert.equal(view.riskText, "Some dispute risk");
  assert.deepEqual(view.decides.map((d) => d.label), ["Decided by", "The line"]);
  assert.deepEqual(view.traps.map((t) => t.label), ["Definition · Fine print", "If it is unclear · Open to argument"]);
  assert.equal(view.traps[1]!.quote, "first selected President Pro Tempore");
  assert.equal(view.marketQuestion, "Will the Democratic Party control the Senate?");
  assert.deepEqual(answerView({ risk: "maybe", traps: [] })!.kind, "rows");
});

test("a Resolution Watch answer reads as the markets watched, until when, and where alerts arrive", () => {
  const view = answerView({
    agent: "Resolution Watch", watchId: "w-1", statusUrl: "https://api.agon.surf/agon/agents/specialists/watch/w-1", endsAt: "2026-12-21T08:00:00.000Z",
    markets: [{ question: "Will the Bank of Canada hold?", url: "https://polymarket.com/market/a", status: "open" }],
  });
  assert.ok(view && view.kind === "watch");
  assert.equal(view.markets[0]!.question, "Will the Bank of Canada hold?");
  assert.equal(view.until, "21 December");
  assert.equal(view.watchPath, "/watch/w-1", "the watch opens on agon.surf, not the raw API");
});

// 2026-11-10 rehearsal: Scout and Pitch answers read as a flat list of field names, and an image as a link.
test("a Scout answer reads as a verdict, live numbers, flags and when Polymarket was read", () => {
  const view = answerView({
    agent: "Scout", market: { question: "Will the Fed cut rates in December?", url: "https://polymarket.com/event/fed/will-the-fed-cut", slug: "will-the-fed-cut", closesAt: "2026-12-16T19:00:00Z", crowdBps: 6350 },
    verdict: "watch", flags: [{ code: "wide_spread", detail: "The spread is 4 cents, so entering and leaving costs that much." }],
    metrics: { yesPct: 63.5, spreadCents: 4, liquidityUsd: 123709, volume24hUsd: 3784, weekMovePts: -2, hoursLeft: 30.5 },
    rulesNote: "The Fed's own statement decides it.", readAt: "2026-11-10T09:41:07.000Z",
  });
  assert.ok(view && view.kind === "scout");
  assert.deepEqual([view.verdict, view.verdictText, view.marketQuestion, view.marketUrl], ["watch", "Trade with care", "Will the Fed cut rates in December?", "https://polymarket.com/event/fed/will-the-fed-cut"]);
  assert.deepEqual(view.metrics, [
    { label: "Yes price", value: "63.5%" }, { label: "Spread", value: "4 cents" }, { label: "Liquidity", value: "$123,709" },
    { label: "Traded in 24 hours", value: "$3,784" }, { label: "Move this week", value: "-2 points" }, { label: "Closes in", value: "31 hours" },
  ]);
  assert.deepEqual(view.flags, ["The spread is 4 cents, so entering and leaving costs that much."]);
  assert.equal(view.rulesNote, "The Fed's own statement decides it.");
  assert.equal(view.readLine, "Read from Polymarket at 09:41:07 UTC");
  const days = answerView({ agent: "Scout", market: { question: "Q", url: "" }, verdict: "tradeable", flags: [], metrics: { yesPct: 50, spreadCents: 1, liquidityUsd: 50000, volume24hUsd: 9000, weekMovePts: 3.5, hoursLeft: 5411.98 }, rulesNote: "" });
  assert.ok(days && days.kind === "scout");
  assert.deepEqual([days.verdictText, days.metrics[4]!.value, days.metrics[5]!.value, days.readLine, days.marketUrl, days.rulesNote], ["Tradeable", "+3.5 points", "225 days", null, null, null]);
});

// Scout v3 (2026-11-11): the answer prices the buyer's size against the order book and shows flow, holders and swings.
test("a Scout answer shows what the size would really get, recent flow, the largest holders and price swings", () => {
  const base = { agent: "Scout", market: { question: "Heat vs. Jazz", url: "https://polymarket.com/event/g/g", outcomes: [{ label: "Heat", pct: 50 }, { label: "Jazz", pct: 50 }] }, verdict: "tradeable", flags: [], metrics: { spreadCents: 1 }, rulesNote: "" };
  const view = answerView({
    ...base,
    trade: { side: "Heat", sizeUsd: 500, sizeGiven: true, buy: { averagePrice: 0.50323, slippageCents: 0.32, shares: 993.6, unfilledUsd: 0 }, sell: { averagePrice: 0.48 }, depth: { withinCents: 2, bidUsd: 96, askUsd: 102 } },
    flow: { hours: 24, complete: true, toward: [{ label: "Heat", usd: 12340 }, { label: "Jazz", usd: 8100 }], net: { label: "Heat", usd: 4240 }, trades: 214, wallets: 87, largest: [{ usd: 2500, side: "buy", outcome: "Heat", price: 0.51, at: "2026-11-11T10:00:00.000Z", wallet: "0xa1a1...a1a1" }] },
    holders: { sides: [{ label: "Heat", valueUsd: 45000, top: [{}, {}, {}, {}, {}] }, { label: "Jazz", valueUsd: 30000, top: [{}, {}] }], openInterestUsd: 120000, topFiveSharePct: 62.5 },
    volatility: { dayRangePts: 3.5, weekRangePts: 9, typicalHourlyMovePts: 1 },
    unavailable: [],
  });
  assert.ok(view && view.kind === "scout");
  assert.deepEqual(view.sections, [
    { title: "Buying $500 of Heat", rows: [
      { label: "Average price", value: "50.3 cents" }, { label: "Above the best price", value: "0.32 cents" }, { label: "Shares", value: "994" },
      { label: "Selling the same size", value: "48 cents" }, { label: "Bids within 2 cents", value: "$96" }, { label: "Asks within 2 cents", value: "$102" },
    ] },
    { title: "Last 24 hours", rows: [
      { label: "Toward Heat", value: "$12,340" }, { label: "Toward Jazz", value: "$8,100" }, { label: "Trades", value: "214 by 87 wallets" }, { label: "Largest trade", value: "$2,500 buy of Heat at 51 cents" },
    ] },
    { title: "Largest holders", rows: [
      { label: "Top 5 on Heat", value: "$45,000" }, { label: "Top 2 on Jazz", value: "$30,000" }, { label: "Open interest", value: "$120,000" }, { label: "Their share of it", value: "62.5%" },
    ] },
    { title: "Price swings", rows: [{ label: "Range in 24 hours", value: "3.5 points" }, { label: "Range this week", value: "9 points" }, { label: "Typical hourly move", value: "1 point" }] },
  ]);
  assert.equal(view.missingLine, null);
  // A size nobody gave, a book that cannot fill it, a short trade window and sections Polymarket did not answer for.
  const thin = answerView({
    ...base, verdict: "avoid",
    trade: { side: "Jazz", sizeUsd: 100, sizeGiven: false, buy: { averagePrice: null, slippageCents: null, shares: 0, unfilledUsd: 100 }, sell: { averagePrice: null }, depth: { withinCents: 2, bidUsd: 0, askUsd: 0 } },
    flow: { hours: 0.2, complete: false, toward: [{ label: "Heat", usd: 10 }, { label: "Jazz", usd: 5 }], trades: 500, wallets: 1, largest: [] },
    holders: null, volatility: null, unavailable: ["holders", "volatility", "something-new"],
  });
  assert.ok(thin && thin.kind === "scout");
  assert.equal(thin.sections[0]!.title, "Buying $100 of Jazz (no size given)");
  assert.deepEqual(thin.sections[0]!.rows.slice(0, 2), [{ label: "Average price", value: "Nothing on offer" }, { label: "Not filled", value: "$100" }]);
  assert.equal(thin.sections[1]!.title, "Last 0.2 hours (the newest trades only)");
  assert.equal(thin.sections[1]!.rows[2]!.value, "500 by 1 wallet");
  assert.equal(thin.sections.length, 2);
  assert.equal(thin.missingLine, "Polymarket did not answer for holders and price history.");
  // An older Scout answer has none of this and still reads.
  const old = answerView(base);
  assert.ok(old && old.kind === "scout");
  assert.deepEqual([old.sections, old.missingLine], [[], null]);
});

test("a Pitch answer reads as a forecast against the crowd price, with its reasons and sources", () => {
  const view = answerView({
    agent: "Pitch", market: { question: "Will Arsenal win on Saturday?", url: "https://polymarket.com/event/ars/will-arsenal-win", slug: "will-arsenal-win", closesAt: "2026-11-14T15:00:00Z", crowdBps: 6350 },
    probabilityBps: 6000, crowdBps: 6350, edgePts: -3.5, reasons: ["a", "b", "c"], model: "m", readAt: "2026-11-10T09:41:07.000Z",
    sources: [{ title: "Saka ruled out", url: "https://news.example/saka", published: "2026-11-09T08:00:00Z" }, { title: "bad", url: "javascript:alert(1)" }],
  });
  assert.ok(view && view.kind === "forecast");
  assert.deepEqual([view.answer.probabilityBps, view.answer.marketPriceBps, view.answer.marketQuestion, view.answer.forecaster.name], [6000, 6350, "Will Arsenal win on Saturday?", "Pitch"]);
  assert.deepEqual(view.answer.reasons, ["a", "b", "c"]);
  assert.deepEqual(view.sources, [{ title: "Saka ruled out", url: "https://news.example/saka", published: "9 November" }]);
  assert.equal(view.readLine, "Read from Polymarket at 09:41:07 UTC");
});

test("an image a service made is shown as an image, from a link or from its data", () => {
  assert.deepEqual(answerView({ created: 1, data: [{ url: "https://img.example/logo.png", revised_prompt: "A warm coffee logo" }] }), { kind: "image", src: "https://img.example/logo.png", caption: "A warm coffee logo" });
  assert.deepEqual(answerView({ data: [{ b64_json: "iVBORw0KGgo=" }] }), { kind: "image", src: "data:image/png;base64,iVBORw0KGgo=", caption: null });
  assert.deepEqual(answerView({ images: ["https://img.example/a.webp"] }), { kind: "image", src: "https://img.example/a.webp", caption: null });
  const unsafe = answerView({ data: [{ url: "javascript:alert(1)" }] });
  assert.ok(unsafe && unsafe.kind === "rows", "only https links and image data are shown as images");
});

// 2026-11-10 production: a price lookup read as "coins {}". Prices now read as prices, and an
// empty answer says that no price came back.
test("a DefiLlama price answer reads as one price per coin, with when it was read", () => {
  const view = answerView({ coins: {
    "coingecko:ethereum": { price: 2091.5489015999997, symbol: "ETH", timestamp: 1794313356, confidence: 0.999 },
    "coingecko:solana": { price: 84.73, symbol: "SOL", timestamp: 1794313356, confidence: 0.999 },
  } });
  assert.deepEqual(view, { kind: "prices", prices: [{ label: "ETH", value: "$2,091.55" }, { label: "SOL", value: "$84.73" }], readLine: "Read at 12:22:36 UTC" });
  assert.deepEqual(answerView({ coins: { "coingecko:pepe": { price: 0.0000123, symbol: "PEPE", timestamp: 1794313356 } } }), { kind: "prices", prices: [{ label: "PEPE", value: "$0.0000123" }], readLine: "Read at 12:22:36 UTC" });
});

test("an empty price answer says no price came back", () => {
  assert.deepEqual(answerView({ coins: {} }), { kind: "text", text: "The service sent no price for those coins." });
});

// 2026-11-10 production (job ff086716): a queued image job read as rows of ticket fields.
test("a queued job the service never finished says so, not its ticket fields", () => {
  assert.deepEqual(answerView({ object: "image.generation.job", status: "queued", id: "1e45", poll_url: "/api/v1/images/generations/1e45", payment_status: "verified" }), { kind: "text", text: "The service queued this work and did not send the result." });
});

test("a Scout answer on a market between two named sides shows both prices by name", () => {
  const view = answerView({
    agent: "Scout", market: { question: "Heat vs. Jazz", url: "https://polymarket.com/event/nba-mia-uta-2026-11-10/nba-mia-uta-2026-11-10", crowdBps: 7650, outcomes: [{ label: "Heat", pct: 76.5 }, { label: "Jazz", pct: 23.5 }] },
    verdict: "tradeable", flags: [], metrics: { yesPct: 76.5, spreadCents: 1, liquidityUsd: 50000, volume24hUsd: 900000, weekMovePts: 0, hoursLeft: 5 },
    rulesNote: "The league's final score decides it.", readAt: "2026-11-11T09:41:07.000Z",
  });
  assert.ok(view && view.kind === "scout");
  assert.deepEqual(view.metrics.slice(0, 2), [{ label: "Heat price", value: "76.5%" }, { label: "Jazz price", value: "23.5%" }]);
  assert.ok(!view.metrics.some((m) => m.label === "Yes price"));
});
