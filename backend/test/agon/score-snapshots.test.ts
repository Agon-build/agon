import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PostgresScoreSnapshotStore, computeSnapshots, type SnapshotDeps } from "../../src/agon/tests/snapshots.ts";
import { createScoresRoutes } from "../../src/agon/tests/scores-routes.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";
import { createMemoryTestResultsStore } from "./test-results-memory-store.ts";
import type { NewTestResult } from "../../src/agon/tests/results-store.ts";

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("score_snapshots"); });
after(async () => db.close());

const NOW = new Date("2026-10-16T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
const run = (agentId: string, score: number, categoryId = "3"): NewTestResult => ({
  agentId, listingReference: `ref-${agentId}`, categoryId, taskId: "t", variant: 0, source: "agon_check", runner: null, score, passed: score >= 80, durationMs: 1, input: {}, output: {}, error: null,
});

async function seeded() {
  const tests = createMemoryTestResultsStore();
  // Agent 41: 10 runs at 90 today. Agent 42: 10 runs at 60, all 3 days ago. Agent 43: 2 runs. Agent 50 is Research with none.
  for (let i = 0; i < 10; i += 1) await tests.insert(run("41", 90), ago(1));
  for (let i = 0; i < 10; i += 1) await tests.insert(run("42", 60), ago(72));
  for (let i = 0; i < 2; i += 1) await tests.insert(run("43", 100), ago(2));
  // Last week agent 41 averaged 70, so its 7-day figure should rise against the week before.
  for (let i = 0; i < 10; i += 1) await tests.insert(run("41", 70), ago(24 * 10));
  const deps: SnapshotDeps = {
    listListed: async () => [
      { agentId: "41", listingReference: "ref-41", categoryId: "3", firstParty: true },
      { agentId: "42", listingReference: "ref-42", categoryId: "3", firstParty: false },
      { agentId: "43", listingReference: "ref-43", categoryId: "3", firstParty: false },
      { agentId: "50", listingReference: "ref-50", categoryId: "1", firstParty: false },
    ],
    tests,
    seasonRaw: async () => null,
    paid: { live: false, aggregates: async () => new Map() },
    weights: { paid: 0.5, arena: 0.3, playground: 0.2 },
  };
  return deps;
}

test("snapshots rank each category per window, and a rerun at the same time changes nothing", async () => {
  const store = new PostgresScoreSnapshotStore(db.pool);
  const deps = await seeded();
  await computeSnapshots(deps, store, NOW);
  const first = await store.board("3", "all");
  await computeSnapshots(deps, store, NOW);
  assert.deepEqual(await store.board("3", "all"), first);
  const { rows } = await db.pool.query("select count(*)::int as n from agon_score_snapshots");
  assert.equal(rows[0].n, 16, "4 agents x 4 windows");

  const all = new Map(first.map((r) => [r.agentId, r]));
  assert.equal(all.get("41")!.rank, 1);
  assert.equal(all.get("42")!.rank, 2);
  assert.equal(all.get("43")!.score, null, "2 runs is not enough");
  assert.equal(all.get("43")!.rank, null);
  assert.equal(all.get("41")!.firstParty, true);
  assert.equal(all.get("41")!.counts.tests, 20);

  const day = new Map((await store.board("3", "24h")).map((r) => [r.agentId, r]));
  assert.equal(day.get("42")!.score, null, "nothing in the last day");
  assert.equal(day.get("41")!.rank, 1);

  const week = new Map((await store.board("3", "7d")).map((r) => [r.agentId, r]));
  assert.ok(week.get("41")!.change! > 0, "up against the week before");
  assert.equal(week.get("42")!.previousScore, null);
  assert.equal(all.get("41")!.change, null, "all time has no previous window");

  assert.deepEqual(await store.board("9", "all"), []);
  assert.equal((await store.board("1", "all"))[0]!.parts.playground.status, "not_enough");
});

test("an agent that is no longer listed drops off the board; history keeps one row per day", async () => {
  const store = new PostgresScoreSnapshotStore(db.pool);
  const deps = await seeded();
  await computeSnapshots(deps, store, NOW);
  const fewer = { ...deps, listListed: async () => (await deps.listListed()).filter((l) => l.agentId !== "42") };
  await computeSnapshots(fewer, store, new Date(NOW.getTime() + 5 * 60_000));
  assert.equal((await store.board("3", "all")).some((r) => r.agentId === "42"), false);
  const history = await store.history("41", "3", 30, NOW);
  assert.equal(history.length, 1);
  assert.equal(history[0]!.day, "2026-10-16");
});

test("the scores API: per category boards with windows and sorting, one agent's view, and card lookups", async () => {
  const store = new PostgresScoreSnapshotStore(db.pool);
  await computeSnapshots(await seeded(), store, NOW);
  const app = createScoresRoutes({ store, remainingTests: async () => 17 });

  const missing = await app.request("/");
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: "category_required", message: "Choose a category. Boards are per category." });
  assert.equal((await app.request("/?category=3&window=1y")).status, 400);
  assert.equal((await app.request("/?category=3&sort=fame")).status, 400);

  const board = await app.request("/?category=3&window=all&sort=playground");
  assert.equal(board.status, 200);
  assert.match(board.headers.get("cache-control") ?? "", /max-age=60/);
  const body = await board.json() as { category: string; window: string; rows: { agentId: string }[] };
  assert.equal(body.window, "all");
  // Playground parts, pulled toward the other agents' average: 41 = 80, 43 = 78.6, 42 = 70.
  assert.deepEqual(body.rows.map((r) => r.agentId), ["41", "43", "42"]);
  const byScore = await (await app.request("/?category=3")).json() as { window: string; rows: { agentId: string }[] };
  assert.equal(byScore.window, "all");
  assert.deepEqual(byScore.rows.map((r) => r.agentId), ["41", "42", "43"], "unrated agents sort last");

  const one = await (await app.request("/41")).json() as { category: string; windows: Record<string, { rank: number } | null>; history: unknown[]; remainingTests: number };
  assert.equal(one.category, "3");
  assert.equal(one.windows.all!.rank, 1);
  assert.equal(one.windows["24h"]!.rank, 1);
  assert.equal(one.remainingTests, 17);
  assert.equal(one.history.length, 1);
  assert.equal((await app.request("/999")).status, 404);

  const cards = await (await app.request("/?agents=41,42,777")).json() as { items: { agentId: string; score: number | null; rank: number | null; categoryId: string }[] };
  assert.deepEqual(cards.items.map((c) => c.agentId).sort(), ["41", "42"]);
  assert.equal((await app.request("/?agents=41,abc")).status, 400);
});
