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
      // Like Gamma: closed markets are left out unless closed=true, which returns only closed ones.
      const closed = url.searchParams.get("closed") === "true";
      return Response.json(markets.filter((m) => Boolean(m.closed) === closed && (slug ? m.slug === slug : cid ? m.conditionId === cid : false)));
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
    sellers: { pitch: { payTo: `0x${"c1".repeat(20)}` as Address, settle: settler.settle }, scout: { payTo: `0x${"c2".repeat(20)}` as Address, settle: settler.settle }, rules: { payTo: `0x${"c3".repeat(20)}` as Address, settle: settler.settle } },
    lookup: createMarketLookup({ fetchImpl: gammaFetch([gammaMarket(), gammaMarket({ slug: "closed-one", conditionId: `0x${"e0".repeat(32)}`, closed: true }), gammaMarket({ slug: "rules-one", conditionId: `0x${"d0".repeat(32)}`, description: RULES, umaResolutionStatuses: `["proposed", "disputed"]` })], opts.tags) }),
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

const RULES = `This market will resolve to "Yes" if the United States and Ukraine enact or sign any deal between March 31 and April 30, 2025, 11:59 PM ET, that explicitly involves Ukrainian minerals.

Announcements of an agreement will not alone qualify for a "Yes" resolution.

The resolution source for this market will be official information from the governments of the US and Ukraine and a consensus of credible reporting.`;

test("the lookup keeps the full rules and the market's proposal and dispute history", async () => {
  const lookup = createMarketLookup({ fetchImpl: gammaFetch([
    gammaMarket({ description: "x".repeat(7_000), umaResolutionStatuses: '["proposed", "disputed"]' }),
    gammaMarket({ slug: "as-array", conditionId: `0x${"a0".repeat(32)}`, umaResolutionStatuses: ["proposed"] }),
    gammaMarket({ slug: "broken", conditionId: `0x${"b0".repeat(32)}`, umaResolutionStatuses: "not json" }),
  ]) });
  const m = await lookup(EPL_SLUG);
  assert.ok(m.ok);
  assert.equal(m.market.description.length, 7_000);
  assert.deepEqual(m.market.umaStatuses, ["proposed", "disputed"]);
  const arr = await lookup("as-array");
  assert.ok(arr.ok && arr.market.umaStatuses.length === 1);
  const broken = await lookup("broken");
  assert.ok(broken.ok && broken.market.umaStatuses.length === 0);
});

test("rules check sells quote-checked traps and a dispute risk, and never sees the price", async () => {
  const reply = JSON.stringify({
    decides: { source: { text: "US and Ukraine governments and credible reporting", quote: "official information from the governments of the US and Ukraine" }, cutoff: { text: "30 April 2025, 11:59 PM ET", quote: "April 30, 2025, 11:59 PM ET" }, threshold: null },
    traps: [
      { category: "definition", kind: "ambiguous", quote: "enact or sign any deal", explain: "A framework deal may or may not count as signed." },
      { category: "source", kind: "ambiguous", quote: "decided by Polymarket staff", explain: "Invented." },
    ],
  });
  const { fetchImpl, settler, prompts } = setup({ reply });
  const out = await buyExact({ url: "http://api.test/rules", init: json({ market: "rules-one" }), network, maxAmount: SPECIALISTS.rules.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 250_000n);
  const data = out.data as { agent: string; risk: string; traps: { quote: string }[]; decides: { cutoff: unknown }; signals: { disputes: number }; market: Record<string, unknown> };
  assert.equal(data.agent, "Rules Check");
  assert.deepEqual(data.traps.map((t) => t.quote), ["enact or sign any deal"]);
  assert.equal(data.risk, "high");
  assert.equal(data.signals.disputes, 1);
  assert.ok(data.decides.cutoff);
  assert.ok(!("crowdBps" in data.market), "no price in the answer");
  assert.doesNotMatch(prompts[0]!, /63\.5|0\.635/, "no price in the prompt");
  assert.equal(settler.calls.length, 1);
});

test("rules check refuses a closed market before any money moves", async () => {
  const { fetchImpl, settler } = setup();
  const out = await buyExact({ url: "http://api.test/rules", init: json({ market: "closed-one" }), network, maxAmount: SPECIALISTS.rules.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!out.ok);
  assert.equal(settler.calls.length, 0);
});

test("the rules check endpoint answers the market-rules test with its own reading, free and without payment", async () => {
  const reply = JSON.stringify({ traps: [{ category: "definition", kind: "ambiguous", quote: "wears a suit", explain: "Suit is not defined." }] });
  const { app, settler } = setup({ reply });
  const res = await app.request("http://api.test/rules", json({
    protocol: "agon-playground/1", category: "verification",
    task: { id: "market-rules", title: "Market rules", adversarialPrompt: "Read the rules.", capability: "market rules review" },
    input: { question: "Will Zelensky wear suit?", rules: "Yes if Volodymyr Zelenskyy wears a suit while meeting Trump. The resolution source will be a consensus of credible reporting." },
    scope: { listingReference: "public-test", listingVersion: "0" },
  }));
  assert.equal(res.status, 200);
  const body = await res.json() as { externalWrites: boolean; output: { risk: string; traps: { quote: string }[] } };
  assert.equal(body.externalWrites, false);
  assert.equal(body.output.risk, "high");
  assert.deepEqual(body.output.traps.map((t) => t.quote), ["wears a suit"]);
  assert.equal(settler.calls.length, 0);
});

function watchSetup(owner: string | null) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const created: { watch: { watchId: string; ownerAddress: string | null; payer: string }; markets: { conditionId: string; state: { status: string; yesBps: number | null } }[] }[] = [];
  const app = createSpecialistRoutes({
    network, store,
    sellers: { watch: { payTo: `0x${"c4".repeat(20)}` as Address, settle: settler.settle } },
    lookup: createMarketLookup({ fetchImpl: gammaFetch([gammaMarket(), gammaMarket({ slug: "closed-one", conditionId: `0x${"e0".repeat(32)}`, closed: true })]) }),
    callModel: async () => ({ text: "{}" }),
    watch: {
      store: {
        createWatch: async (w: never, markets: never) => { created.push({ watch: w, markets }); },
        getWatch: async (id: string) => (id === "known" ? { watch: { watchId: "known", ownerAddress: OWNER_ADDR, payer: "0xp", network: "arc-testnet", status: "active", createdAt: NOW, endsAt: NOW }, markets: [], alerts: [] } : null),
      } as never,
      ownerOf: async () => owner,
      statusBase: "https://api.test/agon/agents/specialists/watch",
      newId: () => "w-123",
    },
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { app, settler, created, fetchImpl };
}
const OWNER_ADDR = `0x${"1".repeat(40)}`;

test("resolution watch sells a watch of up to 10 markets, tied to the buyer's Agon account, with a status link", async () => {
  const { fetchImpl, settler, created } = watchSetup(OWNER_ADDR);
  const out = await buyExact({ url: "http://api.test/watch", init: json({ markets: `https://polymarket.com/event/epl-2027-champion/${EPL_SLUG}` }), network, maxAmount: SPECIALISTS.watch.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 250_000n);
  const data = out.data as { agent: string; watchId: string; statusUrl: string; markets: { question: string; status: string }[] };
  assert.deepEqual([data.agent, data.watchId, data.statusUrl], ["Resolution Watch", "w-123", "https://api.test/agon/agents/specialists/watch/w-123"]);
  assert.equal(data.markets[0]!.status, "open");
  assert.equal(created[0]!.watch.ownerAddress, OWNER_ADDR);
  assert.equal(created[0]!.watch.payer.toLowerCase(), buyer.address.toLowerCase());
  assert.equal(created[0]!.markets[0]!.state.yesBps, 6350);
  assert.equal(settler.calls.length, 1);
});

test("resolution watch refuses a closed market, a bad list or too many markets before any money moves", async () => {
  const { app, fetchImpl, settler } = watchSetup(null);
  const closed = await buyExact({ url: "http://api.test/watch", init: json({ markets: `${EPL_SLUG}\nclosed-one` }), network, maxAmount: SPECIALISTS.watch.price, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!closed.ok);
  assert.equal(settler.calls.length, 0);
  assert.equal((await app.request("http://api.test/watch", json({ markets: "https://evil.example/x" }))).status, 400);
  assert.equal((await app.request("http://api.test/watch", json({ markets: Array.from({ length: 11 }, (_, i) => `market-${i}-x`).join("\n") }))).status, 400);
  assert.equal((await app.request("http://api.test/watch", json({ market: EPL_SLUG }))).status, 400, "watch takes markets, not market");
});

test("the lookup finds a closed market, so it is refused as closed, not as missing", async () => {
  const lookup = createMarketLookup({ fetchImpl: gammaFetch([gammaMarket({ slug: "closed-one", conditionId: `0x${"e0".repeat(32)}`, closed: true })]) });
  const bySlug = await lookup("closed-one");
  assert.ok(bySlug.ok && bySlug.market.closed);
  const byId = await lookup(`0x${"e0".repeat(32)}`);
  assert.ok(byId.ok && byId.market.closed);
  assert.deepEqual(await lookup("no-such-market"), { ok: false, code: "market_not_found" });
});

test("a specialist refuses a closed or unknown market with the reason before anything is signed", async () => {
  const { fetchImpl, settler } = watchSetup(null);
  let signed = 0;
  const signerFor = () => { signed += 1; return localSigner(buyer); };
  const closed = await buyExact({ url: "http://api.test/watch", init: json({ markets: `${EPL_SLUG}
closed-one` }), network, maxAmount: SPECIALISTS.watch.price, signerFor, fetchImpl });
  assert.ok(!closed.ok);
  assert.equal(closed.code, "unexpected_status");
  assert.equal((closed as { status?: number }).status, 422);
  assert.equal(((closed as { data?: { error?: string } }).data)?.error, "market_closed");
  const missing = await buyExact({ url: "http://api.test/watch", init: json({ markets: "no-such-market" }), network, maxAmount: SPECIALISTS.watch.price, signerFor, fetchImpl });
  assert.equal(((missing as { data?: { error?: string } }).data)?.error, "market_not_found");
  assert.equal(signed, 0, "nothing was signed");
  assert.equal(settler.calls.length, 0);
});

test("a watch's status page is public by its id and never shows the owner", async () => {
  const { app } = watchSetup(null);
  const res = await app.request("http://api.test/watch/known");
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(!JSON.stringify(body).includes(OWNER_ADDR));
  assert.equal((await app.request("http://api.test/watch/unknown")).status, 404);
});

test("the resolution watch endpoint answers the settlement-alerts test with its own alert logic", async () => {
  const { app, settler } = watchSetup(null);
  const reading = (over: Record<string, unknown>) => ({ closed: false, outcomePrices: '["0.4","0.6"]', description: "rules", ...over });
  const res = await app.request("http://api.test/watch", json({
    protocol: "agon-playground/1", category: "verification",
    task: { id: "settlement-alerts", title: "Settlement alerts", adversarialPrompt: "Report alerts.", capability: "settlement watching" },
    input: { question: "q", readings: [reading({}), reading({ umaResolutionStatus: "proposed" }), reading({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1","0"]' })] },
    scope: { listingReference: "public-test", listingVersion: "0" },
  }));
  assert.equal(res.status, 200);
  const body = await res.json() as { output: { alerts: { step: number; kind: string }[] } };
  assert.deepEqual(body.output.alerts, [{ step: 1, kind: "settlement_started" }, { step: 2, kind: "settled" }]);
  assert.equal(settler.calls.length, 0);
});
