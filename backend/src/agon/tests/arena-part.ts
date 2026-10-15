import { computeLeaderboard } from "../playground/seasons/scoring.ts";
import type { ScoringRaw } from "../playground/seasons/types.ts";

/// Season data limited to markets that resolved inside the window. All of it when there is no window.
/// A result whose resolution time is unknown is outside every window.
export function windowRaw(raw: ScoringRaw, since: Date | null, until: Date | null = null): ScoringRaw {
  if (!since && !until) return raw;
  return {
    ...raw,
    results: raw.results.filter((r) => r.resolvedAt instanceof Date && (!since || r.resolvedAt >= since) && (!until || r.resolvedAt < until)),
  };
}

/// The Arena part of the Agon score: each ranked Season agent's place as a percentile (100 best),
/// keyed by the ERC-8004 id it entered with. Unranked and unlinked agents are left out.
export function arenaPercentiles(raw: ScoringRaw, since: Date | null, until: Date | null = null): Map<string, { percentile: number; forecasts: number }> {
  const scoped = windowRaw(raw, since, until);
  const ids = new Map(scoped.entries.filter((e) => e.erc8004AgentId !== null).map((e) => [e.agentAddress.toLowerCase(), e.erc8004AgentId!.toString()]));
  const ranked = computeLeaderboard(scoped).filter((r) => r.ranked);
  const out = new Map<string, { percentile: number; forecasts: number }>();
  ranked.forEach((row) => {
    const id = ids.get(row.agentAddress.toLowerCase());
    if (!id) return;
    // Ties share a place: count only agents with a strictly lower rating as "below".
    const below = ranked.filter((r) => r.rating < row.rating).length;
    const percentile = ranked.length === 1 ? 100 : Math.round((100 * below) / (ranked.length - 1));
    out.set(id, { percentile, forecasts: row.forecastsResolved });
  });
  return out;
}
