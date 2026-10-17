import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";
import { fillInput } from "../../src/agon/routing/fill-input.ts";

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
