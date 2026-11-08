import type { LeaderboardRow, SeasonEntry, SeasonInfo } from "./stage-types.ts";

const HOUR = 3_600_000;
const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/// Rounds are numbered from 0: round r opens at startsAt + r × roundHours, the same numbers the commits on Arc use.
export function seasonProgress(s: SeasonInfo): { round: number; total: number; nextRoundAt: string } {
  const start = Date.parse(s.startsAt);
  const step = s.roundHours * HOUR;
  const total = Math.floor((Date.parse(s.endsAt) - start) / step);
  const round = s.currentRound === null ? 0 : Number(s.currentRound);
  const next = s.currentRound === null ? start : start + (round + 1) * step;
  return { round, total, nextRoundAt: new Date(next).toISOString() };
}

/// "Beacon (house, evidence first)" reads as Beacon, built by Agon, evidence first. The market copy is the benchmark.
export function arenaName(displayName: string): { name: string; note: string; benchmark: boolean } {
  const m = /^(.*?)\s*\((house)(?:,\s*([^)]*))?\)\s*$/i.exec(displayName);
  if (!m) return { name: displayName.trim(), note: "", benchmark: false };
  const name = m[1].trim();
  const extra = (m[3] ?? "").trim();
  if (extra.toLowerCase() === "market copy") return { name, note: "Benchmark. Copies the market price.", benchmark: true };
  if (!extra) return { name, note: "Built by Agon", benchmark: false };
  return { name, note: `Built by Agon. ${extra[0].toUpperCase()}${extra.slice(1)}.`, benchmark: false };
}

/// Pixels for one side of the skill bar: full at a skill of 0.01, never hidden when the skill is not zero.
export function skillBarWidth(skill: number, half = 80): number {
  if (!Number.isFinite(skill) || skill === 0) return 0;
  return Math.min(half, Math.max(2, Math.round((Math.abs(skill) / 0.01) * half)));
}

/// One line under the leaderboard: who beats the market price, or who is closest.
export function marketNote(rows: LeaderboardRow[]): string {
  if (rows.length === 0) return "Not available right now";
  const scored = rows.filter((r) => !arenaName(r.displayName).benchmark && r.forecastsResolved > 0);
  if (scored.length === 0) return "No forecasts scored yet this season.";
  const best = scored.reduce((a, b) => (b.meanSkill > a.meanSkill ? b : a));
  const beating = scored.filter((r) => r.meanSkill > 0).length;
  const name = arenaName(best.displayName).name;
  if (beating === 0) return `No agent beats the market price yet this season. ${name} is closest.`;
  return `${beating} ${beating === 1 ? "agent beats" : "agents beat"} the market price this season. ${name} leads.`;
}

/// "Rounds open at 00, 06, 12 and 18 UTC." when rounds fit a day evenly.
export function roundClock(s: SeasonInfo): string {
  if (s.roundHours <= 0 || 24 % s.roundHours !== 0) return `A new round opens every ${s.roundHours} hours.`;
  const first = new Date(s.startsAt).getUTCHours();
  const hours = Array.from({ length: 24 / s.roundHours }, (_, i) => (first + i * s.roundHours) % 24).sort((a, b) => a - b).map((h) => String(h).padStart(2, "0"));
  const list = hours.length === 1 ? hours[0] : `${hours.slice(0, -1).join(", ")} and ${hours[hours.length - 1]}`;
  return `Rounds open at ${list} UTC.`;
}

/// "Started 22 Oct. Four weeks."
export function seasonSpan(s: SeasonInfo): string {
  const started = new Date(s.startsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const days = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / (24 * HOUR));
  const weeks = days / 7;
  const length = Number.isInteger(weeks) && weeks >= 1 && weeks < WORDS.length ? `${WORDS[weeks]} ${weeks === 1 ? "week" : "weeks"}` : `${days} ${days === 1 ? "day" : "days"}`;
  return `Started ${started}. ${length}.`;
}

/// Agent page links by agent address (lower case), through each entry's ERC-8004 id and its listing.
export function agentPageHrefs(entries: SeasonEntry[], scores: { agentId: string; listingReference: string }[]): Record<string, string> {
  const refs = new Map(scores.map((s) => [s.agentId, s.listingReference]));
  const out: Record<string, string> = {};
  for (const e of entries) {
    const ref = e.erc8004AgentId ? refs.get(e.erc8004AgentId) : undefined;
    if (ref) out[e.agentAddress.toLowerCase()] = `/agents/${encodeURIComponent(ref)}`;
  }
  return out;
}
