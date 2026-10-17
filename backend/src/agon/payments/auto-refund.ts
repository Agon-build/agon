import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../network.ts";
import { manualRefundPlan } from "./manual-refund.ts";
import type { PaymentsStore } from "./types.ts";

const REFUNDABLE = new Set(["delivery_failed", "delivery_unknown"]);

/// Refunds Lead hires whose payment moved on chain but whose answer never
/// arrived (for example a settlement that confirmed after the seller gave up).
/// Waits so the Lead's own refund runs first, uses the Lead's refund key so a
/// job is never paid back twice, and leaves a failed refund for the operator.
export async function refundUndeliveredLeadHires(
  deps: {
    store: PaymentsStore;
    leadAddress: Address;
    network: AgonNetworkId;
    now: () => Date;
    refund: (to: Address, amount: bigint, key: string) => Promise<Hex>;
    log?: (message: string) => void;
  },
  input: { olderThanMs?: number; lookbackMs?: number } = {},
): Promise<{ refunded: number; skipped: number }> {
  const tally = { refunded: 0, skipped: 0 };
  const now = deps.now();
  const before = new Date(now.getTime() - (input.olderThanMs ?? 10 * 60_000));
  const after = new Date(now.getTime() - (input.lookbackMs ?? 7 * 24 * 60 * 60_000));
  for (const job of await deps.store.listFailedJobs("agent:lead", after, before)) {
    if (!REFUNDABLE.has(String((job.result as { error?: unknown } | null)?.error ?? ""))) continue;
    const payments = await deps.store.listJobPayments(job.rootId);
    const key = `refund:${job.jobId}`;
    if (payments.some((p) => p.idempotencyKey === key && p.status === "failed")) { tally.skipped += 1; continue; }
    const plan = manualRefundPlan(job, payments, deps.leadAddress);
    if (!plan.ok) continue;
    const base = { idempotencyKey: plan.key, jobId: job.jobId, kind: "refund" as const, payer: deps.leadAddress, payee: plan.to, amount: plan.amount, network: deps.network, authNonce: null, authValidBefore: null };
    try {
      const txHash = await deps.refund(plan.to, plan.amount, plan.key);
      const at = deps.now();
      await deps.store.upsertJobPayment({ ...base, status: "settled", txHash, detail: "automatic refund: paid but not delivered", createdAt: at, updatedAt: at });
      await deps.store.updateJob(job.jobId, { state: "refunded" });
      tally.refunded += 1;
    } catch (error) {
      const at = deps.now();
      await deps.store.upsertJobPayment({ ...base, status: "failed", txHash: null, detail: `automatic refund failed: ${(error as Error).message.slice(0, 200)}`, createdAt: at, updatedAt: at });
      deps.log?.(`automatic refund failed for job ${job.jobId}; run scripts/refund-lead-job.ts`);
      tally.skipped += 1;
    }
  }
  return tally;
}
