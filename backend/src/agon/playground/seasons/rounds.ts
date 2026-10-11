import type { Address, Hex } from "viem";

import { buildRoundTree, forecastLeaf, isProbabilityBps, slateLeaf, type Forecast } from "./forecast.ts";
import { categoryFor } from "./categories.ts";
import { selectSlate, type PolymarketClient } from "./polymarket.ts";
import type { MarketResult, Season, SeasonStore } from "./types.ts";

export const INTAKE_MS = 30 * 60_000;

export type RootCommitter = {
  commit(input: { seasonId: bigint; round: bigint; root: Hex; count: number }): Promise<{ txHash: Hex; blockTime: Date; circleTxId: string }>;
};

export type RoundDeps = {
  store: SeasonStore;
  polymarket: PolymarketClient;
  committer: RootCommitter;
  verifyForecast: (f: Forecast, signature: Hex) => Promise<boolean>;
  now: () => Date;
  log?: (message: string) => void;
};

const roundMs = (season: Season) => season.roundHours * 3_600_000;

export function roundIndexAt(season: Season, at: Date): bigint | null {
  const t = at.getTime();
  if (t < season.startsAt.getTime() || t >= season.endsAt.getTime()) return null;
  return BigInt(Math.floor((t - season.startsAt.getTime()) / roundMs(season)));
}

/// The first round an agent joining now can actually play: the current round
/// while its intake is open, otherwise the next one. Round 0 before the season
/// starts; null when no playable round is left.
export function entryRoundAt(season: Season, at: Date): bigint | null {
  if (at.getTime() < season.startsAt.getTime()) return 0n;
  const current = roundIndexAt(season, at);
  if (current === null) return null;
  const opened = season.startsAt.getTime() + Number(current) * roundMs(season);
  if (at.getTime() < opened + INTAKE_MS) return current;
  const next = current + 1n;
  return season.startsAt.getTime() + Number(next) * roundMs(season) < season.endsAt.getTime() ? next : null;
}

export async function openCurrentRound(
  deps: RoundDeps,
  seasonId: bigint,
): Promise<{ status: "opened" | "exists" | "outside_season" | "no_markets" | "season_not_found"; round?: bigint }> {
  const season = await deps.store.getSeason(seasonId);
  if (!season) return { status: "season_not_found" };
  const now = deps.now();
  const round = roundIndexAt(season, now);
  if (round === null) return { status: "outside_season" };
  if (await deps.store.getRound(seasonId, round)) return { status: "exists", round };
  const openedAt = new Date(season.startsAt.getTime() + Number(round) * roundMs(season));
  const intakeClosesAt = new Date(openedAt.getTime() + INTAKE_MS);
  // A market scores once per season: repeating it on later slates would count
  // one outcome many times and inflate forecast counts.
  const used = new Set(await deps.store.listSeasonMarketIds(seasonId));
  const candidates = (await deps.polymarket.listCandidates(now)).filter((m) => !used.has(m.conditionId));
  const slate = selectSlate(candidates, now);
  const markets = slate.map((m) => ({
    seasonId, round, marketId: m.conditionId, question: m.question, slug: m.slug, endAt: m.endAt, baselineBps: m.yesPriceBps, category: categoryFor(m.tags),
  }));
  const opened = await deps.store.openRound({ seasonId, round, openedAt, intakeClosesAt }, markets);
  if (!opened) return { status: "exists", round };
  if (markets.length === 0) {
    await deps.store.setRoundState(seasonId, round, "skipped");
    deps.log?.(`season ${seasonId} round ${round}: no eligible markets, skipped`);
    return { status: "no_markets", round };
  }
  deps.log?.(`season ${seasonId} round ${round}: opened with ${markets.length} markets`);
  return { status: "opened", round };
}

export type ForecastSubmission = {
  seasonId: bigint;
  round: bigint;
  marketId: Hex;
  agentAddress: Address;
  probabilityBps: number;
  salt: Hex;
  signature: Hex;
};

export type ForecastRejection =
  | "season_not_found"
  | "not_entered"
  | "round_not_open"
  | "market_not_in_slate"
  | "bad_probability"
  | "bad_signature"
  | "changed_forecast";

export async function acceptForecast(
  deps: RoundDeps,
  s: ForecastSubmission,
): Promise<{ ok: true; duplicate: boolean } | { ok: false; code: ForecastRejection }> {
  const season = await deps.store.getSeason(s.seasonId);
  if (!season) return { ok: false, code: "season_not_found" };
  const entry = await deps.store.getEntry(s.seasonId, s.agentAddress);
  if (!entry || entry.enteredRound > s.round) return { ok: false, code: "not_entered" };
  const round = await deps.store.getRound(s.seasonId, s.round);
  if (!round || round.state !== "open" || deps.now().getTime() >= round.intakeClosesAt.getTime()) {
    return { ok: false, code: "round_not_open" };
  }
  const markets = await deps.store.listRoundMarkets(s.seasonId, s.round);
  if (!markets.some((m) => m.marketId === s.marketId.toLowerCase())) return { ok: false, code: "market_not_in_slate" };
  if (!isProbabilityBps(s.probabilityBps) || !/^0x[0-9a-fA-F]{64}$/.test(s.salt)) return { ok: false, code: "bad_probability" };
  const forecast: Forecast = {
    seasonId: s.seasonId,
    round: s.round,
    marketId: s.marketId.toLowerCase() as Hex,
    probabilityBps: s.probabilityBps,
    salt: s.salt.toLowerCase() as Hex,
    agent: s.agentAddress,
  };
  if (!(await deps.verifyForecast(forecast, s.signature))) return { ok: false, code: "bad_signature" };
  // The store re-checks the round atomically: signature checks take time, and
  // a round that started committing meanwhile must not gain a forecast.
  const result = await deps.store.insertForecast(
    {
      seasonId: s.seasonId,
      round: s.round,
      marketId: forecast.marketId,
      agentAddress: s.agentAddress,
      probabilityBps: s.probabilityBps,
      salt: forecast.salt,
      signature: s.signature,
      leaf: forecastLeaf(forecast),
    },
    deps.now(),
  );
  if (result === "round_closed") return { ok: false, code: "round_not_open" };
  if (result === "changed") return { ok: false, code: "changed_forecast" };
  return { ok: true, duplicate: result === "duplicate" };
}

export async function commitDueRounds(deps: RoundDeps): Promise<{ committed: number; skipped: number; failed: number }> {
  const tally = { committed: 0, skipped: 0, failed: 0 };
  for (const round of await deps.store.roundsDueForCommit(deps.now())) {
    // Move to committing before reading forecasts: from here on the store
    // refuses inserts, so the list below is final.
    await deps.store.setRoundState(round.seasonId, round.round, "committing");
    const forecasts = await deps.store.listRoundForecasts(round.seasonId, round.round);
    if (forecasts.length === 0) {
      await deps.store.setRoundState(round.seasonId, round.round, "skipped");
      tally.skipped += 1;
      continue;
    }
    const markets = await deps.store.listRoundMarkets(round.seasonId, round.round);
    const tree = buildRoundTree([...forecasts.map((f) => f.leaf), slateLeaf(round.seasonId, round.round, markets)]);
    try {
      const receipt = await deps.committer.commit({ seasonId: round.seasonId, round: round.round, root: tree.root, count: tree.leaves.length });
      await deps.store.recordCommit(round.seasonId, round.round, {
        root: tree.root,
        count: tree.leaves.length,
        tx: receipt.txHash,
        blockTime: receipt.blockTime,
        circleTxId: receipt.circleTxId,
      });
      deps.log?.(`season ${round.seasonId} round ${round.round}: committed ${forecasts.length} forecasts in ${receipt.txHash}`);
      tally.committed += 1;
    } catch (error) {
      deps.log?.(`season ${round.seasonId} round ${round.round}: commit failed, will retry: ${(error as Error).message}`);
      tally.failed += 1;
    }
  }
  return tally;
}

export async function refreshResults(deps: RoundDeps): Promise<number> {
  const ids = await deps.store.marketsAwaitingResult(deps.now());
  if (ids.length === 0) return 0;
  const markets = await deps.polymarket.getMarkets(ids);
  const checkedAt = deps.now();
  const results: MarketResult[] = markets.map((m) => ({
    marketId: m.conditionId,
    status: m.resolution === "yes" || m.resolution === "no" ? "resolved" : m.resolution === "void" ? "void" : "pending",
    outcome: m.resolution === "yes" ? 1 : m.resolution === "no" ? 0 : null,
    checkedAt,
  }));
  await deps.store.saveResults(results);
  return results.filter((r) => r.status !== "pending").length;
}
