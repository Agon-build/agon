import assert from "node:assert/strict";
import test from "node:test";

import { INTRO_CARDS, INTRO_CARD_MS, formatCount, introStep, type IntroState } from "./intro-cards.ts";
import { copyProblems } from "./docs-content.ts";

test("seven cards in the spec's order, with the routing fee and both sources on the route card", () => {
  assert.deepEqual(INTRO_CARDS.map((c) => c.id), ["describe", "route", "a2a", "circle", "arena", "discover", "list"]);
  const route = INTRO_CARDS.find((c) => c.id === "route")!;
  assert.ok(route.lines.some((l) => /routing fee/i.test(l) && /0\.01/.test(l)));
  assert.ok(route.lines.some((l) => /Circle Marketplace/.test(l)));
  assert.equal(route.example, true);
  assert.equal(INTRO_CARDS.find((c) => c.id === "a2a")!.example, true);
  assert.equal(INTRO_CARDS.find((c) => c.id === "circle")!.count, "circle");
  assert.equal(INTRO_CARDS.find((c) => c.id === "discover")!.count, "discover");
  assert.equal(INTRO_CARD_MS, 4500);
});

test("card copy follows the copy rules and never states a count of its own", () => {
  for (const c of INTRO_CARDS) {
    for (const s of [c.eyebrow, c.title, ...c.lines]) {
      assert.deepEqual(copyProblems(s), [], s);
      if (c.count) assert.ok(!/\d{3,}|\d+k\b/i.test(s.replace(/ERC-8004/g, "")), `${c.id} hardcodes a count: ${s}`);
    }
  }
});

test("the carousel advances on its timer, wraps, pauses and stops for good after manual moves", () => {
  const start: IntroState = { index: 0, paused: false, manual: false };
  assert.equal(introStep(start, { type: "tick" }).index, 1);
  assert.equal(introStep({ ...start, index: 6 }, { type: "tick" }).index, 0);
  assert.equal(introStep({ ...start, index: 0 }, { type: "prev" }).index, 6);
  const paused = introStep(start, { type: "pause" });
  assert.equal(introStep(paused, { type: "tick" }).index, 0);
  assert.equal(introStep(introStep(paused, { type: "resume" }), { type: "tick" }).index, 1);
  const moved = introStep(start, { type: "goto", index: 4 });
  assert.deepEqual(moved, { index: 4, paused: false, manual: true });
  assert.equal(introStep(moved, { type: "tick" }).index, 4, "after a manual move the timer stops");
  assert.equal(introStep(start, { type: "goto", index: 99 }).index, 0, "out-of-range goto is ignored");
});

test("counts format with separators and are never invented when unknown", () => {
  assert.equal(formatCount(2195), "2,195");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(null), null);
  assert.equal(formatCount(Number.NaN), null);
  assert.equal(formatCount(-3), null);
});

import { introKeyAction, introStartPhase } from "./intro-cards.ts";

test("Enter leaves the intro unless focus is on one of its controls; arrows always move", () => {
  assert.equal(introKeyAction("Enter", false), "enter");
  assert.equal(introKeyAction("Enter", true), null, "a tick or Pause keeps its own Enter");
  assert.equal(introKeyAction("ArrowRight", true), "next");
  assert.equal(introKeyAction("ArrowLeft", false), "prev");
  assert.equal(introKeyAction("a", false), null);
});

test("the intro shows on a first visit, never over a resumed job, and always with ?intro=1", () => {
  assert.equal(introStartPhase({ seen: false, forced: false, resumingJob: false }), "skip", "the app opens on Hire; the intro plays only when asked for");
  assert.equal(introStartPhase({ seen: true, forced: false, resumingJob: false }), "skip");
  assert.equal(introStartPhase({ seen: false, forced: false, resumingJob: true }), "skip");
  assert.equal(introStartPhase({ seen: true, forced: true, resumingJob: true }), "show");
});
