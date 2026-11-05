import assert from "node:assert/strict";
import test from "node:test";

import { fillPath, pathParams, withPathParams } from "../../src/agon/routing/path-params.ts";

const URL_ = "https://arc.blockrun.ai/api/v1/defillama/prices/{coins}";

test("names in braces in a service address are found once each", () => {
  assert.deepEqual(pathParams(URL_), ["coins"]);
  assert.deepEqual(pathParams("https://x.example/{a}/b/{b}/{a}"), ["a", "b"]);
  assert.deepEqual(pathParams("https://x.example/plain"), []);
});

test("each address slot becomes a required string input, alongside the declared ones", () => {
  assert.deepEqual(withPathParams(URL_, null), { type: "object", properties: { coins: { type: "string", description: "coins, part of the service address" } }, required: ["coins"] });
  const merged = withPathParams("https://x.example/{id}", { properties: { limit: { type: "integer" } }, required: ["limit"] });
  assert.deepEqual(merged?.required, ["limit", "id"]);
  assert.ok((merged?.properties as Record<string, unknown>).limit);
  const plain = { properties: { q: { type: "string" } } };
  assert.equal(withPathParams("https://x.example/a", plain), plain);
});

test("the address is filled from the input and the slot is not sent again; a missing slot is named", () => {
  assert.deepEqual(fillPath(URL_, { coins: "coingecko:bitcoin,coingecko:ethereum", searchWidth: "4h" }), {
    ok: true, url: "https://arc.blockrun.ai/api/v1/defillama/prices/coingecko:bitcoin,coingecko:ethereum", rest: { searchWidth: "4h" },
  });
  assert.deepEqual(fillPath(URL_, {}), { ok: false, missing: ["coins"] });
  assert.deepEqual(fillPath(URL_, { coins: "  " }), { ok: false, missing: ["coins"] });
  assert.deepEqual(fillPath("https://x.example/{id}", { id: "a/b c" }), { ok: true, url: "https://x.example/a%2Fb%20c", rest: {} });
});

import type { Address } from "viem";
import { agonNetwork } from "../../src/agon/network.ts";
import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";
import { createRouter, type RouteRuntime } from "../../src/agon/routing/router.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

test("a quote calls the service at its filled address, and asks when the address input is missing", async () => {
  const seen: { url: string; body: unknown }[] = [];
  const PAY = `0x${"c1".repeat(20)}` as Address;
  const prices: CatalogEntry = {
    source: "circle", reference: "circle:prices", name: "Token price lookup", provider: "BlockRun.AI", category: "FINANCIAL_ANALYSIS", description: "Token prices by coin id",
    url: URL_, method: "GET", inputSchema: withPathParams(URL_, null), price: 2_000n, payTo: PAY, network: "arc", rating: { tier: "unrated", score: null }, latencyMs: null, tags: [],
  };
  const runtime: RouteRuntime = {
    network: agonNetwork("arc"),
    quoteHire: async (req) => { seen.push({ url: req.providerUrl, body: req.body }); return { ok: false, code: "stop_here" }; },
    confirmHire: async () => ({ ok: false, code: "not_used" }),
    wallets: { ensure: async () => { throw new Error("not used"); } },
  };
  let fill: Record<string, unknown> = {};
  const router = createRouter({
    sources: [{ id: "circle", status: () => "ok", search: async () => [prices], all: async () => [prices] }],
    runtimes: { "arc-testnet": runtime, arc: runtime },
    readIntent: async (text) => ({ kind: "market_data", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: fill }),
    feeBps: 500, feeMin: 10_000n, feeAddress: { arc: `0x${"ef".repeat(20)}` as Address },
    leadAsk: async () => ({ ok: false, code: "x" }), store: new MemoryPaymentsStore(), approvalUrl: (t) => t,
  });
  const out = await router.browse("op:x", "market_data");
  fill = {};
  const ask = await router.quote("op:x", out.routeId, "circle:prices");
  assert.ok(!ask.ok && ask.code === "missing_input" && "missing" in ask && ask.missing[0] === "coins");
  assert.equal(seen.length, 0, "nothing is quoted with the braces left in");
  fill = { coins: "coingecko:bitcoin" };
  await router.quote("op:x", out.routeId, "circle:prices");
  assert.deepEqual(seen, [{ url: "https://arc.blockrun.ai/api/v1/defillama/prices/coingecko:bitcoin", body: {} }]);
});

import { serviceName } from "../../src/agon/routing/circle-source.ts";

test("an outside service is named by the first sentence of its description", () => {
  assert.equal(serviceName("Token price lookup. Pass coin identifiers as `/v1/defillama/prices/{coins}` (e.g. coingecko:bitcoin)."), "Token price lookup");
  assert.equal(serviceName("Weather now"), "Weather now");
  assert.equal(serviceName("A".repeat(80)), `${"A".repeat(57)}...`);
});
