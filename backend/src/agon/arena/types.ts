import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../network.ts";

/// The Arena for any category. A track is one category's competition: it makes
/// the tasks and scores the answers; the engine does everything else.

export type ValueType = "address" | "integer" | "amount" | "date" | "name";

/// One question with one right answer, read by Agon from a primary source when the round opens.
export type ArenaTask = { taskId: string; family: string; question: string; valueType: ValueType; truth: string };

export type TrackDef = {
  id: string;
  categoryId: string;
  label: string;
  /** Up to `count` tasks whose ids are not in `used`. A task whose truth cannot be read is left out. */
  buildTasks(ctx: { seasonId: bigint; round: bigint; used: ReadonlySet<string>; count: number }): Promise<ArenaTask[]>;
  /** 0, 25, 50 or 100, by code. */
  score(task: ArenaTask, result: unknown): number;
  /** Reads the truth again when the round closes; a task that no longer holds counts for no one. */
  recheck(task: ArenaTask): Promise<"holds" | "void">;
};

export type ArenaSeason = { seasonId: bigint; trackId: string; network: AgonNetworkId; commitsAddress: Address; startsAt: Date; endsAt: Date; roundHours: 24 };

export type RoundState = "open" | "sent" | "committing" | "committed" | "skipped";
export type ArenaRound = { seasonId: bigint; round: bigint; opensAt: Date; state: RoundState; root: Hex | null; count: number | null; tx: Hex | null; blockTime: Date | null };

export type Entrant = { agentId: string; listingReference: string; name: string; firstParty: boolean; price: bigint; status: "entered" | "over_price" | "cannot_take" };

/// void: the fault was Agon's or the task's, so the answer counts for no one.
export type Outcome = "delivered" | "refused" | "failed" | "timeout" | "void";
export type ArenaAnswer = {
  seasonId: bigint; round: bigint; taskId: string; agentId: string; listingReference: string; jobId: string | null;
  outcome: Outcome; score: number | null; durationMs: number | null; answerHash: Hex | null;
  /** What Agon paid for this answer, in USDC base units. */
  amount?: bigint;
};

export type ArenaRaw = { season: ArenaSeason; rounds: ArenaRound[]; tasks: (ArenaTask & { round: bigint; void: boolean })[]; answers: ArenaAnswer[]; entrants: (Entrant & { round: bigint })[] };

export const ROUND_HOURS = 24;
export const TASKS_PER_ROUND = 3;
export const SEASON_DAYS = 28;
/// An agent is ranked from this many scored tasks; a track from this many ranked agents.
export const RANKED_TASKS = 15;
export const RANKED_AGENTS = 3;
