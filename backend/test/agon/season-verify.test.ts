import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { compareLeaderboards, rebuildLeaderboard, type PublishedRound } from "../../src/agon/playground/seasons/verify.ts";
import { FORECAST_TYPES, buildRoundTree, createForecastVerifier, forecastDomain, forecastLeaf, slateLeaf } from "../../src/agon/playground/seasons/forecast.ts";
import type { LeaderboardRow } from "../../src/agon/playground/seasons/scoring.ts";

const agent = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const COMMITTER = "0x9999999999999999999999999999999999999999" as const;
const domain = forecastDomain(5042, "0x1111111111111111111111111111111111111111");
const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

async function publishedRound(probabilityBps: number): Promise<PublishedRound> {
  const f = { seasonId: 1n, round: 0n, marketId: cid(1), probabilityBps, salt: cid(7), agent: agent.address };
  const signature = await agent.signTypedData({ domain, types: FORECAST_TYPES, primaryType: "Forecast", message: f });
  return {
    round: 0n,
    markets: [{ marketId: cid(1), endAt: new Date("2026-10-21T12:00:00Z"), baselineBps: 5000 }],
    forecasts: [{ agentAddress: agent.address.toLowerCase() as `0x${string}`, marketId: cid(1), probabilityBps, salt: cid(7), signature, leaf: forecastLeaf(f) }],
  };
}

/// Root as the server commits it: forecast leaves plus the slate leaf.
const rootOf = (round: PublishedRound) =>
  buildRoundTree([...round.forecasts.map((f) => f.leaf), slateLeaf(1n, round.round, round.markets)]).root;

const entries = [{ seasonId: 1n, agentAddress: agent.address.toLowerCase() as `0x${string}`, erc8004AgentId: 42n, displayName: "Outside", house: false, forecastEndpoint: null, enteredRound: 0n }];
const results = [{ marketId: cid(1), status: "resolved" as const, outcome: 1 as const, checkedAt: new Date() }];

test("a consistent season rebuilds with no problems", async () => {
  const round = await publishedRound(8000);
  const root = rootOf(round);
  const out = await rebuildLeaderboard({
    seasonId: 1n,
    agonCommitter: COMMITTER,
    chainRoots: [{ round: 0n, root, count: 1, blockTime: new Date("2026-10-20T00:31:00Z"), committer: COMMITTER }],
    rounds: [round],
    entries,
    results,
    verify: createForecastVerifier(domain),
  });
  assert.deepEqual(out.problems, []);
  assert.equal(out.rows[0]!.forecastsResolved, 1);
});

test("a published forecast that is not in the on-chain root is reported and ignored", async () => {
  const committed = await publishedRound(8000);
  const tampered = await publishedRound(9900);
  const root = rootOf(committed);
  const out = await rebuildLeaderboard({
    seasonId: 1n,
    agonCommitter: COMMITTER,
    chainRoots: [{ round: 0n, root, count: 1, blockTime: new Date("2026-10-20T00:31:00Z"), committer: COMMITTER }],
    rounds: [tampered],
    entries,
    results,
    verify: createForecastVerifier(domain),
  });
  assert.ok(out.problems.some((p) => p.includes("root mismatch")));
  assert.equal(out.rows[0]!.forecastsResolved, 0);
});

test("roots committed by other addresses are ignored; the earliest AGON root counts", async () => {
  const round = await publishedRound(8000);
  const root = rootOf(round);
  const out = await rebuildLeaderboard({
    seasonId: 1n,
    agonCommitter: COMMITTER,
    chainRoots: [
      { round: 0n, root: cid(123), count: 1, blockTime: new Date("2026-10-20T00:30:00Z"), committer: "0x8888888888888888888888888888888888888888" },
      { round: 0n, root, count: 1, blockTime: new Date("2026-10-20T00:31:00Z"), committer: COMMITTER },
      { round: 0n, root, count: 1, blockTime: new Date("2026-10-20T00:40:00Z"), committer: COMMITTER },
    ],
    rounds: [round],
    entries,
    results,
    verify: createForecastVerifier(domain),
  });
  assert.deepEqual(out.problems, []);
});

test("a baseline changed after the commit fails the public check", async () => {
  const round = await publishedRound(8000);
  const root = rootOf(round);
  const edited = { ...round, markets: [{ ...round.markets[0]!, baselineBps: 9000 }] };
  const out = await rebuildLeaderboard({
    seasonId: 1n,
    agonCommitter: COMMITTER,
    chainRoots: [{ round: 0n, root, count: 2, blockTime: new Date("2026-10-20T00:31:00Z"), committer: COMMITTER }],
    rounds: [edited],
    entries,
    results,
    verify: createForecastVerifier(domain),
  });
  assert.ok(out.problems.some((p) => p.includes("root mismatch")));
  assert.equal(out.rows[0]!.slateResolved, 0);
});

test("comparison reports rank, rating and count differences", () => {
  const local: LeaderboardRow[] = [
    { agentAddress: "0xaa" as `0x${string}`, displayName: "x", house: false, slateResolved: 1, forecastsResolved: 1, meanSkill: 0.1, meanBrier: 0.1, rating: 0.12345, ranked: false, rank: null },
  ];
  assert.deepEqual(compareLeaderboards(local, [{ agentAddress: "0xaa", rank: null, rating: 0.1235, forecastsResolved: 1 }]), []);
  assert.equal(compareLeaderboards(local, [{ agentAddress: "0xaa", rank: 1, rating: 0.2, forecastsResolved: 2 }]).length, 3);
  assert.equal(compareLeaderboards(local, []).length, 1);
});
