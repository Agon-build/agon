import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import { createMarketLookup, marketRefFrom, type MarketSnapshot } from "../../src/agon/agents/market-lookup.ts";
import { isFootballMarket } from "../../src/agon/agents/pitch.ts";
import { scoutReport } from "../../src/agon/agents/scout.ts";
import { SPECIALISTS, createSpecialistRoutes } from "../../src/agon/agents/routes.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const NOW = new Date("2026-10-17T12:00:00Z");
const EPL_SLUG = "will-arsenal-win-the-2026-27-english-premier-league-epl-championship";
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const gammaMarket = (over: Record<string, unknown> = {}) => ({
  conditionId: `0x${"f0".repeat(32)}`, slug: EPL_SLUG, question: "Will Arsenal win the 2026-27 English Premier League (EPL) Championship?",
  outcomes: '["Yes", "No"]', outcomePrices: '["0.635", "0.365"]', bestBid: 0.63, bestAsk: 0.64, spread: 0.01, liquidityNum: 123709.6, volume24hr: 3784.5,
  oneWeekPriceChange: 0.02, endDate: "2027-05-30T23:59:00Z", closed: false, description: "This market will resolve according to the team that wins the 2026-27 English Premier League.",
  events: [{ slug: "epl-2027-champion" }], ...over,
});

function gammaFetch(markets: Record<string, unknown>[], tags: string[] = ["EPL", "soccer", "sports"]): typeof fetch {
  return (async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/markets") {
      const slug = url.searchParams.get("slug");
      const cid = url.searchParams.get("condition_ids");
      return Response.json(markets.filter((m) => (slug ? m.slug === slug : cid ? m.conditionId === cid : false)));
    }
    if (url.pathname === "/events") return Response.json([{ slug: url.searchParams.get("slug"), tags: tags.map((slug) => ({ slug })), markets }]);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

test("a market is found from a polymarket link, a slug or a condition id", async () => {
  assert.equal(marketRefFrom(`https://polymarket.com/event/epl-2027-champion/${EPL_SLUG}`), EPL_SLUG);
  assert.equal(marketRefFrom(`  ${EPL_SLUG}  `), EPL_SLUG);
  assert.equal(marketRefFrom("https://evil.example/event/x"), null);
  const lookup = createMarketLookup({ fetchImpl: gammaFetch([gammaMarket()]) });
  const m = await lookup(`https://polymarket.com/event/epl-2027-champion/${EPL_SLUG}`);
  assert.ok(m.ok, JSON.stringify(m));
  assert.equal(m.market.yesBps, 6350);
  assert.equal(m.market.spread, 0.01);
  assert.deepEqual(m.market.tags, ["epl", "soccer", "sports"]);
  assert.equal(m.market.url, `https://polymarket.com/event/epl-2027-champion/${EPL_SLUG}`);
  const byId = await lookup(`0x${"f0".repeat(32)}`);
  assert.ok(byId.ok);
  assert.deepEqual(await lookup("no-such-market"), { ok: false, code: "market_not_found" });
});

test("football is recognised from event tags or the question, other sports are not", () => {
  const base = { question: "Will Arsenal win?", tags: ["epl", "soccer"] } as Pick<MarketSnapshot, "question" | "tags">;
  assert.equal(isFootballMarket(base), true);
  assert.equal(isFootballMarket({ question: "Real Madrid vs. Barcelona: who wins?", tags: [] }), true);
  assert.equal(isFootballMarket({ question: "Will the Lakers win the NBA Finals?", tags: ["nba", "sports"] }), false);
  assert.equal(isFootballMarket({ question: "Will Bitcoin be above $100k?", tags: ["crypto"] }), false);
});

test("scout scores a market from its numbers and names every flag", () => {
  const healthy = { yesBps: 6350, bestBid: 0.63, bestAsk: 0.64, spread: 0.01, liquidity: 123_709, volume24h: 3_784, weekChange: 0.02, endAt: new Date("2027-05-30T23:59:00Z"), description: "This market will resolve according to the team that wins the league.", closed: false } as MarketSnapshot;
  const ok = scoutReport(healthy, NOW);
  assert.equal(ok.verdict, "tradeable");
  assert.deepEqual(ok.flags, []);
  assert.deepEqual(ok.metrics, { yesPct: 63.5, spreadCents: 1, liquidityUsd: 123_709, volume24hUsd: 3_784, weekMovePts: 2, hoursLeft: 5411.98 });
  const thin = scoutReport({ ...healthy, liquidity: 2_000, spread: 0.08, volume24h: 40 }, NOW);
  assert.equal(thin.verdict, "avoid");
  assert.deepEqual(thin.flags.map((f) => f.code), ["thin_liquidity", "wide_spread", "low_activity"]);
  const soon = scoutReport({ ...healthy, endAt: new Date(NOW.getTime() + 5 * 3_600_000) }, NOW);
  assert.equal(soon.verdict, "watch");
  assert.deepEqual(soon.flags.map((f) => f.code), ["closing_soon"]);
  const vague = scoutReport({ ...healthy, yesBps: 150, description: "Resolves at the sole discretion of the market creator." }, NOW);
  assert.deepEqual(vague.flags.map((f) => f.code), ["extreme_price", "vague_rules"]);
  assert.equal(vague.verdict, "watch");
  const boilerplate = scoutReport({ ...healthy, description: "Resolves to the league winner. The primary resolution source will be official information from the league; however, a consensus of credible reporting may also be used." }, NOW);
  assert.deepEqual(boilerplate.flags, [], "a credible-reporting backup next to an official source is not vague");
  const consensusOnly = scoutReport({ ...healthy, description: "This market resolves Yes if a consensus of credible reporting says the deal closed by the date." }, NOW);
  assert.deepEqual(consensusOnly.flags.map((f) => f.code), ["vague_rules"]);
});

function setup(opts: { tags?: string[]; reply?: string } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const prompts: string[] = [];
  const app = createSpecialistRoutes({
    network, store,
    sellers: { pitch: { payTo: `0x${"c1".repeat(20)}` as Address, settle: settler.settle }, scout: { payTo: `0x${"c2".repeat(20)}` as Address, settle: settler.settle } },
    lookup: createMarketLookup({ fetchImpl: gammaFetch([gammaMarket()], opts.tags) }),
    callModel: async (p) => { prompts.push(`${p.systemPrompt} ${p.userPrompt}`); return { text: opts.reply ?? '{"probability":0.6,"reasons":["Arsenal lead the table","Strong home record","Squad depth"]}' }; },
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { app, settler, prompts, fetchImpl };
}

test("pitch asks for payment at its price, then forecasts a football market against the crowd", async () => {
  const { app, fetchImpl, settler, prompts } = setup();
  const unpaid = await app.request("http://api.test/pitch", json({ market: EPL_SLUG }));
  assert.equal(unpaid.status, 402);
  const out = await buyExact({ url: "http://api.test/pitch", init: json({ market: EPL_SLUG }), network, maxAmount: SPECIALISTS.pitch.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 150_000n);
  const data = out.data as { agent: string; probabilityBps: number; crowdBps: number; edgePts: number; reasons: string[]; market: { question: string; url: string } };
  assert.equal(data.agent, "Pitch");
  assert.deepEqual([data.probabilityBps, data.crowdBps, data.edgePts], [6000, 6350, -3.5]);
  assert.equal(data.reasons.length, 3);
  assert.match(prompts[0]!, /draw/i, "the football prompt reasons about draws");
  assert.match(prompts[0]!, /63\.5%/);
  assert.equal(settler.calls.length, 1);
});

test("pitch refuses a market that is not football before any money moves", async () => {
  const { fetchImpl, settler } = setup({ tags: ["nba", "sports"] });
  const out = await buyExact({ url: "http://api.test/pitch", init: json({ market: EPL_SLUG.replace("arsenal", "arsenal") }), network, maxAmount: SPECIALISTS.pitch.price, signerFor: () => localSigner(buyer), fetchImpl: ((u: string, i?: RequestInit) => fetchImpl(u, i)) as typeof fetch });
  assert.ok(!out.ok);
  assert.equal(settler.calls.length, 0, "nothing settles");
});

test("scout sells a market check with a verdict, flags and a one-line rules note", async () => {
  const { fetchImpl, settler } = setup({ reply: "The rules name a single clear source: the league's final table." });
  const out = await buyExact({ url: "http://api.test/scout", init: json({ market: EPL_SLUG }), network, maxAmount: SPECIALISTS.scout.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 100_000n);
  const data = out.data as { agent: string; verdict: string; flags: unknown[]; metrics: { yesPct: number }; rulesNote: string };
  assert.deepEqual([data.agent, data.verdict, data.flags.length, data.metrics.yesPct], ["Scout", "tradeable", 0, 63.5]);
  assert.match(data.rulesNote, /final table/);
  assert.equal(settler.calls.length, 1);
});

test("an agent without a wallet is not for sale, and a bad body is refused", async () => {
  const { app } = setup();
  assert.equal((await app.request("http://api.test/nobody", json({ market: EPL_SLUG }))).status, 404);
  assert.equal((await app.request("http://api.test/pitch", json({ wrong: 1 }))).status, 400);
});
