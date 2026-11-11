import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { opensAt } from "../../src/agon/arena/clock.ts";
import { answerLeaf, canonicalJson, resultHash, roundRoot, taskHash } from "../../src/agon/arena/leaves.ts";
import { closeRound, openDueRound, sendRound, STALE_SEND_MS, type ArenaHire, type RoundDeps } from "../../src/agon/arena/round.ts";
import type { ArenaSettings } from "../../src/agon/arena/settings.ts";
import type { ArenaSeason, ArenaTask, Entrant, TrackDef } from "../../src/agon/arena/types.ts";
import { buildRoundTree, proofFor, verifyProof } from "../../src/agon/playground/seasons/forecast.ts";
import { MemoryArenaStore } from "./arena-memory-store.ts";

const season: ArenaSeason = {
  seasonId: 20001n, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
};
const settings: ArenaSettings = { on: true, seasonId: 20001n, startsAt: season.startsAt, endsAt: season.endsAt, maxHire: 500_000n, maxDay: 5_000_000n, seed: "a-long-enough-test-seed" };
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const entrant = (agentId: string, over: Partial<Entrant> = {}): Entrant => ({ agentId, listingReference: `ref-${agentId}`, name: `Agent ${agentId}`, firstParty: false, price: 50_000n, status: "entered", ...over });
const taskOf = (round: bigint, i: number): ArenaTask => ({ taskId: `block-gas:${round * 10n + BigInt(i)}`, family: "block-gas", question: `How much gas did block ${round * 10n + BigInt(i)} use?`, valueType: "integer", truth: String(1000 + i) });

type Hired = { agentId: string; question: string };
function world(over: {
  entrants?: Entrant[];
  hire?: ArenaHire;
  now?: Date;
  settings?: Partial<ArenaSettings>;
  tasks?: (round: bigint) => ArenaTask[];
  recheck?: TrackDef["recheck"];
} = {}) {
  const store = new MemoryArenaStore();
  const state = { now: over.now ?? new Date("2026-11-20T23:30:00Z") };
  const hired: Hired[] = [];
  const alerts: string[] = [];
  const commits: { seasonId: bigint; round: bigint; root: Hex; count: number }[] = [];
  const track: TrackDef = {
    id: "research", categoryId: "1", label: "Research",
    buildTasks: async ({ round, used, count }) => (over.tasks ? over.tasks(round) : [0, 1, 2].map((i) => taskOf(round, i))).filter((t) => !used.has(t.taskId)).slice(0, count),
    // An answer scores what it says it is worth, so each test sets the score it needs.
    score: (_task, result) => (result as { worth: number }).worth,
    recheck: over.recheck ?? (async () => "holds"),
  };
  const hire: ArenaHire = over.hire ?? (async (e) => ({ ok: true, jobId: `job-${e.agentId}`, amount: e.price, result: { worth: 100, by: e.agentId }, durationMs: 900 }));
  const deps: RoundDeps = {
    store, track, season, settings: { ...settings, ...over.settings },
    listEntrants: async () => over.entrants ?? [entrant("1"), entrant("2"), entrant("3")],
    hire: async (e, q) => { hired.push({ agentId: e.agentId, question: q }); return hire(e, q); },
    committer: { commit: async (input) => { commits.push(input); return { txHash: hex(700 + commits.length), blockTime: new Date("2026-11-21T00:10:00Z"), circleTxId: "c1" }; } },
    now: () => state.now,
    shuffle: (items) => [...items].reverse(),
    alert: (m) => alerts.push(m),
  };
  return { deps, store, state, hired, alerts, commits };
}

test("a round does not open before its time, and opens once after it", async () => {
  const opens = opensAt(season, 0n, settings.seed);
  const early = world({ now: new Date(opens.getTime() - 1) });
  assert.equal(await openDueRound(early.deps), "not_due");
  assert.equal(await early.store.getRound(20001n, 0n), null);

  const w = world({ now: opens });
  assert.equal(await openDueRound(w.deps), "opened");
  assert.equal(await openDueRound(w.deps), "exists");
  assert.equal((await w.store.getRound(20001n, 0n))?.opensAt.getTime(), opens.getTime());
  assert.equal((await w.store.roundTasks(20001n, 0n)).length, 3);

  assert.equal(await openDueRound(world({ now: new Date("2026-11-19T12:00:00Z") }).deps), "not_due");
  assert.equal(await openDueRound(world({ now: new Date("2026-12-18T00:00:00Z") }).deps), "not_due");
});

test("no round opens with nobody to send to, or with no task", async () => {
  assert.equal(await openDueRound(world({ entrants: [] }).deps), "no_entrants");
  assert.equal(await openDueRound(world({ entrants: [entrant("1", { price: 900_000n }), entrant("2", { status: "cannot_take" })] }).deps), "no_entrants");
  const none = world({ tasks: () => [] });
  assert.equal(await openDueRound(none.deps), "no_tasks");
  assert.equal(await none.store.getRound(20001n, 0n), null);
});

test("an agent priced above the limit is kept on the list and never hired", async () => {
  const w = world({ entrants: [entrant("1"), entrant("2", { price: 500_001n }), entrant("3", { price: 500_000n })] });
  assert.equal(await openDueRound(w.deps), "opened");
  assert.deepEqual((await w.store.roundEntrants(20001n, 0n)).map((e) => [e.agentId, e.status]), [["1", "entered"], ["2", "over_price"], ["3", "entered"]]);
  await sendRound(w.deps, 0n);
  assert.ok(!w.hired.some((h) => h.agentId === "2"));
  assert.equal(w.hired.length, 6);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "sent");
});

test("the day's ceiling stops a round before anything is paid, and says so once", async () => {
  // Three agents at 0.05 and three tasks cost 0.45.
  const w = world({ settings: { maxDay: 449_999n } });
  assert.equal(await openDueRound(w.deps), "day_ceiling");
  assert.equal(await w.store.getRound(20001n, 0n), null);
  assert.equal(w.alerts.length, 1);
  assert.match(w.alerts[0]!, /0\.450000 USDC/);
  assert.equal(w.hired.length, 0);

  const exact = world({ settings: { maxDay: 450_000n } });
  assert.equal(await openDueRound(exact.deps), "opened");

  // What was already spent today counts against the ceiling.
  const used = world({ settings: { maxDay: 800_000n } });
  await used.store.saveAnswer({ seasonId: 19999n, round: 0n, taskId: "block-gas:5", agentId: "9", listingReference: "ref-9", jobId: "j", outcome: "delivered", score: 100, durationMs: 1, answerHash: hex(1), amount: 400_000n, excerpt: null }, used.state.now);
  assert.equal(await openDueRound(used.deps), "day_ceiling");
  assert.match(used.alerts[0]!, /0\.400000 of the day's 0\.800000/);

  // The next day starts from nothing.
  const spent = world({ settings: { maxDay: 800_000n } });
  assert.equal(await openDueRound(spent.deps), "opened");
  await sendRound(spent.deps, 0n);
  assert.equal(await spent.store.spentOn(spent.state.now), 450_000n);
  spent.state.now = new Date("2026-11-21T23:30:00Z");
  assert.equal(await openDueRound(spent.deps), "opened");
  await sendRound(spent.deps, 1n);
  spent.state.now = new Date("2026-11-21T23:59:00Z");
  assert.equal(await spent.store.spentOn(spent.state.now), 450_000n);
});

test("every entrant gets every task once, and each answer is scored and timed", async () => {
  const w = world({ hire: async (e, q) => ({ ok: true, jobId: `job-${e.agentId}-${q.length}`, amount: e.price, result: { worth: e.agentId === "1" ? 100 : e.agentId === "2" ? 50 : 0 }, durationMs: 1000 * Number(e.agentId) }) });
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  const answers = await w.store.roundAnswers(20001n, 0n);
  assert.equal(answers.length, 9);
  assert.equal(w.hired.length, 9);
  for (const a of answers) {
    assert.equal(a.outcome, "delivered");
    assert.equal(a.score, a.agentId === "1" ? 100 : a.agentId === "2" ? 50 : 0);
    assert.equal(a.durationMs, 1000 * Number(a.agentId));
    assert.equal(a.amount, 50_000n);
    assert.equal(a.answerHash, resultHash({ worth: a.score }));
    assert.equal(a.excerpt, canonicalJson({ worth: a.score }));
  }
  // Every agent was asked the same three questions.
  const byAgent = (id: string) => w.hired.filter((h) => h.agentId === id).map((h) => h.question).sort();
  assert.deepEqual(byAgent("1"), byAgent("2"));
  assert.deepEqual(byAgent("1"), byAgent("3"));
  // For one task the entrants are asked in the shuffled order, all before the next task starts.
  assert.deepEqual(w.hired.slice(0, 3).map((h) => h.agentId), ["3", "2", "1"]);
  assert.equal(new Set(w.hired.slice(0, 3).map((h) => h.question)).size, 1);

  // Sending again pays nobody twice.
  await sendRound(w.deps, 0n);
  assert.equal(w.hired.length, 9);
});

test("an agent's failure scores 0, and Agon's own fault counts for no one", async () => {
  const kinds: Record<string, Awaited<ReturnType<ArenaHire>>> = {
    "1": { ok: false, kind: "refused" },
    "2": { ok: false, kind: "failed", jobId: "job-2", amount: 50_000n },
    "3": { ok: false, kind: "timeout", jobId: "job-3", amount: 50_000n, durationMs: 180_000 },
    "4": { ok: false, kind: "agon_fault", jobId: "job-4" },
  };
  const w = world({ entrants: ["1", "2", "3", "4", "5"].map((id) => entrant(id)), hire: async (e) => { if (e.agentId === "5") throw new Error("lost connection"); return kinds[e.agentId]!; } });
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  const first = (await w.store.roundAnswers(20001n, 0n)).filter((a) => a.taskId === "block-gas:0");
  assert.deepEqual(first.map((a) => [a.agentId, a.outcome, a.score, a.amount, a.jobId, a.durationMs]), [
    ["1", "refused", 0, 0n, null, null],
    ["2", "failed", 0, 50_000n, "job-2", null],
    ["3", "timeout", 0, 50_000n, "job-3", 180_000],
    ["4", "void", null, 0n, "job-4", null],
    ["5", "void", null, 0n, null, null],
  ]);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "sent");
});

test("an agent that cannot take the task leaves the round with no answers", async () => {
  const w = world({ hire: async (e) => (e.agentId === "2" ? { ok: false, kind: "cannot_take" } : e.agentId === "3" ? { ok: false, kind: "over_price" } : { ok: true, jobId: "j", amount: e.price, result: { worth: 100 }, durationMs: 5 }) });
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  assert.deepEqual((await w.store.roundEntrants(20001n, 0n)).map((e) => e.status), ["entered", "cannot_take", "over_price"]);
  assert.deepEqual([...new Set((await w.store.roundAnswers(20001n, 0n)).map((a) => a.agentId))], ["1"]);
  // Each was asked once, for the first task only.
  assert.equal(w.hired.filter((h) => h.agentId === "2").length, 1);
  assert.equal(w.hired.filter((h) => h.agentId === "3").length, 1);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "sent");
});

test("a send cut off by a restart is not sent again: it waits, then closes as void", async () => {
  let stuck = true;
  const w = world({ hire: async (e) => { if (stuck && e.agentId === "2") return new Promise<never>(() => {}); return { ok: true, jobId: "j", amount: e.price, result: { worth: 100 }, durationMs: 5 }; } });
  await openDueRound(w.deps);
  // The first pass never returns for agent 2, as if the service stopped mid-call.
  void sendRound(w.deps, 0n);
  await new Promise((resolve) => setTimeout(resolve, 20));
  stuck = false;
  const asked = w.hired.length;

  // After the restart the round is still open and agent 2's first task is held, not paid again.
  await sendRound(w.deps, 0n);
  assert.equal(w.hired.filter((h) => h.agentId === "2" && h.question === w.hired[0]!.question).length, 1);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "open");
  assert.ok(w.hired.length > asked);

  w.state.now = new Date(w.state.now.getTime() + STALE_SEND_MS);
  await sendRound(w.deps, 0n);
  const held = (await w.store.roundAnswers(20001n, 0n)).filter((a) => a.agentId === "2" && a.taskId === "block-gas:0");
  assert.deepEqual(held.map((a) => [a.outcome, a.score]), [["void", null]]);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "sent");
  assert.equal((await w.store.roundAnswers(20001n, 0n)).length, 9);
});

test("closing checks each truth again, voids what changed, and commits once", async () => {
  const w = world({ recheck: async (t) => (t.taskId === "block-gas:1" ? "void" : "holds") });
  assert.equal(await closeRound(w.deps, 0n), "not_ready");
  await openDueRound(w.deps);
  assert.equal(await closeRound(w.deps, 0n), "not_ready");
  await sendRound(w.deps, 0n);
  assert.equal(await closeRound(w.deps, 0n), "committed");

  const answers = await w.store.roundAnswers(20001n, 0n);
  assert.deepEqual(answers.filter((a) => a.taskId === "block-gas:1").map((a) => [a.outcome, a.score]), [["void", null], ["void", null], ["void", null]]);
  assert.ok(answers.filter((a) => a.taskId !== "block-gas:1").every((a) => a.score === 100));

  assert.equal(w.commits.length, 1);
  assert.equal(w.commits[0]!.count, 9);
  assert.equal(w.commits[0]!.seasonId, 20001n);
  const tasks = new Map((await w.store.roundTasks(20001n, 0n)).map((t) => [t.taskId, t]));
  const leaves = answers.map((a) => answerLeaf(a, taskHash(tasks.get(a.taskId)!)));
  assert.equal(w.commits[0]!.root, roundRoot(leaves));
  const round = await w.store.getRound(20001n, 0n);
  assert.deepEqual([round?.state, round?.root, round?.count, round?.tx], ["committed", w.commits[0]!.root, 9, hex(701)]);
  // Anyone can prove one published answer against the committed root.
  const tree = buildRoundTree(leaves);
  assert.ok(verifyProof(leaves[4]!, proofFor(tree.leaves, leaves[4]!), round!.root!));

  assert.equal(await closeRound(w.deps, 0n), "committed");
  assert.equal(w.commits.length, 1);
});

test("a recheck that cannot be read voids the task; a round with nothing left is skipped", async () => {
  const w = world({ recheck: async () => { throw new Error("rpc down"); } });
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  assert.equal(await closeRound(w.deps, 0n), "skipped");
  assert.equal(w.commits.length, 0);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "skipped");
  assert.ok((await w.store.roundAnswers(20001n, 0n)).every((a) => a.outcome === "void" && a.score === null));
});

test("a commit that fails is tried again with the same root, and the truth is not checked twice", async () => {
  let rechecks = 0;
  const w = world({ recheck: async () => { rechecks += 1; return "holds"; } });
  const commit = w.deps.committer.commit;
  let fail = true;
  w.deps.committer = { commit: async (input) => { if (fail) { fail = false; w.commits.push(input); throw new Error("circle unavailable"); } return commit(input); } };
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  await assert.rejects(closeRound(w.deps, 0n), /circle unavailable/);
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "committing");
  assert.equal(await closeRound(w.deps, 0n), "committed");
  assert.equal(rechecks, 3);
  assert.equal(w.commits.length, 2);
  assert.equal(w.commits[0]!.root, w.commits[1]!.root);
});

test("the root does not depend on the order of the leaves, and each field changes the leaf", () => {
  const t = taskHash(taskOf(0n, 0));
  const a = { seasonId: 20001n, round: 0n, agentId: "1", outcome: "delivered" as const, score: 100, durationMs: 900, answerHash: hex(5) };
  const leaves = [answerLeaf(a, t), answerLeaf({ ...a, agentId: "2" }, t), answerLeaf({ ...a, agentId: "3" }, t)];
  assert.equal(roundRoot(leaves), roundRoot([...leaves].reverse()));
  const changed = [{ ...a, score: 50 }, { ...a, durationMs: 901 }, { ...a, outcome: "void" as const, score: null }, { ...a, answerHash: hex(6) }, { ...a, round: 1n }, { ...a, seasonId: 20002n }];
  for (const c of changed) assert.notEqual(answerLeaf(c, t), answerLeaf(a, t));
  assert.notEqual(answerLeaf(a, taskHash({ ...taskOf(0n, 0), truth: "1" })), answerLeaf(a, t));
  assert.equal(canonicalJson({ b: 1, a: { d: 2n, c: [3, { z: 1, y: 2 }] } }), '{"a":{"c":[3,{"y":2,"z":1}],"d":"2"},"b":1}');
});
