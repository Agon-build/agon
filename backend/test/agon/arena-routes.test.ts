import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { closeRound, openDueRound, sendRound, type RoundDeps } from "../../src/agon/arena/round.ts";
import { createArenaRoutes } from "../../src/agon/arena/routes.ts";
import { startArena } from "../../src/agon/arena/runtime.ts";
import type { ArenaSeason, Entrant, TrackDef } from "../../src/agon/arena/types.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { verifyProof } from "../../src/agon/playground/seasons/forecast.ts";
import { MemoryArenaStore } from "./arena-memory-store.ts";

const season: ArenaSeason = {
  seasonId: 20001n, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
};
const track: TrackDef = {
  id: "research", categoryId: "1", label: "Research",
  buildTasks: async ({ round, count }) => Array.from({ length: count }, (_, i) => ({ taskId: `block-gas:${round * 10n + BigInt(i)}`, family: "block-gas", question: `How much gas did block ${round * 10n + BigInt(i)} use?`, valueType: "integer" as const, truth: String(21_000 + i) })),
  score: (_t, result) => (result as { worth: number }).worth,
  recheck: async () => "holds",
};
const entrant = (agentId: string, over: Partial<Entrant> = {}): Entrant => ({ agentId, listingReference: `ref-${agentId}`, name: `Agent ${agentId}`, firstParty: agentId === "1", price: 50_000n, status: "entered", ...over });

async function world() {
  const store = new MemoryArenaStore();
  await store.ensureSeason(season);
  const state = { now: new Date("2026-11-20T23:30:00Z") };
  const deps: RoundDeps = {
    store, track, season,
    settings: { on: true, seasonId: 20001n, startsAt: season.startsAt, endsAt: season.endsAt, maxHire: 500_000n, maxDay: 5_000_000n, seed: "a-long-enough-test-seed" },
    listEntrants: async () => [entrant("1"), entrant("2"), entrant("3"), entrant("4", { price: 900_000n })],
    hire: async (e) => ({ ok: true, jobId: `job-${e.agentId}`, amount: e.price, result: { worth: e.agentId === "1" ? 100 : 50, zz: "x".repeat(900) }, durationMs: 1000 * Number(e.agentId) }),
    committer: { commit: async () => ({ txHash: `0x${"b".repeat(64)}` as Hex, blockTime: new Date(state.now.getTime() + 60_000), circleTxId: "c" }) },
    now: () => state.now, shuffle: (items) => items, alert: () => {},
  };
  const app = createArenaRoutes({ tracks: [{ def: track, season, raw: () => store.raw(20001n) }] });
  const get = async (path: string) => { const res = await app.request(path); return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, any>, text: JSON.stringify(await app.request(path).then((r) => r.json())) }; };
  return { store, state, deps, get };
}

test("the track list names each track and its season", async () => {
  const w = await world();
  const { status, body, headers } = await w.get("/tracks");
  assert.equal(status, 200);
  assert.equal(headers.get("cache-control"), "public, max-age=60");
  assert.equal(headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(body.tracks, [{ id: "research", label: "Research", categoryId: "1", open: true, season: { seasonId: "20001", network: "arc-testnet", explorer: agonNetwork("arc-testnet").explorer, commitsAddress: season.commitsAddress, startsAt: "2026-11-20T00:00:00.000Z", endsAt: "2026-12-18T00:00:00.000Z", roundHours: 24 } }]);
  assert.equal((await w.get("/tracks/coding")).status, 404);
  assert.equal((await w.get("/tracks/coding/rounds")).status, 404);
  assert.equal((await w.get("/tracks/coding/rounds/0")).status, 404);
});

test("an open round shows who is in it and nothing an agent could use", async () => {
  const w = await world();
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  for (const path of ["/tracks/research/rounds/0", "/tracks/research", "/tracks/research/rounds"]) {
    const { status, text } = await w.get(path);
    assert.equal(status, 200);
    for (const hidden of ["How much gas", "21000", "21001", "truth", "question", "block-gas", "xxxx", "answerHash", "excerpt"]) assert.ok(!text.includes(hidden), `${path} leaks ${hidden}`);
  }
  const { body } = await w.get("/tracks/research/rounds/0");
  assert.equal(body.state, "sent");
  assert.deepEqual(body.entrants.map((e: { agentId: string; status: string }) => [e.agentId, e.status]), [["1", "entered"], ["2", "entered"], ["3", "entered"], ["4", "over_price"]]);
  assert.equal(body.tasks, undefined);
  assert.equal(body.answers, undefined);
  assert.equal(body.root, undefined);
  // Answers of a round that is not committed are not on the board either.
  const board = (await w.get("/tracks/research")).body;
  assert.deepEqual(board.rows.map((r: { agentId: string; scored: number; mean: number | null }) => [r.agentId, r.scored, r.mean]), [["1", 0, null], ["2", 0, null], ["3", 0, null], ["4", 0, null]]);
});

test("a committed round shows its tasks, true answers, each answer and a proof that checks", async () => {
  const w = await world();
  await openDueRound(w.deps);
  await sendRound(w.deps, 0n);
  assert.equal(await closeRound(w.deps, 0n), "committed");
  const { body } = await w.get("/tracks/research/rounds/0");
  assert.equal(body.state, "committed");
  assert.match(body.root, /^0x[0-9a-f]{64}$/);
  assert.equal(body.count, 9);
  assert.equal(body.tx, `0x${"b".repeat(64)}`);
  assert.deepEqual(body.tasks.map((t: { taskId: string; truth: string; valueType: string; void: boolean }) => [t.taskId, t.truth, t.valueType, t.void]), [["block-gas:0", "21000", "integer", false], ["block-gas:1", "21001", "integer", false], ["block-gas:2", "21002", "integer", false]]);
  assert.match(body.tasks[0].question, /How much gas did block 0 use/);
  assert.equal(body.answers.length, 9);
  for (const a of body.answers as { agentId: string; score: number; outcome: string; durationMs: number; excerpt: string; leaf: Hex; proof: Hex[] }[]) {
    assert.equal(a.outcome, "delivered");
    assert.equal(a.score, a.agentId === "1" ? 100 : 50);
    assert.equal(a.durationMs, 1000 * Number(a.agentId));
    assert.ok(a.excerpt.length <= 500 && a.excerpt.includes("worth"));
    assert.ok(verifyProof(a.leaf, a.proof, body.root));
  }
  assert.ok(!(body.answers as { agentId: string }[]).some((a) => a.agentId === "4"));
  // A changed score no longer matches the committed root.
  assert.equal(new Set((body.answers as { leaf: string }[]).map((a) => a.leaf)).size, 9);

  const rounds = (await w.get("/tracks/research/rounds?limit=5")).body.rounds;
  assert.deepEqual(rounds.map((r: { round: number; state: string; count: number }) => [r.round, r.state, r.count]), [[0, "committed", 9]]);
  assert.equal((await w.get("/tracks/research/rounds/7")).status, 404);
  assert.equal((await w.get("/tracks/research/rounds/abc")).status, 400);
});

test("the board is unranked until three agents have fifteen scored tasks", async () => {
  const w = await world();
  for (let day = 0; day < 5; day += 1) {
    w.state.now = new Date(season.startsAt.getTime() + day * 86_400_000 + 23.5 * 3_600_000);
    assert.equal(await openDueRound(w.deps), "opened");
    await sendRound(w.deps, BigInt(day));
    if (day === 4) {
      const before = (await w.get("/tracks/research")).body;
      assert.equal(before.ranked, false);
      assert.deepEqual(before.rows.map((r: { agentId: string; scored: number }) => [r.agentId, r.scored]), [["1", 12], ["2", 12], ["3", 12], ["4", 0]]);
    }
    assert.equal(await closeRound(w.deps, BigInt(day)), "committed");
  }
  const { body } = await w.get("/tracks/research");
  assert.equal(body.ranked, true);
  assert.equal(body.open, true);
  assert.deepEqual(body.rows.map((r: { agentId: string; rank: number | null; mean: number | null; scored: number; medianMs: number | null; note: string | null; firstParty: boolean }) => [r.agentId, r.rank, r.mean, r.scored, r.medianMs, r.note, r.firstParty]), [
    ["1", 1, 100, 15, 1000, null, true],
    ["2", 2, 50, 15, 2000, null, false],
    ["3", 3, 50, 15, 3000, null, false],
    ["4", null, null, 0, null, "over_price", false],
  ]);
  assert.deepEqual(body.rounds.map((r: { round: number }) => r.round), [4, 3, 2, 1, 0]);
});

test("with the Arena switched off the track is shown as closed and nothing runs", async () => {
  const logs: string[] = [];
  const make = (env: Record<string, string | undefined>) => startArena({
    env, store: new MemoryArenaStore(), network: "arc-testnet", commitsAddress: season.commitsAddress,
    committer: { commit: async () => { throw new Error("must not commit"); } },
    payments: { quoteHire: async () => { throw new Error("must not quote"); }, confirmHire: async () => { throw new Error("must not pay"); } },
    buyerAddress: async () => { throw new Error("must not make a wallet"); },
    listings: async () => { throw new Error("must not list"); },
    firstParty: () => false,
    chain: { latest: async () => 1n, block: async () => null }, markets: { candidates: async () => [], record: async () => null },
    safe: async () => true, alert: () => {}, log: (m) => logs.push(m), startLoop: false,
  });

  const off = make({});
  assert.equal(off.settings, null);
  assert.deepEqual(logs, []);
  const list = (await (await off.routes.request("/tracks")).json()) as { tracks: unknown[] };
  assert.deepEqual(list.tracks, [{ id: "research", label: "Research", categoryId: "1", open: false, season: null }]);
  assert.deepEqual(await (await off.routes.request("/tracks/research")).json(), { id: "research", label: "Research", categoryId: "1", open: false, season: null, ranked: false, rows: [], rounds: [] });
  // No track covers Research while it is off, so the score keeps what it had.
  assert.equal(await off.trackArena("1", null, null), undefined);
  assert.equal(await off.board("research", 10), null);

  const wrong = make({ AGON_ARENA_RESEARCH: "on" });
  assert.equal(wrong.settings, null);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!, /^off: .*AGON_ARENA_SEED/);

  const on = make({ AGON_ARENA_RESEARCH: "on", AGON_ARENA_SEED: "a-long-enough-test-seed", AGON_ARENA_RESEARCH_STARTS_AT: "2026-11-20T00:00:00Z" });
  assert.equal(on.settings?.seasonId, 20001n);
  // On, with no round yet: Research has a track, and nobody is ranked.
  assert.equal(await on.trackArena("1", null, null), null);
  assert.equal(await on.trackArena("3", null, null), undefined);
  assert.equal(await on.board("coding", 10), null);
});
