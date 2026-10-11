import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Address, Hex } from "viem";

import { PostgresSeasonStore } from "../../src/agon/playground/seasons/store.ts";
import type { RoundMarket, Season, StoredForecast } from "../../src/agon/playground/seasons/types.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresSeasonStore;
const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const season: Season = {
  seasonId: 1n,
  network: "arc-testnet",
  commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-10-20T00:00:00Z"),
  endsAt: new Date("2026-11-20T00:00:00Z"),
  roundHours: 6,
};
const market = (id: number, endAt = "2026-10-21T00:00:00Z"): RoundMarket => ({
  seasonId: 1n, round: 0n, marketId: hex(id), question: `q${id}`, slug: `q${id}`, endAt: new Date(endAt), baselineBps: 4000,
});
const DURING = new Date("2026-10-20T00:10:00Z");
const forecast = (p: number): StoredForecast => ({
  seasonId: 1n, round: 0n, marketId: hex(1), agentAddress: A, probabilityBps: p, salt: hex(7), signature: "0xabcd", leaf: hex(100 + p),
});

before(async () => {
  db = await createAgonTestDatabase("seasons");
  store = new PostgresSeasonStore(db.pool);
  await store.ensureSeason(season);
  await store.upsertEntry({ seasonId: 1n, agentAddress: A, erc8004AgentId: 42n, displayName: "Atlas (house)", house: true, forecastEndpoint: null, enteredRound: 0n });
});
after(async () => db.close());

test("ensureSeason is idempotent and returns the stored season", async () => {
  const again = await store.ensureSeason({ ...season, roundHours: 12 });
  assert.equal(again.roundHours, 6);
  assert.deepEqual(await store.getSeason(1n), again);
});

test("a round opens once with its slate", async () => {
  const round = { seasonId: 1n, round: 0n, openedAt: new Date("2026-10-20T00:00:00Z"), intakeClosesAt: new Date("2026-10-20T00:30:00Z") };
  assert.equal(await store.openRound(round, [market(1), market(2)]), true);
  assert.equal(await store.openRound(round, [market(3)]), false);
  assert.equal((await store.listRoundMarkets(1n, 0n)).length, 2);
  assert.equal((await store.getRound(1n, 0n))!.state, "open");
});

test("forecast insert: inserted, duplicate, then changed", async () => {
  assert.equal(await store.insertForecast(forecast(3400), DURING), "inserted");
  assert.equal(await store.insertForecast(forecast(3400), DURING), "duplicate");
  assert.equal(await store.insertForecast(forecast(9000), DURING), "changed");
  const rows = await store.listRoundForecasts(1n, 0n);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.probabilityBps, 3400);
});

test("due rounds, commit record and results feed scoringRaw", async () => {
  assert.equal((await store.roundsDueForCommit(new Date("2026-10-20T00:10:00Z"))).length, 0);
  assert.equal((await store.roundsDueForCommit(new Date("2026-10-20T00:31:00Z"))).length, 1);
  // Once intake has closed, or the round is committing, the store refuses new forecasts.
  assert.equal(await store.insertForecast({ ...forecast(1111), marketId: hex(2) }, new Date("2026-10-20T00:30:00Z")), "round_closed");
  await store.setRoundState(1n, 0n, "committing");
  assert.equal(await store.insertForecast({ ...forecast(2222), marketId: hex(2) }, DURING), "round_closed");
  assert.equal((await store.roundsDueForCommit(new Date("2026-10-20T00:31:00Z"))).length, 1, "committing rounds stay due for retry");
  await store.recordCommit(1n, 0n, { root: hex(9), count: 1, tx: hex(8), blockTime: new Date("2026-10-20T00:31:05Z"), circleTxId: "circle-1" });
  const round = await store.getRound(1n, 0n);
  assert.equal(round!.state, "committed");
  assert.equal(round!.commitCount, 1);
  assert.equal((await store.roundsDueForCommit(new Date("2026-10-21T00:00:00Z"))).length, 0);

  assert.deepEqual(await store.marketsAwaitingResult(new Date("2026-10-20T12:00:00Z")), []);
  const awaiting = await store.marketsAwaitingResult(new Date("2026-10-21T00:00:01Z"));
  assert.deepEqual(awaiting.sort(), [hex(1), hex(2)]);
  await store.saveResults([
    { marketId: hex(1), status: "resolved", outcome: 1, checkedAt: new Date() },
    { marketId: hex(2), status: "pending", outcome: null, checkedAt: new Date() },
  ]);
  assert.deepEqual(await store.marketsAwaitingResult(new Date("2026-10-21T00:00:01Z")), [hex(2)]);

  const raw = await store.scoringRaw(1n);
  assert.equal(raw.entries.length, 1);
  assert.equal(raw.entries[0]!.erc8004AgentId, 42n);
  assert.equal(raw.rounds.length, 1);
  assert.equal(raw.markets.length, 2);
  assert.equal(raw.forecasts.length, 1);
  assert.equal(raw.results.find((r) => r.marketId === hex(1))!.outcome, 1);
});

test("a final result is never overwritten by a later pending read", async () => {
  await store.saveResults([{ marketId: hex(1), status: "pending", outcome: null, checkedAt: new Date() }]);
  const raw = await store.scoringRaw(1n);
  assert.equal(raw.results.find((r) => r.marketId === hex(1))!.status, "resolved");
});

test("addresses and hashes are stored lowercase", async () => {
  await store.upsertEntry({ seasonId: 1n, agentAddress: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" as Address, erc8004AgentId: null, displayName: "Outside", house: false, forecastEndpoint: "https://agent.example/forecast", enteredRound: 0n });
  const entry = await store.getEntry(1n, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  assert.equal(entry!.agentAddress, "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("season market ids and agent-id lookups", async () => {
  assert.deepEqual((await store.listSeasonMarketIds(1n)).sort(), [hex(1), hex(2)]);
  assert.equal((await store.getEntryByAgentId(1n, 42n))!.agentAddress, A);
  assert.equal(await store.getEntryByAgentId(1n, 7n), null);
});

test("round markets keep their category; a market without one is stored as other", async () => {
  const round = { seasonId: 1n, round: 7n, openedAt: new Date("2026-10-21T18:00:00Z"), intakeClosesAt: new Date("2026-10-21T18:30:00Z") };
  const politics = { ...market(70), round: 7n, category: "politics" as const };
  const bare = { ...market(71), round: 7n };
  assert.equal(await store.openRound(round, [politics, bare as typeof politics]), true);
  const stored = await store.listRoundMarkets(1n, 7n);
  assert.deepEqual(stored.map((m) => [m.marketId, m.category]), [[hex(70), "politics"], [hex(71), "other"]]);
});
