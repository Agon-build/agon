import { buildRoundTree } from "../playground/seasons/forecast.ts";
import type { RootCommitter } from "../playground/seasons/rounds.ts";
import { opensAt, roundAt } from "./clock.ts";
import { answerLeaf, canonicalJson, resultHash, taskHash } from "./leaves.ts";
import type { ArenaSettings } from "./settings.ts";
import type { ArenaStore, StoredTask } from "./store.ts";
import { TASKS_PER_ROUND, type ArenaAnswer, type ArenaSeason, type Entrant, type TrackDef } from "./types.ts";

/// One round of a track: open it, send every task to every entrant through the
/// paid hire, score the answers, and commit the round on Arc.

/// What sending one task to one agent came to.
/// agon_fault: Agon could not pay or cannot tell what happened, so the task counts for no one.
export type ArenaHire = (entrant: Entrant, question: string) => Promise<
  | { ok: true; jobId: string; amount: bigint; result: unknown; durationMs: number }
  | { ok: false; kind: "refused" | "failed" | "timeout" | "agon_fault" | "cannot_take" | "over_price"; jobId?: string; amount?: bigint; durationMs?: number }
>;

export type RoundDeps = {
  store: ArenaStore;
  track: TrackDef;
  settings: ArenaSettings;
  season: ArenaSeason;
  /** Every listed agent in the track's category, one entry per agent. */
  listEntrants(): Promise<Entrant[]>;
  hire: ArenaHire;
  committer: RootCommitter;
  now(): Date;
  shuffle<T>(items: T[]): T[];
  alert(message: string): void;
};

export type OpenResult = "opened" | "not_due" | "exists" | "no_entrants" | "day_ceiling" | "no_tasks";

/// A send that left no answer for this long was cut off; it is closed as void, never sent again.
export const STALE_SEND_MS = 10 * 60_000;
const EXCERPT_MAX = 2_000;

const usdc = (v: bigint) => `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`;

export async function openDueRound(deps: RoundDeps): Promise<OpenResult> {
  const { store, season, settings } = deps;
  const now = deps.now();
  const round = roundAt(season, now);
  if (round === null) return "not_due";
  if (await store.getRound(season.seasonId, round)) return "exists";
  const opens = opensAt(season, round, settings.seed);
  if (now < opens) return "not_due";

  const entrants = (await deps.listEntrants()).map((e): Entrant => (e.status === "entered" && e.price > settings.maxHire ? { ...e, status: "over_price" } : e));
  const entered = entrants.filter((e) => e.status === "entered");
  if (entered.length === 0) return "no_entrants";

  const tasks = await deps.track.buildTasks({ seasonId: season.seasonId, round, used: await store.usedTaskIds(season.seasonId), count: TASKS_PER_ROUND });
  if (tasks.length === 0) return "no_tasks";

  const cost = entered.reduce((sum, e) => sum + e.price, 0n) * BigInt(tasks.length);
  const spent = await store.spentOn(now);
  if (spent + cost > settings.maxDay) {
    deps.alert(`Arena ${deps.track.id} round ${round} not opened: it would cost ${usdc(cost)} USDC and ${usdc(spent)} of the day's ${usdc(settings.maxDay)} is spent.`);
    return "day_ceiling";
  }
  return (await store.openRound({ seasonId: season.seasonId, round, opensAt: opens }, tasks, entrants)) ? "opened" : "exists";
}

const excerptOf = (result: unknown): string => (typeof result === "string" ? result : canonicalJson(result)).slice(0, EXCERPT_MAX);

async function sendOne(deps: RoundDeps, round: bigint, task: StoredTask, entrant: Entrant): Promise<void> {
  const { store, season } = deps;
  const base = { seasonId: season.seasonId, round, taskId: task.taskId, agentId: entrant.agentId, listingReference: entrant.listingReference };
  const none = { jobId: null, score: null, durationMs: null, answerHash: null, amount: 0n, excerpt: null };
  const claim = await store.claimSend(base, deps.now(), STALE_SEND_MS);
  if (claim === "busy") return;
  if (claim === "stale") {
    await store.saveAnswer({ ...base, ...none, outcome: "void" }, deps.now());
    return;
  }
  // A throw leaves it unknown whether the agent was paid, so the task counts for no one.
  const out = await deps.hire(entrant, task.question).catch((): Awaited<ReturnType<ArenaHire>> => ({ ok: false, kind: "agon_fault" }));
  let answer: ArenaAnswer;
  if (out.ok) {
    answer = { ...base, jobId: out.jobId, outcome: "delivered", score: deps.track.score(task, out.result), durationMs: out.durationMs, answerHash: resultHash(out.result), amount: out.amount, excerpt: excerptOf(out.result) };
  } else if (out.kind === "cannot_take" || out.kind === "over_price") {
    // Nothing was asked of the agent. It leaves this round with no answers.
    await store.setEntrantStatus(season.seasonId, round, entrant.agentId, out.kind);
    return;
  } else if (out.kind === "agon_fault") {
    answer = { ...base, ...none, jobId: out.jobId ?? null, amount: out.amount ?? 0n, outcome: "void" };
  } else {
    answer = { ...base, ...none, jobId: out.jobId ?? null, amount: out.amount ?? 0n, durationMs: out.durationMs ?? null, outcome: out.kind, score: 0 };
  }
  await store.saveAnswer(answer, deps.now());
}

/// Sends what is still owed for the round. Safe to call again after a restart.
export async function sendRound(deps: RoundDeps, round: bigint): Promise<void> {
  const { store, season } = deps;
  const current = await store.getRound(season.seasonId, round);
  if (!current || current.state !== "open") return;
  const tasks = await store.roundTasks(season.seasonId, round);

  // One task at a time; for a task, every entrant is asked in the same moment, in a fresh order.
  for (const task of tasks) {
    const answered = new Set((await store.roundAnswers(season.seasonId, round)).filter((a) => a.taskId === task.taskId).map((a) => a.agentId));
    const owed = (await store.roundEntrants(season.seasonId, round)).filter((e) => e.status === "entered" && !answered.has(e.agentId));
    await Promise.all(deps.shuffle(owed).map((entrant) => sendOne(deps, round, task, entrant)));
  }

  const entered = (await store.roundEntrants(season.seasonId, round)).filter((e) => e.status === "entered");
  const answers = new Set((await store.roundAnswers(season.seasonId, round)).map((a) => `${a.taskId}\n${a.agentId}`));
  const complete = tasks.every((t) => entered.every((e) => answers.has(`${t.taskId}\n${e.agentId}`)));
  if (complete) await store.setRoundState(season.seasonId, round, "sent");
}

/// Checks each task's truth once more, then commits the round. A round with nothing left to commit is skipped.
export async function closeRound(deps: RoundDeps, round: bigint): Promise<"committed" | "skipped" | "not_ready"> {
  const { store, season } = deps;
  const current = await store.getRound(season.seasonId, round);
  if (!current || current.state === "open") return "not_ready";
  if (current.state === "committed" || current.state === "skipped") return current.state;

  if (current.state === "sent") {
    // The leaves must not change once a commit has been tried, so the truth is checked only here.
    for (const task of await store.roundTasks(season.seasonId, round)) {
      if (task.void) continue;
      const verdict = await deps.track.recheck(task).catch(() => "void" as const);
      if (verdict === "void") await store.voidTask(season.seasonId, round, task.taskId);
    }
    await store.setRoundState(season.seasonId, round, "committing");
  }

  const tasks = new Map((await store.roundTasks(season.seasonId, round)).map((t) => [t.taskId, t]));
  const answers = await store.roundAnswers(season.seasonId, round);
  if (answers.length === 0 || [...tasks.values()].every((t) => t.void)) {
    await store.setRoundState(season.seasonId, round, "skipped");
    return "skipped";
  }
  const tree = buildRoundTree(answers.map((a) => answerLeaf(a, taskHash(tasks.get(a.taskId)!))));
  const commit = await deps.committer.commit({ seasonId: season.seasonId, round, root: tree.root, count: tree.leaves.length });
  await store.recordCommit(season.seasonId, round, { root: tree.root, count: tree.leaves.length, tx: commit.txHash, blockTime: commit.blockTime });
  return "committed";
}
