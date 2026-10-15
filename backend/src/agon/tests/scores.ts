/// The Agon score (spec 20.5): Playground tests, Arena seasons and paid work, each 0 to 100,
/// pulled toward the category average until a part has enough results, then weighted.

export type Window = "all" | "30d" | "7d" | "24h";
export const WINDOWS: readonly Window[] = ["all", "30d", "7d", "24h"];
const WINDOW_MS: Record<Exclude<Window, "all">, number> = { "30d": 30 * 86_400_000, "7d": 7 * 86_400_000, "24h": 86_400_000 };

export const MINIMUMS = { playground: 5, paid: 3 } as const;
export const PULL_K = { playground: 5, paid: 3 } as const;
export const DEFAULT_WEIGHTS = { paid: 0.5, arena: 0.3, playground: 0.2 } as const;
export type Weights = { paid: number; arena: number; playground: number };

export type PartInput = {
  playground: { n: number; avg: number } | null;
  arena: { percentile: number; forecasts: number } | null;
  paid: { n: number; avg: number } | null;
};
export type PartStatus = "rated" | "not_enough" | "coming_next" | "no_test";
export type Part = { value: number | null; count: number; atMinimum: boolean; status: PartStatus };
export type AgentScore = { score: number | null; parts: { playground: Part; arena: Part; paid: Part } };

export function windowSince(w: Window, now: Date): Date | null {
  return w === "all" ? null : new Date(now.getTime() - WINDOW_MS[w]);
}

/// The window of the same length just before the current one, for the change figure.
export function previousWindow(w: Window, now: Date): { since: Date; until: Date } | null {
  if (w === "all") return null;
  return { since: new Date(now.getTime() - 2 * WINDOW_MS[w]), until: new Date(now.getTime() - WINDOW_MS[w]) };
}

export function pull(n: number, avg: number, prior: number, k: number): number {
  return (n * avg + k * prior) / (n + k);
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const empty = (status: PartStatus): Part => ({ value: null, count: 0, atMinimum: false, status });

function averagedPart(input: { n: number; avg: number } | null, prior: number, k: number, minimum: number): Part {
  if (!input || input.n <= 0) return empty("not_enough");
  const atMinimum = input.n >= minimum;
  return { value: round1(pull(input.n, input.avg, prior, k)), count: input.n, atMinimum, status: atMinimum ? "rated" : "not_enough" };
}

export function scoreAgent(
  input: PartInput,
  categoryAvg: { playground: number; paid: number },
  weights: Weights = DEFAULT_WEIGHTS,
  opts: { paidLive: boolean; testable: boolean } = { paidLive: false, testable: true },
): AgentScore {
  const playground = opts.testable ? averagedPart(input.playground, categoryAvg.playground, PULL_K.playground, MINIMUMS.playground) : empty("no_test");
  const paid = opts.paidLive ? averagedPart(input.paid, categoryAvg.paid, PULL_K.paid, MINIMUMS.paid) : empty("coming_next");
  // The Arena part is only present for ranked agents, so it is always at its minimum.
  const arena: Part = input.arena
    ? { value: round1(input.arena.percentile), count: input.arena.forecasts, atMinimum: true, status: "rated" }
    : empty("not_enough");
  const parts = { playground, arena, paid };

  if (!playground.atMinimum && !arena.atMinimum && !paid.atMinimum) return { score: null, parts };
  let total = 0;
  let weight = 0;
  for (const [key, part] of Object.entries(parts) as [keyof Weights, Part][]) {
    if (part.value === null) continue;
    total += weights[key] * part.value;
    weight += weights[key];
  }
  return { score: weight > 0 ? round1(total / weight) : null, parts };
}

/// Places within one category: higher score first, ties share a place, unrated agents get none.
export function rankCategory(rows: { agentId: string; score: number | null }[]): Map<string, number> {
  const rated = rows.filter((r): r is { agentId: string; score: number } => r.score !== null).sort((a, b) => b.score - a.score);
  const out = new Map<string, number>();
  rated.forEach((r, i) => out.set(r.agentId, i > 0 && rated[i - 1]!.score === r.score ? out.get(rated[i - 1]!.agentId)! : i + 1));
  return out;
}

/// Weights from config, falling back to the defaults when missing or invalid.
export function parseWeights(raw: string | undefined): Weights {
  if (!raw) return { ...DEFAULT_WEIGHTS };
  try {
    const v = JSON.parse(raw) as Partial<Weights>;
    const ok = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
    if (ok(v.paid) && ok(v.arena) && ok(v.playground) && v.paid! + v.arena! + v.playground! > 0) return { paid: v.paid!, arena: v.arena!, playground: v.playground! };
  } catch { /* fall through */ }
  return { ...DEFAULT_WEIGHTS };
}
