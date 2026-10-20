import assert from "node:assert/strict";
import test from "node:test";

import { INTENT_KINDS, KIND_SOURCES, kindFromWords, readIntent } from "../../src/agon/routing/intent.ts";

test("code reads market checks and chances before the model does", () => {
  assert.equal(kindFromWords("Is this Polymarket market worth trading? polymarket.com/event/fed-cut"), "analysis");
  assert.equal(kindFromWords("Check the liquidity and spread on the Arsenal title market"), "analysis");
  assert.equal(kindFromWords("How does this market resolve? Are the rules clear?"), "analysis");
  assert.equal(kindFromWords("Should I avoid the Bitcoin 120k market?"), "analysis");
  assert.equal(kindFromWords("What is the chance BTC is above $120k on Friday?"), "forecast");
  assert.equal(kindFromWords("Will Arsenal win the Premier League this season?"), "forecast");
  assert.equal(kindFromWords("What are the odds the Fed cuts in December?"), "forecast");
  assert.equal(kindFromWords("What is the chance this market's rules resolve it Yes?"), "forecast", "a chance question stays a forecast");
  assert.equal(kindFromWords("Summarise the latest Arc docs on gas"), null);
});

test("the model still gives search words and values, and code decides a clear kind", async () => {
  const out = await readIntent("Is the Fed December market worth trading?", model('{"kind":"forecast","query":"fed december market","values":{}}'), "m");
  assert.deepEqual(out, { kind: "analysis", query: "fed december market", values: {} });
  const down = await readIntent("Is the Fed December market worth trading?", async () => { throw new Error("down"); }, "m");
  assert.equal(down.kind, "analysis", "a model failure still routes a clear request");
});

const model = (text: string) => async () => ({ text });

test("a model answer becomes an intent", async () => {
  const out = await readIntent("Analyst ratings for AAPL please", model('{"kind":"market_data","query":"analyst ratings AAPL","values":{"ticker":"AAPL"}}'), "m");
  assert.deepEqual(out, { kind: "market_data", query: "analyst ratings AAPL", values: { ticker: "AAPL" } });
});

test("garbage, an unknown kind or a model error falls back to other with the raw text", async () => {
  const raw = "something odd";
  assert.deepEqual(await readIntent(raw, model("not json"), "m"), { kind: "other", query: raw, values: {} });
  assert.deepEqual(await readIntent(raw, model('{"kind":"teleport","query":"x"}'), "m"), { kind: "other", query: raw, values: {} });
  assert.deepEqual(await readIntent(raw, async () => { throw new Error("down"); }, "m"), { kind: "other", query: raw, values: {} });
});

test("every kind maps to at least one source category", () => {
  for (const kind of INTENT_KINDS) {
    const s = KIND_SOURCES[kind];
    assert.ok(s.agonCategories.length + s.circleCategories.length > 0, kind);
  }
  assert.deepEqual(KIND_SOURCES.forecast.circleCategories, ["PREDICTION_MARKETS"]);
  assert.ok(KIND_SOURCES.other.circleCategories.includes("FINANCIAL_ANALYSIS"));
});
