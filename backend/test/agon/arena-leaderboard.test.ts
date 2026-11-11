import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { arenaLeaderboard, trackPercentiles } from "../../src/agon/arena/leaderboard.ts";
import type { ArenaAnswer, ArenaRaw, ArenaSeason, Entrant, Outcome, RoundState } from "../../src/agon/arena/types.ts";
import { computeSnapshots, type ScoreRow, type ScoreSnapshotStore, type SnapshotDeps } from "../../src/agon/tests/snapshots.ts";
import { createMemoryTestResultsStore } from "./test-results-memory-store.ts";

const season: ArenaSeason = {
  seasonId: 20001n, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
};
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const DAY = 86_400_000;
const committedAt = (round: number) => new Date(season.startsAt.getTime() + round * DAY + 23 * 3_600_000);

type Plan = { score: number | null; ms?: number | null; outcome?: Outcome };
/// A season in which each agent answers three tasks a round, as `plan` says for (agent, round, task).
function rawOf(agents: string[], rounds: number, plan: (agentId: string, round: number, task: number) => Plan | null, over: { state?: (round: number) => RoundState; entrant?: (agentId: string, round: number) => Partial<Entrant> } = {}): ArenaRaw {
  const raw: ArenaRaw = { season, rounds: [], tasks: [], answers: [], entrants: [] };
  for (let r = 0; r < rounds; r += 1) {
    const state = over.state?.(r) ?? "committed";
    raw.rounds.push({ seasonId: 20001n, round: BigInt(r), opensAt: new Date(season.startsAt.getTime() + r * DAY), state, root: state === "committed" ? hex(r + 1) : null, count: state === "committed" ? 9 : null, tx: state === "committed" ? hex(100 + r) : null, blockTime: state === "committed" ? committedAt(r) : null });
    for (let t = 0; t < 3; t += 1) raw.tasks.push({ round: BigInt(r), taskId: `block-gas:${r * 10 + t}`, family: "block-gas", question: "q", valueType: "integer", truth: "7", void: false });
    for (const agentId of agents) {
      raw.entrants.push({ round: BigInt(r), agentId, listingReference: `ref-${agentId}`, name: `Agent ${agentId}`, firstParty: agentId === "1", price: 50_000n, status: "entered", ...over.entrant?.(agentId, r) });
      for (let t = 0; t < 3; t += 1) {
        const p = plan(agentId, r, t);
        if (!p) continue;
        const outcome: Outcome = p.outcome ?? (p.score === null ? "void" : "delivered");
        const answer: ArenaAnswer = { seasonId: 20001n, round: BigInt(r), taskId: `block-gas:${r * 10 + t}`, agentId, listingReference: `ref-${agentId}`, jobId: "j", outcome, score: p.score, durationMs: p.ms === undefined ? 1000 : p.ms, answerHash: hex(5), amount: 50_000n, excerpt: null };
        raw.answers.push(answer);
      }
    }
  }
  return raw;
}
const row = (raw: ArenaRaw, agentId: string) => arenaLeaderboard(raw).rows.find((r) => r.agentId === agentId)!;

test("an agent is ranked from fifteen scored tasks, and a track from three ranked agents", () => {
  // Agent 3 misses one task in round 0, so after five rounds it has fourteen.
  const raw = rawOf(["1", "2", "3"], 5, (a, r, t) => (a === "3" && r === 0 && t === 0 ? null : { score: a === "1" ? 100 : 50 }));
  const board = arenaLeaderboard(raw);
  assert.deepEqual(board.rows.map((r) => [r.agentId, r.scored, r.ranked, r.rank, r.mean]), [["1", 15, true, 1, 100], ["2", 15, true, 2, 50], ["3", 14, false, null, 50]]);
  assert.equal(board.ranked, false);
  assert.equal(trackPercentiles(raw, null, null), null);

  const full = rawOf(["1", "2", "3"], 5, (a) => ({ score: a === "1" ? 100 : a === "2" ? 50 : 0 }));
  assert.equal(arenaLeaderboard(full).ranked, true);
  assert.deepEqual([...trackPercentiles(full, null, null)!], [["1", { percentile: 100, forecasts: 15 }], ["2", { percentile: 50, forecasts: 15 }], ["3", { percentile: 0, forecasts: 15 }]]);
  assert.equal(row(full, "1").firstParty, true);
  assert.equal(row(full, "2").firstParty, false);
});

test("two ranked agents never earn the Arena part", () => {
  const raw = rawOf(["1", "2"], 6, (a) => ({ score: a === "1" ? 100 : 0 }));
  assert.equal(arenaLeaderboard(raw).ranked, false);
  assert.equal(trackPercentiles(raw, null, null), null);
  // A lone agent with a perfect record is the same.
  assert.equal(trackPercentiles(rawOf(["1"], 10, () => ({ score: 100 })), null, null), null);
});

test("void answers count for no one, and failures count as 0", () => {
  const raw = rawOf(["1", "2", "3"], 6, (a, r, t) => {
    if (a === "1" && t === 0) return { score: null };
    if (a === "2" && t === 1) return { score: 0, outcome: "refused", ms: null };
    return { score: 100 };
  });
  assert.deepEqual([row(raw, "1").mean, row(raw, "1").scored], [100, 12]);
  assert.equal(row(raw, "1").ranked, false);
  assert.deepEqual([row(raw, "2").mean, row(raw, "2").scored], [66.7, 18]);
  assert.deepEqual([row(raw, "3").mean, row(raw, "3").scored], [100, 18]);
});

test("equal scores are ordered by the faster median time; equal on both shares a place", () => {
  const raw = rawOf(["1", "2", "3", "4"], 5, (a, _r, t) => ({ score: 100, ms: a === "1" ? 3000 : a === "2" ? [900, 1100, 5000][t]! : 3000 }));
  const board = arenaLeaderboard(raw);
  assert.deepEqual(board.rows.map((r) => [r.agentId, r.medianMs, r.rank]), [["2", 1100, 1], ["1", 3000, 2], ["3", 3000, 2], ["4", 3000, 2]]);
  assert.deepEqual([...trackPercentiles(raw, null, null)!].map(([id, v]) => [id, v.percentile]), [["2", 100], ["1", 0], ["3", 0], ["4", 0]]);
  // A refusal has no time and does not slow or speed the median.
  const mixed = rawOf(["1", "2", "3"], 5, (a, _r, t) => (a === "1" && t === 0 ? { score: 0, outcome: "refused", ms: null } : { score: 100, ms: 2000 }));
  assert.equal(row(mixed, "1").medianMs, 2000);
  assert.equal(row(rawOf(["1"], 1, () => ({ score: 0, outcome: "failed", ms: null })), "1").medianMs, null);
});

test("only committed rounds count, and a window reads the commit time", () => {
  const raw = rawOf(["1", "2", "3"], 7, (a) => ({ score: a === "1" ? 100 : a === "2" ? 50 : 0 }), { state: (r) => (r === 5 ? "sent" : r === 6 ? "open" : "committed") });
  assert.equal(row(raw, "1").scored, 15);
  // Rounds 0 to 4 are committed at 23:00 on days 0 to 4; a window from day 2 holds three of them.
  const since = new Date(season.startsAt.getTime() + 2 * DAY);
  assert.equal(arenaLeaderboard(raw, since).rows.find((r) => r.agentId === "1")!.scored, 9);
  assert.equal(trackPercentiles(raw, since, null), null);
  assert.equal(arenaLeaderboard(raw, null, since).rows.find((r) => r.agentId === "1")!.scored, 6);
});

test("an agent left out of the latest round says why", () => {
  const raw = rawOf(["1", "2", "3"], 3, (a, r) => (a === "2" && r === 2 ? null : a === "3" ? null : { score: 100 }), {
    entrant: (a, r) => (a === "2" && r === 2 ? { status: "over_price", price: 900_000n } : a === "3" ? { status: "cannot_take" } : {}),
  });
  assert.equal(row(raw, "1").note, null);
  assert.equal(row(raw, "2").note, "over_price");
  assert.deepEqual([row(raw, "3").note, row(raw, "3").mean, row(raw, "3").scored, row(raw, "3").rank], ["cannot_take", null, 0, null]);
  // Unranked agents are listed after ranked ones, best first.
  assert.deepEqual(arenaLeaderboard(raw).rows.map((r) => r.agentId), ["1", "2", "3"]);
});

// The Agon score takes a category's Arena part from the track that covers it.
const capture = () => {
  const rows: ScoreRow[] = [];
  const store = { replaceAll: async (r: ScoreRow[]) => { rows.splice(0, rows.length, ...r); }, upsertHistory: async () => {} } as unknown as ScoreSnapshotStore;
  return { rows, store };
};
const scoreDeps = (trackArena?: SnapshotDeps["trackArena"]): SnapshotDeps => ({
  listListed: async () => [
    { agentId: "1", listingReference: "ref-1", categoryId: "1", firstParty: true },
    { agentId: "2", listingReference: "ref-2", categoryId: "1", firstParty: false },
    { agentId: "3", listingReference: "ref-3", categoryId: "1", firstParty: false },
    { agentId: "41", listingReference: "ref-41", categoryId: "3", firstParty: false },
  ],
  tests: createMemoryTestResultsStore(),
  // The forecast season ranks agent 41 and, by id, would also rank agent 2.
  seasonRaw: async () => null,
  paid: { live: false, aggregates: async () => new Map() },
  weights: { paid: 0.5, arena: 0.3, playground: 0.2 },
  ...(trackArena ? { trackArena } : {}),
});
const NOW = new Date("2026-12-01T12:00:00Z");

test("a ranked track gives Research agents their Arena part, and an unranked one gives none", async () => {
  const full = rawOf(["1", "2", "3"], 5, (a) => ({ score: a === "1" ? 100 : a === "2" ? 50 : 0 }));
  const asked: string[] = [];
  const ranked = capture();
  await computeSnapshots(scoreDeps(async (categoryId, since, until) => { asked.push(categoryId); return categoryId === "1" ? trackPercentiles(full, since, until) : undefined; }), ranked.store, NOW);
  const part = (rows: ScoreRow[], agentId: string) => rows.find((r) => r.agentId === agentId && r.window === "all")!.parts.arena;
  assert.deepEqual(part(ranked.rows, "1"), { value: 100, count: 15, atMinimum: true, status: "rated" });
  assert.deepEqual(part(ranked.rows, "2"), { value: 50, count: 15, atMinimum: true, status: "rated" });
  assert.deepEqual(part(ranked.rows, "3"), { value: 0, count: 15, atMinimum: true, status: "rated" });
  assert.equal(ranked.rows.find((r) => r.agentId === "1" && r.window === "all")!.score, 100);
  assert.equal(part(ranked.rows, "41").status, "not_enough");
  assert.ok(asked.includes("1") && asked.includes("3"));

  const two = rawOf(["1", "2"], 6, (a) => ({ score: a === "1" ? 100 : 0 }));
  const unranked = capture();
  await computeSnapshots(scoreDeps(async (categoryId, since, until) => (categoryId === "1" ? trackPercentiles(two, since, until) : undefined)), unranked.store, NOW);
  for (const id of ["1", "2", "3"]) assert.deepEqual(part(unranked.rows, id), { value: null, count: 0, atMinimum: false, status: "not_enough" });
  assert.equal(unranked.rows.find((r) => r.agentId === "1" && r.window === "all")!.score, null);
});

test("a track that cannot be read, or none at all, leaves the board as it was", async () => {
  const none = capture();
  await computeSnapshots(scoreDeps(), none.store, NOW);
  const failing = capture();
  await computeSnapshots(scoreDeps(async () => { throw new Error("database down"); }), failing.store, NOW);
  assert.deepEqual(failing.rows, none.rows);
  assert.equal(none.rows.length, 16);
});
