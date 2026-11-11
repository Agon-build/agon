import type { ScoringRaw, Season } from "./types.ts";

/// The seasons one deployment knows: the one it was started for and, when set, the one that
/// follows it. At the moment one ends the next begins, with no change to settings and no
/// restart, so no round is missed (owner decision 2026-11-11: Season 3's forecast track rolls
/// over from Season 2 on 19 November with no gap).

/// The season running at a moment: the latest one that has started. Before any has started it
/// is the first; after the last has ended it is still the last, so its record stays in view.
export function activeSeason(seasons: readonly Season[], at: Date): Season {
  if (seasons.length === 0) throw new Error("no season configured");
  const sorted = [...seasons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  let active = sorted[0]!;
  for (const s of sorted) if (s.startsAt.getTime() <= at.getTime()) active = s;
  return active;
}

/// The season before the active one, when the deployment knows it.
export function previousSeason(seasons: readonly Season[], at: Date): Season | null {
  const sorted = [...seasons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const index = sorted.findIndex((s) => s.seasonId === activeSeason(seasons, at).seasonId);
  return index > 0 ? sorted[index - 1]! : null;
}

/// The season after the active one, when one is set.
export function upcomingSeason(seasons: readonly Season[], at: Date): Season | null {
  const sorted = [...seasons].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const index = sorted.findIndex((s) => s.seasonId === activeSeason(seasons, at).seasonId);
  return sorted[index + 1] ?? null;
}

/// Why a following season cannot be used; empty when it can.
export function nextSeasonProblems(current: Pick<Season, "seasonId" | "endsAt">, next: Pick<Season, "seasonId" | "startsAt" | "endsAt">): string[] {
  const problems: string[] = [];
  if (next.seasonId === current.seasonId) problems.push("AGON_SEASON_NEXT_ID must differ from AGON_SEASON_ID");
  if (next.startsAt.getTime() < current.endsAt.getTime()) problems.push("the next season cannot start before the current one ends");
  if (next.endsAt.getTime() <= next.startsAt.getTime()) problems.push("AGON_SEASON_NEXT_ENDS_AT must be after the next season's start");
  return problems;
}

/// What the Arena part of the Agon score is computed from. A season that has just begun has no
/// settled forecast yet, and an agent's Arena record should not vanish for the days that takes:
/// until the running season has its first result, the season before it is used.
export async function scoringRawWithCarry(store: { scoringRaw(seasonId: bigint): Promise<ScoringRaw> }, seasons: readonly Season[], at: Date): Promise<ScoringRaw> {
  const raw = await store.scoringRaw(activeSeason(seasons, at).seasonId);
  const before = previousSeason(seasons, at);
  if (raw.results.length > 0 || !before) return raw;
  return store.scoringRaw(before.seasonId);
}
