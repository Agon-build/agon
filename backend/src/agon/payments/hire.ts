import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { budgetWalletRef, ensureBudgetWallet, ownerRefFromWalletRef, type WalletOps } from "./budget-wallets.ts";
import { buyExact, peekExactTerms } from "./exact-buyer.ts";
import { createGuardedSigner } from "./guarded-signer.ts";
import { newJob } from "./jobs.ts";
import { issueApproval, issueConfirmation, redeemApproval, redeemConfirmation } from "./limits.ts";
import type { BudgetWallet, Job, PaymentsStore } from "./types.ts";

export type HireDeps = {
  store: PaymentsStore;
  network: AgonNetwork;
  ops: WalletOps;
  signJson: (walletId: string, json: string) => Promise<Hex>;
  now: () => Date;
  off: { all: boolean; budget: boolean };
  fetchImpl?: typeof fetch;
  authorizationUsed?: (authorizer: Address, nonce: Hex) => Promise<boolean>;
  paidTimeoutMs?: number;
};

/// A hire of the lead agent covers its own data purchases, a negotiation and
/// a paid forecast, so the paid request gets well over a minute.
export const HIRE_PAID_TIMEOUT_MS = 180_000;

export type HireRequest = { ownerRef: string; providerUrl: string; providerRef: string; providerLabel: string; body: Record<string, unknown> };

export type HireQuote = { jobId: string; amount: bigint; payTo: Address; providerLabel: string; network: AgonNetwork; expiresAt: Date } & (
  | { step: "confirm_code"; code: string }
  | { step: "approval_link"; token: string }
);

export type HireOutcome =
  | { ok: true; jobId: string; amount: bigint; txHash: Hex | null; result: unknown }
  | { ok: false; code: string; jobId?: string; detail?: string; txHash?: Hex | null };

const postInit = (body: unknown, jobId?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(jobId ? { "x-agon-job": jobId } : {}) },
  body: JSON.stringify(body),
});

/// Reads the provider's live price, records a quoted job, and returns either a
/// chat code (within the per-hire limit) or a one-time browser approval link.
export async function quoteHire(
  deps: HireDeps,
  req: HireRequest,
): Promise<{ ok: true; quote: HireQuote } | { ok: false; code: "payments_off" | "frozen" | "provider_free" | "no_matching_option" | "provider_unreachable"; detail?: string }> {
  if (deps.off.all || deps.off.budget) return { ok: false, code: "payments_off" };
  const wallet = await ensureBudgetWallet({ store: deps.store, ops: deps.ops, network: deps.network, now: deps.now }, req.ownerRef);
  if (wallet.frozen) return { ok: false, code: "frozen" };
  const peek = await peekExactTerms({ url: req.providerUrl, init: postInit(req.body), network: deps.network, fetchImpl: deps.fetchImpl });
  if (!peek.ok) return { ok: false, code: peek.code === "no_matching_option" ? "no_matching_option" : "provider_unreachable", detail: peek.detail };
  if (!("option" in peek)) return { ok: false, code: "provider_free" };
  const now = deps.now();
  const job = newJob({
    parent: null,
    buyerRef: budgetWalletRef(req.ownerRef),
    providerRef: req.providerRef,
    providerLabel: req.providerLabel,
    network: deps.network.id,
    price: peek.option.amount,
    request: { url: req.providerUrl, body: req.body, payTo: peek.option.payTo },
    now,
  });
  await deps.store.insertJob(job);
  const base = { jobId: job.jobId, amount: peek.option.amount, payTo: peek.option.payTo, providerLabel: req.providerLabel, network: deps.network };
  if (peek.option.amount <= wallet.perHireCap) {
    const { code, expiresAt } = await issueConfirmation(deps.store, { walletRef: budgetWalletRef(req.ownerRef), jobId: job.jobId, amount: peek.option.amount, payee: peek.option.payTo, now });
    return { ok: true, quote: { ...base, step: "confirm_code", code, expiresAt } };
  }
  const { token, expiresAt } = await issueApproval(deps.store, { walletRef: budgetWalletRef(req.ownerRef), action: "over_limit_hire", payload: { jobId: job.jobId }, now });
  return { ok: true, quote: { ...base, step: "approval_link", token, expiresAt } };
}

export async function confirmHire(deps: HireDeps, input: { ownerRef: string; code: string }): Promise<HireOutcome> {
  const redeemed = await redeemConfirmation(deps.store, { walletRef: budgetWalletRef(input.ownerRef), code: input.code, now: deps.now() });
  if (!redeemed.ok) return { ok: false, code: redeemed.code };
  const wallet = await deps.store.getBudgetWallet(input.ownerRef, deps.network.id);
  const job = await deps.store.getJob(redeemed.jobId);
  if (!wallet || !job) return { ok: false, code: "unknown_job" };
  return payJob(deps, wallet, job, wallet.perHireCap);
}

export async function completeApprovedHire(deps: HireDeps, input: { token: string }): Promise<HireOutcome> {
  const approval = await redeemApproval(deps.store, { token: input.token, action: "over_limit_hire", now: deps.now() });
  if (!approval.ok) return { ok: false, code: approval.code };
  const ownerRef = ownerRefFromWalletRef(approval.walletRef);
  const wallet = ownerRef ? await deps.store.getBudgetWallet(ownerRef, deps.network.id) : null;
  const job = await deps.store.getJob(String(approval.payload.jobId));
  if (!wallet || !job) return { ok: false, code: "unknown_job" };
  // The approval lifts the per-hire limit for this one job; the daily limit still applies.
  return payJob(deps, wallet, job, job.priceAtomic);
}

async function payJob(deps: HireDeps, wallet: BudgetWallet, job: Job, perPaymentCap: bigint): Promise<HireOutcome> {
  if (deps.off.all || deps.off.budget) return { ok: false, code: "payments_off", jobId: job.jobId };
  if (wallet.frozen) return { ok: false, code: "frozen", jobId: job.jobId };
  if (job.state !== "quoted") return { ok: false, code: "already_processed", jobId: job.jobId };
  const walletRef = budgetWalletRef(wallet.ownerRef);
  const key = `hire:${job.jobId}`;
  const payTo = String(job.request.payTo).toLowerCase() as Address;
  const reserved = await deps.store.reserveSpend({
    walletRef, idempotencyKey: key, network: deps.network.id, amount: job.priceAtomic, payee: payTo, jobId: job.jobId,
    perPaymentCap, dailyCap: wallet.dailyCap, now: deps.now(),
  });
  if (reserved === "duplicate") return { ok: false, code: "already_processed", jobId: job.jobId };
  if (reserved !== "reserved") {
    await deps.store.updateJob(job.jobId, { state: "failed", result: { error: reserved } });
    return { ok: false, code: reserved, jobId: job.jobId };
  }
  await deps.store.updateJob(job.jobId, { state: "paying" });
  const payment = {
    idempotencyKey: key, jobId: job.jobId, kind: "hire" as const, payer: wallet.address, payee: payTo, amount: job.priceAtomic, network: deps.network.id,
    status: "pending" as const, txHash: null, detail: job.providerLabel, authNonce: null, authValidBefore: null, createdAt: deps.now(), updatedAt: deps.now(),
  };
  await deps.store.upsertJobPayment(payment);

  const signed: { nonce: Hex | null } = { nonce: null };
  const purchase = await buyExact({
    url: String(job.request.url),
    init: postInit(job.request.body, job.jobId),
    network: deps.network,
    maxAmount: job.priceAtomic,
    expectedPayTo: payTo,
    fetchImpl: deps.fetchImpl,
    paidTimeoutMs: deps.paidTimeoutMs ?? HIRE_PAID_TIMEOUT_MS,
    signerFor: () =>
      createGuardedSigner({
        address: wallet.address,
        walletId: wallet.walletId,
        signJson: deps.signJson,
        context: () => ({ network: deps.network, from: wallet.address, payTo, maxValue: job.priceAtomic, now: deps.now() }),
        // Recorded before the paid request is sent, so an interrupted payment can be reconciled on chain.
        onSigned: (message) => {
          signed.nonce = message.nonce as Hex;
          return deps.store.upsertJobPayment({ ...payment, authNonce: message.nonce as Hex, authValidBefore: new Date(Number(message.validBefore) * 1000), updatedAt: deps.now() });
        },
      }),
  });

  if (purchase.ok) {
    // A provider that could not deliver and refunded the buyer (the lead agent does this) answers 200 with refunded: true.
    const refunded = (purchase.data as { ok?: unknown; refunded?: unknown } | null)?.ok === false && (purchase.data as { refunded?: unknown }).refunded === true;
    await deps.store.finishSpend(walletRef, key, { state: "settled", txHash: purchase.txHash });
    await deps.store.upsertJobPayment({ ...payment, status: "settled", txHash: purchase.txHash, updatedAt: deps.now() });
    await deps.store.updateJob(job.jobId, { state: refunded ? "refunded" : "delivered", result: purchase.data });
    return { ok: true, jobId: job.jobId, amount: job.priceAtomic, txHash: purchase.txHash, result: purchase.data };
  }
  if (purchase.code === "paid_request_failed" && purchase.txHash) {
    await deps.store.finishSpend(walletRef, key, { state: "settled", txHash: purchase.txHash });
    await deps.store.upsertJobPayment({ ...payment, status: "settled", txHash: purchase.txHash, updatedAt: deps.now() });
    await deps.store.updateJob(job.jobId, { state: "failed", result: { error: "delivery_failed", status: purchase.status } });
    return { ok: false, code: "delivery_failed", jobId: job.jobId, txHash: purchase.txHash };
  }
  if (purchase.sent) {
    // The signed payment left this process. A seller that answered with an
    // error may still have settled it, so ask the chain before deciding.
    if (purchase.code === "paid_request_failed" && signed.nonce && deps.authorizationUsed) {
      const used = await deps.authorizationUsed(wallet.address, signed.nonce).catch(() => null);
      if (used === true) {
        await deps.store.finishSpend(walletRef, key, { state: "settled", txHash: null });
        await deps.store.upsertJobPayment({ ...payment, authNonce: signed.nonce, status: "settled", detail: "settled on chain; seller reported an error", updatedAt: deps.now() });
        await deps.store.updateJob(job.jobId, { state: "failed", result: { error: "delivery_failed", status: purchase.status } });
        return { ok: false, code: "delivery_failed", jobId: job.jobId, txHash: null };
      }
    }
    // Otherwise it may or may not settle: leave the job paying for reconciliation.
    return { ok: false, code: "payment_unknown", jobId: job.jobId, detail: purchase.detail };
  }
  await deps.store.finishSpend(walletRef, key, { state: "failed" });
  await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: `${job.providerLabel}: ${purchase.code}`, updatedAt: deps.now() });
  await deps.store.updateJob(job.jobId, { state: "failed", result: { error: purchase.code, detail: purchase.detail } });
  return { ok: false, code: purchase.code, jobId: job.jobId, detail: purchase.detail };
}

/// Hires stuck in "paying" (crash or lost response) are settled by asking USDC
/// whether the signed authorization was used: used means the money moved;
/// expired and unused means it never will, so the reservation is released.
export async function reconcileStuckHires(deps: HireDeps, input: { olderThanMs?: number } = {}): Promise<{ settled: number; released: number; waiting: number }> {
  const tally = { settled: 0, released: 0, waiting: 0 };
  const now = deps.now();
  for (const job of await deps.store.listStuckJobs("paying", new Date(now.getTime() - (input.olderThanMs ?? 600_000)))) {
    const payment = (await deps.store.listJobPayments(job.rootId)).find((p) => p.idempotencyKey === `hire:${job.jobId}`);
    const walletRef = job.buyerRef;
    if (!payment?.authNonce || !payment.authValidBefore) {
      await deps.store.finishSpend(walletRef, `hire:${job.jobId}`, { state: "failed" });
      if (payment) await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: "never signed", updatedAt: now });
      await deps.store.updateJob(job.jobId, { state: "failed", result: { error: "never_signed" } });
      tally.released += 1;
      continue;
    }
    const used = deps.authorizationUsed ? await deps.authorizationUsed(payment.payer, payment.authNonce) : false;
    if (used) {
      // A provider that finished after the buyer gave up may have stored its answer.
      const delivered = (job.result as { ok?: unknown } | null)?.ok === true;
      await deps.store.finishSpend(walletRef, `hire:${job.jobId}`, { state: "settled", txHash: null });
      await deps.store.upsertJobPayment({ ...payment, status: "settled", detail: delivered ? "settled on chain" : "settled on chain; delivery unknown", updatedAt: now });
      await deps.store.updateJob(job.jobId, delivered ? { state: "delivered" } : { state: "failed", result: { error: "delivery_unknown" } });
      tally.settled += 1;
    } else if (payment.authValidBefore <= now) {
      await deps.store.finishSpend(walletRef, `hire:${job.jobId}`, { state: "failed" });
      await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: "authorization expired unused", updatedAt: now });
      await deps.store.updateJob(job.jobId, { state: "failed", result: { error: "payment_expired_unused" } });
      tally.released += 1;
    } else {
      tally.waiting += 1;
    }
  }
  return tally;
}
