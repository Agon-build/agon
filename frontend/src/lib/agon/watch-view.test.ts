import assert from "node:assert/strict";
import test from "node:test";

import { marketRow, watchPageView, whenText } from "./watch-view.ts";

const base = { question: "Q?", url: "https://polymarket.com/event/x/y", outcome: null, yesBps: 9820, updatedAt: "2026-10-23T00:00:00Z" };

test("each market's state reads in plain words", () => {
  assert.deepEqual([marketRow({ ...base, status: "open" }).state, marketRow({ ...base, status: "open" }).detail], ["Open", "98% chance of Yes"]);
  assert.equal(marketRow({ ...base, status: "open", yesBps: 5 }).detail, "Under 1% chance of Yes");
  assert.equal(marketRow({ ...base, status: "open", yesBps: 9950 }).detail, "Over 99% chance of Yes");
  assert.equal(marketRow({ ...base, status: "proposed" }).state, "Result proposed");
  assert.equal(marketRow({ ...base, status: "disputed" }).state, "Result challenged");
  assert.equal(marketRow({ ...base, status: "settled", outcome: "no" }).state, "Settled: No");
  assert.equal(marketRow({ ...base, status: "settled", outcome: "split" }).state, "Settled: 50-50");
});

test("alert times are relative, newest first, and the summary counts settled markets", () => {
  const now = new Date("2026-10-23T01:00:00Z");
  assert.equal(whenText("2026-10-23T00:59:40Z", now), "Just now");
  assert.equal(whenText("2026-10-23T00:28:00Z", now), "32 min ago");
  assert.equal(whenText("2026-10-22T20:00:00Z", now), "5 h ago");
  const view = watchPageView({
    watchId: "w", status: "active", endsAt: "2026-12-22T00:26:46Z",
    markets: [{ ...base, status: "settled", outcome: "yes" }, { ...base, status: "open" }],
    alerts: [{ kind: "challenged", title: "First", body: "b", at: "2026-10-23T00:10:00Z" }, { kind: "settled", title: "Second", body: "b", at: "2026-10-23T00:50:00Z" }],
  }, now);
  assert.equal(view.alerts[0]!.title, "Second");
  assert.match(view.summary, /^Watching 2 markets, 1 settled\./);
  assert.match(view.summary, /22 December/);
  for (const s of [view.summary, ...view.markets.map((m) => m.detail)]) assert.ok(!s.includes("—") && !/ \+ /.test(s), s);
});
