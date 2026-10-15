import type pg from "pg";

import type { ScoringRaw } from "../playground/seasons/types.ts";
import { arenaPercentiles } from "./arena-part.ts";
import type { TestResultsStore } from "./results-store.ts";
import { WINDOWS, previousWindow, rankCategory, scoreAgent, windowSince, type Part, type PartInput, type Weights, type Window } from "./scores.ts";
import { TESTABLE_CATEGORIES } from "./tasks.ts";

export type ListedForScores = { agentId: string; listingReference: string; categoryId: string; firstParty: boolean };
type Averages = Map<string, { n: number; avg: number }>;

export type SnapshotDeps = {
  listListed(): Promise<ListedForScores[]>;
  tests: Pick<TestResultsStore, "aggregates">;
  /// The current Season's scoring data, or null when no Season runs.
  seasonRaw(): Promise<ScoringRaw | null>;
  /// Buyer scores (0 to 100) per agent; `live` stays false until the Orders plan ships.
  paid: { live: boolean; aggregates(categoryId: string, since: Date | null, until: Date | null): Promise<Averages> };
  weights: Weights;
};

export type ScoreCounts = { tests: number; forecasts: number; paid: number };
export type ScoreRow = {
  agentId: string;
  listingReference: string;
  categoryId: string;
  window: Window;
  firstParty: boolean;
  computedAt: string;
  score: number | null;
  previousScore: number | null;
  change: number | null;
  rank: number | null;
  parts: { playground: Part; arena: Part; paid: Part };
  counts: ScoreCounts;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/// The prior an agent's part is pulled toward: the mean of the other agents' unpulled averages
/// in the same category and window, or 50 when no other agent has that part.
function priorFor(agentId: string, peers: string[], averages: Averages): number {
  const others = peers.filter((id) => id !== agentId).map((id) => averages.get(id)).filter((v): v is { n: number; avg: number } => Boolean(v && v.n > 0));
  return others.length ? others.reduce((s, v) => s + v.avg, 0) / others.length : 50;
}

async function scoreWindow(
  deps: SnapshotDeps,
  categoryId: string,
  agents: ListedForScores[],
  raw: ScoringRaw | null,
  since: Date | null,
  until: Date | null,
) {
  const testable = (TESTABLE_CATEGORIES as readonly string[]).includes(categoryId);
  const [tests, paid] = await Promise.all([
    testable ? deps.tests.aggregates(categoryId, since, until) : Promise.resolve(new Map() as Averages),
    deps.paid.live ? deps.paid.aggregates(categoryId, since, until) : Promise.resolve(new Map() as Averages),
  ]);
  const arena = raw ? arenaPercentiles(raw, since, until) : new Map<string, { percentile: number; forecasts: number }>();
  const ids = agents.map((a) => a.agentId);
  return new Map(agents.map((a) => {
    const input: PartInput = { playground: tests.get(a.agentId) ?? null, arena: arena.get(a.agentId) ?? null, paid: paid.get(a.agentId) ?? null };
    const result = scoreAgent(input, { playground: priorFor(a.agentId, ids, tests), paid: priorFor(a.agentId, ids, paid) }, deps.weights, { paidLive: deps.paid.live, testable });
    return [a.agentId, result] as const;
  }));
}

/// Recomputes every listed agent's score in its category for all four windows, ranks each board,
/// replaces the stored snapshots, and records today's all-time score in the history.
export async function computeSnapshots(deps: SnapshotDeps, store: ScoreSnapshotStore, now: Date): Promise<number> {
  const seen = new Set<string>();
  const listed = (await deps.listListed()).filter((l) => {
    const key = `${l.agentId}|${l.categoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const byCategory = new Map<string, ListedForScores[]>();
  for (const l of listed) byCategory.set(l.categoryId, [...(byCategory.get(l.categoryId) ?? []), l]);
  const raw = await deps.seasonRaw().catch(() => null);

  const rows: ScoreRow[] = [];
  for (const [categoryId, agents] of byCategory) {
    for (const window of WINDOWS) {
      const current = await scoreWindow(deps, categoryId, agents, raw, windowSince(window, now), null);
      const prev = previousWindow(window, now);
      const before = prev ? await scoreWindow(deps, categoryId, agents, raw, prev.since, prev.until) : null;
      const ranks = rankCategory(agents.map((a) => ({ agentId: a.agentId, score: current.get(a.agentId)!.score })));
      for (const a of agents) {
        const { score, parts } = current.get(a.agentId)!;
        const previousScore = before?.get(a.agentId)?.score ?? null;
        rows.push({
          agentId: a.agentId, listingReference: a.listingReference, categoryId, window, firstParty: a.firstParty, computedAt: now.toISOString(),
          score, previousScore, change: score !== null && previousScore !== null ? round1(score - previousScore) : null, rank: ranks.get(a.agentId) ?? null,
          parts, counts: { tests: parts.playground.count, forecasts: parts.arena.count, paid: parts.paid.count },
        });
      }
    }
  }
  await store.replaceAll(rows, now);
  await store.upsertHistory(rows.filter((r) => r.window === "all").map((r) => ({ agentId: r.agentId, categoryId: r.categoryId, day: now.toISOString().slice(0, 10), score: r.score })));
  return rows.length;
}

export interface ScoreSnapshotStore {
  replaceAll(rows: ScoreRow[], computedAt: Date): Promise<void>;
  upsertHistory(rows: { agentId: string; categoryId: string; day: string; score: number | null }[]): Promise<void>;
  board(categoryId: string, window: Window): Promise<ScoreRow[]>;
  forAgent(agentId: string): Promise<ScoreRow[]>;
  forAgents(agentIds: string[], window: Window): Promise<ScoreRow[]>;
  history(agentId: string, categoryId: string, days: number, now: Date): Promise<{ day: string; score: number | null }[]>;
}

type SnapshotDbRow = {
  agent_id: string; listing_reference: string; category_id: string; window: Window; first_party: boolean; computed_at: Date;
  score: string | null; previous_score: string | null; rank: number | null; parts: ScoreRow["parts"]; counts: ScoreCounts;
};
const num = (v: string | null) => (v === null ? null : Number(v));
const fromDb = (r: SnapshotDbRow): ScoreRow => {
  const score = num(r.score);
  const previousScore = num(r.previous_score);
  return {
    agentId: String(r.agent_id), listingReference: r.listing_reference, categoryId: r.category_id, window: r.window, firstParty: r.first_party,
    computedAt: r.computed_at.toISOString(), score, previousScore, change: score !== null && previousScore !== null ? round1(score - previousScore) : null,
    rank: r.rank, parts: r.parts, counts: r.counts,
  };
};
const ORDER = "order by rank asc nulls last, score desc nulls last, agent_id asc";

export class PostgresScoreSnapshotStore implements ScoreSnapshotStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async replaceAll(rows: ScoreRow[], computedAt: Date) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from agon_score_snapshots");
      for (const r of rows) {
        await client.query(
          `insert into agon_score_snapshots (agent_id, category_id, "window", listing_reference, first_party, computed_at, score, previous_score, rank, parts, counts)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
          [r.agentId, r.categoryId, r.window, r.listingReference, r.firstParty, computedAt, r.score, r.previousScore, r.rank, JSON.stringify(r.parts), JSON.stringify(r.counts)],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertHistory(rows: { agentId: string; categoryId: string; day: string; score: number | null }[]) {
    for (const r of rows) {
      await this.pool.query(
        `insert into agon_score_history (agent_id, category_id, day, score) values ($1, $2, $3::date, $4)
         on conflict (agent_id, category_id, day) do update set score = excluded.score`,
        [r.agentId, r.categoryId, r.day, r.score],
      );
    }
  }

  async board(categoryId: string, window: Window) {
    const { rows } = await this.pool.query<SnapshotDbRow>(`select * from agon_score_snapshots where category_id = $1 and "window" = $2 ${ORDER}`, [categoryId, window]);
    return rows.map(fromDb);
  }

  async forAgent(agentId: string) {
    const { rows } = await this.pool.query<SnapshotDbRow>(`select * from agon_score_snapshots where agent_id = $1 order by category_id, "window"`, [agentId]);
    return rows.map(fromDb);
  }

  async forAgents(agentIds: string[], window: Window) {
    if (!agentIds.length) return [];
    const { rows } = await this.pool.query<SnapshotDbRow>(`select * from agon_score_snapshots where agent_id = any($1::numeric[]) and "window" = $2 ${ORDER}`, [agentIds, window]);
    return rows.map(fromDb);
  }

  async history(agentId: string, categoryId: string, days: number, now: Date) {
    const { rows } = await this.pool.query<{ day: string; score: string | null }>(
      `select to_char(day, 'YYYY-MM-DD') as day, score from agon_score_history
        where agent_id = $1 and category_id = $2 and day > ($3::date - $4::int) order by day`,
      [agentId, categoryId, now.toISOString().slice(0, 10), days],
    );
    return rows.map((r) => ({ day: r.day, score: num(r.score) }));
  }
}

/// Recomputes the snapshots every few minutes. Returns a stop function.
export function startScoreSnapshots(input: { deps: SnapshotDeps; store: ScoreSnapshotStore; intervalMs?: number; log?: (m: string) => void }): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await computeSnapshots(input.deps, input.store, new Date()); } catch (error) { input.log?.(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, input.intervalMs ?? 5 * 60_000);
  void tick();
  return () => clearInterval(timer);
}
