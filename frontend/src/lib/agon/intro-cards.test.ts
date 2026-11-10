import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

import { INTRO_CARDS, INTRO_CARD_MS, introKeyAction, introStartPhase, introStep, type IntroState, markEntered, readEntered } from "./intro-cards.ts";
import { copyProblems } from "./docs-content.ts";

test("seven cards, each labelled by what is true today (capabilities.md)", () => {
  assert.deepEqual(INTRO_CARDS.map((c) => c.id), ["describe", "route", "a2a", "playground", "arena", "circle", "list"]);
  const label = (id: string) => INTRO_CARDS.find((c) => c.id === id)!.label ?? null;
  assert.deepEqual(["describe", "route", "a2a"].map(label), ["example", "example", "example"]);
  assert.deepEqual(["playground", "list", "arena", "circle"].map(label), [null, null, null, null], "Live capabilities carry no label (Arena Season 2 and Circle hires are Live)");
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

// 2026-11-10: the intro played again whenever Hire was opened after a reload or a sign-in,
// and its Enter led away from Hire. It now plays once in a browser session, on a first visit to Hire.
test("the intro plays once in a browser session, never over a resumed job", () => {
  assert.equal(introStartPhase({ entered: false, forced: false, resumingJob: false }), "show", "a first visit opens with the intro");
  assert.equal(introStartPhase({ entered: true, forced: false, resumingJob: false }), "skip", "after that, Hire opens as Hire");
  assert.equal(introStartPhase({ entered: false, forced: false, resumingJob: true }), "skip", "a paid job reopens straight to its progress");
  assert.equal(introStartPhase({ entered: true, forced: true, resumingJob: true }), "show", "?intro=1 always shows it");
});

test("having entered Agon is remembered for the browser session, through a reload", () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  assert.equal(readEntered(store), false);
  markEntered(store);
  assert.equal(readEntered(store), true, "a reload reads it back from the session");
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => markEntered(blocked));
  assert.equal(readEntered(blocked), false, "storage that cannot be read means not entered");
});

test("any Agon page, the welcome story and the intro itself all count as having entered", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("../../components/redesign/TopNav.tsx"), /markEntered()/);
  assert.match(read("../../components/landing/WelcomeStory.tsx"), /markEntered()/);
  assert.match(read("../../components/agon/IntroGate.tsx"), /markEntered()/);
});
