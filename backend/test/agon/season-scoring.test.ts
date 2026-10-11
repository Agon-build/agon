import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import { brier, computeLeaderboard, MIN_RANKED_FORECASTS } from "../../src/agon/playground/seasons/scoring.ts";
import type { ScoringRaw, SeasonEntry, SeasonRound, RoundMarket, StoredForecast, MarketResult } from "../../src/agon/playground/seasons/types.ts";

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const mid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const t = (iso: string) => new Date(iso);

function entry(agent: Address, house = false, enteredRound = 0n): SeasonEntry {
  return { seasonId: 1n, agentAddress: agent, erc8004AgentId: null, displayName: agent.slice(0, 6), house, forecastEndpoint: null, enteredRound };
}
function round(r: bigint, state: SeasonRound["state"] = "committed", blockTime = "2026-10-20T00:30:00Z"): SeasonRound {
  return { seasonId: 1n, round: r, openedAt: t("2026-10-20T00:00:00Z"), intakeClosesAt: t("2026-10-20T00:30:00Z"), state, commitRoot: mid(9), commitCount: 1, commitTx: mid(8), commitBlockTime: state === "committed" ? t(blockTime) : null };
}
function market(r: bigint, id: number, baselineBps: number, endAt = "2026-10-21T00:00:00Z"): RoundMarket {
  return { seasonId: 1n, round: r, marketId: mid(id), question: `q${id}`, slug: `q${id}`, endAt: t(endAt), baselineBps };
}
function forecast(agent: Address, r: bigint, id: number, probabilityBps: number): StoredForecast {
  return { seasonId: 1n, round: r, marketId: mid(id), agentAddress: agent, probabilityBps, salt: mid(1), signature: "0x01", leaf: mid(2) };
}
function result(id: number, status: MarketResult["status"], outcome: 0 | 1 | null): MarketResult {
  return { marketId: mid(id), status, outcome, checkedAt: t("2026-10-21T01:00:00Z") };
}

test("brier score", () => {
  near(brier(7000, 1), 0.09);
  near(brier(7000, 0), 0.49);
  near(brier(10_000, 1), 0);
  near(brier(0, 1), 1);
});

test("skill is baseline brier minus agent brier; skipped markets count as zero", () => {
  const raw: ScoringRaw = {
    entries: [entry(A), entry(B)],
    rounds: [round(0n)],
    markets: [market(0n, 1, 5000), market(0n, 2, 5000)],
    forecasts: [forecast(A, 0n, 1, 8000), forecast(A, 0n, 2, 8000), forecast(B, 0n, 1, 8000)],
    results: [result(1, "resolved", 1), result(2, "resolved", 0)],
  };
  const rows = computeLeaderboard(raw);
  const a = rows.find((r) => r.agentAddress === A)!;
  const b = rows.find((r) => r.agentAddress === B)!;
  // market 1: baseline 0.25, agent 0.04 -> +0.21; market 2: baseline 0.25, agent 0.64 -> -0.39
  near(a.meanSkill, (0.21 - 0.39) / 2);
  assert.equal(a.slateResolved, 2);
  assert.equal(a.forecastsResolved, 2);
  near(a.meanBrier!, (0.04 + 0.64) / 2);
  // B skipped market 2: counted as zero skill
  near(b.meanSkill, 0.21 / 2);
  assert.equal(b.forecastsResolved, 1);
});

test("void and pending markets are excluded for everyone", () => {
  const raw: ScoringRaw = {
    entries: [entry(A)],
    rounds: [round(0n)],
    markets: [market(0n, 1, 5000), market(0n, 2, 5000), market(0n, 3, 5000)],
    forecasts: [forecast(A, 0n, 1, 8000), forecast(A, 0n, 2, 0), forecast(A, 0n, 3, 0)],
    results: [result(1, "resolved", 1), result(2, "void", null), result(3, "pending", null)],
  };
  const [a] = computeLeaderboard(raw);
  assert.equal(a!.slateResolved, 1);
  near(a!.meanSkill, 0.21);
});

test("forecasts from rounds that are not committed, or committed too late, do not count", () => {
  const raw: ScoringRaw = {
    entries: [entry(A)],
    rounds: [round(0n, "committed", "2026-10-20T23:30:00Z"), round(1n, "open")],
    markets: [market(0n, 1, 5000, "2026-10-21T00:00:00Z"), market(1n, 2, 5000)],
    forecasts: [forecast(A, 0n, 1, 9000), forecast(A, 1n, 2, 9000)],
    results: [result(1, "resolved", 1), result(2, "resolved", 1)],
  };
  const [a] = computeLeaderboard(raw);
  // round 0 committed 30 minutes before end: forecast invalid, counted as a skip
  // round 1 not committed: its slate is not scored yet
  assert.equal(a!.slateResolved, 1);
  assert.equal(a!.forecastsResolved, 0);
  near(a!.meanSkill, 0);
  assert.equal(a!.meanBrier, null);
});

test("slate before an agent's entry round is not held against it", () => {
  const raw: ScoringRaw = {
    entries: [entry(A, false, 1n)],
    rounds: [round(0n), round(1n)],
    markets: [market(0n, 1, 5000), market(1n, 2, 5000)],
    forecasts: [forecast(A, 1n, 2, 8000)],
    results: [result(1, "resolved", 1), result(2, "resolved", 1)],
  };
  const [a] = computeLeaderboard(raw);
  assert.equal(a!.slateResolved, 1);
  near(a!.meanSkill, 0.21);
});

test("ranking needs MIN_RANKED_FORECASTS and rating shrinks small samples", () => {
  const markets: RoundMarket[] = [];
  const forecasts: StoredForecast[] = [];
  const results: MarketResult[] = [];
  for (let i = 1; i <= MIN_RANKED_FORECASTS; i++) {
    markets.push(market(0n, i, 5000));
    forecasts.push(forecast(A, 0n, i, 8000));
    results.push(result(i, "resolved", 1));
  }
  forecasts.push(forecast(B, 0n, 1, 10_000));
  const rows = computeLeaderboard({ entries: [entry(A), entry(B)], rounds: [round(0n)], markets, forecasts, results });
  const a = rows.find((r) => r.agentAddress === A)!;
  const b = rows.find((r) => r.agentAddress === B)!;
  assert.equal(a.ranked, true);
  assert.equal(a.rank, 1);
  near(a.rating, 0.21 * (20 / 40));
  assert.equal(b.ranked, false);
  assert.equal(b.rank, null);
  near(b.rating, (0.25 / 20) * (1 / 21));
  assert.equal(rows[0]!.agentAddress, A);
});

test("house flag and display name pass through", () => {
  const rows = computeLeaderboard({ entries: [entry(A, true)], rounds: [], markets: [], forecasts: [], results: [] });
  assert.equal(rows[0]!.house, true);
  assert.equal(rows[0]!.slateResolved, 0);
  near(rows[0]!.meanSkill, 0);
});
