import type { Job } from "../payments/types.ts";
import { cleanComment, rateCheck, type Rating, type RatingRefusal, type RatingStatus } from "./rules.ts";
import type { RatingsStore } from "./store.ts";

export type RateOutcome = { ok: true; rating: Rating } | { ok: false; reason: RatingRefusal | "invalid_stars" };

export type Ratings = {
  status(jobId: string, raterRefs: readonly string[]): Promise<RatingStatus>;
  rate(jobId: string, raterRefs: readonly string[], stars: number, comment?: unknown): Promise<RateOutcome>;
  /** The newest commented ratings for a listing, for its page. */
  recentFor(listingReference: string, limit?: number): Promise<Rating[]>;
};

export function createRatings(deps: {
  store: RatingsStore;
  getJob(jobId: string): Promise<Job | null>;
  /** Every provider ref a listing's jobs may carry (see refsForListing). */
  refsFor(listingReference: string): Promise<string[]>;
  now: () => Date;
}): Ratings {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const load = async (jobId: string) => (UUID.test(jobId) ? deps.getJob(jobId.toLowerCase()) : null);

  return {
    async status(jobId, raterRefs) {
      const job = await load(jobId);
      const existing = job ? await deps.store.get(job.jobId) : null;
      return rateCheck(job, raterRefs, existing, deps.now());
    },

    async rate(jobId, raterRefs, stars, comment) {
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, reason: "invalid_stars" };
      const job = await load(jobId);
      const now = deps.now();
      const check = rateCheck(job, raterRefs, job ? await deps.store.get(job.jobId) : null, now);
      if (!check.canRate) return { ok: false, reason: check.reason };
      const rating: Rating = { jobId: job!.jobId, providerRef: job!.providerRef, stars, comment: cleanComment(comment), createdAt: now };
      // A second tap racing the first loses at the primary key.
      const added = await deps.store.add({ ...rating, rater: job!.buyerRef, network: job!.network, at: now });
      return added ? { ok: true, rating } : { ok: false, reason: "already_rated" };
    },

    async recentFor(listingReference, limit = 10) {
      return deps.store.recent(await deps.refsFor(listingReference), Math.min(Math.max(limit, 1), 20));
    },
  };
}
