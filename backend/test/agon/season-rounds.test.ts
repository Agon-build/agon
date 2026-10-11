import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import {
  acceptForecast, commitDueRounds, entryRoundAt, openCurrentRound, refreshResults, roundIndexAt, type RoundDeps,
} from "../../src/agon/playground/seasons/rounds.ts";
import {
  FORECAST_TYPES, buildRoundTree, createForecastVerifier, forecastDomain, proofFor, slateLeaf, verifyProof,
} from "../../src/agon/playground/seasons/forecast.ts";
import type { PolymarketMarket } from "../../src/agon/playground/seasons/polymarket.ts";
import type { Season } from "../../src/agon/playground/seasons/types.ts";
import { MemorySeasonStore } from "./season-memory-store.ts";

const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const COMMITS = "0x1111111111111111111111111111111111111111" as const;
const domain = forecastDomain(5_042_002, COMMITS);
const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const season: Season = { seasonId: 1n, network: "arc-testnet", commitsAddress: COMMITS, startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: new Date("2026-10-27T00:00:00Z"), roundHours: 6 };

function market(n: number, overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  return { conditionId: cid(n), question: `q${n}`, slug: `q${n}`, endAt: new Date("2026-10-21T12:00:00Z"), yesPriceBps: 4000, liquidity: 20_000, closed: false, resolution: "pending", tags: ["crypto"], ...overrides };
}

function setup(nowIso = "2026-10-20T06:05:00Z") {
  const store = new MemorySeasonStore();
  let now = new Date(nowIso);
  const commits: { root: Hex; count: number; round: bigint }[] = [];
  const deps: RoundDeps = {
    store,
    polymarket: {
      listCandidates: async () => [market(1), market(2)],
      getMarkets: async (ids) => ids.map((id) => market(Number(BigInt(id)), { closed: true, resolution: id === cid(1) ? "yes" : "void" })),
    },
    committer: {
      commit: async (input) => {
        commits.push({ root: input.root, count: input.count, round: input.round });
        return { txHash: cid(999), blockTime: new Date(now.getTime() + 5_000), circleTxId: `circle-${input.round}` };
      },
    },
    verifyForecast: createForecastVerifier(domain),
    now: () => now,
  };
  return { store, deps, commits, setNow: (iso: string) => (now = new Date(iso)) };
}

async function signed(round: bigint, marketId: Hex, probabilityBps: number, signer = agent) {
  const salt = cid(7);
  const message = { seasonId: 1n, round, marketId, probabilityBps, salt, agent: signer.address };
  const signature = await signer.signTypedData({ domain, types: FORECAST_TYPES, primaryType: "Forecast", message });
  return { seasonId: 1n, round, marketId, agentAddress: signer.address, probabilityBps, salt, signature };
}

const enter = (store: MemorySeasonStore, enteredRound = 0n) =>
  store.upsertEntry({ seasonId: 1n, agentAddress: agent.address, erc8004AgentId: null, displayName: "A", house: false, forecastEndpoint: null, enteredRound });

test("round index follows the season clock", () => {
  assert.equal(roundIndexAt(season, new Date("2026-10-19T23:59:59Z")), null);
  assert.equal(roundIndexAt(season, new Date("2026-10-20T00:00:00Z")), 0n);
  assert.equal(roundIndexAt(season, new Date("2026-10-20T06:05:00Z")), 1n);
  assert.equal(roundIndexAt(season, new Date("2026-10-27T00:00:00Z")), null);
});

test("entry round: the current round while intake is open, otherwise the next; none after the last round", () => {
  assert.equal(entryRoundAt(season, new Date("2026-10-19T12:00:00Z")), 0n);
  assert.equal(entryRoundAt(season, new Date("2026-10-20T06:10:00Z")), 1n);
  assert.equal(entryRoundAt(season, new Date("2026-10-20T06:30:00Z")), 2n);
  assert.equal(entryRoundAt(season, new Date("2026-10-26T18:10:00Z")), 27n);
  assert.equal(entryRoundAt(season, new Date("2026-10-26T18:31:00Z")), null);
  assert.equal(entryRoundAt(season, new Date("2026-10-27T00:00:00Z")), null);
});

test("opening a round snapshots the slate and baselines once", async () => {
  const { store, deps } = setup();
  await store.ensureSeason(season);
  assert.deepEqual(await openCurrentRound(deps, 1n), { status: "opened", round: 1n });
  assert.deepEqual(await openCurrentRound(deps, 1n), { status: "exists", round: 1n });
  const markets = await store.listRoundMarkets(1n, 1n);
  assert.deepEqual(markets.map((m) => [m.marketId, m.baselineBps]), [[cid(1), 4000], [cid(2), 4000]]);
  const round = await store.getRound(1n, 1n);
  assert.equal(round!.openedAt.toISOString(), "2026-10-20T06:00:00.000Z");
  assert.equal(round!.intakeClosesAt.toISOString(), "2026-10-20T06:30:00.000Z");
});

test("a market already used this season is never put on a later slate", async () => {
  const { store, deps, setNow } = setup();
  await store.ensureSeason(season);
  await openCurrentRound(deps, 1n);
  setNow("2026-10-20T12:05:00Z");
  assert.deepEqual(await openCurrentRound(deps, 1n), { status: "no_markets", round: 2n });
  deps.polymarket.listCandidates = async () => [market(1), market(2), market(3)];
  setNow("2026-10-20T18:05:00Z");
  assert.deepEqual(await openCurrentRound(deps, 1n), { status: "opened", round: 3n });
  assert.deepEqual((await store.listRoundMarkets(1n, 3n)).map((m) => m.marketId), [cid(3)]);
});

test("a round with no eligible markets is opened as skipped", async () => {
  const { store, deps } = setup();
  await store.ensureSeason(season);
  deps.polymarket.listCandidates = async () => [];
  assert.deepEqual(await openCurrentRound(deps, 1n), { status: "no_markets", round: 1n });
  assert.equal((await store.getRound(1n, 1n))!.state, "skipped");
});

test("forecast intake: accepted, duplicate, changed, and each refusal code", async () => {
  const { store, deps, setNow } = setup();
  await store.ensureSeason(season);
  await openCurrentRound(deps, 1n);
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(1), 3400)), { ok: false, code: "not_entered" });
  await enter(store, 1n);

  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(1), 3400)), { ok: true, duplicate: false });
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(1), 3400)), { ok: true, duplicate: true });
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(1), 9000)), { ok: false, code: "changed_forecast" });
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(5), 3400)), { ok: false, code: "market_not_in_slate" });
  assert.deepEqual(await acceptForecast(deps, { ...(await signed(1n, cid(2), 3400)), probabilityBps: 10_001 }), { ok: false, code: "bad_probability" });
  assert.deepEqual(await acceptForecast(deps, { ...(await signed(1n, cid(2), 3400)), probabilityBps: 3500 }), { ok: false, code: "bad_signature" });
  const forged = await signed(1n, cid(2), 3400, stranger);
  assert.deepEqual(await acceptForecast(deps, { ...forged, agentAddress: agent.address }), { ok: false, code: "bad_signature" });
  assert.deepEqual(await acceptForecast(deps, { ...(await signed(1n, cid(2), 3400)), seasonId: 9n }), { ok: false, code: "season_not_found" });
  assert.deepEqual(await acceptForecast(deps, await signed(4n, cid(2), 3400)), { ok: false, code: "round_not_open" });

  setNow("2026-10-20T06:30:00Z");
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(2), 3400)), { ok: false, code: "round_not_open" });
});

test("a forecast whose insert lands after the round started committing is refused, not stored", async () => {
  const { store, deps } = setup();
  await store.ensureSeason(season);
  await enter(store);
  await openCurrentRound(deps, 1n);
  const realVerify = deps.verifyForecast;
  // Slow signature check: while it runs, the worker moves the round to committing.
  deps.verifyForecast = async (f, sig) => {
    await store.setRoundState(1n, 1n, "committing");
    return realVerify(f, sig);
  };
  assert.deepEqual(await acceptForecast(deps, await signed(1n, cid(1), 3400)), { ok: false, code: "round_not_open" });
  assert.equal((await store.listRoundForecasts(1n, 1n)).length, 0);
});

test("due rounds commit one root over the forecasts and the slate leaf; empty rounds are skipped", async () => {
  const { store, deps, commits, setNow } = setup();
  await store.ensureSeason(season);
  await enter(store);
  await openCurrentRound(deps, 1n);
  await acceptForecast(deps, await signed(1n, cid(1), 3400));
  await acceptForecast(deps, await signed(1n, cid(2), 7000));
  deps.polymarket.listCandidates = async () => [market(3)];
  setNow("2026-10-20T12:01:00Z");
  await openCurrentRound(deps, 1n); // round 2 opens with market 3; nobody forecasts
  setNow("2026-10-20T12:31:00Z");

  assert.deepEqual(await commitDueRounds(deps), { committed: 1, skipped: 1, failed: 0 });
  assert.equal(commits.length, 1);
  assert.equal(commits[0]!.count, 3);
  const forecasts = await store.listRoundForecasts(1n, 1n);
  const slate = slateLeaf(1n, 1n, await store.listRoundMarkets(1n, 1n));
  const tree = buildRoundTree([...forecasts.map((f) => f.leaf), slate]);
  assert.equal(commits[0]!.root, tree.root);
  for (const leaf of tree.leaves) assert.equal(verifyProof(leaf, proofFor(tree.leaves, leaf), tree.root), true);
  assert.equal((await store.getRound(1n, 1n))!.state, "committed");
  assert.equal((await store.getRound(1n, 2n))!.state, "skipped");
  assert.deepEqual(await commitDueRounds(deps), { committed: 0, skipped: 0, failed: 0 });
});

test("a failed commit leaves the round committing for the next tick", async () => {
  const { store, deps, setNow } = setup();
  await store.ensureSeason(season);
  await enter(store);
  await openCurrentRound(deps, 1n);
  await acceptForecast(deps, await signed(1n, cid(1), 3400));
  setNow("2026-10-20T06:31:00Z");
  const original = deps.committer.commit;
  deps.committer.commit = async () => {
    throw new Error("rpc down");
  };
  assert.deepEqual(await commitDueRounds(deps), { committed: 0, skipped: 0, failed: 1 });
  assert.equal((await store.getRound(1n, 1n))!.state, "committing");
  deps.committer.commit = original;
  assert.deepEqual(await commitDueRounds(deps), { committed: 1, skipped: 0, failed: 0 });
});

test("results refresh maps yes, no and void and leaves pending markets alone", async () => {
  const { store, deps, setNow } = setup();
  await store.ensureSeason(season);
  await openCurrentRound(deps, 1n);
  setNow("2026-10-21T12:00:01Z");
  assert.equal(await refreshResults(deps), 2);
  const raw = await store.scoringRaw(1n);
  const byId = new Map(raw.results.map((r) => [r.marketId, r]));
  assert.deepEqual([byId.get(cid(1))!.status, byId.get(cid(1))!.outcome], ["resolved", 1]);
  assert.equal(byId.get(cid(2))!.status, "void");
  assert.equal(await refreshResults(deps), 0);
});

test("opened slate markets carry the category of their tags", async () => {
  const { store, deps } = setup();
  await store.ensureSeason(season);
  deps.polymarket.listCandidates = async () => [market(1), market(2, { tags: ["politics", "elections"] }), market(3, { tags: [] })];
  await openCurrentRound(deps, 1n);
  const markets = await store.listRoundMarkets(1n, 1n);
  assert.deepEqual(markets.map((m) => [m.marketId, m.category]), [[cid(1), "crypto"], [cid(2), "politics"], [cid(3), "other"]]);
});

test("the committed slate leaf does not depend on categories", () => {
  const base = { seasonId: 1n, round: 0n, marketId: cid(1), question: "q", slug: "q", endAt: new Date("2026-10-21T00:00:00Z"), baselineBps: 4000 };
  assert.equal(slateLeaf(1n, 0n, [{ ...base, category: "crypto" as const }]), slateLeaf(1n, 0n, [{ ...base, category: "politics" as const }]));
});
