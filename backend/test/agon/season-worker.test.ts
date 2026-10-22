import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { MAX_FORECAST_ATTEMPTS, bootstrapSeason, runSeasonTick, seasonWorkerLoop, type SeasonWorkerDeps } from "../../src/agon/playground/seasons/worker.ts";
import { createForecastVerifier, forecastDomain } from "../../src/agon/playground/seasons/forecast.ts";
import { DEFAULT_HOUSE_AGENTS } from "../../src/agon/playground/seasons/house-agents.ts";
import type { PolymarketMarket } from "../../src/agon/playground/seasons/polymarket.ts";
import type { Season } from "../../src/agon/playground/seasons/types.ts";
import { MemorySeasonStore } from "./season-memory-store.ts";

const COMMITS = "0x1111111111111111111111111111111111111111" as const;
const domain = forecastDomain(5_042_002, COMMITS);
const keys = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
] as const;
const accounts = keys.map((k) => privateKeyToAccount(k));
const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const season: Season = { seasonId: 1n, network: "arc-testnet", commitsAddress: COMMITS, startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: new Date("2026-10-27T00:00:00Z"), roundHours: 6 };
const market = (n: number): PolymarketMarket => ({
  conditionId: cid(n), question: `q${n}`, slug: `q${n}`, endAt: new Date("2026-10-21T12:00:00Z"), yesPriceBps: 4000, liquidity: 20_000, closed: false, resolution: "pending", tags: ["crypto"],
});

function setup() {
  const store = new MemorySeasonStore();
  let now = new Date("2026-10-20T00:05:00Z");
  let modelCalls = 0;
  const deps: SeasonWorkerDeps = {
    store,
    seasonId: 1n,
    domain,
    polymarket: { listCandidates: async () => [market(1), market(2)], getMarkets: async () => [] },
    committer: { commit: async () => ({ txHash: cid(999), blockTime: new Date(now.getTime() + 5_000), circleTxId: "c-1" }) },
    verifyForecast: createForecastVerifier(domain),
    now: () => now,
    house: [
      { spec: DEFAULT_HOUSE_AGENTS[0]!, walletId: "w-atlas", address: accounts[0]!.address },
      { spec: DEFAULT_HOUSE_AGENTS[4]!, walletId: "w-mirror", address: accounts[1]!.address },
    ],
    callModel: async () => {
      modelCalls += 1;
      return { text: '{"probability":0.31,"reasons":["a","b","c"]}' };
    },
    signTypedData: async (walletId, json) => {
      const doc = JSON.parse(json);
      const account = walletId === "w-atlas" ? accounts[0]! : accounts[1]!;
      return account.signTypedData({
        domain: doc.domain,
        types: { Forecast: doc.types.Forecast },
        primaryType: "Forecast",
        message: { ...doc.message, seasonId: BigInt(doc.message.seasonId), round: BigInt(doc.message.round) },
      });
    },
    newSalt: () => cid(7),
  };
  return { store, deps, setNow: (iso: string) => (now = new Date(iso)), modelCalls: () => modelCalls };
}

test("bootstrap creates the season and house entries labelled house", async () => {
  const { store, deps } = setup();
  await bootstrapSeason(deps, season);
  const entries = await store.listEntries(1n);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.house && e.displayName.includes("(house")));
});

test("a tick opens the round and house agents forecast every market, signed and accepted", async () => {
  const { store, deps } = setup();
  await bootstrapSeason(deps, season);
  const tick = await runSeasonTick(deps);
  assert.equal(tick.opened, true);
  assert.equal(tick.houseForecasts, 4);
  const forecasts = await store.listRoundForecasts(1n, 0n);
  assert.equal(forecasts.length, 4);
  const mirror = forecasts.filter((f) => f.agentAddress === accounts[1]!.address.toLowerCase());
  assert.deepEqual(mirror.map((f) => f.probabilityBps), [4000, 4000]);
});

test("a second tick in the same round does not duplicate house forecasts (crash-safe resume)", async () => {
  const { store, deps, modelCalls } = setup();
  await bootstrapSeason(deps, season);
  await runSeasonTick(deps);
  const callsAfterFirst = modelCalls();
  const second = await runSeasonTick(deps);
  assert.equal(second.opened, false);
  assert.equal(second.houseForecasts, 0);
  assert.equal(modelCalls(), callsAfterFirst);
  assert.equal((await store.listRoundForecasts(1n, 0n)).length, 4);
});

test("after intake closes the tick commits the round", async () => {
  const { store, deps, setNow } = setup();
  await bootstrapSeason(deps, season);
  await runSeasonTick(deps);
  setNow("2026-10-20T00:31:00Z");
  const tick = await runSeasonTick(deps);
  assert.equal(tick.committed, 1);
  assert.equal((await store.getRound(1n, 0n))!.state, "committed");
});

test("one house wallet failing to sign does not stop the other house agents", async () => {
  const { store, deps } = setup();
  await bootstrapSeason(deps, season);
  const realSign = deps.signTypedData;
  deps.signTypedData = async (walletId, json) => {
    if (walletId === "w-atlas") throw new Error("circle rate limited");
    return realSign(walletId, json);
  };
  const tick = await runSeasonTick(deps);
  assert.equal(tick.houseForecasts, 2);
  const forecasts = await store.listRoundForecasts(1n, 0n);
  assert.ok(forecasts.every((f) => f.agentAddress === accounts[1]!.address.toLowerCase()));
});

test("a Polymarket outage at round open does not stop commits of earlier rounds", async () => {
  const { store, deps, setNow } = setup();
  await bootstrapSeason(deps, season);
  await runSeasonTick(deps);
  deps.polymarket.listCandidates = async () => {
    throw new Error("gamma 503");
  };
  setNow("2026-10-20T06:05:00Z");
  const tick = await runSeasonTick(deps);
  assert.equal(tick.committed, 1);
  assert.equal((await store.getRound(1n, 0n))!.state, "committed");
});

test("house agents bootstrapped after intake closes enter from the next round", async () => {
  const { store, deps, setNow } = setup();
  setNow("2026-10-20T00:45:00Z");
  await bootstrapSeason(deps, season);
  assert.ok((await store.listEntries(1n)).every((e) => e.enteredRound === 1n));
});

test("the loop retries bootstrap until the database is reachable", { timeout: 5_000 }, async () => {
  const { store, deps } = setup();
  const realEnsure = store.ensureSeason.bind(store);
  let attempts = 0;
  store.ensureSeason = async (s) => {
    attempts += 1;
    if (attempts === 1) throw new Error("connection refused");
    return realEnsure(s);
  };
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), 3_000);
  const logs: string[] = [];
  deps.log = (m) => {
    logs.push(m);
    if (m.includes("tick")) controller.abort();
  };
  await seasonWorkerLoop(deps, { season, intervalMs: 1, signal: controller.signal });
  clearTimeout(guard);
  assert.ok(attempts >= 2);
  assert.ok(await store.getSeason(1n));
  assert.ok(logs.some((m) => m.includes("bootstrap failed")));
});

test("with Season commits switched off the tick never calls the committer", async () => {
  const { deps, setNow } = setup();
  let commits = 0;
  deps.committer = { commit: async () => { commits += 1; return { txHash: cid(999), blockTime: new Date(), circleTxId: "c-1" }; } };
  deps.commitsOff = () => true;
  await bootstrapSeason(deps, season);
  await runSeasonTick(deps);
  setNow("2026-10-20T00:31:00Z");
  const tick = await runSeasonTick(deps);
  assert.equal(tick.committed, 0);
  assert.equal(commits, 0);
});

test("an answer that never parses is retried at most MAX_FORECAST_ATTEMPTS times per market in a round", async () => {
  const { deps, setNow } = setup();
  let calls = 0;
  deps.callModel = async () => {
    calls += 1;
    return { text: "no idea" };
  };
  await bootstrapSeason(deps, season);
  for (let minute = 5; minute < 12; minute++) {
    setNow(`2026-10-20T00:${String(minute).padStart(2, "0")}:00Z`);
    await runSeasonTick(deps);
  }
  assert.equal(MAX_FORECAST_ATTEMPTS, 3);
  assert.equal(calls, 2 * MAX_FORECAST_ATTEMPTS, "two markets, atlas only (mirror never calls a model)");
});

test("bootstrap gives house entries their listing ids; unset keeps them, a set value without the key clears it", async () => {
  const { store, deps } = setup();
  const key = deps.house[0]!.spec.key;
  const id = async () => (await store.listEntries(1n)).find((e) => e.agentAddress === deps.house[0]!.address.toLowerCase())!.erc8004AgentId;
  await bootstrapSeason({ ...deps, houseAgentIds: { [key]: 41n } }, season);
  assert.equal(await id(), 41n);
  await bootstrapSeason({ ...deps, houseAgentIds: null }, season);
  assert.equal(await id(), 41n, "env unset keeps the stored id");
  await bootstrapSeason({ ...deps, houseAgentIds: {} }, season);
  assert.equal(await id(), null, "env set without this house clears it");
});

test("an evidence-first house agent uses the worker's evidence search and forecasts part way from the price", async () => {
  const { store, deps } = setup();
  const beacon = DEFAULT_HOUSE_AGENTS.find((a) => a.key === "beacon")!;
  const searched: string[] = [];
  deps.house = [{ spec: beacon, walletId: "w-atlas", address: accounts[0]!.address }];
  deps.callModel = async () => ({ text: '{"probability":0.2,"reasons":["[1] fact"]}' });
  deps.searchEvidence = async (q) => (searched.push(q), [{ n: 1, title: "t", url: "https://n.example/1", published: "2026-10-19", text: "fact" }]);
  await bootstrapSeason(deps, season);
  await runSeasonTick(deps);
  assert.deepEqual(searched, ["q1", "q2"]);
  const forecasts = await store.listRoundForecasts(1n, 0n);
  assert.deepEqual(forecasts.map((f) => f.probabilityBps), [3000, 3000], "half way from 40% toward 20%");
});
