import type { Address } from "viem";

import type { Job, JobPayment } from "./types.ts";

export type ManualRefundPlan =
  | { ok: true; key: string; to: Address; amount: bigint }
  | { ok: false; reason: "not_a_lead_job" | "delivered" | "already_refunded" | "not_paid" };

/// Decides whether an operator may refund a Lead job by hand, and to whom.
/// Uses the Lead's own refund key, so a refund that already settled (by the
/// Lead or by an earlier manual run) is never paid again.
export function manualRefundPlan(job: Job, payments: readonly JobPayment[], leadAddress: Address): ManualRefundPlan {
  if (job.providerRef !== "agent:lead") return { ok: false, reason: "not_a_lead_job" };
  if (job.state === "delivered") return { ok: false, reason: "delivered" };
  const key = `refund:${job.jobId}`;
  const refunds = payments.filter((p) => p.idempotencyKey === key);
  if (refunds.some((p) => p.status === "settled")) return { ok: false, reason: "already_refunded" };
  const attempt = refunds.find((p) => p.status === "failed");
  if (attempt) return { ok: true, key, to: attempt.payee, amount: attempt.amount };
  const lead = leadAddress.toLowerCase();
  const hire = payments.find((p) => p.kind === "hire" && p.status === "settled" && p.payee.toLowerCase() === lead);
  if (!hire) return { ok: false, reason: "not_paid" };
  return { ok: true, key, to: hire.payer, amount: hire.amount };
}
