import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../network.ts";
import { manualRefundPlan } from "./manual-refund.ts";
import type { PaymentsStore } from "./types.ts";

const REFUNDABLE = new Set(["delivery_failed", "delivery_unknown"]);

/// A seller wallet Agon runs (the Lead, a specialist, a house forecaster) and
/// how to send USDC back out of it.
export type AgonSellerWallet = { address: Address; refund: (to: Address, amount: bigint, key: string) => Promise<Hex> };

/// Refunds hires of Agon's own agents whose payment settled but whose answer
/// never arrived (the agent failed after settling, or the settlement confirmed
/// after the buyer gave up). Covers every seller wallet Agon runs, matched by
/// the payee of the settled hire payment, and pays the refund from that same
/// wallet. Only top-level jobs bought from an Agon agent wallet are seen here;
/// outside services are never refunded by Agon. Waits so an agent's own
/// refund runs first. A failed refund is recorded and left for the operator.
export async function refundUndeliveredAgonHires(
  deps: {
    store: PaymentsStore;
    sellers: readonly AgonSellerWallet[];
    network: AgonNetworkId;
    now: () => Date;
    log?: (message: string) => void;
  },
  input: { olderThanMs?: number; lookbackMs?: number } = {},
): Promise<{ refunded: number; skipped: number }> {
  const tally = { refunded: 0, skipped: 0 };
  const sellers = new Map(deps.sellers.map((s) => [s.address.toLowerCase(), s]));
  const now = deps.now();
  const before = new Date(now.getTime() - (input.olderThanMs ?? 10 * 60_000));
  const after = new Date(now.getTime() - (input.lookbackMs ?? 7 * 24 * 60 * 60_000));
  for (const job of await deps.store.listFailedRootJobs(after, before)) {
    if (!REFUNDABLE.has(String((job.result as { error?: unknown } | null)?.error ?? ""))) continue;
    const payments = await deps.store.listJobPayments(job.rootId);
    const key = `refund:${job.jobId}`;
    if (payments.some((p) => p.idempotencyKey === key && p.status === "failed")) { tally.skipped += 1; continue; }
    const planned = manualRefundPlan(job, payments, deps.sellers.map((s) => s.address));
    if (!planned.ok) continue;
    const plan = { ...planned, seller: sellers.get(planned.from.toLowerCase())! };
    const base = { idempotencyKey: plan.key, jobId: job.jobId, kind: "refund" as const, payer: plan.seller.address, payee: plan.to, amount: plan.amount, network: deps.network, authNonce: null, authValidBefore: null };
    try {
      const txHash = await plan.seller.refund(plan.to, plan.amount, plan.key);
      const at = deps.now();
      await deps.store.upsertJobPayment({ ...base, status: "settled", txHash, detail: "automatic refund: paid but not delivered", createdAt: at, updatedAt: at });
      await deps.store.updateJob(job.jobId, { state: "refunded" });
      tally.refunded += 1;
    } catch (error) {
      const at = deps.now();
      await deps.store.upsertJobPayment({ ...base, status: "failed", txHash: null, detail: `automatic refund failed: ${(error as Error).message.slice(0, 200)}`, createdAt: at, updatedAt: at });
      deps.log?.(`automatic refund failed for job ${job.jobId} from ${plan.seller.address}; run scripts/refund-lead-job.ts`);
      tally.skipped += 1;
    }
  }
  return tally;
}
