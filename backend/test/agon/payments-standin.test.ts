import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import { createStandinRoutes } from "../../src/agon/payments/standin-seller.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const PAY_TO = `0x${"5".repeat(40)}` as Address;
const cid = `0x${"ab".repeat(32)}`;

function setup() {
  const upstream: string[] = [];
  const upstreamFetch = (async (url: string) => {
    upstream.push(url);
    if (url.startsWith("https://coins.llama.fi/")) return new Response(JSON.stringify({ coins: { "coingecko:bitcoin": { price: 82953.31, symbol: "BTC" } } }));
    return new Response(JSON.stringify({
      events: [{ title: "Bitcoin above ___ on October 30?", markets: [
        { conditionId: cid, question: "Will the price of Bitcoin be above $82,000 on October 30?", slug: "btc-82k-oct-30", endDate: "2026-10-30T16:00:00Z", outcomes: '["Yes","No"]', outcomePrices: '["0.41","0.59"]', liquidityNum: 40000 },
        { conditionId: `0x${"cd".repeat(32)}`, question: "Up or down?", slug: "x", endDate: "2026-10-30T16:00:00Z", outcomes: '["Up","Down"]', outcomePrices: '["0.5","0.5"]' },
        { conditionId: `0x${"ce".repeat(32)}`, question: "Will the price of Bitcoin be above $80,000 on October 30?", slug: "y", endDate: "2026-10-30T16:00:00Z", outcomes: '["Yes","No"]', outcomePrices: '["1","0"]', closed: true },
      ] }],
    }));
  }) as typeof fetch;
  const settler = fakeSettler();
  const store = new MemoryPaymentsStore();
  const app = createStandinRoutes({ network, payTo: PAY_TO, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), fetchImpl: upstreamFetch });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { fetchImpl, upstream, settler };
}

test("the price route charges 0.002 and passes DefiLlama's answer through", async () => {
  const { fetchImpl, upstream } = setup();
  const out = await buyExact({ url: "http://api.test/price/coingecko:bitcoin", network, maxAmount: 2_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 2_000n);
  assert.equal((out.data as { coins: Record<string, { price: number }> }).coins["coingecko:bitcoin"]!.price, 82953.31);
  assert.equal(upstream[0], "https://coins.llama.fi/prices/current/coingecko:bitcoin");
});

test("the market route charges 0.0085 and returns binary markets with a Yes price", async () => {
  const { fetchImpl, upstream } = setup();
  const out = await buyExact({ url: "http://api.test/markets?q=bitcoin%2082000", network, maxAmount: 8_500n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.ok(out.ok, show(out));
  const markets = (out.data as { markets: { conditionId: string; yesPriceBps: number }[] }).markets;
  assert.deepEqual(markets.map((m) => [m.conditionId, m.yesPriceBps]), [[cid, 4100]]);
  assert.ok(upstream[0]!.startsWith("https://gamma-api.polymarket.com/public-search?"));
  // Without this Polymarket ranks long-closed events first and almost no question finds an open market.
  assert.equal(new URL(upstream[0]!).searchParams.get("events_status"), "active", "only open events are searched");
});

test("bad coin lists and empty queries are refused before payment", async () => {
  const { fetchImpl, settler } = setup();
  assert.equal((await fetchImpl("http://api.test/price/not%20valid!")).status, 400);
  assert.equal((await fetchImpl("http://api.test/markets?q=")).status, 400);
  assert.equal(settler.calls.length, 0);
});
