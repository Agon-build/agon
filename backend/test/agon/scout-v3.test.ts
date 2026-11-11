import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import type { MarketSnapshot } from "../../src/agon/agents/market-lookup.ts";
import { SPECIALISTS, createSpecialistRoutes } from "../../src/agon/agents/routes.ts";
import { SCOUT_TRADES, scoutAsk, scoutReport, type ScoutReads, type ScoutReport } from "../../src/agon/agents/scout.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { certificationReply } from "../../src/agon/payments/listing-protocols.ts";
import { PolymarketUnavailable, type Polymarket, type Book, type HoldersOf, type PricePoint, type Read, type Trade } from "../../src/agon/polymarket/index.ts";
import { buildTestCase, scoreAnswer, testFamilyFor, trueNumbers } from "../../src/agon/tests/tasks.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const NOW = new Date("2026-11-11T12:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1_000);
const CONDITION = `0x${"ab".repeat(32)}`;
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const market = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  conditionId: CONDITION, slug: "heat-jazz", url: "https://polymarket.com/event/heat-jazz/heat-jazz", question: "Heat vs. Jazz", endAt: new Date("2026-12-30T00:00:00Z"),
  outcomes: [{ label: "Heat", tokenId: "111", price: 0.5 }, { label: "Jazz", tokenId: "222", price: 0.5 }], yesNo: false, yesBps: 5000, bestBid: 0.49, bestAsk: 0.5, spread: 0.01,
  liquidity: 80_000, volume24h: 12_000, weekChange: 0.02, description: "This market resolves to the team that wins the game, according to the official results of the league.",
  tags: ["nba"], closed: false, umaStatuses: [], tickSize: 0.01, minOrderSize: 5, acceptingOrders: true, negRisk: false, ...over,
});
const read = <T,>(value: T, source: string): Read<T> => ({ value, readAt: NOW.toISOString(), source, ageMs: 0 });
const BOOK: Book = { tokenId: "111", bids: [{ price: 0.48, size: 200 }, { price: 0.45, size: 100 }], asks: [{ price: 0.5, size: 100 }, { price: 0.52, size: 100 }], tickSize: 0.01, minOrderSize: 5, lastTradePrice: 0.5 };
const trade = (over: Partial<Trade>): Trade => ({ wallet: `0x${"a1".repeat(20)}`, side: "buy", tokenId: "111", outcome: "Heat", outcomeIndex: 0, shares: 100, price: 0.5, usd: 50, at: NOW_SEC - 60, txHash: "0x1", ...over });
const TRADES: Trade[] = [
  trade({ usd: 300, shares: 600, at: NOW_SEC - 3_600 }),
  trade({ side: "sell", usd: 100, shares: 200, at: NOW_SEC - 7_200, wallet: `0x${"b2".repeat(20)}` }),
  trade({ tokenId: "222", outcome: "Jazz", outcomeIndex: 1, usd: 50, at: NOW_SEC - 100, wallet: `0x${"b2".repeat(20)}` }),
  trade({ usd: 1_000, shares: 2_000, at: NOW_SEC - 90_000 }),
];
const HOLDERS: HoldersOf[] = [
  { tokenId: "111", holders: [{ wallet: `0x${"c3".repeat(20)}`, name: "alice", shares: 10_000, outcomeIndex: 0 }] },
  { tokenId: "222", holders: [{ wallet: `0x${"d4".repeat(20)}`, name: "", shares: 6_000, outcomeIndex: 1 }] },
];
const HISTORY: PricePoint[] = [{ at: NOW_SEC - 172_800, price: 0.4 }, { at: NOW_SEC - 10_800, price: 0.5 }, { at: NOW_SEC - 7_200, price: 0.52 }, { at: NOW_SEC - 3_600, price: 0.49 }];
const reads = (over: Partial<ScoutReads> = {}): ScoutReads => ({
  book: read(BOOK, "https://clob.polymarket.com/book"), history: read(HISTORY, "https://clob.polymarket.com/prices-history"),
  trades: read(TRADES, "https://data-api.polymarket.com/v2/trades"), holders: read(HOLDERS, "https://data-api.polymarket.com/v2/holders"),
  openInterest: read(20_000, "https://data-api.polymarket.com/v2/oi"), ...over,
});
const ask = (sizeUsd: number, sideIndex: 0 | 1 = 0) => ({ sideIndex, sizeUsd, sizeGiven: true });

test("a size and a side are read as people write them, and what cannot be read is refused", () => {
  const m = market();
  assert.deepEqual(scoutAsk(m, {}), { ok: true, ask: { sideIndex: 0, sizeUsd: 100, sizeGiven: false } });
  assert.deepEqual(scoutAsk(m, { size: "", side: "  " }), { ok: true, ask: { sideIndex: 0, sizeUsd: 100, sizeGiven: false } });
  assert.deepEqual(scoutAsk(m, { size: 500, side: "jazz" }), { ok: true, ask: { sideIndex: 1, sizeUsd: 500, sizeGiven: true } });
  for (const [text, want] of [["500", 500], ["$1,500", 1_500], ["2k", 2_000], ["250 usd", 250], ["0.5m", 500_000], ["12.5", 12.5]] as const) {
    const out = scoutAsk(m, { size: text });
    assert.ok(out.ok && out.ask.sizeUsd === want, `${text}: ${JSON.stringify(out)}`);
  }
  for (const bad of ["lots", "0", "-5", "2000000", "5 shares", 0.5, Number.NaN]) assert.deepEqual(scoutAsk(m, { size: bad }), { ok: false, code: "invalid_size" }, String(bad));
  assert.deepEqual(scoutAsk(m, { side: "Lakers" }), { ok: false, code: "unknown_side" });
  assert.deepEqual(scoutAsk(market({ outcomes: [{ label: "Yes", tokenId: "1", price: 0.6 }, { label: "No", tokenId: "2", price: 0.4 }] }), { side: "NO" }), { ok: true, ask: { sideIndex: 1, sizeUsd: 100, sizeGiven: false } });
});

test("Scout prices the buyer's size against the order book and keeps every older field", () => {
  const plain = scoutReport(market(), NOW);
  const out = scoutReport(market(), NOW, { ask: ask(60), reads: reads() });
  assert.deepEqual([out.verdict, out.flags, out.metrics, out.resolution], [plain.verdict, plain.flags, plain.metrics, "open"]);
  assert.equal(out.verdict, "tradeable");
  const t = out.trade!;
  assert.deepEqual([t.side, t.sizeUsd, t.sizeGiven], ["Heat", 60, true]);
  assert.deepEqual([t.buy.averagePrice, t.buy.slippageCents, t.buy.levelsUsed, t.buy.unfilledUsd], [0.50323, 0.32, 2, 0]);
  assert.deepEqual([t.sell.averagePrice, t.sell.bestPrice, t.sell.unfilledUsd], [0.48, 0.48, 0]);
  assert.deepEqual(t.depth, { withinCents: 2, bidUsd: 96, askUsd: 102 });
  assert.deepEqual(out.sources!.map((s) => s.what), ["book", "history", "trades", "holders", "openInterest"]);
  assert.ok(out.sources!.every((s) => s.readAt === NOW.toISOString() && s.source.startsWith("https://")));
  assert.deepEqual(out.unavailable, []);
});

test("a size the book cannot fill is flagged and the verdict is avoid; a size that moves the price is flagged", () => {
  const big = scoutReport(market(), NOW, { ask: ask(200), reads: reads() });
  assert.deepEqual(big.flags.map((f) => f.code), ["book_too_thin"]);
  assert.equal(big.verdict, "avoid");
  assert.match(big.flags[0]!.detail, /fills only \$102 of a \$200 buy of Heat/);
  assert.equal(big.trade!.buy.unfilledUsd, 98);
  const deep: Book = { ...BOOK, asks: [{ price: 0.5, size: 20 }, { price: 0.56, size: 1_000 }] };
  const moved = scoutReport(market(), NOW, { ask: ask(200), reads: reads({ book: read(deep, "https://clob.polymarket.com/book") }) });
  assert.deepEqual(moved.flags.map((f) => f.code), ["size_moves_price"]);
  assert.equal(moved.verdict, "watch");
  const empty = scoutReport(market(), NOW, { ask: ask(50), reads: reads({ book: read({ ...BOOK, asks: [] }, "https://clob.polymarket.com/book") }) });
  assert.deepEqual([empty.verdict, empty.trade!.buy.averagePrice, empty.trade!.buy.unfilledUsd], ["avoid", null, 50]);
});

test("a market that is settling or not taking orders says so", () => {
  const settling = scoutReport(market({ umaStatuses: ["proposed"] }), NOW);
  assert.deepEqual([settling.resolution, settling.flags.map((f) => f.code), settling.verdict], ["proposed", ["settlement_started"], "watch"]);
  assert.equal(scoutReport(market({ umaStatuses: ["proposed", "disputed"] }), NOW).resolution, "disputed");
  const shut = scoutReport(market({ acceptingOrders: false }), NOW);
  assert.deepEqual([shut.flags.map((f) => f.code), shut.verdict], [["not_accepting_orders"], "avoid"]);
});

test("flow counts the last 24 hours toward each side and says when the trades do not reach that far", () => {
  const flow = scoutReport(market(), NOW, { ask: ask(60), reads: reads() }).flow!;
  assert.deepEqual([flow.complete, flow.hours, flow.trades, flow.wallets], [true, 24, 3, 2]);
  assert.deepEqual(flow.toward, [{ label: "Heat", usd: 300 }, { label: "Jazz", usd: 150 }]);
  assert.deepEqual(flow.net, { label: "Heat", usd: 150 });
  assert.deepEqual([flow.largest[0]!.usd, flow.largest[0]!.outcome, flow.largest[0]!.wallet], [300, "Heat", "0xa1a1...a1a1"]);
  const busy = Array.from({ length: SCOUT_TRADES }, () => trade({ at: NOW_SEC - 600 }));
  const short = scoutReport(market(), NOW, { ask: ask(60), reads: reads({ trades: read(busy, "https://data-api.polymarket.com/v2/trades") }) }).flow!;
  assert.deepEqual([short.complete, short.hours, short.trades], [false, 0.2, SCOUT_TRADES]);
  const quiet = scoutReport(market(), NOW, { ask: ask(60), reads: reads({ trades: read([], "https://data-api.polymarket.com/v2/trades") }) }).flow!;
  assert.deepEqual([quiet.complete, quiet.trades, quiet.net], [true, 0, null]);
});

test("the largest holders are valued at today's price, and their share is given only when it can be compared", () => {
  const h = scoutReport(market(), NOW, { ask: ask(60), reads: reads() }).holders!;
  assert.deepEqual(h.sides.map((s) => [s.label, s.valueUsd, s.top[0]!.name]), [["Heat", 5_000, "alice"], ["Jazz", 3_000, "0xd4d4...d4d4"]]);
  assert.deepEqual([h.openInterestUsd, h.topFiveSharePct], [20_000, 40]);
  // A negative-risk market's holdings are not held against open interest one to one (seen 2026-11-11).
  assert.equal(scoutReport(market({ negRisk: true }), NOW, { ask: ask(60), reads: reads() }).holders!.topFiveSharePct, null);
  assert.equal(scoutReport(market(), NOW, { ask: ask(60), reads: reads({ openInterest: read(5_000, "https://data-api.polymarket.com/v2/oi") }) }).holders!.topFiveSharePct, null, "above 100 is not a share");
  const noOi = scoutReport(market(), NOW, { ask: ask(60), reads: reads({ openInterest: null }) });
  assert.deepEqual([noOi.holders!.openInterestUsd, noOi.holders!.topFiveSharePct, noOi.unavailable], [null, null, ["openInterest"]]);
});

test("price swings come from the week's history, and a section Polymarket did not answer for is named", () => {
  const out = scoutReport(market(), NOW, { ask: ask(60), reads: reads() });
  assert.deepEqual(out.volatility, { dayRangePts: 3, weekRangePts: 12, typicalHourlyMovePts: 5 });
  const bare = scoutReport(market(), NOW, { ask: ask(60), reads: reads({ history: null, trades: null, holders: null, openInterest: null }) });
  assert.deepEqual([bare.flow, bare.holders, bare.volatility], [null, null, null]);
  assert.deepEqual(bare.unavailable, ["flow", "holders", "openInterest", "volatility"]);
  assert.deepEqual(bare.sources!.map((s) => s.what), ["book"]);
  assert.equal(scoutReport(market(), NOW, { ask: ask(60), reads: reads({ history: read([HISTORY[0]!], "https://clob.polymarket.com/prices-history") }) }).volatility, null);
});

function setup(opts: { m?: MarketSnapshot; down?: ("book" | "history" | "trades" | "holders" | "openInterest")[]; withData?: boolean } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const calls: string[] = [];
  const m = opts.m ?? market();
  const answer = <T,>(what: "book" | "history" | "trades" | "holders" | "openInterest", arg: string, value: T): Promise<Read<T>> => {
    calls.push(`${what}:${arg}`);
    return opts.down?.includes(what) ? Promise.reject(new PolymarketUnavailable("down")) : Promise.resolve(read(value, `https://polymarket.test/${what}`));
  };
  // The buyer signs against the real clock, so the recorded times are moved to end now.
  const shift = Math.floor(Date.now() / 1_000) - NOW_SEC;
  const polymarket: Pick<Polymarket, "book" | "history" | "trades" | "holders" | "openInterest"> = {
    book: (token) => answer("book", token, { ...BOOK, tokenId: token }),
    history: (token) => answer("history", token, HISTORY.map((h) => ({ ...h, at: h.at + shift }))),
    trades: (id, limit) => answer("trades", `${id}:${limit}`, TRADES.map((t) => ({ ...t, at: t.at + shift }))),
    holders: (id, limit) => answer("holders", `${id}:${limit}`, HOLDERS),
    openInterest: (id) => answer("openInterest", id, 20_000),
  };
  const app = createSpecialistRoutes({
    network, store,
    sellers: { scout: { payTo: `0x${"c2".repeat(20)}` as Address, settle: settler.settle } },
    lookup: async () => ({ ok: true, market: m }),
    ...(opts.withData === false ? {} : { polymarket }),
    callModel: async () => ({ text: "The league's official result decides it." }),
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  const buy = (body: unknown) => buyExact({ url: "http://api.test/scout", init: json(body), network, maxAmount: SPECIALISTS.scout.price, signerFor: () => localSigner(buyer), fetchImpl });
  return { app, settler, calls, buy };
}

test("a paid Scout check prices the size on the side asked for, with where each number was read", async () => {
  const { buy, settler, calls } = setup();
  const out = await buy({ market: "heat-jazz", size: "$60", side: "jazz" });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 100_000n);
  const data = out.data as ScoutReport & { agent: string; rulesNote: string; readAt: string; market: { outcomes: { label: string }[] } };
  assert.deepEqual([data.agent, data.verdict, data.trade!.side, data.trade!.sizeUsd, data.trade!.buy.averagePrice], ["Scout", "tradeable", "Jazz", 60, 0.50323]);
  assert.match(data.rulesNote, /official result/);
  assert.deepEqual(calls.sort(), [`book:222`, `history:222`, `holders:${CONDITION}:5`, `openInterest:${CONDITION}`, `trades:${CONDITION}:${SCOUT_TRADES}`]);
  assert.equal(data.flow!.toward[0].usd, 300);
  assert.equal(data.sources!.length, 5);
  assert.equal(settler.calls.length, 1);
});

test("a side the market does not have, or a size that is not an amount, is refused before payment is asked", async () => {
  const { app, calls } = setup();
  const side = await app.request("http://api.test/scout", json({ market: "heat-jazz", side: "Lakers" }));
  assert.equal(side.status, 422);
  const sideBody = await side.json() as { error: string; message: string };
  assert.deepEqual([sideBody.error, sideBody.message], ["unknown_side", "This market's sides are Heat and Jazz. Send one of them as the side."]);
  const size = await app.request("http://api.test/scout", json({ market: "heat-jazz", size: "lots" }));
  assert.equal(size.status, 422);
  assert.equal((await size.json() as { error: string }).error, "invalid_size");
  assert.equal((await app.request("http://api.test/scout", json({ market: "heat-jazz", size: 500, side: "Heat" }))).status, 402);
  assert.equal((await app.request("http://api.test/scout", json({ market: "heat-jazz" }))).status, 402);
  assert.equal((await app.request("http://api.test/scout", json({ market: "heat-jazz", side: 7 }))).status, 400);
  assert.deepEqual(calls, [], "nothing is read from the order book before a payment arrives");
});

test("Scout takes no money when the order book cannot be read, or the side has no token", async () => {
  const down = setup({ down: ["book"] });
  const out = await down.buy({ market: "heat-jazz", size: 60 });
  assert.ok(!out.ok);
  assert.equal(down.settler.calls.length, 0, "nothing settles");
  const tokenless = setup({ m: market({ outcomes: [{ label: "Over", tokenId: "", price: 0.5 }, { label: "Under", tokenId: "", price: 0.5 }] }) });
  assert.ok(!(await tokenless.buy({ market: "heat-jazz" })).ok);
  assert.equal(tokenless.settler.calls.length, 0);
});

test("a section Polymarket did not answer for is left out and named; the rest is still sold", async () => {
  const { buy, settler } = setup({ down: ["trades", "history"] });
  const out = await buy({ market: "heat-jazz" });
  assert.ok(out.ok, show(out));
  const data = out.data as ScoutReport;
  assert.deepEqual([data.flow, data.volatility, data.unavailable], [null, null, ["flow", "volatility"]]);
  assert.deepEqual([data.trade!.sizeUsd, data.trade!.sizeGiven, data.trade!.side], [100, false, "Heat"]);
  assert.equal(data.holders!.topFiveSharePct, 40);
  assert.equal(settler.calls.length, 1);
});

const NUMBERS = { family: "true-numbers" as const };
const ctx = { arcChainId: 5042002, arcBlock: 1n };
const serviceFile = (properties: Record<string, unknown>) => ({ invocation: { requestSchema: { properties } } });

test("True numbers: an Analysis agent that takes a market and a size gets four order books, others keep their test", () => {
  assert.equal(testFamilyFor({ categoryId: "3", manifestBody: serviceFile({ market: {}, size: {}, side: {} }) }), "true-numbers");
  assert.equal(testFamilyFor({ categoryId: "3", manifestBody: serviceFile({ market: {} }) }), undefined);
  assert.equal(testFamilyFor({ categoryId: "8", manifestBody: serviceFile({ market: {}, size: {} }) }), "market-rules");
  const cases = [0, 1, 2, 3].map((v) => buildTestCase("3", v, NUMBERS)!);
  assert.deepEqual(cases.map((c) => c.taskId), ["true-numbers", "true-numbers", "true-numbers", "true-numbers"]);
  assert.equal(new Set(cases.map((c) => (c.input as { question: string }).question)).size, 4);
  assert.ok(cases.every((c) => c.prompt.length <= 1_000));
  assert.equal(buildTestCase("3", 0)!.taskId, "evidence-under-pressure");
  const [fits, walks, tooBig, sell] = cases.map((c) => c.expected as ReturnType<typeof trueNumbers>);
  assert.deepEqual([fits!.averagePrice, fits!.slippageCents, fits!.unfilledUsd], [0.5, 0, 0]);
  assert.ok(walks!.slippageCents! > 1 && walks!.unfilledUsd === 0);
  assert.ok(tooBig!.unfilledUsd > 0 && tooBig!.filledUsd < 2_500);
  assert.ok(sell!.averagePrice! < 0.77 && sell!.averagePrice! > 0.7);
});

test("True numbers: Agon's own arithmetic scores 100, and reading the first level as the best price fails", () => {
  for (const v of [0, 1, 2, 3]) {
    const t = buildTestCase("3", v, NUMBERS)!;
    assert.equal(scoreAnswer(t, { ...trueNumbers(t.input as Parameters<typeof trueNumbers>[0]), writesPerformed: false }, ctx).score, 100, `variant ${v}`);
  }
  const t = buildTestCase("3", 1, NUMBERS)!;
  const input = t.input as { book: { bids: { price: string; size: string }[]; asks: { price: string; size: string }[] } };
  // Polymarket sends asks highest first; an agent that takes asks[0] as the best ask prices the order at 0.70.
  const naive = scoreAnswer(t, { averagePrice: Number(input.book.asks[0]!.price), slippageCents: 0, filledUsd: 400, unfilledUsd: 0, depthBidUsd: 522, depthAskUsd: 560 }, ctx);
  assert.equal(naive.passed, false);
  assert.ok(naive.notes.some((n) => n.includes("Average price")));
  assert.equal(scoreAnswer(t, "not an object", ctx).score, 0);
  assert.equal(scoreAnswer(t, { averagePrice: "0.63" }, ctx).score, 0, "numbers must be numbers");
});

const numbersTask = (v: number) => {
  const t = buildTestCase("3", v, NUMBERS)!;
  return { test: t, body: { protocol: "agon-playground/1", category: "analysis", task: { id: t.taskId, title: t.title, adversarialPrompt: t.prompt, capability: t.capability }, input: t.input, scope: { listingReference: "public-test", listingVersion: String(v) } } };
};

test("True numbers: Scout answers the test with the code it sells and scores 100 on every variant", async () => {
  const { app } = setup({ withData: false });
  for (const v of [0, 1, 2, 3]) {
    const { test: t, body } = numbersTask(v);
    const res = await app.request("http://api.test/scout", json(body));
    assert.equal(res.status, 200);
    const reply = await res.json() as { protocol: string; externalWrites: boolean; output: Record<string, unknown> };
    assert.deepEqual([reply.protocol, reply.externalWrites, reply.output.writesPerformed], ["agon-playground/1", false, false]);
    assert.equal(scoreAnswer(t, reply.output, ctx).score, 100, `variant ${v}`);
  }
});

test("True numbers: an agent that does not price orders refuses the test", async () => {
  const model = "test-model";
  const { body } = numbersTask(0);
  const refused = await certificationReply({ agent: { name: "Other", capabilities: ["analysis"] }, body, model, callModel: async () => ({ text: "{}" }) });
  assert.equal(refused.status, 400);
  const failed = await certificationReply({ agent: { name: "Other", capabilities: ["analysis"] }, body, model, callModel: async () => ({ text: "{}" }), trueNumbers: async () => null });
  assert.equal(failed.status, 502);
});
