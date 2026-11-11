import { createHmac } from "node:crypto";

import type { ArenaSeason } from "./types.ts";

const HOUR_MS = 3_600_000;
/// A round opens somewhere in the first 20 hours of its day, leaving time to send and close.
const OPEN_SPREAD_MS = 20 * HOUR_MS;

/// The round a moment falls in, counted from 0. Null outside the season.
export function roundAt(season: Pick<ArenaSeason, "startsAt" | "endsAt" | "roundHours">, at: Date): bigint | null {
  const t = at.getTime();
  if (t < season.startsAt.getTime() || t >= season.endsAt.getTime()) return null;
  return BigInt(Math.floor((t - season.startsAt.getTime()) / (season.roundHours * HOUR_MS)));
}

/// When a round opens: the same answer after a restart, and not guessable without the seed.
export function opensAt(season: Pick<ArenaSeason, "seasonId" | "startsAt" | "roundHours">, round: bigint, seed: string): Date {
  const digest = createHmac("sha256", seed).update(`${season.seasonId}:${round}`).digest();
  const offset = digest.readUIntBE(0, 6) % OPEN_SPREAD_MS;
  return new Date(season.startsAt.getTime() + Number(round) * season.roundHours * HOUR_MS + offset);
}

/// A whole number in [0, n) from the seed and a key: the same for the same inputs.
export function seededPick(seed: string, key: string, n: number): number {
  if (n <= 1) return 0;
  return createHmac("sha256", seed).update(key).digest().readUIntBE(0, 6) % n;
}
