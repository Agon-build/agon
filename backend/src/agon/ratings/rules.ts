import type { Job } from "../payments/types.ts";

/// User ratings from paid work: the person who paid rates a delivered job once,
/// within 14 days of delivery, with 1 to 5 stars and an optional short comment.

export const RATE_WINDOW_MS = 14 * 86_400_000;
export const COMMENT_MAX = 280;

export type Rating = { jobId: string; providerRef: string; stars: number; comment: string | null; createdAt: Date };
export type RatingRefusal = "not_found" | "not_yours" | "not_delivered" | "too_late" | "already_rated";
export type RatingStatus = { canRate: true } | { canRate: false; reason: RatingRefusal; rating?: Rating };

/// A rating is in stars; the Agon score's paid part is 0 to 100.
export const starsToScore = (stars: number) => (stars - 1) * 25;

/// Whether `raterRefs` (the buyer refs the person signs in as) may rate this job now.
/// Only a top-level job counts: a job the Lead bought for you is the Lead's own work.
export function rateCheck(job: Job | null, raterRefs: readonly string[], existing: Rating | null, now: Date): RatingStatus {
  if (!job || job.depth !== 0) return { canRate: false, reason: "not_found" };
  if (!raterRefs.includes(job.buyerRef)) return { canRate: false, reason: "not_yours" };
  if (existing) return { canRate: false, reason: "already_rated", rating: existing };
  if (job.state !== "delivered") return { canRate: false, reason: "not_delivered" };
  // A delivered job is not written again, so its last update is when it was delivered.
  if (now.getTime() - job.updatedAt.getTime() > RATE_WINDOW_MS) return { canRate: false, reason: "too_late" };
  return { canRate: true };
}

/// The comment as stored: control characters out, spaces collapsed, at most 280 characters; empty is none.
export function cleanComment(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, COMMENT_MAX) : null;
}

/// Totals per provider ref, as read from the store.
export type RefTotals = { providerRef: string; n: number; scoreSum: number };
export type ScoredListing = { agentId: string; listingReference: string };

/// The provider refs a listing's jobs are recorded under: the listing itself, and for
/// Agon's own agents the ref their direct hires use (the Lead is "agent:lead").
export function refsForListing(listing: ScoredListing, firstParty: readonly { agentId: string; providerRef: string }[]): string[] {
  return [listing.listingReference, ...firstParty.filter((f) => f.agentId === listing.agentId).map((f) => f.providerRef)];
}

/// The paid part per agent: the mean score of every rating on any of its refs.
export function paidAverages(
  listings: readonly ScoredListing[],
  firstParty: readonly { agentId: string; providerRef: string }[],
  totals: readonly RefTotals[],
): Map<string, { n: number; avg: number }> {
  const byRef = new Map(totals.map((t) => [t.providerRef, t]));
  // One agent may have several listings: each ref is counted once per agent.
  const refsByAgent = new Map<string, Set<string>>();
  for (const listing of listings) {
    const refs = refsByAgent.get(listing.agentId) ?? new Set<string>();
    for (const ref of refsForListing(listing, firstParty)) refs.add(ref);
    refsByAgent.set(listing.agentId, refs);
  }
  const out = new Map<string, { n: number; avg: number }>();
  for (const [agentId, refs] of refsByAgent) {
    let n = 0;
    let sum = 0;
    for (const ref of refs) {
      const t = byRef.get(ref);
      if (t) { n += t.n; sum += t.scoreSum; }
    }
    if (n > 0) out.set(agentId, { n, avg: sum / n });
  }
  return out;
}
