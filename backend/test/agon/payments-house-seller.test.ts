import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import { createHouseSellerRoutes } from "../../src/agon/playground/seasons/house-seller.ts";
import { DEFAULT_HOUSE_AGENTS } from "../../src/agon/playground/seasons/house-agents.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { negotiate, type SellerReply } from "../../src/agon/payments/bargain.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, OTHER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const other = privateKeyToAccount(OTHER_KEY);
const network = agonNetwork("arc-testnet");
const ATLAS = `0x${"a7".repeat(20)}` as Address;
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const forecastBody = { marketId: `0x${"ab".repeat(32)}`, question: "Will the price of Bitcoin be above $82,000 on October 30?", endDate: "2026-10-30T16:00:00Z", crowdBps: 4100, notes: ["BTC spot $82,953"] };

function setup(reply = '{"probability":0.34,"reasons":["a","b","c"]}') {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const prompts: string[] = [];
  let ids = 0;
  const app = createHouseSellerRoutes({
    network, store, ask: 220_000n, floor: 160_000n,
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
  assert.deepEqual(out.data, { probabilityBps: 3400, reasons: ["a", "b", "c"], model: "anthropic/claude-sonnet-5.5", agent: "Atlas (house)" });
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

test("an unparseable model answer after payment returns 502 so the buyer can move on", async () => {
  const { fetchImpl } = setup("no idea");
  const out = await buyExact({ url: "http://api.test/atlas/forecast", init: json(forecastBody), network, maxAmount: 220_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(!out.ok && out.code === "paid_request_failed" && out.status === 502 && out.txHash);
});
