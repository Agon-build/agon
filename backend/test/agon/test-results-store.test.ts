import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PostgresTestResultsStore, type NewTestResult } from "../../src/agon/tests/results-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("test_results"); });
after(async () => db.close());

const LIMITS = { perUserHour: 5, perAgentDay: 20 };
const T0 = new Date("2026-10-16T12:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const runner = (n: number) => `0x${n.toString(16).padStart(40, "a")}`;
const row = (over: Partial<NewTestResult> = {}): NewTestResult => ({
  agentId: "41", listingReference: "agon:41", categoryId: "3", taskId: "evidence-under-pressure", variant: 0,
  source: "public", runner: runner(1), score: 80, passed: true, durationMs: 120, input: { a: 1 }, output: { b: 2 }, error: null, ...over,
});

test("a public result reads back by id and by agent", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  const out = await store.insertPublicWithinLimits(row({ agentId: "1", runner: runner(100) }), LIMITS, T0);
  assert.ok(out.ok);
  const got = await store.get(out.result.id);
  assert.equal(got?.score, 80);
  assert.deepEqual(got?.input, { a: 1 });
  assert.equal(got?.createdAt.toISOString(), T0.toISOString());
  assert.deepEqual((await store.listByAgent("1", 10)).map((r) => r.id), [out.result.id]);
  assert.equal(await store.get("00000000-0000-0000-0000-000000000000"), null);
});

test("the 6th public test by one person in an hour is refused, and allowed again after the hour", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  const who = runner(200);
  for (let i = 0; i < 5; i += 1) assert.ok((await store.insertPublicWithinLimits(row({ agentId: "2", runner: who }), LIMITS, at(i))).ok);
  assert.deepEqual(await store.insertPublicWithinLimits(row({ agentId: "2", runner: who }), LIMITS, at(30)), { ok: false, code: "user_limit" });
  assert.ok((await store.insertPublicWithinLimits(row({ agentId: "2", runner: who }), LIMITS, at(61))).ok);
});

test("the 21st public test on one agent in a day is refused; Agon checks ignore both limits", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  for (let i = 0; i < 20; i += 1) assert.ok((await store.insertPublicWithinLimits(row({ agentId: "3", runner: runner(300 + i) }), LIMITS, at(i))).ok);
  assert.deepEqual(await store.insertPublicWithinLimits(row({ agentId: "3", runner: runner(399) }), LIMITS, at(100)), { ok: false, code: "agent_limit" });
  assert.equal(await store.remainingToday("3", at(100), 20), 0);
  assert.deepEqual(await store.publicCounts(runner(319), "3", at(30)), { byRunnerHour: 1, byAgentDay: 20 });
  assert.deepEqual(await store.publicCounts(runner(319), "3", at(100)), { byRunnerHour: 0, byAgentDay: 20 });
  await store.insert(row({ agentId: "3", source: "agon_check", runner: null }), at(101));
  assert.equal((await store.listByAgent("3", 50)).length, 21);
  assert.equal(await store.remainingToday("3", at(24 * 60 + 20), 20), 20, "the day rolls");
});

test("two requests at once cannot both take a person's last test of the hour", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  const who = runner(500);
  for (let i = 0; i < 4; i += 1) assert.ok((await store.insertPublicWithinLimits(row({ agentId: "5", runner: who }), LIMITS, at(i))).ok);
  const both = await Promise.all([
    store.insertPublicWithinLimits(row({ agentId: "5", runner: who }), LIMITS, at(10)),
    store.insertPublicWithinLimits(row({ agentId: "6", runner: who }), LIMITS, at(10)),
  ]);
  assert.equal(both.filter((r) => r.ok).length, 1);
});

test("aggregates average one category inside the window, and all time when no window", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  await store.insert(row({ agentId: "7", categoryId: "8", score: 100, source: "agon_check", runner: null }), at(-48 * 60));
  await store.insert(row({ agentId: "7", categoryId: "8", score: 60, source: "agon_check", runner: null }), at(0));
  await store.insert(row({ agentId: "8", categoryId: "8", score: 40, source: "agon_check", runner: null }), at(0));
  await store.insert(row({ agentId: "7", categoryId: "1", score: 0, source: "agon_check", runner: null }), at(0));
  const all = await store.aggregates("8", null);
  assert.deepEqual(all.get("7"), { n: 2, avg: 80 });
  const day = await store.aggregates("8", at(-60));
  assert.deepEqual(day.get("7"), { n: 1, avg: 60 });
  assert.deepEqual(day.get("8"), { n: 1, avg: 40 });
  assert.equal(day.size, 2);
  const before = await store.aggregates("8", at(-72 * 60), at(-60));
  assert.deepEqual(before.get("7"), { n: 1, avg: 100 }, "until is exclusive and bounds the window");
  assert.equal(before.has("8"), false);
});

test("the recent feed is newest first", async () => {
  const store = new PostgresTestResultsStore(db.pool);
  const a = await store.insert(row({ agentId: "9", source: "agon_check", runner: null }), at(1000));
  const b = await store.insert(row({ agentId: "9", source: "agon_check", runner: null }), at(1001));
  const recent = await store.listRecent(2);
  assert.deepEqual(recent.map((r) => r.id), [b.id, a.id]);
});
