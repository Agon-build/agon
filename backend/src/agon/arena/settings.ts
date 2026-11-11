import { SEASON_DAYS } from "./types.ts";

/// Arena settings for the Research track, read from the environment without ever
/// throwing. Spending is off unless AGON_ARENA_RESEARCH is "on"; a mistake in any
/// other value keeps it off and says why.

export type ArenaSettings = {
  on: true;
  seasonId: bigint;
  startsAt: Date;
  endsAt: Date;
  /** The most Agon pays one agent for one task, in USDC base units. */
  maxHire: bigint;
  /** The most the track spends in one UTC day, in USDC base units. */
  maxDay: bigint;
  /** Decides when each round opens, so nobody outside can predict it. */
  seed: string;
};

const USDC = /^\d{1,9}(\.\d{1,6})?$/;
const usdc = (raw: string): bigint | null => {
  if (!USDC.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
};
const instant = (raw: string | undefined): Date | null => {
  if (!raw || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function readArenaSettings(env: Record<string, string | undefined>): { settings: ArenaSettings | null; problems: string[] } {
  if (env.AGON_ARENA_RESEARCH !== "on") return { settings: null, problems: [] };
  const problems: string[] = [];

  const seed = env.AGON_ARENA_SEED ?? "";
  if (seed.length < 16) problems.push("AGON_ARENA_SEED must be at least 16 characters");

  const idRaw = env.AGON_ARENA_RESEARCH_SEASON_ID ?? "20001";
  const seasonId = /^[1-9]\d{0,17}$/.test(idRaw) ? BigInt(idRaw) : null;
  if (seasonId === null) problems.push("AGON_ARENA_RESEARCH_SEASON_ID must be a positive integer");

  const startsAt = instant(env.AGON_ARENA_RESEARCH_STARTS_AT);
  if (!startsAt) problems.push("AGON_ARENA_RESEARCH_STARTS_AT must be a time such as 2026-11-20T00:00:00Z");
  const endsAt = env.AGON_ARENA_RESEARCH_ENDS_AT === undefined
    ? startsAt && new Date(startsAt.getTime() + SEASON_DAYS * 86_400_000)
    : instant(env.AGON_ARENA_RESEARCH_ENDS_AT);
  if (env.AGON_ARENA_RESEARCH_ENDS_AT !== undefined && !endsAt) problems.push("AGON_ARENA_RESEARCH_ENDS_AT must be a time such as 2026-12-18T00:00:00Z");
  if (startsAt && endsAt && endsAt <= startsAt) problems.push("AGON_ARENA_RESEARCH_ENDS_AT must be after the start");

  const maxHire = usdc(env.AGON_ARENA_MAX_HIRE_USDC ?? "0.50");
  if (maxHire === null || maxHire === 0n) problems.push("AGON_ARENA_MAX_HIRE_USDC must be a USDC amount such as 0.50");
  const maxDay = usdc(env.AGON_ARENA_MAX_DAY_USDC ?? "5");
  if (maxDay === null || maxDay === 0n) problems.push("AGON_ARENA_MAX_DAY_USDC must be a USDC amount such as 5");

  if (problems.length > 0 || seasonId === null || !startsAt || !endsAt || !maxHire || !maxDay) return { settings: null, problems };
  return { settings: { on: true, seasonId, startsAt, endsAt, maxHire, maxDay, seed }, problems };
}
