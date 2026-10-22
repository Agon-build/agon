import assert from "node:assert/strict";
import test from "node:test";

import { alertsBetween, parseMarketRefs, stateFromGamma, type WatchState } from "../../src/agon/agents/resolution-watch.ts";

const gamma = (over: Record<string, unknown> = {}) => ({
  conditionId: `0x${"ab".repeat(32)}`, question: "Will the Bank of Canada hold in October?", closed: false,
  outcomes: '["Yes", "No"]', outcomePrices: '["0.4", "0.6"]', description: "Resolves Yes if the target rate is unchanged.", ...over,
});
const open: WatchState = stateFromGamma(gamma());

test("a market's state is read from Gamma: open, proposed, disputed, settled with its outcome", () => {
  assert.deepEqual([open.status, open.outcome, open.yesBps], ["open", null, 4000]);
  assert.equal(stateFromGamma(gamma({ umaResolutionStatus: "proposed", outcomePrices: '["0.98", "0.02"]' })).status, "proposed");
  assert.equal(stateFromGamma(gamma({ umaResolutionStatus: "disputed" })).status, "disputed");
  const yes = stateFromGamma(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1", "0"]' }));
  assert.deepEqual([yes.status, yes.outcome], ["settled", "yes"]);
  assert.equal(stateFromGamma(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0", "1"]' })).outcome, "no");
  assert.equal(stateFromGamma(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0.5", "0.5"]' })).outcome, "split");
  assert.equal(stateFromGamma(gamma({ closed: true })).status, "open", "closed for trading but not final is not settled");
});

test("starting a watch raises nothing; each later change raises one alert of its kind", () => {
  const q = "Will the Bank of Canada hold in October?";
  assert.deepEqual(alertsBetween(q, null, open), []);
  const proposed = stateFromGamma(gamma({ umaResolutionStatus: "proposed", outcomePrices: '["0.98", "0.02"]' }));
  const [started] = alertsBetween(q, open, proposed);
  assert.equal(started!.kind, "settlement_started");
  assert.match(started!.body, /2 hours/);
  assert.match(started!.body, /98\.0%/);
  const disputed = stateFromGamma(gamma({ umaResolutionStatus: "disputed" }));
  assert.deepEqual(alertsBetween(q, proposed, disputed).map((a) => a.kind), ["challenged"]);
  assert.match(alertsBetween(q, proposed, disputed)[0]!.body, /days/);
  assert.deepEqual(alertsBetween(q, disputed, proposed).map((a) => a.kind), ["settlement_started"], "a new proposal after a dispute");
  const settled = stateFromGamma(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1", "0"]' }));
  const [done] = alertsBetween(q, proposed, settled);
  assert.deepEqual([done!.kind, /Yes/.test(done!.title)], ["settled", true]);
  assert.deepEqual(alertsBetween(q, proposed, proposed), [], "no change, no alert");
});

test("a change in the rules text is its own alert and shows the words that were added", () => {
  const changed = stateFromGamma(gamma({ description: "Resolves Yes if the target rate is unchanged. Clarification: an emergency cut before the meeting counts as a change." }));
  const alerts = alertsBetween("q", open, changed);
  assert.deepEqual(alerts.map((a) => a.kind), ["rules_changed"]);
  assert.match(alerts[0]!.body, /emergency cut before the meeting/);
  assert.equal(alertsBetween("q", open, stateFromGamma(gamma({ description: "Entirely new text." })))[0]!.kind, "rules_changed");
});

test("the markets input takes up to 10 links, slugs or condition ids, one per line or comma separated", () => {
  assert.deepEqual(parseMarketRefs("https://polymarket.com/event/x/will-a-happen\nwill-b-happen, 0x" + "cd".repeat(32)), ["will-a-happen", "will-b-happen", `0x${"cd".repeat(32)}`]);
  assert.deepEqual(parseMarketRefs("will-a-happen\nwill-a-happen"), ["will-a-happen"], "duplicates once");
  assert.equal(parseMarketRefs("https://evil.example/x"), null);
  assert.equal(parseMarketRefs(""), null);
  assert.equal(parseMarketRefs(Array.from({ length: 11 }, (_, i) => `market-${i}-x`).join("\n")), null);
});
