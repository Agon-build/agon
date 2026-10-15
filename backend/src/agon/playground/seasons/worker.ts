import type { Address, Hex } from "viem";

import { forecastTypedDataJson, type ForecastDomain } from "./forecast.ts";
import { forecastSlate, type HouseAgentSpec, type ModelCaller } from "./house-agents.ts";
import {
  acceptForecast, commitDueRounds, entryRoundAt, openCurrentRound, refreshResults, roundIndexAt, type RoundDeps,
} from "./rounds.ts";
import type { Season } from "./types.ts";

/// A house agent's answer for one market is tried at most this many times per
/// round; an answer that never parses must not call the model on every tick.
export const MAX_FORECAST_ATTEMPTS = 3;
const attemptsByWorker = new WeakMap<object, Map<string, number>>();

export type HouseRunner = { spec: HouseAgentSpec; walletId: string; address: Address };

export type SeasonWorkerDeps = RoundDeps & {
  seasonId: bigint;
  domain: ForecastDomain;
  house: HouseRunner[];
  callModel: ModelCaller;
  signTypedData: (walletId: string, json: string) => Promise<Hex>;
  newSalt: () => Hex;
  commitsOff?: () => boolean;
  /// House key to its listing's ERC-8004 id, so agent pages find the house's Arena rating.
  /// Null or absent leaves stored ids alone; a value is authoritative (a missing key clears).
  houseAgentIds?: Record<string, bigint> | null;
};

export async function bootstrapSeason(deps: SeasonWorkerDeps, season: Season): Promise<void> {
  const stored = await deps.store.ensureSeason(season);
  const enteredRound = entryRoundAt(stored, deps.now()) ?? 0n;
  for (const h of deps.house) {
    await deps.store.upsertEntry({
      seasonId: stored.seasonId,
      agentAddress: h.address,
      erc8004AgentId: null,
      displayName: h.spec.displayName,
      house: true,
      forecastEndpoint: null,
      enteredRound,
    });
    if (deps.houseAgentIds) await deps.store.setEntryAgentId(stored.seasonId, h.address, deps.houseAgentIds[h.spec.key] ?? null);
  }
}

/// Fills only the markets each house agent has not forecast yet, so a crash
/// between opening a round and finishing house forecasts resumes cleanly on
/// the next tick. One agent's failure never stops the others.
async function houseForecastsForOpenRound(deps: SeasonWorkerDeps): Promise<number> {
  const season = await deps.store.getSeason(deps.seasonId);
  if (!season) return 0;
  const round = roundIndexAt(season, deps.now());
  if (round === null) return 0;
  const state = await deps.store.getRound(deps.seasonId, round);
  if (!state || state.state !== "open" || deps.now() >= state.intakeClosesAt) return 0;
  const markets = await deps.store.listRoundMarkets(deps.seasonId, round);
  const existing = await deps.store.listRoundForecasts(deps.seasonId, round);
  let accepted = 0;
  for (const h of deps.house) {
    try {
      const done = new Set(existing.filter((f) => f.agentAddress === h.address.toLowerCase()).map((f) => f.marketId));
      let attempts = attemptsByWorker.get(deps);
      if (!attempts) attemptsByWorker.set(deps, (attempts = new Map()));
      const key = (marketId: string) => `${round}:${h.address.toLowerCase()}:${marketId}`;
      const missing = markets.filter((m) => !done.has(m.marketId) && (attempts!.get(key(m.marketId)) ?? 0) < MAX_FORECAST_ATTEMPTS);
      if (missing.length === 0) continue;
      for (const m of missing) attempts.set(key(m.marketId), (attempts.get(key(m.marketId)) ?? 0) + 1);
      for (const f of await forecastSlate(deps.callModel, h.spec, missing, deps.now(), deps.log)) {
        try {
          const salt = deps.newSalt();
          const forecast = { seasonId: deps.seasonId, round, marketId: f.marketId, probabilityBps: f.probabilityBps, salt, agent: h.address };
          const signature = await deps.signTypedData(h.walletId, forecastTypedDataJson(deps.domain, forecast));
          const result = await acceptForecast(deps, { ...forecast, agentAddress: h.address, signature });
          if (result.ok && !result.duplicate) accepted += 1;
          if (!result.ok) deps.log?.(`house ${h.spec.key}: forecast refused (${result.code}) for ${f.marketId}`);
        } catch (error) {
          deps.log?.(`house ${h.spec.key}: forecast failed for ${f.marketId}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      deps.log?.(`house ${h.spec.key}: skipped this tick: ${(error as Error).message}`);
    }
  }
  return accepted;
}

async function phase<T>(deps: SeasonWorkerDeps, name: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    deps.log?.(`season ${deps.seasonId} ${name} failed: ${(error as Error).message}`);
    return fallback;
  }
}

/// Each phase is isolated: a Polymarket outage at round open must not stop
/// commits of earlier rounds or result checks.
export async function runSeasonTick(
  deps: SeasonWorkerDeps,
): Promise<{ opened: boolean; houseForecasts: number; committed: number; resolved: number }> {
  const open = await phase<{ status: string }>(deps, "round open", { status: "failed" }, () => openCurrentRound(deps, deps.seasonId));
  const houseForecasts = await phase(deps, "house forecasts", 0, () => houseForecastsForOpenRound(deps));
  const commits = deps.commitsOff?.()
    ? { committed: 0, skipped: 0, failed: 0 }
    : await phase(deps, "commit", { committed: 0, skipped: 0, failed: 0 }, () => commitDueRounds(deps));
  const resolved = await phase(deps, "results", 0, () => refreshResults(deps));
  return { opened: open.status === "opened", houseForecasts, committed: commits.committed, resolved };
}

/// Retries bootstrap until it succeeds (for example while Postgres is still
/// starting), then runs ticks until aborted.
export async function seasonWorkerLoop(
  deps: SeasonWorkerDeps,
  options: { season: Season; intervalMs: number; signal?: AbortSignal },
): Promise<void> {
  const wait = () => new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  let bootstrapped = false;
  while (!options.signal?.aborted) {
    if (!bootstrapped) {
      try {
        await bootstrapSeason(deps, options.season);
        bootstrapped = true;
      } catch (error) {
        deps.log?.(`season ${deps.seasonId} bootstrap failed, retrying: ${(error as Error).message}`);
        await wait();
        continue;
      }
    }
    const tick = await runSeasonTick(deps);
    if (tick.opened || tick.houseForecasts || tick.committed || tick.resolved) {
      deps.log?.(`season ${deps.seasonId} tick: ${JSON.stringify(tick)}`);
    }
    await wait();
  }
}
