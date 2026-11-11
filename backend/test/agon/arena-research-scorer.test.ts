import assert from "node:assert/strict";
import test from "node:test";

import { scoreResearch } from "../../src/agon/arena/tracks/research/scorer.ts";
import { candidates, normalise } from "../../src/agon/arena/tracks/research/values.ts";
import type { ValueType } from "../../src/agon/arena/types.ts";

const task = (valueType: ValueType, truth: string, question = "What is it?") => ({ valueType, truth, question });
const ADDR = "0xabcdef0123456789abcdef0123456789abcdef01";

test("each kind of value has one normal form", () => {
  assert.equal(normalise("integer", "1,234,567"), "1234567");
  assert.equal(normalise("integer", "1234567"), "1234567");
  assert.equal(normalise("integer", "0"), "0");
  assert.equal(normalise("integer", "twelve"), null);
  assert.equal(normalise("address", ADDR.toUpperCase().replace("0X", "0x")), ADDR);
  assert.equal(normalise("address", "0xabc"), null);
  for (const d of ["2026-11-12", "12 November 2026", "Nov 12, 2026", "November 12th, 2026", "12 Nov 2026", "2026-11-12T08:30:00Z"]) assert.equal(normalise("date", d), "2026-11-12");
  assert.equal(normalise("date", "2026-02-31"), null);
  assert.equal(normalise("amount", "$1,250.5"), "1250.500000");
  assert.equal(normalise("amount", "3 USDC"), "3.000000");
  assert.equal(normalise("amount", "3"), null);
  assert.equal(normalise("name", '  "Miami   Heat". '), "miami heat");
});

test("the right value alone scores 100, in text or inside JSON", () => {
  assert.equal(scoreResearch(task("integer", "21000"), "21,000"), 100);
  assert.equal(scoreResearch(task("integer", "21000"), { report: { lines: ["The block used 21000 gas."] } }), 100);
  assert.equal(scoreResearch(task("integer", "21000"), { gas: 21000 }), 100);
  assert.equal(scoreResearch(task("address", ADDR), `Deployed by ${ADDR.toUpperCase().replace("0X", "0x")}.`), 100);
  assert.equal(scoreResearch(task("date", "2026-11-12"), "It ends on 12 November 2026."), 100);
  assert.equal(scoreResearch(task("amount", "1250.500000"), "It moved $1,250.50."), 100);
  assert.equal(scoreResearch(task("name", "heat"), { answer: "The second outcome is Heat." }), 100);
});

test("a declared value field is the answer, and the rest is not read", () => {
  const result = { answer: "Block 1204455 used 21,000 gas on 12 November 2026.", value: "21000", source: "https://example.com/block/1204455", readAt: "2026-11-13T10:00:00Z" };
  assert.equal(scoreResearch(task("integer", "21000"), result), 100);
  assert.equal(scoreResearch(task("integer", "21000"), { ...result, value: "20999" }), 0);
  assert.equal(scoreResearch(task("date", "2026-11-12"), { value: "2026-11-12", readAt: "2026-11-13T10:00:00Z" }), 100);
});

test("naming other values beside the right one costs points", () => {
  const t = task("integer", "21000");
  assert.equal(scoreResearch(t, "21000 or 22000"), 50);
  assert.equal(scoreResearch(t, "21000, 22000 or 23000"), 25);
  assert.equal(scoreResearch(t, "21000, 22000, 23000 or 24000"), 0);
  assert.equal(scoreResearch(t, { value: "21000 22000 23000 24000 25000" }), 0);
  assert.equal(scoreResearch(t, "22000"), 0);
});

test("a value the question names is not an answer", () => {
  const t = task("integer", "21000", "How much gas did block 1204455 on Arc Testnet use? Reply with the number only.");
  assert.equal(scoreResearch(t, "Block 1204455 used 21,000 gas."), 100);
  assert.equal(scoreResearch(t, "1204455"), 0);
  const d = task("date", "2026-11-12", 'What end date does Polymarket list for the market "nba-heat-knicks-2026-11-11"?');
  assert.equal(scoreResearch(d, "The market nba-heat-knicks-2026-11-11 ends 2026-11-12."), 100);
});

test("dates, links, hex and times are not counted as numbers", () => {
  const t = task("integer", "7");
  assert.equal(scoreResearch(t, "7 transactions, read 2026-11-13 at 10:42 from https://example.com/b/99 (hash 0xabc123)."), 100);
  assert.deepEqual(candidates("integer", "v2 and 3rd and 1.5 and 10x"), []);
});

test("nothing delivered scores 0", () => {
  for (const empty of [null, undefined, "", "   ", {}, [], { value: "" }]) assert.equal(scoreResearch(task("integer", "7"), empty), 0);
});

test("a name must appear as a whole phrase", () => {
  assert.equal(scoreResearch(task("name", "heat"), "Heat"), 100);
  assert.equal(scoreResearch(task("name", "heat"), "The heater is on."), 0);
  assert.equal(scoreResearch(task("name", "miami heat"), "It is the Miami  Heat."), 100);
  assert.equal(scoreResearch(task("name", "heat"), "Knicks"), 0);
});

test("a very large answer is read up to a limit and never throws", () => {
  const big = { parts: Array.from({ length: 5000 }, (_, i) => `filler text number ${i} `.repeat(10)) };
  assert.equal(typeof scoreResearch(task("integer", "7"), big), "number");
  let deep: unknown = "7";
  for (let i = 0; i < 40; i += 1) deep = { deep };
  assert.equal(scoreResearch(task("integer", "7"), deep), 0);
});
