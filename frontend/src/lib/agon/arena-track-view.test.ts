import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CLOSED_LINE, UNRANKED_LINE, roundState, roundView, rowView, seconds, trackStatusLine, type TrackRound, type TrackRow } from "./arena-track-view.ts";

const row = (over: Partial<TrackRow> = {}): TrackRow => ({ agentId: "70", listingReference: "5042002:0xabc:7", name: "Compass", firstParty: false, mean: 83.333, scored: 15, medianMs: 2140, ranked: true, rank: 1, note: null, ...over });

test("the line above the board says where the track stands", () => {
  assert.equal(UNRANKED_LINE, "Not ranked yet: needs three agents");
  assert.equal(trackStatusLine({ open: false, ranked: false, rows: [], rounds: [] }), CLOSED_LINE);
  assert.equal(CLOSED_LINE, "Research opens soon");
  assert.equal(trackStatusLine({ open: true, ranked: false, rows: [], rounds: [] }), "No agents entered yet");
  assert.equal(trackStatusLine({ open: true, ranked: false, rows: [row({ ranked: false, rank: null })], rounds: [] }), UNRANKED_LINE);
  assert.equal(trackStatusLine({ open: true, ranked: true, rows: [row()], rounds: [] }), "Ranked on mean score. An agent is ranked after 15 scored tasks.");
});

test("a row shows the mean to one decimal and the median time in seconds", () => {
  assert.deepEqual(rowView(row()), { key: "70", rank: "1", name: "Compass", note: "", score: "83.3", scored: "15", time: "2.1 s", href: "/agents/5042002%3A0xabc%3A7" });
  assert.equal(rowView(row({ mean: 100 })).score, "100.0");
  assert.equal(seconds(950), "0.9 s");
  assert.equal(seconds(null), "–");
});

test("a row says why an agent is unranked or left out", () => {
  assert.equal(rowView(row({ firstParty: true })).note, "Built by Agon");
  assert.deepEqual([rowView(row({ ranked: false, rank: null, scored: 6 })).rank, rowView(row({ ranked: false, rank: null, scored: 6 })).note], ["–", "6 of 15 tasks"]);
  assert.equal(rowView(row({ note: "over_price", ranked: false, rank: null, mean: null, scored: 0, medianMs: null })).note, "Priced above the Arena limit");
  assert.equal(rowView(row({ note: "cannot_take", ranked: false, rank: null, mean: null, scored: 0, medianMs: null, firstParty: true })).note, "Built by Agon. Cannot take Arena tasks");
  const out = rowView(row({ note: "cannot_take", ranked: false, rank: null, mean: null, scored: 0, medianMs: null }));
  assert.deepEqual([out.score, out.time, out.scored], ["–", "–", "0"]);
});

const base = { round: 3, openedAt: "2026-11-23T09:12:00.000Z", entrants: [{ agentId: "70", name: "Compass", firstParty: true, status: "entered" as const }, { agentId: "71", name: "Ledger", firstParty: true, status: "entered" as const }] };

test("a round that Arc does not hold yet shows no task", () => {
  for (const state of ["open", "sent", "committing"] as const) assert.deepEqual(roundView({ ...base, state }), { line: "Round in progress", tasks: [] });
  assert.deepEqual(roundView({ ...base, state: "skipped" }), { line: "This round was skipped. Nothing was scored.", tasks: [] });
  // A committed round whose details did not arrive is not shown as empty tasks.
  assert.deepEqual(roundView({ ...base, state: "committed" }), { line: "Round in progress", tasks: [] });
});

test("a committed round shows each question, the checked answer and what every agent did", () => {
  const round: TrackRound = {
    ...base, state: "committed", tx: `0x${"b".repeat(64)}`, count: 4,
    tasks: [
      { taskId: "block-gas:12", family: "block-gas", question: "How much gas did block 12 on Arc Testnet use? Reply with the number only.", valueType: "integer", truth: "21000", void: false },
      { taskId: "block-date:13", family: "block-date", question: "On what date (UTC) was block 13 on Arc Testnet produced?", valueType: "date", truth: "2026-11-01", void: true },
    ],
    answers: [
      { taskId: "block-gas:12", agentId: "70", outcome: "delivered", score: 100, durationMs: 1840, excerpt: `{"value":"21000"}` },
      { taskId: "block-gas:12", agentId: "71", outcome: "refused", score: 0, durationMs: 300, excerpt: null },
      { taskId: "block-date:13", agentId: "70", outcome: "void", score: null, durationMs: null, excerpt: "x".repeat(400) },
      { taskId: "block-date:13", agentId: "99", outcome: "timeout", score: 0, durationMs: 180000, excerpt: null },
    ],
  };
  const view = roundView(round);
  assert.equal(view.line, "4 answers committed on Arc");
  assert.deepEqual(view.tasks.map((t) => [t.key, t.truth, t.note]), [["block-gas:12", "21000", ""], ["block-date:13", "2026-11-01", "Not counted: the answer changed before the round closed."]]);
  assert.deepEqual(view.tasks[0]!.answers, [
    { key: "block-gas:12:70", name: "Compass", outcome: "Answered", score: "100", time: "1.8 s", excerpt: `{"value":"21000"}` },
    { key: "block-gas:12:71", name: "Ledger", outcome: "Refused", score: "0", time: "–", excerpt: "" },
  ]);
  const second = view.tasks[1]!.answers;
  assert.deepEqual(second.map((a) => [a.name, a.outcome, a.score, a.time]), [["Compass", "Not counted", "–", "–"], ["Agent 99", "Timed out", "0", "–"]]);
  assert.equal(second[0]!.excerpt.length, 160);
});

test("round states read in plain words", () => {
  assert.deepEqual(roundState("committed"), { label: "Committed", tone: "ok" });
  assert.deepEqual(roundState("sent"), { label: "Closing", tone: "warn" });
  assert.deepEqual(roundState("committing"), { label: "Committing", tone: "warn" });
  assert.deepEqual(roundState("open"), { label: "Open", tone: "idle" });
  assert.deepEqual(roundState("skipped"), { label: "Skipped", tone: "idle" });
});

test("both Arena pages carry the track switch, and the Research page renders what the view returns", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  assert.match(read("app/arena/ArenaClient.tsx"), /<TrackSwitch active="prediction" \/>/);
  const research = read("app/arena/research/ResearchClient.tsx");
  assert.match(research, /<TrackSwitch active="research" \/>/);
  for (const fn of ["trackStatusLine(", "rowView", "roundView(", "roundState(", "getTrack(\"research\")", "getTrackRound(\"research\""]) assert.ok(research.includes(fn), `Research uses ${fn}`);
  assert.match(read("app/arena/research/page.tsx"), /<ResearchClient \/>/);
  const sw = read("components/agon/TrackSwitch.tsx");
  assert.match(sw, /href: "\/arena"/);
  assert.match(sw, /href: "\/arena\/research"/);
  // No hard-coded explorer: the address comes with the season.
  assert.doesNotMatch(research, /https?:\/\/[a-z.]*arc(scan)?\./);
  assert.doesNotMatch(research, /—/);
});
