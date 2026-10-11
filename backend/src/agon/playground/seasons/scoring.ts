import type { Address, Hex } from "viem";

import { committedInTime } from "./forecast.ts";
import type { ScoringRaw } from "./types.ts";

export const MIN_RANKED_FORECASTS = 20;
export const SHRINK_K = 20;

export type LeaderboardRow = {
  agentAddress: Address;
  displayName: string;
  house: boolean;
  slateResolved: number;
  forecastsResolved: number;
  meanSkill: number;
  meanBrier: number | null;
  rating: number;
  ranked: boolean;
  rank: number | null;
};

export function brier(probabilityBps: number, outcome: 0 | 1): number {
  const p = probabilityBps / 10_000;
  return (p - outcome) ** 2;
}

const key = (round: bigint, marketId: Hex) => `${round}:${marketId.toLowerCase()}`;

/// Season 1 rules (spec section 10): skill is the baseline's Brier minus the
/// agent's; the mean runs over every resolved slate market since entry, with a
/// skipped or invalid forecast counted as zero skill; rating shrinks the mean
/// toward zero by n / (n + 20) where n is resolved forecasts submitted.
export function computeLeaderboard(raw: ScoringRaw): LeaderboardRow[] {
  const outcomes = new Map<string, 0 | 1>();
  for (const r of raw.results) {
    if (r.status === "resolved" && (r.outcome === 0 || r.outcome === 1)) outcomes.set(r.marketId.toLowerCase(), r.outcome);
  }
  const committed = new Map<bigint, Date>();
  for (const r of raw.rounds) {
    if (r.state === "committed" && r.commitBlockTime) committed.set(r.round, r.commitBlockTime);
  }
  const slate = raw.markets.filter((m) => committed.has(m.round) && outcomes.has(m.marketId.toLowerCase()));
  const marketEnd = new Map(raw.markets.map((m) => [key(m.round, m.marketId), m.endAt]));

  const valid = new Map<string, number>();
  for (const f of raw.forecasts) {
    const blockTime = committed.get(f.round);
    const end = marketEnd.get(key(f.round, f.marketId));
    if (!blockTime || !end || !committedInTime(blockTime, end)) continue;
    valid.set(`${f.agentAddress.toLowerCase()}|${key(f.round, f.marketId)}`, f.probabilityBps);
  }

  const rows: LeaderboardRow[] = raw.entries.map((e) => {
    let skillSum = 0;
    let brierSum = 0;
    let slateResolved = 0;
    let forecastsResolved = 0;
    for (const m of slate) {
      if (m.round < e.enteredRound) continue;
      const outcome = outcomes.get(m.marketId.toLowerCase())!;
      slateResolved += 1;
      const p = valid.get(`${e.agentAddress.toLowerCase()}|${key(m.round, m.marketId)}`);
      if (p === undefined) continue;
      forecastsResolved += 1;
      const agentBrier = brier(p, outcome);
      brierSum += agentBrier;
      skillSum += brier(m.baselineBps, outcome) - agentBrier;
    }
    const meanSkill = slateResolved > 0 ? skillSum / slateResolved : 0;
    return {
      agentAddress: e.agentAddress,
      displayName: e.displayName,
      house: e.house,
      slateResolved,
      forecastsResolved,
      meanSkill,
      meanBrier: forecastsResolved > 0 ? brierSum / forecastsResolved : null,
      rating: meanSkill * (forecastsResolved / (forecastsResolved + SHRINK_K)),
      ranked: forecastsResolved >= MIN_RANKED_FORECASTS,
      rank: null,
    };
  });

  const byAddress = (a: LeaderboardRow, b: LeaderboardRow) => (a.agentAddress.toLowerCase() < b.agentAddress.toLowerCase() ? -1 : 1);
  const ranked = rows
    .filter((r) => r.ranked)
    .sort((a, b) => b.rating - a.rating || b.forecastsResolved - a.forecastsResolved || byAddress(a, b));
  ranked.forEach((r, i) => (r.rank = i + 1));
  const unranked = rows.filter((r) => !r.ranked).sort((a, b) => b.forecastsResolved - a.forecastsResolved || byAddress(a, b));
  return [...ranked, ...unranked];
}
