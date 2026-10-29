import type { ChatButton } from "../chat/types.ts";
import type { RateOutcome } from "../../ratings/service.ts";

/// The stars under a delivery message send "rate:<job id>:<stars>" (43 bytes, under Telegram's 64).
export const RATE_TAP = /^rate:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-5])$/i;

/// The job a delivery row can be rated for: only a delivered job, never a refund or a watch alert.
export function ratableJobOf(eventKey: string): string | null {
  const m = /^job:([0-9a-f-]{36}):delivered$/i.exec(eventKey);
  return m ? m[1]!.toLowerCase() : null;
}

export function rateButtons(jobId: string): ChatButton[] {
  return [1, 2, 3, 4, 5].map((n) => ({ label: `${n} ★`, data: `rate:${jobId}:${n}` }));
}

export function rateReply(out: RateOutcome): string {
  if (out.ok) return `Thanks. You rated this job ${out.rating.stars} of 5.`;
  switch (out.reason) {
    case "already_rated": return "You already rated this job.";
    case "too_late": return "Ratings close 14 days after delivery.";
    case "not_yours": return "Only the person who paid for this job can rate it.";
    case "not_delivered": return "Only a delivered job can be rated.";
    default: return "This job can't be rated.";
  }
}
