import { hasRatedPart, matchCount, wordsOf, type CatalogEntry } from "./catalog.ts";
import { circleFits, type HireCategoryId } from "./categories.ts";
import { formatUsdc } from "../payments/bargain.ts";
import { byDelivery, type DeliveryRecord } from "./delivery-record.ts";
import { feeFor } from "./fee.ts";
import { kindFromWords, type Intent } from "./intent.ts";

/// recentlyFailed: the service took payment and sent no answer in the last day (audit H2).
/// delivery: what Agon has seen an outside service do with paid hires routed through it (never an Agon score).
export type Ranked = CatalogEntry & { fee: bigint; total: bigint; reason: string; recentlyFailed?: true; delivery?: { paid: number; delivered: number } };

/// Shown on a service that recently took payment and sent no answer.
export const RECENT_FAILURE_REASON = "Took payment without answering in the last day";
/// Said before anyone pays an outside service (audit H2, 2026-11-09).
export const OUTSIDE_PAYMENT_NOTE = "Paid to an outside service up front. Agon cannot refund it if no answer comes, and takes its fee only if one does.";

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
  const out: Ranked[] = ranked.slice(0, 4).map(({ e, fee, down }) => ({ ...e, fee, total: e.price + fee, ...(down ? { reason: RECENT_FAILURE_REASON, recentlyFailed: true as const } : { reason: reasonFor(e, e.price === minPrice && ranked.length > 1) }) }));
  return { pick: out[0]!, alternatives: out.slice(1) };
}

export type Group = "ranked" | "new" | "outside";
export type Choice = Ranked & { group: Group };
export type Groups = { ranked: Choice[]; fresh: Choice[]; outside: Choice[] };
export type GroupOptions = { feeBps: number; feeMin?: bigint; downranked: Set<string>; feeBpsFor?: (e: CatalogEntry) => number; fitted?: string[] | null; category: HireCategoryId; always?: string[]; deliveries?: Map<string, DeliveryRecord> };

/// Shown per group on Hire before the person asks for no more.
export const GROUP_MAX = 12;
/// Two Agon scores this close are treated as equal, so the lower total decides.
export const SCORE_TIE = 2;
const OUTSIDE_REASON = "Outside market, not ranked by Agon";
/// What an outside service's card says once Agon has routed paid hires to it.
export const outsideReason = (r: DeliveryRecord | undefined): string =>
  r && r.paid > 0 ? `Outside market, delivered ${r.delivered} of ${r.paid} paid ${r.paid === 1 ? "hire" : "hires"} through Agon` : OUTSIDE_REASON;

/// The person's choices for one request, in three groups. Agon agents with proof
/// are ranked by their Agon score (close scores by total, then speed). Agon agents
/// without proof yet are new, by total. Outside services are never ranked: they
/// must belong to the category. One that delivered at least half of three or more paid hires
/// comes first, one with no record next, one that delivered fewer last; then by total. A
/// service that recently failed after payment goes last in its group.
export function groupCandidates(entries: CatalogEntry[], intent: Intent, opts: GroupOptions): Groups {
  const words = wordsOf(intent.query);
  const needed = words.length <= 2 ? 1 : 2;
  const fitted = opts.fitted ? new Set(opts.fitted) : null;
  const always = new Set(opts.always ?? []);
  const fitting = entries.filter((e) => always.has(e.reference) || (fitted ? fitted.has(e.reference) : words.length > 0 && matchCount(e, words) >= needed));
  const priced = fitting.map((e) => {
    const fee = feeFor(e.price, opts.feeBpsFor ? opts.feeBpsFor(e) : opts.feeBps, opts.feeMin ?? 0n);
    // Shown without being named by the fit check (a market agent on a market check): after the ones that were named.
    return { e, fee, total: e.price + fee, down: opts.downranked.has(e.reference) ? 1 : 0, unnamed: intent.kind === "analysis" && fitted && fitted.size > 0 && !fitted.has(e.reference) ? 1 : 0 };
  });
  type P = (typeof priced)[number];
  const byTotal = (a: P, b: P) => (a.total < b.total ? -1 : a.total > b.total ? 1 : 0) || (a.e.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.e.latencyMs ?? Number.MAX_SAFE_INTEGER);
  const score = (p: P) => p.e.rating.proof?.score ?? p.e.rating.score ?? 0;
  const byScore = (a: P, b: P) => (Math.abs(score(a) - score(b)) <= SCORE_TIE ? byTotal(a, b) : score(b) - score(a));
  const done = (list: P[], group: Group, sort: (a: P, b: P) => number): Choice[] => {
    const minPrice = list.reduce((m, r) => (r.e.price < m ? r.e.price : m), list[0]?.e.price ?? 0n);
    return list
      .sort((a, b) => a.down - b.down || a.unnamed - b.unnamed || sort(a, b))
      .slice(0, GROUP_MAX)
      .map(({ e, fee, total, down }) => {
        const record = group === "outside" ? opts.deliveries?.get(e.reference) : undefined;
        return {
          ...e, fee, total, group,
          ...(record && record.paid > 0 ? { delivery: { paid: record.paid, delivered: record.delivered } } : {}),
          ...(down ? { reason: RECENT_FAILURE_REASON, recentlyFailed: true as const } : { reason: group === "outside" ? outsideReason(record) : reasonFor(e, e.price === minPrice && list.length > 1) }),
        };
      });
  };
  const agon = priced.filter((p) => p.e.source === "agon");
  return {
    ranked: done(agon.filter((p) => hasRatedPart(p.e.rating.proof ?? null)), "ranked", byScore),
    fresh: done(agon.filter((p) => !hasRatedPart(p.e.rating.proof ?? null)), "new", byTotal),
    outside: done(priced.filter((p) => p.e.source !== "agon" && circleFits(opts.category, p.e)), "outside", (a, b) => offKind(a.e, intent) - offKind(b.e, intent) || byDelivery(opts.deliveries?.get(a.e.reference), opts.deliveries?.get(b.e.reference)) || byTotal(a, b)),
  };
}
