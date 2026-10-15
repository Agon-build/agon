import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_WEIGHTS, MINIMUMS, parseWeights, previousWindow, pull, rankCategory, scoreAgent, windowSince } from "../../src/agon/tests/scores.ts";

const AVG = { playground: 50, paid: 50 };
const LIVE = { paidLive: true, testable: true };

test("with all three parts the score is the 50/30/20 weighted average of the pulled parts", () => {
  const out = scoreAgent({ playground: { n: 100, avg: 90 }, arena: { percentile: 60, forecasts: 40 }, paid: { n: 100, avg: 80 } }, AVG, undefined, LIVE);
  const pg = pull(100, 90, 50, 5);
  const paid = pull(100, 80, 50, 3);
  assert.equal(out.score, Math.round((0.5 * paid + 0.3 * 60 + 0.2 * pg) * 10) / 10);
  assert.equal(out.parts.paid.status, "rated");
  assert.equal(out.parts.arena.count, 40);
});

test("a missing part is left out and the others scaled, never counted as zero", () => {
  const out = scoreAgent({ playground: { n: 50, avg: 80 }, arena: { percentile: 60, forecasts: 30 }, paid: null }, { playground: 80, paid: 50 }, undefined, LIVE);
  assert.equal(out.score, 68);
  assert.equal(out.parts.paid.status, "not_enough");
  assert.equal(out.parts.paid.value, null);
});

test("one lucky run of 100 is pulled far below thirty runs averaging 90", () => {
  assert.equal(Math.round(pull(1, 100, 50, 5) * 10) / 10, 58.3);
  assert.equal(Math.round(pull(30, 90, 50, 5) * 10) / 10, 84.3);
  const lucky = scoreAgent({ playground: { n: 1, avg: 100 }, arena: { percentile: 50, forecasts: 20 }, paid: null }, AVG, undefined, LIVE);
  const steady = scoreAgent({ playground: { n: 30, avg: 90 }, arena: { percentile: 50, forecasts: 20 }, paid: null }, AVG, undefined, LIVE);
  assert.ok(steady.score! > lucky.score!);
});

test("below every minimum the agent is not rated yet; at 5 runs it is", () => {
  const four = scoreAgent({ playground: { n: MINIMUMS.playground - 1, avg: 95 }, arena: null, paid: null }, AVG, undefined, LIVE);
  assert.equal(four.score, null);
  assert.equal(four.parts.playground.status, "not_enough");
  assert.equal(four.parts.playground.count, 4);
  const five = scoreAgent({ playground: { n: 5, avg: 95 }, arena: null, paid: null }, AVG, undefined, LIVE);
  assert.equal(five.parts.playground.status, "rated");
  assert.equal(five.score, Math.round(pull(5, 95, 50, 5) * 10) / 10);
});

test("paid work shows Coming next before Orders, and untestable categories have no Playground part", () => {
  const out = scoreAgent({ playground: { n: 9, avg: 70 }, arena: { percentile: 80, forecasts: 25 }, paid: { n: 10, avg: 100 } }, AVG, undefined, { paidLive: false, testable: false });
  assert.equal(out.parts.paid.status, "coming_next");
  assert.equal(out.parts.playground.status, "no_test");
  assert.equal(out.score, 80, "only the Arena part counts");
});

test("an empty window gives no score and no NaN anywhere", () => {
  const out = scoreAgent({ playground: null, arena: null, paid: null }, AVG, undefined, LIVE);
  assert.equal(out.score, null);
  for (const p of Object.values(out.parts)) assert.ok(p.value === null && Number.isFinite(p.count));
  assert.equal(JSON.stringify(out).includes("NaN"), false);
});

test("ranks: ties share a place, the next place skips, and unrated agents get no rank", () => {
  const ranks = rankCategory([{ agentId: "a", score: 70 }, { agentId: "b", score: 90 }, { agentId: "c", score: 90 }, { agentId: "d", score: null }]);
  assert.deepEqual(Object.fromEntries(ranks), { b: 1, c: 1, a: 3 });
});

test("windows: 24 hours is exactly a day back, the previous 7 days sit before the current 7, all time has none", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  assert.equal(windowSince("24h", now)!.toISOString(), "2026-10-15T12:00:00.000Z");
  assert.equal(windowSince("30d", now)!.toISOString(), "2026-09-16T12:00:00.000Z");
  assert.equal(windowSince("all", now), null);
  assert.deepEqual(previousWindow("7d", now), { since: new Date("2026-10-02T12:00:00Z"), until: new Date("2026-10-09T12:00:00Z") });
  assert.equal(previousWindow("all", now), null);
});

test("weights come from config and fall back to 50/30/20 when missing or invalid", () => {
  assert.deepEqual(parseWeights(undefined), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights('{"paid":0.6,"arena":0.2,"playground":0.2}'), { paid: 0.6, arena: 0.2, playground: 0.2 });
  assert.deepEqual(parseWeights('{"paid":-1,"arena":0.2,"playground":0.2}'), DEFAULT_WEIGHTS);
  assert.deepEqual(parseWeights("not json"), DEFAULT_WEIGHTS);
});
