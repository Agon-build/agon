import assert from "node:assert/strict";
import test from "node:test";

import { seededPick } from "../../src/agon/arena/clock.ts";
import { BLOCK_SETTLE_DEPTH } from "../../src/agon/arena/tracks/research/chain-facts.ts";
import { createResearchTrack, type ChainBlock, type ChainReader, type MarketReader, type MarketRecord } from "../../src/agon/arena/tracks/research/index.ts";
import { normalise } from "../../src/agon/arena/tracks/research/values.ts";

const LATEST = 1_500_000n;
const blockOf = (n: bigint): ChainBlock => ({ gasUsed: 21_000n * (n % 50n + 1n), txCount: Number(n % 9n) + 1, timestamp: new Date(Date.UTC(2026, 9, 1) + Number(n) * 500) });
const RECORDS: Record<string, MarketRecord> = {
  "nba-heat-knicks-2026-11-11": { slug: "nba-heat-knicks-2026-11-11", question: "Heat vs Knicks", endDate: new Date("2026-11-12T03:00:00Z"), outcomes: ["Knicks", "Heat"], yesNo: false },
  "fed-cut-december": { slug: "fed-cut-december", question: "Fed cut in December?", endDate: new Date("2026-12-16T19:00:00Z"), outcomes: ["Yes", "No"], yesNo: true },
  "epl-arsenal-chelsea": { slug: "epl-arsenal-chelsea", question: "Arsenal vs Chelsea", endDate: new Date("2026-11-22T15:00:00Z"), outcomes: ["Arsenal", "Chelsea"], yesNo: false },
};

function world(over: { chain?: Partial<ChainReader>; markets?: Partial<MarketReader>; seed?: string } = {}) {
  const chain: ChainReader = { latest: async () => LATEST, block: async (n) => blockOf(n), ...over.chain };
  const markets: MarketReader = { candidates: async () => Object.keys(RECORDS), record: async (ref) => RECORDS[ref] ?? null, ...over.markets };
  const seed = over.seed ?? "test-seed-for-research";
  return createResearchTrack({ chain, markets, pick: (key, n) => seededPick(seed, key, n) });
}
const ctx = (round: bigint, used: string[] = []) => ({ seasonId: 20001n, round, used: new Set(used), count: 3 });

test("the track is Research, listing category 1", () => {
  const track = world();
  assert.equal(track.id, "research");
  assert.equal(track.categoryId, "1");
  assert.equal(track.label, "Research");
});

test("a round has three tasks from both sources, each with a truth in normal form", async () => {
  const track = world();
  for (let round = 0n; round < 12n; round += 1n) {
    const tasks = await track.buildTasks(ctx(round));
    assert.equal(tasks.length, 3);
    assert.equal(new Set(tasks.map((t) => t.taskId)).size, 3);
    assert.ok(tasks.some((t) => t.family.startsWith("block-")), "one chain task");
    assert.ok(tasks.some((t) => t.family.startsWith("market-")), "one market task");
    for (const t of tasks) {
      assert.equal(t.taskId.slice(0, t.taskId.indexOf(":")), t.family);
      assert.ok(t.truth.length > 0);
      assert.equal(normalise(t.valueType, t.truth), t.truth);
      assert.ok(t.question.length > 20 && t.question.includes(t.taskId.slice(t.taskId.indexOf(":") + 1)), "the question names its subject");
      // The same answer the task expects scores full marks.
      assert.equal(track.score(t, { value: t.truth }), 100);
      assert.equal(track.score(t, "I could not find it."), 0);
    }
  }
});

test("a block task names a block well behind the newest one", async () => {
  const track = world();
  for (let round = 0n; round < 8n; round += 1n) {
    for (const t of (await track.buildTasks(ctx(round))).filter((x) => x.family.startsWith("block-"))) {
      const n = BigInt(t.taskId.slice(t.taskId.indexOf(":") + 1));
      assert.ok(n >= 1n && n <= LATEST - BLOCK_SETTLE_DEPTH);
      assert.ok(t.question.includes(String(n)));
    }
  }
});

test("the same round builds the same tasks after a restart, and no task repeats in a season", async () => {
  const a = await world().buildTasks(ctx(4n));
  const b = await world().buildTasks(ctx(4n));
  assert.deepEqual(a, b);
  const again = await world().buildTasks(ctx(4n, a.map((t) => t.taskId)));
  for (const t of again) assert.ok(!a.some((x) => x.taskId === t.taskId));
});

test("a source that cannot be read gives fewer tasks, never one without a truth", async () => {
  const noChain = await world({ chain: { latest: async () => { throw new Error("rpc down"); } } }).buildTasks(ctx(1n));
  assert.ok(noChain.length >= 1 && noChain.every((t) => t.family.startsWith("market-") && t.truth));
  const noMarkets = await world({ markets: { candidates: async () => [] } }).buildTasks(ctx(1n));
  assert.equal(noMarkets.length, 3);
  assert.ok(noMarkets.every((t) => t.family.startsWith("block-")));
  const nothing = await world({ chain: { block: async () => null }, markets: { record: async () => null } }).buildTasks(ctx(1n));
  assert.deepEqual(nothing, []);
  const young = await world({ chain: { latest: async () => 500n }, markets: { candidates: async () => [] } }).buildTasks(ctx(1n));
  assert.deepEqual(young, []);
});

test("a Yes or No market gives an end-date task, never a second-outcome task", async () => {
  const track = world({ markets: { candidates: async () => ["fed-cut-december"] } });
  for (let round = 0n; round < 6n; round += 1n) {
    for (const t of (await track.buildTasks(ctx(round))).filter((x) => x.family.startsWith("market-"))) {
      assert.equal(t.family, "market-end-date");
      assert.equal(t.truth, "2026-12-16");
    }
  }
});

test("one family is asked in more than one way", async () => {
  const questions = new Set<string>();
  for (const seed of ["seed-one-for-wording", "seed-two-for-wording", "seed-three-for-wording", "seed-four-for-wording", "seed-five-for-wording", "seed-six-for-wording"]) {
    for (let round = 0n; round < 6n; round += 1n) {
      for (const t of await world({ seed }).buildTasks(ctx(round))) if (t.family === "block-gas") questions.add(t.question.replace(/\d+/g, "N"));
    }
  }
  assert.ok(questions.size >= 2);
});

test("a task whose truth changed or cannot be read again is void", async () => {
  const [task] = (await world().buildTasks(ctx(2n))).filter((t) => t.family.startsWith("block-"));
  assert.ok(task);
  assert.equal(await world().recheck(task), "holds");
  assert.equal(await world({ chain: { block: async (n) => ({ ...blockOf(n), gasUsed: 1n, txCount: 99, timestamp: new Date("2020-01-01T00:00:00Z") }) } }).recheck(task), "void");
  assert.equal(await world({ chain: { block: async () => null } }).recheck(task), "void");
  assert.equal(await world({ chain: { block: async () => { throw new Error("rpc down"); } } }).recheck(task), "void");

  const [market] = (await world().buildTasks(ctx(2n))).filter((t) => t.family.startsWith("market-"));
  assert.ok(market);
  assert.equal(await world().recheck(market), "holds");
  assert.equal(await world({ markets: { record: async () => null } }).recheck(market), "void");
  assert.equal(await world().recheck({ ...market, taskId: "unknown-kind:x" }), "void");
  assert.equal(await world().recheck({ ...market, truth: "something else" }), "void");
});
