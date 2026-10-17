import assert from "node:assert/strict";
import test from "node:test";

import { INTENT_KINDS, KIND_SOURCES, readIntent } from "../../src/agon/routing/intent.ts";

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
