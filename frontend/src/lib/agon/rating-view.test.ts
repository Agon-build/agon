import assert from "node:assert/strict";
import test from "node:test";

import { WINDOW_CHOICES, changeLabel, evidenceLine, pageSlice, partStatusLabel, ratingByAgentId, scoreLine } from "./rating-view.ts";

test("test runs are shown a page at a time, and a page past the end shows the last one", () => {
  const runs = Array.from({ length: 12 }, (_, i) => i + 1);
  assert.deepEqual(pageSlice(runs, 0, 5), { rows: [1, 2, 3, 4, 5], page: 0, pages: 3, label: "1-5 of 12" });
  assert.deepEqual(pageSlice(runs, 2, 5), { rows: [11, 12], page: 2, pages: 3, label: "11-12 of 12" });
  assert.equal(pageSlice(runs, 9, 5).page, 2, "clamped after the list shrinks");
  assert.deepEqual(pageSlice([], 0, 5), { rows: [], page: 0, pages: 1, label: "" });
});

test("the score line reads like a fact, or says the agent is not rated yet", () => {
  assert.equal(scoreLine({ score: 78.4, rank: 3, categoryLabel: "Analysis" }), "Agon score 78 · Analysis #3");
  assert.equal(scoreLine({ score: 61, rank: null, categoryLabel: "Research" }), "Agon score 61 · Research");
  assert.equal(scoreLine({ score: null, rank: null, categoryLabel: "Analysis" }), "Not rated yet");
  assert.equal(scoreLine(null), "Not rated yet");
});

test("the evidence line counts what the score rests on, leaving out empty parts", () => {
  assert.equal(evidenceLine({ tests: 12, forecasts: 40, paid: 5 }), "12 tests · 40 forecasts · 5 paid jobs");
  assert.equal(evidenceLine({ tests: 1, forecasts: 0, paid: 1 }), "1 test · 1 paid job");
  assert.equal(evidenceLine({ tests: 0, forecasts: 1, paid: 0 }), "1 forecast");
  assert.equal(evidenceLine({ tests: 0, forecasts: 0, paid: 0 }), "No results yet");
});

test("each part shows its value or why it has none", () => {
  assert.equal(partStatusLabel({ value: 84.3, count: 30, atMinimum: true, status: "rated" }), "84");
  assert.equal(partStatusLabel({ value: 58.3, count: 1, atMinimum: false, status: "not_enough" }), "58");
  assert.equal(partStatusLabel({ value: null, count: 0, atMinimum: false, status: "not_enough" }), "Not enough results");
  assert.equal(partStatusLabel({ value: null, count: 0, atMinimum: false, status: "coming_next" }), "Coming next");
  assert.equal(partStatusLabel({ value: null, count: 0, atMinimum: false, status: "no_test" }), "No public test for this category yet");
});

test("change against the previous window reads up, down or new", () => {
  assert.equal(changeLabel(4, false), "up 4");
  assert.equal(changeLabel(-2.5, false), "down 2.5");
  assert.equal(changeLabel(0, false), "");
  assert.equal(changeLabel(null, true), "new");
  assert.equal(changeLabel(null, false), "");
});

test("windows are all time, 30 days, 7 days and 24 hours, in that order", () => {
  assert.deepEqual(WINDOW_CHOICES.map((w) => [w.id, w.label]), [["all", "All time"], ["30d", "30 days"], ["7d", "7 days"], ["24h", "24 hours"]]);
});

test("card lines per agent use the category name; agents without a score read Not rated yet", () => {
  const map = ratingByAgentId([
    { agentId: "41", categoryId: "3", score: 78, rank: 1 },
    { agentId: "42", categoryId: "1", score: null, rank: null },
  ]);
  assert.equal(map.get("41"), "Agon score 78 · Analysis #1");
  assert.equal(map.get("42"), "Not rated yet");
  assert.equal(map.has("43"), false);
});

test("five categories have a public test with a plain title; the rest say there is none yet", async () => {
  const { testInfo, runErrorText } = await import("./rating-view.ts");
  assert.deepEqual(["1", "3", "5", "7", "8"].map((c) => testInfo(c)?.title), ["Live chain fact", "Evidence under pressure", "Transaction safety", "Selector guard", "Manifest anchor"]);
  assert.equal(testInfo("6"), null);
  assert.equal(runErrorText({ status: 429, serverMessage: "You have run 5 tests in the last hour. Try again later." }), "You have run 5 tests in the last hour. Try again later.");
  assert.equal(runErrorText({ status: 401, serverMessage: null }), "Sign in to test this agent.");
  assert.equal(runErrorText(new Error("x")), "The test could not run. Try again in a moment.");
});

test("a Verification agent's test is named from the input it declares, and a run from its own task", async () => {
  const { testInfo, runTestTitle } = await import("./rating-view.ts");
  const takes = (name: string) => ({ invocation: { requestSchema: { properties: { [name]: { type: "string" } } } } });
  assert.equal(testInfo("8", takes("markets"))!.title, "Settlement alerts");
  assert.equal(testInfo("8", takes("market"))!.title, "Market rules");
  assert.equal(testInfo("8", null)!.title, "Manifest anchor");
  assert.equal(testInfo("3", takes("market"))!.title, "Evidence under pressure");
  assert.equal(runTestTitle({ taskId: "settlement-alerts", categoryId: "8" }), "Settlement alerts");
  assert.equal(runTestTitle({ taskId: "manifest-anchor", categoryId: "8" }), "Manifest anchor");
  assert.equal(runTestTitle({ taskId: "unknown", categoryId: "6" }), null);
});
