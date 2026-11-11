import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Hex } from "viem";

import { PostgresArenaStore, type ArenaStore } from "../../src/agon/arena/store.ts";
import type { ArenaAnswer, ArenaSeason, ArenaTask, Entrant } from "../../src/agon/arena/types.ts";
import { MemoryArenaStore } from "./arena-memory-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const seasonOf = (id: bigint): ArenaSeason => ({
  seasonId: id, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
});
const task = (id: string): ArenaTask => ({ taskId: id, family: id.split(":")[0]!, question: `Question about ${id}?`, valueType: "integer", truth: "7" });
const entrant = (agentId: string, over: Partial<Entrant> = {}): Entrant => ({ agentId, listingReference: `5042002:0xabc:${agentId}`, name: `Agent ${agentId}`, firstParty: false, price: 50_000n, status: "entered", ...over });
const answer = (seasonId: bigint, taskId: string, agentId: string, over: Partial<ArenaAnswer> = {}): ArenaAnswer => ({
  seasonId, round: 0n, taskId, agentId, listingReference: `5042002:0xabc:${agentId}`, jobId: `job-${taskId}-${agentId}`,
  outcome: "delivered", score: 100, durationMs: 1200, answerHash: hex(9), amount: 50_000n, excerpt: "7", ...over,
});
const OPENS = new Date("2026-11-20T09:00:00Z");

let db: AgonTestDatabase;
const stores: { name: string; make: () => ArenaStore }[] = [
  { name: "memory", make: () => new MemoryArenaStore() },
  { name: "postgres", make: () => new PostgresArenaStore(db.pool) },
];

before(async () => {
  db = await createAgonTestDatabase("arena");
});
after(async () => db.close());

// Each case uses its own season and its own day, so the two stores and the cases never see each other's rows.
let next = 30_000n;
for (const { name, make } of stores) {
  const fresh = async () => {
    next += 1n;
    const store = make();
    await store.ensureSeason(seasonOf(next));
    return { store, id: next, day: new Date(Date.UTC(2031, 0, Number(next - 30_000n), 12)) };
  };

  test(`${name}: a season is stored once and read back`, async () => {
    const { store, id } = await fresh();
    const again = await store.ensureSeason({ ...seasonOf(id), trackId: "other", endsAt: new Date("2027-01-01T00:00:00Z") });
    assert.deepEqual(again, seasonOf(id));
    assert.equal(await store.raw(999_999n), null);
  });

  test(`${name}: a round opens once, with its tasks and entrants`, async () => {
    const { store, id } = await fresh();
    assert.equal(await store.getRound(id, 0n), null);
    assert.equal(await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:10"), task("block-date:11")], [entrant("2"), entrant("1", { status: "over_price", price: 900_000n })]), true);
    assert.equal(await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:99")], [entrant("3")]), false);
    assert.deepEqual(await store.getRound(id, 0n), { seasonId: id, round: 0n, opensAt: OPENS, state: "open", root: null, count: null, tx: null, blockTime: null });
    assert.deepEqual((await store.roundTasks(id, 0n)).map((t) => [t.taskId, t.truth, t.valueType, t.void]), [["block-gas:10", "7", "integer", false], ["block-date:11", "7", "integer", false]]);
    assert.deepEqual((await store.roundEntrants(id, 0n)).map((e) => [e.agentId, e.status, e.price, e.firstParty]), [["1", "over_price", 900_000n, false], ["2", "entered", 50_000n, false]]);
    assert.deepEqual(await store.usedTaskIds(id), new Set(["block-gas:10", "block-date:11"]));
    // A task already used in the season cannot open another round.
    await assert.rejects(store.openRound({ seasonId: id, round: 1n, opensAt: OPENS }, [task("block-gas:10")], [entrant("2")]));
    assert.equal(await store.getRound(id, 1n), null);
  });

  test(`${name}: one send per task and agent, and a cut-off send is found`, async () => {
    const { store, id } = await fresh();
    await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:10")], [entrant("1")]);
    const key = { seasonId: id, round: 0n, taskId: "block-gas:10", agentId: "1" };
    const t0 = new Date("2026-11-20T09:00:00Z");
    assert.equal(await store.claimSend(key, t0, 600_000), "claimed");
    assert.equal(await store.claimSend(key, new Date(t0.getTime() + 60_000), 600_000), "busy");
    assert.equal(await store.claimSend(key, new Date(t0.getTime() + 600_000), 600_000), "stale");
    assert.equal(await store.claimSend({ ...key, agentId: "2" }, t0, 600_000), "claimed");
  });

  test(`${name}: answers are kept once, and a void task takes its scores away`, async () => {
    const { store, id, day } = await fresh();
    await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:10"), task("block-date:11")], [entrant("1"), entrant("2")]);
    await store.saveAnswer(answer(id, "block-gas:10", "1"), day);
    await store.saveAnswer(answer(id, "block-gas:10", "1", { score: 0, excerpt: "second write" }), day);
    await store.saveAnswer(answer(id, "block-gas:10", "2", { outcome: "refused", score: 0, durationMs: null, answerHash: null, amount: 0n, excerpt: null, jobId: null }), day);
    await store.saveAnswer(answer(id, "block-date:11", "1", { score: 50 }), day);
    const before = await store.roundAnswers(id, 0n);
    assert.deepEqual(before.map((a) => [a.taskId, a.agentId, a.outcome, a.score, a.amount, a.excerpt]), [
      ["block-date:11", "1", "delivered", 50, 50_000n, "7"],
      ["block-gas:10", "1", "delivered", 100, 50_000n, "7"],
      ["block-gas:10", "2", "refused", 0, 0n, null],
    ]);
    await store.voidTask(id, 0n, "block-gas:10");
    assert.deepEqual((await store.roundTasks(id, 0n)).map((t) => [t.taskId, t.void]), [["block-gas:10", true], ["block-date:11", false]]);
    assert.deepEqual((await store.roundAnswers(id, 0n)).map((a) => [a.taskId, a.agentId, a.outcome, a.score]), [
      ["block-date:11", "1", "delivered", 50],
      ["block-gas:10", "1", "void", null],
      ["block-gas:10", "2", "void", null],
    ]);
  });

  test(`${name}: spending is summed for one UTC day`, async () => {
    const { store, id, day } = await fresh();
    await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:10"), task("block-date:11")], [entrant("1"), entrant("2")]);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    assert.equal(await store.spentOn(day), 0n);
    await store.saveAnswer(answer(id, "block-gas:10", "1", { amount: 50_000n }), dayStart);
    await store.saveAnswer(answer(id, "block-gas:10", "2", { amount: 220_000n }), new Date(dayStart.getTime() + 86_399_000));
    await store.saveAnswer(answer(id, "block-date:11", "1", { amount: 999_000n }), new Date(dayStart.getTime() - 1));
    await store.saveAnswer(answer(id, "block-date:11", "2", { amount: 999_000n }), new Date(dayStart.getTime() + 86_400_000));
    assert.equal(await store.spentOn(day), 270_000n);
  });

  test(`${name}: a round moves through its states and keeps its commit`, async () => {
    const { store, id, day } = await fresh();
    await store.openRound({ seasonId: id, round: 0n, opensAt: OPENS }, [task("block-gas:10")], [entrant("1"), entrant("2")]);
    await store.openRound({ seasonId: id, round: 1n, opensAt: OPENS }, [task("block-gas:20")], [entrant("1")]);
    await store.setEntrantStatus(id, 0n, "2", "cannot_take");
    assert.deepEqual((await store.roundEntrants(id, 0n)).map((e) => e.status), ["entered", "cannot_take"]);
    await store.saveAnswer(answer(id, "block-gas:10", "1"), day);
    await store.setRoundState(id, 0n, "sent");
    assert.deepEqual((await store.roundsIn(id, ["sent"])).map((r) => r.round), [0n]);
    assert.deepEqual((await store.roundsIn(id, ["open", "sent"])).map((r) => r.round), [0n, 1n]);
    const blockTime = new Date("2026-11-20T10:00:00Z");
    await store.recordCommit(id, 0n, { root: hex(1), count: 1, tx: hex(2), blockTime });
    assert.deepEqual(await store.getRound(id, 0n), { seasonId: id, round: 0n, opensAt: OPENS, state: "committed", root: hex(1), count: 1, tx: hex(2), blockTime });
    // A committed round is never moved back.
    await store.setRoundState(id, 0n, "open");
    assert.equal((await store.getRound(id, 0n))?.state, "committed");
    await store.setRoundState(id, 1n, "skipped");
    assert.equal((await store.getRound(id, 1n))?.state, "skipped");

    const raw = await store.raw(id);
    assert.ok(raw);
    assert.deepEqual(raw.season, seasonOf(id));
    assert.deepEqual(raw.rounds.map((r) => [r.round, r.state]), [[0n, "committed"], [1n, "skipped"]]);
    assert.deepEqual(raw.tasks.map((t) => [t.round, t.taskId]), [[0n, "block-gas:10"], [1n, "block-gas:20"]]);
    assert.deepEqual(raw.entrants.map((e) => [e.round, e.agentId, e.status]), [[0n, "1", "entered"], [0n, "2", "cannot_take"], [1n, "1", "entered"]]);
    assert.deepEqual(raw.answers.map((a) => [a.round, a.taskId, a.agentId, a.score]), [[0n, "block-gas:10", "1", 100]]);
  });
}
