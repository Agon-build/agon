import { randomUUID } from "node:crypto";
import type pg from "pg";

export type TestSource = "public" | "agon_check";
export type TestResult = {
  id: string;
  agentId: string;
  listingReference: string;
  categoryId: string;
  taskId: string;
  variant: number;
  source: TestSource;
  runner: string | null;
  score: number;
  passed: boolean;
  durationMs: number;
  input: unknown;
  output: unknown | null;
  error: string | null;
  createdAt: Date;
};
export type NewTestResult = Omit<TestResult, "id" | "createdAt">;
export type TestLimits = { perUserHour: number; perAgentDay: number };
export type LimitedInsert = { ok: true; result: TestResult } | { ok: false; code: "user_limit" | "agent_limit" };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/// Playground test results. Public runs are limited per person per hour and per agent per day;
/// Agon's own checks are not limited.
export interface TestResultsStore {
  insertPublicWithinLimits(r: NewTestResult, limits: TestLimits, now: Date): Promise<LimitedInsert>;
  insert(r: NewTestResult, now: Date): Promise<TestResult>;
  get(id: string): Promise<TestResult | null>;
  listByAgent(agentId: string, limit: number): Promise<TestResult[]>;
  listRecent(limit: number): Promise<TestResult[]>;
  remainingToday(agentId: string, now: Date, perAgentDay: number): Promise<number>;
  /// Public runs by this person in the last hour and on this agent in the last 24 hours.
  publicCounts(runner: string, agentId: string, now: Date): Promise<{ byRunnerHour: number; byAgentDay: number }>;
  /// Count and average score per agent in one category, for runs at or after `since` and before `until`.
  aggregates(categoryId: string, since: Date | null, until?: Date | null): Promise<Map<string, { n: number; avg: number }>>;
  lastCheckAt(listingReference: string): Promise<Date | null>;
}

type Row = {
  id: string; agent_id: string; listing_reference: string; category_id: string; task_id: string; variant: number; source: TestSource;
  runner: string | null; score: number; passed: boolean; duration_ms: number; input: unknown; output: unknown | null; error: string | null; created_at: Date;
};
const fromRow = (r: Row): TestResult => ({
  id: r.id, agentId: String(r.agent_id), listingReference: r.listing_reference, categoryId: r.category_id, taskId: r.task_id, variant: r.variant,
  source: r.source, runner: r.runner, score: r.score, passed: r.passed, durationMs: r.duration_ms, input: r.input, output: r.output, error: r.error, createdAt: r.created_at,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PostgresTestResultsStore implements TestResultsStore {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  private async insertWith(client: pg.Pool | pg.PoolClient, r: NewTestResult, now: Date): Promise<TestResult> {
    const { rows } = await client.query<Row>(
      `insert into agon_test_results (id, agent_id, listing_reference, category_id, task_id, variant, source, runner, score, passed, duration_ms, input, output, error, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15) returning *`,
      [randomUUID(), r.agentId, r.listingReference, r.categoryId, r.taskId, r.variant, r.source, r.runner?.toLowerCase() ?? null, r.score, r.passed, r.durationMs,
        JSON.stringify(r.input ?? null), r.output === null || r.output === undefined ? null : JSON.stringify(r.output), r.error, now],
    );
    return fromRow(rows[0]!);
  }

  async insertPublicWithinLimits(r: NewTestResult, limits: TestLimits, now: Date): Promise<LimitedInsert> {
    const runner = (r.runner ?? "").toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // Runner lock first, then agent, so two runs never wait on each other in opposite order.
      await client.query("select pg_advisory_xact_lock(hashtext('agon_test_runner:' || $1::text))", [runner]);
      await client.query("select pg_advisory_xact_lock(hashtext('agon_test_agent:' || $1::text))", [r.agentId]);
      const { rows } = await client.query<{ by_runner: string; by_agent: string }>(
        `select
           (select count(*) from agon_test_results where source = 'public' and runner = $1 and created_at > $3) as by_runner,
           (select count(*) from agon_test_results where source = 'public' and agent_id = $2 and created_at > $4) as by_agent`,
        [runner, r.agentId, new Date(now.getTime() - HOUR_MS), new Date(now.getTime() - DAY_MS)],
      );
      if (Number(rows[0]!.by_runner) >= limits.perUserHour) { await client.query("rollback"); return { ok: false, code: "user_limit" }; }
      if (Number(rows[0]!.by_agent) >= limits.perAgentDay) { await client.query("rollback"); return { ok: false, code: "agent_limit" }; }
      const result = await this.insertWith(client, { ...r, source: "public", runner }, now);
      await client.query("commit");
      return { ok: true, result };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  insert(r: NewTestResult, now: Date) { return this.insertWith(this.pool, r, now); }

  async get(id: string) {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<Row>("select * from agon_test_results where id = $1", [id]);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async listByAgent(agentId: string, limit: number) {
    const { rows } = await this.pool.query<Row>("select * from agon_test_results where agent_id = $1 order by created_at desc, id limit $2", [agentId, limit]);
    return rows.map(fromRow);
  }

  async listRecent(limit: number) {
    const { rows } = await this.pool.query<Row>("select * from agon_test_results order by created_at desc, id limit $1", [limit]);
    return rows.map(fromRow);
  }

  async remainingToday(agentId: string, now: Date, perAgentDay: number) {
    const { rows } = await this.pool.query<{ n: string }>(
      "select count(*) as n from agon_test_results where source = 'public' and agent_id = $1 and created_at > $2",
      [agentId, new Date(now.getTime() - DAY_MS)],
    );
    return Math.max(0, perAgentDay - Number(rows[0]!.n));
  }

  async publicCounts(runner: string, agentId: string, now: Date) {
    const { rows } = await this.pool.query<{ by_runner: string; by_agent: string }>(
      `select
         (select count(*) from agon_test_results where source = 'public' and runner = $1 and created_at > $3) as by_runner,
         (select count(*) from agon_test_results where source = 'public' and agent_id = $2 and created_at > $4) as by_agent`,
      [runner.toLowerCase(), agentId, new Date(now.getTime() - HOUR_MS), new Date(now.getTime() - DAY_MS)],
    );
    return { byRunnerHour: Number(rows[0]!.by_runner), byAgentDay: Number(rows[0]!.by_agent) };
  }

  async aggregates(categoryId: string, since: Date | null, until: Date | null = null) {
    const { rows } = await this.pool.query<{ agent_id: string; n: string; avg: string }>(
      `select agent_id, count(*) as n, avg(score) as avg from agon_test_results
        where category_id = $1 and ($2::timestamptz is null or created_at >= $2) and ($3::timestamptz is null or created_at < $3)
        group by agent_id`,
      [categoryId, since, until],
    );
    return new Map(rows.map((r) => [String(r.agent_id), { n: Number(r.n), avg: Number(r.avg) }]));
  }

  async lastCheckAt(listingReference: string) {
    const { rows } = await this.pool.query<{ at: Date | null }>(
      "select max(created_at) as at from agon_test_results where source = 'agon_check' and listing_reference = $1",
      [listingReference],
    );
    return rows[0]?.at ?? null;
  }
}
