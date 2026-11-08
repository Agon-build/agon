import assert from "node:assert/strict";
import test from "node:test";

import { schemaFields, scorePartRows } from "./agent-layout.ts";
import type { ScorePart, ScoreRow } from "./scores-api.ts";

const part = (value: number | null, count: number, status: ScorePart["status"]): ScorePart => ({ value, count, atMinimum: status === "rated", status });
const row = (parts: ScoreRow["parts"]): ScoreRow => ({
  agentId: "1", listingReference: "5042002:0x1:1", categoryId: "4", firstParty: true, rank: 4, score: 72.9, previousScore: null, change: null,
  parts, counts: { tests: parts.playground.count, forecasts: parts.arena.count, paid: parts.paid.count },
});

test("the Lead's score parts read counted, not yet and not counted", () => {
  const rows = scorePartRows(row({ playground: part(99, 5, "rated"), paid: part(null, 1, "not_enough"), arena: part(null, 0, "not_enough") }));
  assert.deepEqual(rows.map((r) => r.label), ["Playground", "Ratings from paid work", "Arena"]);
  assert.deepEqual(rows.map((r) => [r.value, r.state]), [["99", "Counted"], ["1 of 3", "Not yet"], ["Not enough yet", "Not counted"]]);
  assert.equal(rows[2]!.note, "Not enough Arena forecasts yet to count.");
  assert.equal(rows[1]!.note, "One rating so far. It counts once three people who paid have rated it.");
});

test("a counted part shows its value to one decimal and how many results it rests on", () => {
  const rows = scorePartRows(row({ playground: part(88.34, 12, "rated"), paid: part(91, 4, "rated"), arena: part(60, 48, "rated") }));
  assert.deepEqual(rows.map((r) => [r.value, r.state]), [["88.3", "Counted"], ["91", "Counted"], ["60", "Counted"]]);
  assert.equal(rows[0]!.note, "Public tests scored by code, from 12 runs.");
  assert.equal(rows[1]!.note, "From 4 ratings by people who paid.");
  assert.equal(rows[2]!.note, "From 48 scored Arena forecasts.");
});

test("a part with no test or still to come says so plainly", () => {
  const rows = scorePartRows(row({ playground: part(null, 0, "no_test"), paid: part(null, 0, "coming_next"), arena: part(null, 3, "not_enough") }));
  assert.deepEqual(rows.map((r) => [r.value, r.state]), [["No test yet", "Not counted"], ["0 of 3", "Not counted"], ["Not enough yet", "Not yet"]]);
  assert.equal(rows[0]!.note, "There is no public test for this category yet.");
  assert.equal(rows[1]!.note, "No ratings yet. It counts once three people who paid have rated it.");
});

test("what an agent takes and gives comes from its published schemas", () => {
  const body = {
    invocation: {
      requestSchema: { properties: { market: { description: "A market link or id" }, notes: { type: "string" } }, required: ["market"] },
      responseSchema: { properties: { probability: { description: "The chance of Yes" }, reasons: {} } },
    },
  };
  assert.deepEqual(schemaFields(body, "request"), [
    { name: "market", description: "A market link or id", optional: false },
    { name: "notes", description: null, optional: true },
  ]);
  assert.deepEqual(schemaFields(body, "response").map((f) => f.name), ["probability", "reasons"]);
  assert.deepEqual(schemaFields(undefined, "request"), []);
  assert.deepEqual(schemaFields({ invocation: { requestSchema: { properties: [] } } }, "request"), []);
});
