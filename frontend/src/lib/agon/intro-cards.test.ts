import assert from "node:assert/strict";
import test from "node:test";

import { INTRO_CARDS, INTRO_CARD_MS, introKeyAction, introStartPhase, introStep, type IntroState } from "./intro-cards.ts";
import { copyProblems } from "./docs-content.ts";

test("seven cards, each labelled by what is true today (capabilities.md)", () => {
  assert.deepEqual(INTRO_CARDS.map((c) => c.id), ["describe", "route", "a2a", "playground", "arena", "circle", "list"]);
  const label = (id: string) => INTRO_CARDS.find((c) => c.id === id)!.label ?? null;
  assert.deepEqual(["describe", "route", "a2a"].map(label), ["example", "example", "example"]);
  assert.deepEqual(["playground", "list"].map(label), [null, null], "Live capabilities carry no label");
  assert.deepEqual(["arena", "circle"].map(label), ["coming_next", "coming_next"], "not proven live, so not shown as working");
  assert.equal(INTRO_CARD_MS, 4500);
});

test("the route example uses a real listed agent's price and the 0.01 minimum routing fee", () => {
  const route = INTRO_CARDS.find((c) => c.id === "route")!;
  assert.ok(route.lines.some((l) => /Scout/.test(l) && /0\.10\b/.test(l)), route.lines.join(" | "));
  assert.ok(route.lines.some((l) => /routing fee/i.test(l) && /0\.01\b/.test(l)));
  assert.ok(route.lines.some((l) => /Total/.test(l) && /0\.11\b/.test(l)));
});

test("no card advertises Discover, hidden agents or a count", () => {
  for (const c of INTRO_CARDS) {
    const text = [c.eyebrow, c.title, ...c.lines].join(" ");
    assert.ok(!/discover|hidden agent/i.test(text), `${c.id}: ${text}`);
    assert.ok(!("count" in c), `${c.id} still reads a count`);
  }
});

test("card copy follows the copy rules", () => {
  for (const c of INTRO_CARDS) for (const s of [c.eyebrow, c.title, ...c.lines]) assert.deepEqual(copyProblems(s), [], s);
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

test("Enter leaves the intro unless focus is on one of its controls; arrows always move", () => {
  assert.equal(introKeyAction("Enter", false), "enter");
  assert.equal(introKeyAction("Enter", true), null, "a tick or Pause keeps its own Enter");
  assert.equal(introKeyAction("ArrowRight", true), "next");
  assert.equal(introKeyAction("ArrowLeft", false), "prev");
  assert.equal(introKeyAction("a", false), null);
});

test("the intro plays on every visit to agon.surf, once per page load, never over a resumed job", () => {
  assert.equal(introStartPhase({ shownThisLoad: false, forced: false, resumingJob: false }), "show", "every visit opens with the intro");
  assert.equal(introStartPhase({ shownThisLoad: true, forced: false, resumingJob: false }), "skip", "moving back to Hire inside the app does not replay it");
  assert.equal(introStartPhase({ shownThisLoad: false, forced: false, resumingJob: true }), "skip", "a paid job reopens straight to its progress");
  assert.equal(introStartPhase({ shownThisLoad: true, forced: true, resumingJob: true }), "show", "?intro=1 always shows it");
});
