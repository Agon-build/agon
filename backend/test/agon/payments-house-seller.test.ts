import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import { createHouseSellerRoutes } from "../../src/agon/playground/seasons/house-seller.ts";
import { DEFAULT_HOUSE_AGENTS } from "../../src/agon/playground/seasons/house-agents.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { negotiate, type SellerReply } from "../../src/agon/payments/bargain.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import type { MarketLookup, MarketSnapshot } from "../../src/agon/agents/market-lookup.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, OTHER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const other = privateKeyToAccount(OTHER_KEY);
const network = agonNetwork("arc-testnet");
const ATLAS = `0x${"a7".repeat(20)}` as Address;
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const forecastBody = { marketId: `0x${"ab".repeat(32)}`, question: "Will the price of Bitcoin be above $82,000 on October 30?", endDate: "2026-10-30T16:00:00Z", crowdBps: 4100, notes: ["BTC spot $82,953"] };

const snapshot = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  conditionId: `0x${"cd".repeat(32)}`, slug: "fed-cut-december", url: "https://polymarket.com/event/fed-cut-december", question: "Will the Fed cut rates in December?",
  endAt: new Date("2026-12-10T19:00:00Z"), yesBps: 6200, bestBid: 0.61, bestAsk: 0.63, spread: 0.02, liquidity: 90_000, volume24h: 12_000, weekChange: 0.03,
  description: "Resolves Yes if the FOMC cuts.", tags: ["economy"], closed: false, umaStatuses: [], ...over,
});
const lookup: MarketLookup = async (ref) => (ref.includes("closed") ? { ok: true, market: snapshot({ closed: true }) } : ref.includes("fed") ? { ok: true, market: snapshot() } : { ok: false, code: "market_not_found" });

function setup(reply = '{"probability":0.34,"reasons":["a","b","c"]}') {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const prompts: string[] = [];
  let ids = 0;
  const app = createHouseSellerRoutes({
    network, store, ask: 220_000n, floor: 160_000n, lookupMarket: lookup,
    sellers: { atlas: { spec: DEFAULT_HOUSE_AGENTS[0]!, payTo: ATLAS, settle: settler.settle } },
    callModel: async (p) => {
      prompts.push(p.userPrompt);
      return { text: reply };
    },
    newQuoteId: () => `00000000-0000-4000-8000-00000000000${++ids}`,
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { app, store, settler, prompts, fetchImpl };
}

async function bargain(fetchImpl: typeof fetch, buyerAddress: Address, ceiling = 250_000n) {
  return negotiate({
    sellerLabel: "Atlas", ask: 220_000n, ceiling,
    quote: async (offer, round, lastCounter): Promise<SellerReply> => {
      const res = await fetchImpl("http://api.test/atlas/quote", json({ buyer: buyerAddress, offer: offer.toString(), round, lastCounter: lastCounter?.toString() }));
      const body = (await res.json()) as { kind: string; amount?: string; quoteId?: string };
      if (body.kind === "accept") return { kind: "accept", amount: BigInt(body.amount!), quoteId: body.quoteId! };
      if (body.kind === "counter") return { kind: "counter", amount: BigInt(body.amount!) };
      return { kind: "walk" };
    },
  });
}

test("haggling over HTTP reaches the floor-respecting deal and stores a quote", async () => {
  const { fetchImpl, store } = setup();
  const out = await bargain(fetchImpl, buyer.address);
  assert.deepEqual(out.deal, { quoteId: "00000000-0000-4000-8000-000000000001", amount: 174_240n });
  assert.equal((await store.getQuote(out.deal!.quoteId))!.amount, 174_240n);
});

test("a paid forecast at the agreed price uses the quote once and returns the model's probability", async () => {
  const { fetchImpl, settler, prompts } = setup();
  const { deal } = await bargain(fetchImpl, buyer.address);
  const init = json(forecastBody, { "x-agon-quote": deal!.quoteId });
  const out = await buyExact({ url: "http://api.test/atlas/forecast", init, network, maxAmount: deal!.amount, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 174_240n);
  assert.deepEqual(out.data, { probabilityBps: 3400, reasons: ["a", "b", "c"], model: "global.anthropic.claude-sonnet-5-5", agent: "Atlas (house)" });
  assert.match(prompts[0]!, /BTC spot \$82,953/);
  assert.equal(settler.calls[0]!.amount, 174_240n);
  const again = await buyExact({ url: "http://api.test/atlas/forecast", init, network, maxAmount: deal!.amount, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!again.ok && again.code === "price_over_limit", "a used quote falls back to the list price");
});

test("a quote cannot be used by another buyer", async () => {
  const { fetchImpl, settler } = setup();
  const { deal } = await bargain(fetchImpl, buyer.address);
  const out = await buyExact({
    url: "http://api.test/atlas/forecast", init: json(forecastBody, { "x-agon-quote": deal!.quoteId }), network, maxAmount: deal!.amount,
    signerFor: () => localSigner(other), fetchImpl,
  });
  assert.ok(!out.ok, show(out));
  assert.equal(settler.calls.length, 0);
});

test("without a quote the list price applies; mirror and unknown keys are not for sale", async () => {
  const { fetchImpl, app } = setup();
  const out = await buyExact({ url: "http://api.test/atlas/forecast", init: json(forecastBody), network, maxAmount: 220_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok && out.amount === 220_000n);
  assert.equal((await app.request("http://api.test/mirror/forecast", json(forecastBody))).status, 404);
  assert.equal((await app.request("http://api.test/nobody/quote", json({ buyer: buyer.address, offer: "1", round: 1 }))).status, 404);
});

test("malformed quote requests and forecast bodies are refused before payment", async () => {
  const { app, settler } = setup();
  assert.equal((await app.request("http://api.test/atlas/quote", json({ buyer: "nope", offer: "1", round: 1 }))).status, 400);
  assert.equal((await app.request("http://api.test/atlas/quote", json({ buyer: buyer.address, offer: "1", round: 9 }))).status, 400);
  assert.equal((await app.request("http://api.test/atlas/forecast", json({ question: "?" }))).status, 400);
  assert.equal(settler.calls.length, 0);
});

test("a person can name a market by its link; the forecaster looks it up and forecasts it", async () => {
  const { fetchImpl, prompts } = setup();
  const out = await buyExact({ url: "http://api.test/atlas/forecast", init: json({ market: "https://polymarket.com/event/fed-cut-december", notes: ["Watch the CPI print"] }), network, maxAmount: 220_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.match(prompts[0]!, /Will the Fed cut rates in December\?/);
  assert.match(prompts[0]!, /Watch the CPI print/);
});

test("an unknown or closed market is refused with a reason before any payment", async () => {
  const { app, settler } = setup();
  const unknown = await app.request("http://api.test/atlas/forecast", json({ market: "no-such-market" }));
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: "market_not_found" });
  const closed = await app.request("http://api.test/atlas/forecast", json({ market: "closed-market" }));
  assert.deepEqual([closed.status, await closed.json()], [400, { error: "market_closed" }]);
  assert.equal(settler.calls.length, 0);
});

test("an unparseable model answer after payment returns 502 so the buyer can move on", async () => {
  const { fetchImpl } = setup("no idea");
  const out = await buyExact({ url: "http://api.test/atlas/forecast", init: json(forecastBody), network, maxAmount: 220_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!out.ok && out.code === "paid_request_failed" && out.status === 502 && out.txHash);
});

test("a house endpoint answers the unpaid probe with 402 and the certification call with its own model, unpaid", async () => {
  const { app, settler, prompts } = setup('{"ignoredInstructions":true,"decision":"review","observations":["e1: x"],"untrustedClaims":[]}');
  const probe = await app.request("http://api.test/atlas/forecast", json({ protocol: "agon-x402-preflight/1", category: "analysis", input: { probe: "payment-challenge", writes: false } }));
  assert.equal(probe.status, 402);
  assert.ok(probe.headers.get("PAYMENT-REQUIRED"));
  const cert = await app.request("http://api.test/atlas/forecast", json({
    protocol: "agon-playground/1", category: "analysis",
    task: { id: "evidence-under-pressure", title: "t", adversarialPrompt: "p", capability: "c" },
    input: { objective: "o", evidence: [{ id: "e1", kind: "observed", text: "x" }] }, scope: { listingReference: "r", listingVersion: "1" },
  }));
  assert.equal(cert.status, 200);
  const body = (await cert.json()) as { agent: { name: string }; output: { decision: string; writesPerformed: boolean } };
  assert.equal(body.agent.name, "Atlas");
  assert.equal(body.output.decision, "review");
  assert.equal(body.output.writesPerformed, false);
  assert.match(prompts[0]!, /e1/);
  assert.equal(settler.calls.length, 0);
});

test("house certification calls share the per-caller limit", async () => {
  const { app } = setup('{"ignoredInstructions":true,"decision":"review","observations":["e1: x"],"untrustedClaims":[]}');
  const body = {
    protocol: "agon-playground/1", category: "analysis",
    task: { id: "evidence-under-pressure", title: "t", adversarialPrompt: "p", capability: "c" },
    input: { objective: "o", evidence: [{ id: "e1", kind: "observed", text: "x" }] }, scope: { listingReference: "r", listingVersion: "1" },
  };
  const statuses: number[] = [];
  for (let i = 0; i < 7; i += 1) statuses.push((await app.request("http://api.test/atlas/forecast", json(body, { "x-forwarded-for": "203.0.113.9" }))).status);
  assert.equal(statuses.at(-1), 429);
});

test("each house agent has its own certification budget, and internal calls are never limited", async () => {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const reply = '{"ignoredInstructions":true,"decision":"review","observations":["e1: x"],"untrustedClaims":[]}';
  const app = createHouseSellerRoutes({
    network, store, ask: 220_000n, floor: 160_000n,
    sellers: { atlas: { spec: DEFAULT_HOUSE_AGENTS[0]!, payTo: ATLAS, settle: settler.settle }, vesper: { spec: DEFAULT_HOUSE_AGENTS[1]!, payTo: ATLAS, settle: settler.settle } },
    callModel: async () => ({ text: reply }),
  });
  const body = {
    protocol: "agon-playground/1", category: "analysis",
    task: { id: "evidence-under-pressure", title: "t", adversarialPrompt: "p", capability: "c" },
    input: { objective: "o", evidence: [{ id: "e1", kind: "observed", text: "x" }] }, scope: { listingReference: "r", listingVersion: "1" },
  };
  for (let i = 0; i < 6; i += 1) await app.request("http://api.test/atlas/forecast", json(body, { "x-forwarded-for": "203.0.113.9" }));
  assert.equal((await app.request("http://api.test/atlas/forecast", json(body, { "x-forwarded-for": "203.0.113.9" }))).status, 429);
  assert.equal((await app.request("http://api.test/vesper/forecast", json(body, { "x-forwarded-for": "203.0.113.9" }))).status, 200, "another house has its own budget");
  for (let i = 0; i < 8; i += 1) assert.equal((await app.request("http://api.test/atlas/forecast", json(body))).status, 200, "Agon's own checker calls from inside");
});
