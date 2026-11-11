import type { ArenaTask } from "../../types.ts";
import { normalise } from "./values.ts";

/// Research tasks about a public market record: facts Polymarket publishes for one market.

export type MarketRecord = { slug: string; question: string; endDate: Date | null; outcomes: string[]; yesNo: boolean };
export type MarketReader = {
  /** One market's record by its slug or link; null when it cannot be read. */
  record(ref: string): Promise<MarketRecord | null>;
  /** Slugs of open markets to draw tasks from. */
  candidates(): Promise<string[]>;
};

export const MARKET_KINDS = ["market-end-date", "market-second-outcome"] as const;
export type MarketKind = (typeof MARKET_KINDS)[number];

const WORDINGS: Record<MarketKind, readonly ((slug: string) => string)[]> = {
  "market-end-date": [
    (s) => `What end date does Polymarket list for the market "${s}"? Reply with the date as YYYY-MM-DD.`,
    (s) => `Look up the Polymarket market "${s}" and report its listed end date (UTC) as YYYY-MM-DD.`,
    (s) => `On Polymarket, when is the market "${s}" set to end? Give the UTC date as YYYY-MM-DD.`,
  ],
  "market-second-outcome": [
    (s) => `The Polymarket market "${s}" has two outcomes. What is the second one called? Reply with the name only.`,
    (s) => `Look up the Polymarket market "${s}" and name its second listed outcome. Give just the name.`,
    (s) => `On Polymarket, which outcome is listed second in the market "${s}"? Answer with its name only.`,
  ],
};

export const isMarketKind = (kind: string): kind is MarketKind => (MARKET_KINDS as readonly string[]).includes(kind);

/// The truth of a kind for a record, or null when the record does not have one.
export function marketTruth(kind: MarketKind, record: MarketRecord): string | null {
  if (kind === "market-end-date") return record.endDate ? record.endDate.toISOString().slice(0, 10) : null;
  // "No" as the second of Yes and No is not a question worth asking.
  if (record.yesNo || record.outcomes.length !== 2) return null;
  return normalise("name", record.outcomes[1]!);
}

/// One market task, or null when no unused market could be read in a few tries.
export async function marketTask(deps: { markets: MarketReader; pick: (key: string, n: number) => number }, key: string, used: ReadonlySet<string>): Promise<ArenaTask | null> {
  const slugs = await deps.markets.candidates().catch(() => [] as string[]);
  if (slugs.length === 0) return null;
  const first = deps.pick(`${key}:kind`, MARKET_KINDS.length);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const slug = slugs[deps.pick(`${key}:market:${attempt}`, slugs.length)]!;
    const record = await deps.markets.record(slug).catch(() => null);
    if (!record) continue;
    // Try the chosen kind, then the other one, so a Yes or No market still gives an end-date task.
    for (const kind of [MARKET_KINDS[first]!, MARKET_KINDS[1 - first]!]) {
      const taskId = `${kind}:${record.slug}`;
      const truth = marketTruth(kind, record);
      if (!truth || used.has(taskId)) continue;
      const wordings = WORDINGS[kind];
      return { taskId, family: kind, question: wordings[deps.pick(`${key}:wording`, wordings.length)]!(record.slug), valueType: kind === "market-end-date" ? "date" : "name", truth };
    }
  }
  return null;
}

/// The truth of a market task as the record reads now, or null when it cannot be read.
export async function marketTruthNow(markets: MarketReader, kind: MarketKind, subject: string): Promise<string | null> {
  const record = await markets.record(subject).catch(() => null);
  return record ? marketTruth(kind, record) : null;
}
