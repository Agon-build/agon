import type { Address, Hex } from "viem";

import { buildRoundTree, forecastLeaf, slateLeaf, type Forecast } from "./forecast.ts";
import { computeLeaderboard, type LeaderboardRow } from "./scoring.ts";
import type { MarketResult, RoundMarket, SeasonEntry, SeasonRound, StoredForecast } from "./types.ts";

export type ChainRoot = { round: bigint; root: Hex; count: number; blockTime: Date; committer: Address };

export type PublishedRound = {
  round: bigint;
  markets: { marketId: Hex; endAt: Date; baselineBps: number }[];
  forecasts: { agentAddress: Address; marketId: Hex; probabilityBps: number; salt: Hex; signature: Hex; leaf: Hex }[];
};

/// Rebuilds the leaderboard from data anyone can fetch: roots from the chain,
/// published forecasts and slates from the API, results from Polymarket. The
/// round's earliest AGON root must equal the tree of every published leaf
/// plus the slate leaf (so changed baselines or end times are caught). A
/// forecast then scores only if its leaf recomputes and its signature verifies.
export async function rebuildLeaderboard(input: {
  seasonId: bigint;
  agonCommitter: Address;
  chainRoots: ChainRoot[];
  rounds: PublishedRound[];
  entries: SeasonEntry[];
  results: MarketResult[];
  verify: (f: Forecast, sig: Hex) => Promise<boolean>;
}): Promise<{ problems: string[]; rows: LeaderboardRow[] }> {
  const problems: string[] = [];
  const earliest = new Map<bigint, ChainRoot>();
  for (const r of input.chainRoots) {
    if (r.committer.toLowerCase() !== input.agonCommitter.toLowerCase()) continue;
    const prev = earliest.get(r.round);
    if (!prev || r.blockTime < prev.blockTime) earliest.set(r.round, r);
  }

  const rounds: SeasonRound[] = [];
  const markets: RoundMarket[] = [];
  const forecasts: StoredForecast[] = [];
  for (const pr of input.rounds) {
    for (const m of pr.markets) {
      markets.push({ seasonId: input.seasonId, round: pr.round, marketId: m.marketId, question: "", slug: "", endAt: m.endAt, baselineBps: m.baselineBps });
    }
    const chain = earliest.get(pr.round);
    if (!chain) {
      if (pr.forecasts.length > 0) problems.push(`round ${pr.round}: forecasts published but no AGON root on chain`);
      continue;
    }
    const valid: StoredForecast[] = [];
    for (const f of pr.forecasts) {
      const forecast: Forecast = {
        seasonId: input.seasonId,
        round: pr.round,
        marketId: f.marketId,
        probabilityBps: f.probabilityBps,
        salt: f.salt,
        agent: f.agentAddress,
      };
      if (forecastLeaf(forecast) !== f.leaf.toLowerCase()) {
        problems.push(`round ${pr.round}: leaf does not recompute for ${f.agentAddress}`);
        continue;
      }
      if (!(await input.verify(forecast, f.signature))) {
        problems.push(`round ${pr.round}: bad signature for ${f.agentAddress}`);
        continue;
      }
      valid.push({ ...f, seasonId: input.seasonId, round: pr.round });
    }
    const recomputed = buildRoundTree([...pr.forecasts.map((f) => f.leaf), slateLeaf(input.seasonId, pr.round, pr.markets)]).root;
    if (recomputed !== chain.root.toLowerCase()) {
      problems.push(`round ${pr.round}: root mismatch (chain ${chain.root}, recomputed ${recomputed})`);
      continue;
    }
    rounds.push({
      seasonId: input.seasonId,
      round: pr.round,
      openedAt: chain.blockTime,
      intakeClosesAt: chain.blockTime,
      state: "committed",
      commitRoot: chain.root,
      commitCount: chain.count,
      commitTx: null,
      commitBlockTime: chain.blockTime,
    });
    forecasts.push(...valid);
  }
  const rows = computeLeaderboard({ entries: input.entries, rounds, markets, forecasts, results: input.results });
  return { problems, rows };
}

export function compareLeaderboards(
  local: LeaderboardRow[],
  published: { agentAddress: string; rank: number | null; rating: number; forecastsResolved: number }[],
): string[] {
  const out: string[] = [];
  const byAddress = new Map(published.map((p) => [p.agentAddress.toLowerCase(), p]));
  for (const row of local) {
    const p = byAddress.get(row.agentAddress.toLowerCase());
    if (!p) {
      out.push(`${row.agentAddress}: missing from published leaderboard`);
      continue;
    }
    if (p.rank !== row.rank) out.push(`${row.agentAddress}: rank ${p.rank} published, ${row.rank} rebuilt`);
    if (Math.abs(p.rating - Math.round(row.rating * 10_000) / 10_000) > 1e-4) {
      out.push(`${row.agentAddress}: rating ${p.rating} published, ${row.rating} rebuilt`);
    }
    if (p.forecastsResolved !== row.forecastsResolved) {
      out.push(`${row.agentAddress}: ${p.forecastsResolved} forecasts published, ${row.forecastsResolved} rebuilt`);
    }
  }
  return out;
}
