import { computeLeaderboard, type LeaderboardRow } from "../playground/seasons/scoring.ts";
import type { ScoringRaw } from "../playground/seasons/types.ts";

type SeasonSource = { store: { scoringRaw(seasonId: bigint): Promise<ScoringRaw> }; season: { seasonId: bigint } };

/// Reads the Season leaderboard for channels, cached so a busy stage page
/// never recomputes scores on every poll.
export function createLeaderboardReader(season: SeasonSource | null, ttlMs = 60_000, nowMs: () => number = Date.now): (limit: number) => Promise<LeaderboardRow[] | null> {
  let cached: { at: number; rows: LeaderboardRow[] } | null = null;
  return async (limit) => {
    if (!season) return null;
    if (!cached || nowMs() - cached.at >= ttlMs) cached = { at: nowMs(), rows: computeLeaderboard(await season.store.scoringRaw(season.season.seasonId)) };
    return cached.rows.slice(0, Math.max(1, Math.min(limit, 50)));
  };
}
