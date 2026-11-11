import type pg from "pg";
import type { Address, Hex } from "viem";

import type { ArenaAnswer, ArenaRaw, ArenaRound, ArenaSeason, ArenaTask, Entrant, Outcome, RoundState, SendKey, ValueType } from "./types.ts";

export type StoredTask = ArenaTask & { void: boolean };
export type CommitRecord = { root: Hex; count: number; tx: Hex; blockTime: Date };
/// claimed: this caller sends now. busy: another send is under way. stale: a send began long ago and left no answer.
export type Claim = "claimed" | "busy" | "stale";

export interface ArenaStore {
  ensureSeason(season: ArenaSeason): Promise<ArenaSeason>;
  /** Creates the round with its tasks and entrants in one step. False when the round already exists. */
  openRound(round: { seasonId: bigint; round: bigint; opensAt: Date }, tasks: ArenaTask[], entrants: Entrant[]): Promise<boolean>;
  getRound(seasonId: bigint, round: bigint): Promise<ArenaRound | null>;
  roundTasks(seasonId: bigint, round: bigint): Promise<StoredTask[]>;
  roundEntrants(seasonId: bigint, round: bigint): Promise<Entrant[]>;
  roundAnswers(seasonId: bigint, round: bigint): Promise<ArenaAnswer[]>;
  /** Every task id the season has used, so no task is asked twice. */
  usedTaskIds(seasonId: bigint): Promise<Set<string>>;
  /** One send per task and agent: a restart never pays an agent twice for the same task. */
  claimSend(key: SendKey, now: Date, staleMs: number): Promise<Claim>;
  saveAnswer(answer: ArenaAnswer, at: Date): Promise<void>;
  setEntrantStatus(seasonId: bigint, round: bigint, agentId: string, status: Entrant["status"]): Promise<void>;
  /** The task counts for no one: its answers become void with no score. */
  voidTask(seasonId: bigint, round: bigint, taskId: string): Promise<void>;
  setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void>;
  recordCommit(seasonId: bigint, round: bigint, commit: CommitRecord): Promise<void>;
  roundsIn(seasonId: bigint, states: RoundState[]): Promise<ArenaRound[]>;
  /** What the Arena paid on that UTC day, across every season. */
  spentOn(day: Date): Promise<bigint>;
  raw(seasonId: bigint): Promise<ArenaRaw | null>;
}

type SeasonRow = { season_id: string; track_id: string; network: ArenaSeason["network"]; commits_address: Address; starts_at: Date; ends_at: Date };
type RoundRow = { season_id: string; round: string; opens_at: Date; state: RoundState; commit_root: Hex | null; commit_count: number | null; commit_tx: Hex | null; commit_block_time: Date | null };
type TaskRow = { round: string; task_id: string; family: string; question: string; value_type: ValueType; truth: string; void: boolean };
type EntrantRow = { round: string; agent_id: string; listing_reference: string; name: string; first_party: boolean; price: string; status: Entrant["status"] };
type AnswerRow = { season_id: string; round: string; task_id: string; agent_id: string; listing_reference: string; job_id: string | null; outcome: Outcome; score: number | null; duration_ms: number | null; answer_hash: Hex | null; amount: string; excerpt: string | null };

const toSeason = (r: SeasonRow): ArenaSeason => ({ seasonId: BigInt(r.season_id), trackId: r.track_id, network: r.network, commitsAddress: r.commits_address, startsAt: r.starts_at, endsAt: r.ends_at, roundHours: 24 });
const toRound = (r: RoundRow): ArenaRound => ({ seasonId: BigInt(r.season_id), round: BigInt(r.round), opensAt: r.opens_at, state: r.state, root: r.commit_root, count: r.commit_count, tx: r.commit_tx, blockTime: r.commit_block_time });
const toTask = (r: TaskRow): StoredTask & { round: bigint } => ({ round: BigInt(r.round), taskId: r.task_id, family: r.family, question: r.question, valueType: r.value_type, truth: r.truth, void: r.void });
const toEntrant = (r: EntrantRow): Entrant & { round: bigint } => ({ round: BigInt(r.round), agentId: r.agent_id, listingReference: r.listing_reference, name: r.name, firstParty: r.first_party, price: BigInt(r.price), status: r.status });
const toAnswer = (r: AnswerRow): ArenaAnswer => ({
  seasonId: BigInt(r.season_id), round: BigInt(r.round), taskId: r.task_id, agentId: r.agent_id, listingReference: r.listing_reference, jobId: r.job_id,
  outcome: r.outcome, score: r.score, durationMs: r.duration_ms, answerHash: r.answer_hash, amount: BigInt(r.amount), excerpt: r.excerpt,
});

const ROUND_COLS = "season_id, round, opens_at, state, commit_root, commit_count, commit_tx, commit_block_time";
const TASK_COLS = "round, task_id, family, question, value_type, truth, void";
const ENTRANT_COLS = "round, agent_id, listing_reference, name, first_party, price::text as price, status";
const ANSWER_COLS = "season_id, round, task_id, agent_id, listing_reference, job_id, outcome, score, duration_ms, answer_hash, amount::text as amount, excerpt";

export class PostgresArenaStore implements ArenaStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async ensureSeason(season: ArenaSeason): Promise<ArenaSeason> {
    await this.pool.query(
      `insert into agon_arena_seasons (season_id, track_id, network, commits_address, starts_at, ends_at)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [season.seasonId.toString(), season.trackId, season.network, season.commitsAddress.toLowerCase(), season.startsAt, season.endsAt],
    );
    const { rows } = await this.pool.query<SeasonRow>("select * from agon_arena_seasons where season_id = $1", [season.seasonId.toString()]);
    return toSeason(rows[0]!);
  }

  async openRound(round: { seasonId: bigint; round: bigint; opensAt: Date }, tasks: ArenaTask[], entrants: Entrant[]): Promise<boolean> {
    const client = await this.pool.connect();
    const at = [round.seasonId.toString(), round.round.toString()];
    try {
      await client.query("begin");
      const inserted = await client.query("insert into agon_arena_rounds (season_id, round, opens_at) values ($1, $2, $3) on conflict do nothing", [...at, round.opensAt]);
      if (inserted.rowCount === 0) {
        await client.query("rollback");
        return false;
      }
      for (const [position, t] of tasks.entries()) {
        await client.query(
          "insert into agon_arena_tasks (season_id, round, task_id, position, family, question, value_type, truth) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [...at, t.taskId, position, t.family, t.question, t.valueType, t.truth],
        );
      }
      for (const e of entrants) {
        await client.query(
          "insert into agon_arena_entrants (season_id, round, agent_id, listing_reference, name, first_party, price, status) values ($1, $2, $3, $4, $5, $6, $7, $8)",
          [...at, e.agentId, e.listingReference, e.name, e.firstParty, e.price.toString(), e.status],
        );
      }
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRound(seasonId: bigint, round: bigint): Promise<ArenaRound | null> {
    const { rows } = await this.pool.query<RoundRow>(`select ${ROUND_COLS} from agon_arena_rounds where season_id = $1 and round = $2`, [seasonId.toString(), round.toString()]);
    return rows[0] ? toRound(rows[0]) : null;
  }

  async roundTasks(seasonId: bigint, round: bigint): Promise<StoredTask[]> {
    const { rows } = await this.pool.query<TaskRow>(`select ${TASK_COLS} from agon_arena_tasks where season_id = $1 and round = $2 order by position`, [seasonId.toString(), round.toString()]);
    return rows.map((r) => { const { round: _round, ...task } = toTask(r); return task; });
  }

  async roundEntrants(seasonId: bigint, round: bigint): Promise<Entrant[]> {
    const { rows } = await this.pool.query<EntrantRow>(`select ${ENTRANT_COLS} from agon_arena_entrants where season_id = $1 and round = $2 order by agent_id`, [seasonId.toString(), round.toString()]);
    return rows.map((r) => { const { round: _round, ...entrant } = toEntrant(r); return entrant; });
  }

  async roundAnswers(seasonId: bigint, round: bigint): Promise<ArenaAnswer[]> {
    const { rows } = await this.pool.query<AnswerRow>(`select ${ANSWER_COLS} from agon_arena_answers where season_id = $1 and round = $2 order by task_id, agent_id`, [seasonId.toString(), round.toString()]);
    return rows.map(toAnswer);
  }

  async usedTaskIds(seasonId: bigint): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ task_id: string }>("select task_id from agon_arena_tasks where season_id = $1", [seasonId.toString()]);
    return new Set(rows.map((r) => r.task_id));
  }

  async claimSend(key: SendKey, now: Date, staleMs: number): Promise<Claim> {
    const params = [key.seasonId.toString(), key.round.toString(), key.taskId, key.agentId];
    const inserted = await this.pool.query("insert into agon_arena_sends (season_id, round, task_id, agent_id, claimed_at) values ($1, $2, $3, $4, $5) on conflict do nothing", [...params, now]);
    if (inserted.rowCount === 1) return "claimed";
    const { rows } = await this.pool.query<{ claimed_at: Date }>("select claimed_at from agon_arena_sends where season_id = $1 and round = $2 and task_id = $3 and agent_id = $4", params);
    return rows[0] && now.getTime() - rows[0].claimed_at.getTime() >= staleMs ? "stale" : "busy";
  }

  async saveAnswer(a: ArenaAnswer, at: Date): Promise<void> {
    await this.pool.query(
      `insert into agon_arena_answers (season_id, round, task_id, agent_id, listing_reference, job_id, outcome, score, duration_ms, answer_hash, amount, excerpt, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict do nothing`,
      [a.seasonId.toString(), a.round.toString(), a.taskId, a.agentId, a.listingReference, a.jobId, a.outcome, a.score, a.durationMs, a.answerHash, a.amount.toString(), a.excerpt, at],
    );
  }

  async setEntrantStatus(seasonId: bigint, round: bigint, agentId: string, status: Entrant["status"]): Promise<void> {
    await this.pool.query("update agon_arena_entrants set status = $4 where season_id = $1 and round = $2 and agent_id = $3", [seasonId.toString(), round.toString(), agentId, status]);
  }

  async voidTask(seasonId: bigint, round: bigint, taskId: string): Promise<void> {
    const params = [seasonId.toString(), round.toString(), taskId];
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("update agon_arena_tasks set void = true where season_id = $1 and round = $2 and task_id = $3", params);
      await client.query("update agon_arena_answers set outcome = 'void', score = null where season_id = $1 and round = $2 and task_id = $3", params);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void> {
    await this.pool.query("update agon_arena_rounds set state = $3 where season_id = $1 and round = $2 and state <> 'committed'", [seasonId.toString(), round.toString(), state]);
  }

  async recordCommit(seasonId: bigint, round: bigint, c: CommitRecord): Promise<void> {
    await this.pool.query(
      "update agon_arena_rounds set state = 'committed', commit_root = $3, commit_count = $4, commit_tx = $5, commit_block_time = $6 where season_id = $1 and round = $2",
      [seasonId.toString(), round.toString(), c.root.toLowerCase(), c.count, c.tx.toLowerCase(), c.blockTime],
    );
  }

  async roundsIn(seasonId: bigint, states: RoundState[]): Promise<ArenaRound[]> {
    const { rows } = await this.pool.query<RoundRow>(`select ${ROUND_COLS} from agon_arena_rounds where season_id = $1 and state = any($2::text[]) order by round`, [seasonId.toString(), states]);
    return rows.map(toRound);
  }

  async spentOn(day: Date): Promise<bigint> {
    const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const { rows } = await this.pool.query<{ total: string }>(
      "select coalesce(sum(amount), 0)::text as total from agon_arena_answers where created_at >= $1 and created_at < $2",
      [start, new Date(start.getTime() + 86_400_000)],
    );
    return BigInt(rows[0]!.total);
  }

  async raw(seasonId: bigint): Promise<ArenaRaw | null> {
    const id = [seasonId.toString()];
    const season = await this.pool.query<SeasonRow>("select * from agon_arena_seasons where season_id = $1", id);
    if (!season.rows[0]) return null;
    const [rounds, tasks, entrants, answers] = await Promise.all([
      this.pool.query<RoundRow>(`select ${ROUND_COLS} from agon_arena_rounds where season_id = $1 order by round`, id),
      this.pool.query<TaskRow>(`select ${TASK_COLS} from agon_arena_tasks where season_id = $1 order by round, position`, id),
      this.pool.query<EntrantRow>(`select ${ENTRANT_COLS} from agon_arena_entrants where season_id = $1 order by round, agent_id`, id),
      this.pool.query<AnswerRow>(`select ${ANSWER_COLS} from agon_arena_answers where season_id = $1 order by round, task_id, agent_id`, id),
    ]);
    return { season: toSeason(season.rows[0]), rounds: rounds.rows.map(toRound), tasks: tasks.rows.map(toTask), entrants: entrants.rows.map(toEntrant), answers: answers.rows.map(toAnswer) };
  }
}
