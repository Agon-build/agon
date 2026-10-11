import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage, type Hex } from "viem";

import { createErc8004EntryVerifier, createSeasonRoutes, entryMessage, type EntryVerifier } from "../../src/agon/playground/seasons/routes.ts";
import { FORECAST_TYPES, createForecastVerifier, forecastDomain, verifyProof } from "../../src/agon/playground/seasons/forecast.ts";
import { commitDueRounds, openCurrentRound, type RoundDeps } from "../../src/agon/playground/seasons/rounds.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import type { Season } from "../../src/agon/playground/seasons/types.ts";
import { MemorySeasonStore } from "./season-memory-store.ts";

const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const owner = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const other = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const COMMITS = "0x1111111111111111111111111111111111111111" as const;
const domain = forecastDomain(5_042_002, COMMITS);
const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const OWNER_SIG = `0x${"11".repeat(65)}` as Hex;
const AGENT_SIG = `0x${"22".repeat(65)}` as Hex;
const season: Season = { seasonId: 1n, network: "arc-testnet", commitsAddress: COMMITS, startsAt: new Date("2026-10-20T00:00:00Z"), endsAt: new Date("2026-10-27T00:00:00Z"), roundHours: 6 };
const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

/// Accepts only the fixed test signatures, and only when the route built the
/// message from exactly the submitted fields.
const fakeVerifier: EntryVerifier = async (input) =>
  input.ownerSignature === OWNER_SIG &&
  input.agentSignature === AGENT_SIG &&
  input.message ===
    entryMessage({
      seasonId: input.seasonId,
      erc8004AgentId: input.erc8004AgentId,
      agentAddress: input.agentAddress,
      displayName: input.displayName,
      forecastEndpoint: input.forecastEndpoint,
    });

async function setup(options: { postLimitPerMinute?: number } = {}) {
  const store = new MemorySeasonStore();
  let now = new Date("2026-10-20T00:05:00Z");
  const rounds: RoundDeps = {
    store,
    polymarket: {
      listCandidates: async () => [{ conditionId: cid(1), question: "q1", slug: "q1", endAt: new Date("2026-10-21T12:00:00Z"), yesPriceBps: 4000, liquidity: 20_000, closed: false, resolution: "pending", tags: [] }],
      getMarkets: async () => [],
    },
    committer: { commit: async () => ({ txHash: cid(999), blockTime: new Date("2026-10-20T00:31:05Z"), circleTxId: "c" }) },
    verifyForecast: createForecastVerifier(domain),
    now: () => now,
  };
  await store.ensureSeason(season);
  await openCurrentRound(rounds, 1n);
  const app = createSeasonRoutes({
    store,
    rounds,
    network: agonNetwork("arc-testnet"),
    verifyEntry: fakeVerifier,
    postLimitPerMinute: options.postLimitPerMinute ?? 100,
  });
  return { app, store, rounds, setNow: (iso: string) => (now = new Date(iso)) };
}

const entry = (overrides: Record<string, unknown> = {}) => ({
  agentAddress: agent.address,
  erc8004AgentId: "42",
  displayName: "Outside Bot",
  ownerSignature: OWNER_SIG,
  agentSignature: AGENT_SIG,
  ...overrides,
});

async function forecastBody(probabilityBps: number) {
  const message = { seasonId: 1n, round: 0n, marketId: cid(1), probabilityBps, salt: cid(7), agent: agent.address };
  const signature = await agent.signTypedData({ domain, types: FORECAST_TYPES, primaryType: "Forecast", message });
  return { round: "0", marketId: cid(1), agentAddress: agent.address, probabilityBps, salt: cid(7), signature };
}

test("the entry message binds season, agent id, signer, name and endpoint", () => {
  assert.equal(
    entryMessage({ seasonId: 1n, erc8004AgentId: 42n, agentAddress: agent.address, displayName: "Outside Bot", forecastEndpoint: null }),
    `AGON Season 1 entry\nAgent id: 42\nForecast signer: ${agent.address.toLowerCase()}\nName: Outside Bot\nEndpoint: none`,
  );
});

test("the ERC-8004 verifier needs both the identity owner's and the forecast signer's signatures", async () => {
  const client = {
    readContract: async () => owner.address,
    verifyMessage: (args: { address: `0x${string}`; message: string; signature: Hex }) => verifyMessage(args),
  };
  const verify = createErc8004EntryVerifier(client, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
  const fields = { seasonId: 1n, erc8004AgentId: 42n, agentAddress: agent.address, displayName: "Outside Bot", forecastEndpoint: null };
  const message = entryMessage(fields);
  const ownerSignature = await owner.signMessage({ message });
  const agentSignature = await agent.signMessage({ message });
  assert.equal(await verify({ ...fields, message, ownerSignature, agentSignature }), true);
  assert.equal(await verify({ ...fields, message, ownerSignature, agentSignature: await other.signMessage({ message }) }), false);
  assert.equal(await verify({ ...fields, message, ownerSignature: await other.signMessage({ message }), agentSignature }), false);
  const renamed = entryMessage({ ...fields, displayName: "Somebody Else" });
  assert.equal(await verify({ ...fields, displayName: "Somebody Else", message: renamed, ownerSignature, agentSignature }), false);
});

test("open entry requires valid signatures and records the entry", async () => {
  const { app, store } = await setup();
  assert.equal((await app.request("/1/entries", post(entry({ agentSignature: `0x${"33".repeat(65)}` })))).status, 403);
  const ok = await app.request("/1/entries", post(entry({ forecastEndpoint: "https://bot.example/forecast" })));
  assert.equal(ok.status, 201);
  const stored = await store.getEntry(1n, agent.address);
  assert.equal(stored!.house, false);
  assert.equal(stored!.erc8004AgentId, 42n);
  assert.equal(stored!.forecastEndpoint, "https://bot.example/forecast");
  assert.equal(stored!.enteredRound, 0n);
});

test("an existing entry cannot be rewritten; an identical resubmission is accepted", async () => {
  const { app, store } = await setup();
  await app.request("/1/entries", post(entry()));
  assert.equal((await app.request("/1/entries", post(entry({ erc8004AgentId: "43", displayName: "Attacker" })))).status, 409);
  assert.equal((await app.request("/1/entries", post(entry()))).status, 200);
  const stored = await store.getEntry(1n, agent.address);
  assert.equal(stored!.displayName, "Outside Bot");
  assert.equal(stored!.erc8004AgentId, 42n);
});

test("one forecast signer per ERC-8004 agent id", async () => {
  const { app } = await setup();
  await app.request("/1/entries", post(entry()));
  const res = await app.request("/1/entries", post(entry({ agentAddress: other.address })));
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, "agent_id_taken");
});

test("entries cannot claim the house label", async () => {
  const { app } = await setup();
  assert.equal((await app.request("/1/entries", post(entry({ displayName: "Totally (house)" })))).status, 400);
});

test("entering after intake closes starts at the next round; entering after the last round is refused", async () => {
  const { app, store, setNow } = await setup();
  setNow("2026-10-20T00:45:00Z");
  assert.equal((await app.request("/1/entries", post(entry()))).status, 201);
  assert.equal((await store.getEntry(1n, agent.address))!.enteredRound, 1n);
  setNow("2026-10-27T01:00:00Z");
  const late = await app.request("/1/entries", post(entry({ agentAddress: other.address, erc8004AgentId: "77" })));
  assert.equal(late.status, 409);
  assert.equal(((await late.json()) as { error: string }).error, "season_not_open");
});

test("forecasts are accepted per item with named refusals", async () => {
  const { app } = await setup();
  await app.request("/1/entries", post(entry()));
  const res = await app.request("/1/forecasts", post({ forecasts: [await forecastBody(3400), { ...(await forecastBody(3400)), marketId: cid(9) }] }));
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: { ok: boolean; code?: string }[] };
  assert.deepEqual(body.results, [{ ok: true, duplicate: false }, { ok: false, code: "market_not_in_slate" }]);
});

test("forecast signatures must be exactly 65 bytes", async () => {
  const { app } = await setup();
  const long = { ...(await forecastBody(3400)), signature: `0x${"ab".repeat(400)}` };
  assert.equal((await app.request("/1/forecasts", post({ forecasts: [long] }))).status, 400);
});

test("oversized bodies are refused before parsing", async () => {
  const { app } = await setup();
  const res = await app.request("/1/forecasts", post(`{"forecasts":[${'"x",'.repeat(20_000)}"x"]}`));
  assert.equal(res.status, 413);
});

test("writes are rate limited per client address", async () => {
  const { app } = await setup({ postLimitPerMinute: 2 });
  const headers = { "x-forwarded-for": "203.0.113.9" };
  assert.notEqual((await app.request("/1/entries", post(entry(), headers))).status, 429);
  assert.notEqual((await app.request("/1/entries", post(entry(), headers))).status, 429);
  assert.equal((await app.request("/1/entries", post(entry(), headers))).status, 429);
  assert.notEqual((await app.request("/1/entries", post(entry(), { "x-forwarded-for": "198.51.100.4" }))).status, 429);
});

test("round detail hides forecasts until committed, then publishes forecasts and the slate leaf with proofs", async () => {
  const { app, rounds, setNow } = await setup();
  await app.request("/1/entries", post(entry()));
  await app.request("/1/forecasts", post({ forecasts: [await forecastBody(3400)] }));

  const before = (await (await app.request("/1/rounds/0")).json()) as { forecasts: unknown[]; commit: unknown; slate: unknown; markets: unknown[] };
  assert.equal(before.forecasts.length, 0);
  assert.equal(before.commit, null);
  assert.equal(before.slate, null);
  assert.equal(before.markets.length, 1);

  setNow("2026-10-20T00:31:00Z");
  await commitDueRounds(rounds);
  const after = (await (await app.request("/1/rounds/0")).json()) as {
    forecasts: { salt: string; leaf: Hex; proof: Hex[] }[];
    slate: { leaf: Hex; proof: Hex[] };
    commit: { txUrl: string; count: number; root: Hex };
  };
  assert.equal(after.forecasts.length, 1);
  assert.equal(after.forecasts[0]!.salt, cid(7));
  assert.equal(after.commit.count, 2);
  assert.equal(after.commit.txUrl, `https://explorer.testnet.arc.io/tx/${cid(999)}`);
  assert.equal(verifyProof(after.forecasts[0]!.leaf, after.forecasts[0]!.proof, after.commit.root), true);
  assert.equal(verifyProof(after.slate.leaf, after.slate.proof, after.commit.root), true);
  const detail = (await (await app.request("/1/rounds/0")).json()) as { markets: { category: string }[] };
  assert.equal(detail.markets[0]!.category, "other");
});

test("leaderboard hides outside entries with no scored forecasts and reports real freshness", async () => {
  const { app, store } = await setup();
  await store.upsertEntry({ seasonId: 1n, agentAddress: other.address, erc8004AgentId: null, displayName: "Mirror (house, market copy)", house: true, forecastEndpoint: null, enteredRound: 0n });
  await app.request("/1/entries", post(entry()));
  const first = (await (await app.request("/1/leaderboard")).json()) as { network: string; rows: { agentAddress: string }[]; updatedAt: string; lastCommitAt: string | null; commitsAddress: string };
  assert.equal(first.network, "Arc Testnet");
  assert.equal(first.commitsAddress, COMMITS);
  assert.deepEqual(first.rows.map((r) => r.agentAddress), [other.address.toLowerCase()]);
  assert.equal(first.lastCommitAt, null);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = (await (await app.request("/1/leaderboard")).json()) as { updatedAt: string };
  assert.equal(second.updatedAt, first.updatedAt, "cached board reports when it was computed");
});

test("unknown season and malformed ids return 404 and 400", async () => {
  const { app } = await setup();
  assert.equal((await app.request("/9/leaderboard")).status, 404);
  assert.equal((await app.request("/abc/leaderboard")).status, 400);
  assert.equal((await app.request("/1/rounds/x")).status, 400);
});

test("leaderboard by category: valid names, overall, and a 400 for anything else", async () => {
  const { app, store } = await setup();
  await store.upsertEntry({ seasonId: 1n, agentAddress: other.address, erc8004AgentId: null, displayName: "Mirror (house, market copy)", house: true, forecastEndpoint: null, enteredRound: 0n });
  const politics = (await (await app.request("/1/leaderboard?category=politics")).json()) as { category: string; minRanked: number; rows: unknown[] };
  assert.equal(politics.category, "politics");
  assert.equal(politics.minRanked, 10);
  assert.equal(politics.rows.length, 1);
  const overall = (await (await app.request("/1/leaderboard")).json()) as { category: string; minRanked: number };
  assert.equal(overall.category, "overall");
  assert.equal(overall.minRanked, 20);
  assert.equal(((await (await app.request("/1/leaderboard?category=overall")).json()) as { category: string }).category, "overall");
  const bad = await app.request("/1/leaderboard?category=politcs");
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: "invalid_category" });
});

test("ratings list every shown agent with an overall cell and six category cells", async () => {
  const { app, store } = await setup();
  await store.upsertEntry({ seasonId: 1n, agentAddress: other.address, erc8004AgentId: null, displayName: "Mirror (house, market copy)", house: true, forecastEndpoint: null, enteredRound: 0n });
  await app.request("/1/entries", post(entry()));
  const body = (await (await app.request("/1/ratings")).json()) as {
    categories: string[]; minRanked: { overall: number; category: number };
    agents: { agentAddress: string; house: boolean; overall: { rank: number | null }; categories: Record<string, { forecastsResolved: number }> }[];
  };
  assert.deepEqual(body.categories, ["sports", "crypto", "economics", "politics", "world", "culture"]);
  assert.deepEqual(body.minRanked, { overall: 20, category: 10 });
  assert.deepEqual(body.agents.map((a) => a.agentAddress), [other.address.toLowerCase()], "outside entries appear once they have a scored forecast");
  assert.deepEqual(Object.keys(body.agents[0]!.categories).sort(), [...body.categories].sort());
  assert.equal((await app.request("/9/ratings")).status, 404);
});
