import type { Address } from "viem";

import type { Job, JobPayment } from "./types.ts";

export type ManualRefundPlan =
  | { ok: true; key: string; from: Address; to: Address; amount: bigint }
  | { ok: false; reason: "not_an_agon_agent" | "delivered" | "already_refunded" | "not_paid" };

/// Decides whether a job of one of Agon's own agents may be refunded, from
/// which of Agon's seller wallets (`sellers`: the Lead, specialists, house
/// forecasters), to whom and how much. The wallet is the one the settled hire
/// paid. Uses `refund:<jobId>`, the key the Lead's own refund and the automatic
/// refund use, so a refund that already settled is never paid again.
export function manualRefundPlan(job: Job, payments: readonly JobPayment[], sellers: readonly Address[]): ManualRefundPlan {
  if (job.state === "delivered") return { ok: false, reason: "delivered" };
  const ours = new Set(sellers.map((a) => a.toLowerCase()));
  const key = `refund:${job.jobId}`;
  const refunds = payments.filter((p) => p.idempotencyKey === key);
  if (refunds.some((p) => p.status === "settled")) return { ok: false, reason: "already_refunded" };
  const attempt = refunds.find((p) => p.status === "failed" && ours.has(p.payer.toLowerCase()));
  if (attempt) return { ok: true, key, from: attempt.payer, to: attempt.payee, amount: attempt.amount };
  const hires = payments.filter((p) => p.jobId === job.jobId && p.kind === "hire" && p.status === "settled");
  const hire = hires.find((p) => ours.has(p.payee.toLowerCase()));
  if (!hire) return { ok: false, reason: hires.length > 0 ? "not_an_agon_agent" : "not_paid" };
  return { ok: true, key, from: hire.payee, to: hire.payer, amount: hire.amount };
}
