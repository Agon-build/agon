import type { RatingRefusal } from "./job-rating-view";
import { agonCall } from "./stage";

/// User ratings from paid work: the person who paid rates a delivered job once, 1 to 5 stars.

export type JobRating = { stars: number; comment: string | null; createdAt: string };
export type { RatingRefusal };
export type RatingStatus = { canRate: true } | { canRate: false; reason: RatingRefusal; rating?: JobRating };

export const COMMENT_MAX = 280;

export function getJobRating(jobId: string): Promise<RatingStatus> {
  return agonCall<RatingStatus>(`/agon/app/jobs/${encodeURIComponent(jobId)}/rating`);
}

export function rateJob(jobId: string, stars: number, comment?: string): Promise<{ ok: true; rating: JobRating }> {
  const text = comment?.trim();
  return agonCall(`/agon/app/jobs/${encodeURIComponent(jobId)}/rating`, { body: { stars, ...(text ? { comment: text } : {}) } });
}

export async function getAgentReviews(listingReference: string): Promise<JobRating[]> {
  const out = await agonCall<{ items: JobRating[] }>(`/agon/app/ratings?reference=${encodeURIComponent(listingReference)}`);
  return out.items;
}
