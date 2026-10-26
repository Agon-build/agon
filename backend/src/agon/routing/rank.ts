import { matchCount, wordsOf, type CatalogEntry } from "./catalog.ts";
import { formatUsdc } from "../payments/bargain.ts";
import { feeFor } from "./fee.ts";
import { kindFromWords, type Intent } from "./intent.ts";

export type Ranked = CatalogEntry & { fee: bigint; total: bigint; reason: string };

const TIER_ORDER: Record<CatalogEntry["rating"]["tier"], number> = { scored: 0, verified: 1, listed: 2, unrated: 3 };

function reasonFor(e: CatalogEntry, cheapest: boolean): string {
  const trust = e.rating.tier === "scored" ? `Verified on Agon, score ${e.rating.score}`
    : e.rating.tier === "verified" ? "Verified on Agon, not scored yet"
    : e.rating.tier === "listed" ? "Listed on Agon, not verified yet"
    : `Not rated by Agon, from ${e.provider} on Circle`;
  return `${trust}${cheapest ? ", lowest price for this task" : `, ${formatUsdc(e.price)} USDC`}`;
}

/// A market check ("is it worth trading?") wants a verdict on the market, so an
/// agent that describes itself as giving a probability fits it less well.
const offKind = (e: CatalogEntry, intent: Intent) => (intent.kind === "analysis" && kindFromWords(`${e.name} ${e.description}`) === "forecast" ? 1 : 0);

/// The owner's rule: fit first; then rated Agon agents, unrated Agon agents,
/// then Circle; within a tier the lower total, then the faster answer. A
/// service that recently failed after payment goes last.
/// `fitted` is the model's judgement of which services do the job; without it,
/// the words decide: one shared word for a one or two word request, two for a longer one.
export function rankCandidates(entries: CatalogEntry[], intent: Intent, opts: { feeBps: number; feeMin?: bigint; downranked: Set<string>; feeBpsFor?: (e: CatalogEntry) => number; fitted?: string[] | null }): { pick: Ranked | null; alternatives: Ranked[] } {
  const words = wordsOf(intent.query);
  const needed = words.length <= 2 ? 1 : 2;
  const fitted = opts.fitted ? new Set(opts.fitted) : null;
  const fitting = fitted ? entries.filter((e) => fitted.has(e.reference)) : words.length === 0 ? [] : entries.filter((e) => matchCount(e, words) >= needed);
  if (fitting.length === 0) return { pick: null, alternatives: [] };
  const ranked = fitting
    // No fee address for a network means no fee is charged there, so none is shown.
    .map((e) => ({ e, fee: feeFor(e.price, opts.feeBpsFor ? opts.feeBpsFor(e) : opts.feeBps, opts.feeMin ?? 0n), down: opts.downranked.has(e.reference) ? 1 : 0, off: offKind(e, intent) }))
    .sort((a, b) =>
      a.down - b.down
      || a.off - b.off
      || TIER_ORDER[a.e.rating.tier] - TIER_ORDER[b.e.rating.tier]
      || (a.e.price + a.fee < b.e.price + b.fee ? -1 : a.e.price + a.fee > b.e.price + b.fee ? 1 : 0)
      || (a.e.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.e.latencyMs ?? Number.MAX_SAFE_INTEGER));
  const minPrice = ranked.reduce((m, r) => (r.e.price < m ? r.e.price : m), ranked[0]!.e.price);
  const out: Ranked[] = ranked.slice(0, 4).map(({ e, fee }) => ({ ...e, fee, total: e.price + fee, reason: reasonFor(e, e.price === minPrice && ranked.length > 1) }));
  return { pick: out[0]!, alternatives: out.slice(1) };
}
