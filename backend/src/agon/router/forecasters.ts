import type { Address } from "viem";

import { DEFAULT_HOUSE_AGENTS } from "../playground/seasons/house-agents.ts";
import type { LeaderboardRow } from "../playground/seasons/scoring.ts";
import type { SeasonEntry } from "../playground/seasons/types.ts";

export type ForecasterCandidate = {
  agentAddress: Address;
  displayName: string;
  house: boolean;
  providerRef: string;
  quoteUrl: string | null;
  forecastUrl: string;
  rating: number;
  ranked: boolean;
  forecastsResolved: number;
  reason: string;
};

export function houseKeyFor(displayName: string): string | null {
  const spec = DEFAULT_HOUSE_AGENTS.find((a) => a.displayName === displayName && a.kind === "model");
  return spec?.key ?? null;
}

/// Season 1 decides who gets forecasting work: ranked agents by rating, then
/// unranked ones. The market-copy benchmark is never hired, and an agent with
/// no reachable forecast endpoint is skipped.
export function rankForecasters(input: { rows: LeaderboardRow[]; entries: SeasonEntry[]; publicApiUrl: string; hireableHouseKeys: readonly string[] }): ForecasterCandidate[] {
  const entries = new Map(input.entries.map((e) => [e.agentAddress.toLowerCase(), e]));
  const candidates: ForecasterCandidate[] = [];
  for (const row of input.rows) {
    const entry = entries.get(row.agentAddress.toLowerCase());
    if (!entry) continue;
    let quoteUrl: string | null = null;
    let forecastUrl: string;
    let providerRef: string;
    if (row.house) {
      const key = houseKeyFor(row.displayName);
      if (!key || !input.hireableHouseKeys.includes(key)) continue;
      quoteUrl = `${input.publicApiUrl}/agon/agents/house/${key}/quote`;
      forecastUrl = `${input.publicApiUrl}/agon/agents/house/${key}/forecast`;
      providerRef = `house:${key}`;
    } else {
      if (!entry.forecastEndpoint) continue;
      forecastUrl = entry.forecastEndpoint;
      providerRef = `agent:${row.agentAddress.toLowerCase()}`;
    }
    candidates.push({
      agentAddress: row.agentAddress,
      displayName: row.displayName,
      house: row.house,
      providerRef,
      quoteUrl,
      forecastUrl,
      rating: row.rating,
      ranked: row.ranked,
      forecastsResolved: row.forecastsResolved,
      reason: row.ranked
        ? `Season 1 rank #${row.rank}, beats the market by ${row.meanSkill.toFixed(3)} over ${row.forecastsResolved} forecasts`
        : row.forecastsResolved === 0 ? "No scored forecasts yet" : `${row.forecastsResolved} scored forecasts so far, not ranked yet`,
    });
  }
  return candidates.sort((a, b) => Number(b.ranked) - Number(a.ranked) || b.rating - a.rating || b.forecastsResolved - a.forecastsResolved);
}
