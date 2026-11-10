import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";
import { coinsFit, fillInput } from "../../src/agon/routing/fill-input.ts";

const schema = { type: "object", required: ["symbol"], properties: { symbol: { type: "string", description: "Stock ticker" }, limit: { type: "integer" } } };
const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  source: "circle", reference: "circle:x", name: "Analyst ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS", description: "Analyst ratings",
  url: "https://x.example/ratings", method: "GET", inputSchema: schema, price: 10_000n, payTo: null, network: "arc", rating: { tier: "unrated", score: null }, latencyMs: null, tags: [], ...over,
});
const intent = { kind: "market_data" as const, query: "analyst ratings", values: {} };
const model = (text: string) => async () => ({ text });

test("a filled input that matches the schema passes, with numbers coerced to the schema type", async () => {
  const out = await fillInput(entry(), "Analyst ratings for AAPL", intent, model('{"symbol":"AAPL","limit":"5"}'), "m");
  assert.deepEqual(out, { ok: true, input: { symbol: "AAPL", limit: 5 } });
});

test("a missing required field becomes one plain question naming it", async () => {
  const out = await fillInput(entry(), "Analyst ratings please", intent, model("{}"), "m");
  assert.deepEqual(out, { ok: false, missing: ["symbol"], question: "What should I use for symbol (Stock ticker)?", partial: {} });
});

test("extra fields are dropped", async () => {
  const out = await fillInput(entry(), "AAPL ratings", intent, model('{"symbol":"AAPL","secret":"x"}'), "m");
  assert.deepEqual(out, { ok: true, input: { symbol: "AAPL" } });
});

test("no schema falls back to the request text, and a model error still asks for what is required", async () => {
  // minor: an outside service that declares no inputs gets none of the person's words.
  assert.deepEqual(await fillInput(entry({ inputSchema: null }), "hello there", intent, model("{}"), "m"), { ok: true, input: {} });
  assert.deepEqual(await fillInput(entry({ inputSchema: null, method: "POST" }), "hello there", intent, model("{}"), "m"), { ok: true, input: {} });
  // An Agon agent with no declared inputs takes the request as its task.
  assert.deepEqual(await fillInput(entry({ source: "agon", inputSchema: null, method: "POST" }), "hello there", intent, model("{}"), "m"), { ok: true, input: { query: "hello there" } });
  const out = await fillInput(entry(), "ratings", intent, async () => { throw new Error("down"); }, "m");
  assert.equal(out.ok, false);
});

test("final I4: with no required list, an empty fill asks about the first field instead of sending an empty paid request", async () => {
  const loose = { type: "object", properties: { symbol: { type: "string", description: "Stock ticker" }, ticker: { type: "string" } } };
  for (const call of [model("{}"), async () => { throw new Error("model down"); }]) {
    const out = await fillInput(entry({ inputSchema: loose }), "Analyst ratings please", intent, call, "m");
    assert.deepEqual(out, { ok: false, missing: ["symbol"], question: "What should I use for symbol (Stock ticker)?", partial: {} });
  }
  const filled = await fillInput(entry({ inputSchema: loose }), "Ratings for AAPL", intent, model('{"ticker":"AAPL"}'), "m");
  assert.deepEqual(filled, { ok: true, input: { ticker: "AAPL" } });
});

test("an option field gets its default or first option, never the model's pick, so the request costs the listed price", async () => {
  // BlockRun's image service, read 2026-11-06: "model" is optional in the schema, but a request without it is refused with 400.
  const image = { type: "object", required: ["prompt"], properties: {
    n: { type: "integer", default: 1 },
    size: { enum: ["1024x1024", "1792x1024"], type: "string", default: "1024x1024" },
    model: { enum: ["openai/gpt-image-1", "google/nano-banana-pro"], type: "string" },
    prompt: { type: "string" },
  } };
  const e = entry({ inputSchema: image, method: "POST" });
  const out = await fillInput(e, "a logo of a red fox", intent, model('{"prompt":"a logo of a red fox","model":"google/nano-banana-pro","size":"9x9"}'), "m");
  assert.deepEqual(out, { ok: true, input: { size: "1024x1024", model: "openai/gpt-image-1", prompt: "a logo of a red fox" } });
  const asked = await fillInput(e, "make me something", intent, model("{}"), "m");
  assert.deepEqual(asked, { ok: false, missing: ["prompt"], question: "What should I use for prompt?", partial: { size: "1024x1024", model: "openai/gpt-image-1" } });
  // With no required list, filled options alone still ask for the open field.
  const loose = { type: "object", properties: { model: { enum: ["a", "b"] }, prompt: { type: "string" } } };
  const empty = await fillInput(entry({ inputSchema: loose }), "hi", intent, model("{}"), "m");
  assert.deepEqual(empty, { ok: false, missing: ["prompt"], question: "What should I use for prompt?", partial: { model: "a" } });
});

// 2026-11-10 production: "Price of ETH and SOL right now" paid BlockRun's DefiLlama price lookup 0.002 USDC
// and got {"coins":{}}. The address takes DefiLlama ids (coingecko:ethereum); the model only saw the field
// name "coins" and sent the tickers. Code now names the coins from the request.
const PRICES = entry({
  reference: "circle:prices", name: "Token price lookup", provider: "BlockRun.AI",
  description: "Token price lookup. Pass coin identifiers as `/v1/defillama/prices/{coins}` (e.g. `coingecko:bitcoin`, `ethereum:0xC02a`). Supports comma-separated lists.",
  url: "https://arc.blockrun.ai/api/v1/defillama/prices/{coins}", method: "GET",
  inputSchema: { type: "object", required: ["coins"], properties: { coins: { type: "string", description: "coins, part of the service address" } } },
});

test("a DefiLlama price lookup gets the coins in DefiLlama's form, named by code, not by the model", async () => {
  const out = await fillInput(PRICES, "Price of ETH and SOL right now", intent, model('{"coins":"ETH,SOL"}'), "m");
  assert.deepEqual(out, { ok: true, input: { coins: "coingecko:ethereum,coingecko:solana" } });
  const btc = await fillInput(PRICES, "What is bitcoin trading at?", intent, model("{}"), "m");
  assert.deepEqual(btc, { ok: true, input: { coins: "coingecko:bitcoin" } });
});

test("a price lookup for coins Agon cannot name asks which coins, and never sends a bare ticker", async () => {
  const out = await fillInput(PRICES, "Price of PEPE right now", intent, model('{"coins":"PEPE"}'), "m");
  assert.equal(out.ok, false);
  assert.deepEqual(!out.ok && out.missing, ["coins"]);
  assert.equal(!out.ok && out.question, "Which coins? Name them, such as BTC, ETH or SOL, or give DefiLlama ids like coingecko:pepe.");
  const given = await fillInput(PRICES, "Price of coingecko:pepe", intent, model('{"coins":"coingecko:pepe"}'), "m");
  assert.deepEqual(given, { ok: true, input: { coins: "coingecko:pepe" } }, "ids already in DefiLlama's form are kept");
});

// 2026-11-10 production: anchor-x402's token price service (fields chain, contract, symbol, none required)
// was offered for "Price of ETH and SOL right now" and asked "What should I use for chain?". It takes a
// symbol, so code fills the symbol; with no coin Agon knows, it asks for the token plainly.
const SYMBOL_PRICE = entry({
  reference: "circle:anchor-price", name: "Look up the current US dollar price of a token", provider: "anchor-x402", description: "Look up the current US dollar price of a token",
  url: "https://api.anchor-x402.com/v1/price/token", method: "POST",
  inputSchema: { type: "object", properties: {
    chain: { type: "string", description: "Chain slug: base, ethereum, solana, polygon, arbitrum, optimism, bsc, avalanche. Use with contract." },
    symbol: { type: "string", description: "Token symbol like 'ETH', 'BTC', 'SOL', 'USDC'." },
    contract: { type: "string", description: "Token contract address. Use with chain." },
  } },
});

test("a token price service that takes a symbol gets the coin's symbol from the request, and nothing else", async () => {
  assert.deepEqual(await fillInput(SYMBOL_PRICE, "Price of ETH right now", intent, model('{"chain":"ethereum"}'), "m"), { ok: true, input: { symbol: "ETH" } });
  assert.deepEqual(await fillInput(SYMBOL_PRICE, "What is bitcoin trading at?", intent, model("{}"), "m"), { ok: true, input: { symbol: "BTC" } });
});

test("a token price service with no coin Agon knows asks for the token, by symbol or by chain and contract", async () => {
  const out = await fillInput(SYMBOL_PRICE, "How much is that new token worth?", intent, model("{}"), "m");
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.question, "Which token? Give its symbol, such as ETH or USDC, or its chain and contract address.");
  assert.deepEqual(await fillInput(SYMBOL_PRICE, "Price of PEPE", intent, model('{"symbol":"PEPE"}'), "m"), { ok: true, input: { symbol: "PEPE" } }, "a symbol the model read is kept");
});

test("a service that takes one symbol does not fit a request naming several coins", () => {
  assert.equal(coinsFit(SYMBOL_PRICE, "Price of ETH and SOL right now"), false);
  assert.equal(coinsFit(SYMBOL_PRICE, "Price of ETH right now"), true);
  assert.equal(coinsFit(PRICES, "Price of ETH and SOL right now"), true, "a service that takes a list fits");
  assert.equal(coinsFit(entry(), "Price of ETH and SOL right now"), true, "a service with no coin field is not judged here");
});
