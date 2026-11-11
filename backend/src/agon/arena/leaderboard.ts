import { RANKED_AGENTS, RANKED_TASKS, type ArenaRaw, type Entrant } from "./types.ts";

/// A track's leaderboard: each agent's mean task score over committed rounds.
/// Correctness decides the order; the faster agent wins a tie; price is not counted.

export type ArenaRow = {
  agentId: string;
  listingReference: string;
  name: string;
  firstParty: boolean;
  /** Mean score of the agent's scored tasks, 0 to 100. Null when it has none. */
  mean: number | null;
  scored: number;
  /** Median time to deliver, in milliseconds. Null when nothing was delivered. */
  medianMs: number | null;
  /** True from 15 scored tasks. */
  ranked: boolean;
  rank: number | null;
  /** Why the agent is not being sent tasks, from its latest round. */
  note: "over_price" | "cannot_take" | null;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
};
/// Higher mean first; on equal means the faster agent; an agent with no time goes last.
const NO_TIME = Number.MAX_SAFE_INTEGER;
const better = (a: ArenaRow, b: ArenaRow): number => (b.mean ?? -1) - (a.mean ?? -1) || (a.medianMs ?? NO_TIME) - (b.medianMs ?? NO_TIME);

export function arenaLeaderboard(raw: ArenaRaw, since: Date | null = null, until: Date | null = null): { ranked: boolean; rows: ArenaRow[] } {
  // Only committed rounds count: an answer is not a result until Arc holds its round.
  const committed = new Set(raw.rounds.filter((r) => r.state === "committed" && r.blockTime && (!since || r.blockTime >= since) && (!until || r.blockTime < until)).map((r) => r.round));

  // Who an agent is, and why it is left out, come from the latest round it appeared in.
  const latest = new Map<string, Entrant & { round: bigint }>();
  for (const e of raw.entrants) {
    const seen = latest.get(e.agentId);
    if (!seen || e.round >= seen.round) latest.set(e.agentId, e);
  }

  const scores = new Map<string, number[]>();
  const times = new Map<string, number[]>();
  for (const a of raw.answers) {
    if (!committed.has(a.round) || a.outcome === "void" || a.score === null) continue;
    scores.set(a.agentId, [...(scores.get(a.agentId) ?? []), a.score]);
    if (a.outcome === "delivered" && a.durationMs !== null) times.set(a.agentId, [...(times.get(a.agentId) ?? []), a.durationMs]);
  }

  const rows: ArenaRow[] = [...latest.values()].map((e) => {
    const own = scores.get(e.agentId) ?? [];
    return {
      agentId: e.agentId, listingReference: e.listingReference, name: e.name, firstParty: e.firstParty,
      mean: own.length ? round1(own.reduce((s, v) => s + v, 0) / own.length) : null,
      scored: own.length, medianMs: median(times.get(e.agentId) ?? []), ranked: own.length >= RANKED_TASKS, rank: null,
      note: e.status === "entered" ? null : e.status,
    };
  });

  const ranked = rows.filter((r) => r.ranked).sort((a, b) => better(a, b) || (a.agentId < b.agentId ? -1 : 1));
  // Agents level on both score and time share a place.
  ranked.forEach((row, i) => { row.rank = i > 0 && better(ranked[i - 1]!, row) === 0 ? ranked[i - 1]!.rank : i + 1; });
  const rest = rows.filter((r) => !r.ranked).sort((a, b) => better(a, b) || b.scored - a.scored || (a.agentId < b.agentId ? -1 : 1));
  return { ranked: ranked.length >= RANKED_AGENTS, rows: [...ranked, ...rest] };
}

/// The Arena part of the Agon score for the track's category: each ranked agent's place as a
/// percentile (100 best). Null while the track has fewer than three ranked agents, so nobody
/// earns the part by standing alone.
export function trackPercentiles(raw: ArenaRaw, since: Date | null, until: Date | null): Map<string, { percentile: number; forecasts: number }> | null {
  const board = arenaLeaderboard(raw, since, until);
  if (!board.ranked) return null;
  const ranked = board.rows.filter((r) => r.ranked);
  return new Map(ranked.map((row) => {
    const below = ranked.filter((r) => r.rank! > row.rank!).length;
    return [row.agentId, { percentile: Math.round((100 * below) / (ranked.length - 1)), forecasts: row.scored }];
  }));
}
