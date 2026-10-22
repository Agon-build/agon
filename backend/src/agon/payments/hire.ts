import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { budgetWalletRef, ensureBudgetWallet, ownerRefFromWalletRef, type WalletOps } from "./budget-wallets.ts";
import { buyExact, peekExactTerms } from "./exact-buyer.ts";
import { createGuardedSigner } from "./guarded-signer.ts";
import { newJob } from "./jobs.ts";
import { issueApproval, issueConfirmation, redeemApproval, redeemConfirmation } from "./limits.ts";
import type { BudgetWallet, Job, PaymentsStore } from "./types.ts";
import { stableUuid } from "../playground/seasons/committer.ts";
import { feeFor } from "../routing/fee.ts";

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
  /** Reads a Circle transfer's state, so a fee counts as paid only once it lands on chain. */
  feeTxState?: (id: string) => Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
  /** How long a delivered hire waits for its fee transfer before leaving it to reconcile. */
  feeWaitMs?: number;
};

const FEE_GIVE_UP_MS = 24 * 60 * 60_000;

/// A hire of the lead agent covers its own data purchases, a negotiation and
/// a paid forecast, so the paid request gets well over a minute.
export const HIRE_PAID_TIMEOUT_MS = 180_000;

export type HireRequest = {
  ownerRef: string; providerUrl: string; providerRef: string; providerLabel: string; body: Record<string, unknown>;
  /** GET sends the body as a query string; POST (the default) as JSON. */
  method?: "GET" | "POST";
  /** Agon's routing fee in basis points and where it goes; no address means no fee. */
  feeBps?: number;
  feeAddress?: Address | null;
  /** Terms the person was shown; live terms that differ are refused before anything is written. */
  expect?: { amount: bigint; payTo: Address | null };
  /** Reads the wallet balance so a short wallet is refused before anything is written. */
  balanceOf?: (address: Address) => Promise<bigint | null>;
  /** Kept free in the wallet when a fee is charged: the gas for sending it. */
  reserve?: bigint;
};

export type HireQuote = { jobId: string; amount: bigint; fee: bigint; total: bigint; payTo: Address; providerLabel: string; network: AgonNetwork; expiresAt: Date } & (
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

/// The provider call for a job: GET carries the input in the query string.
function providerCall(url: string, method: "GET" | "POST", body: Record<string, unknown>, jobId?: string): { url: string; init: RequestInit } {
  if (method === "POST") return { url, init: postInit(body, jobId) };
  const u = new URL(url);
  for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) u.searchParams.set(k, typeof v === "string" ? v : JSON.stringify(v));
  return { url: u.toString(), init: { method: "GET", headers: jobId ? { "x-agon-job": jobId } : {} } };
}

const jobFee = (job: Job): { fee: bigint; feeAddress: Address | null } => {
  const r = job.request as { fee?: unknown; feeAddress?: unknown };
  return { fee: typeof r.fee === "string" ? BigInt(r.fee) : 0n, feeAddress: typeof r.feeAddress === "string" ? (r.feeAddress as Address) : null };
};

/// Reasons an Agon market agent refuses a request before asking for payment; the person sees each in plain words.
const PROVIDER_REFUSALS = ["market_not_found", "market_closed", "not_yes_no", "not_a_football_market", "market_unavailable"] as const;
export type ProviderRefusal = (typeof PROVIDER_REFUSALS)[number];
const isProviderRefusal = (v: unknown): v is ProviderRefusal => (PROVIDER_REFUSALS as readonly unknown[]).includes(v);

/// Reads the provider's live price, records a quoted job, and returns either a
/// chat code (within the per-hire limit) or a one-time browser approval link.
export async function quoteHire(
  deps: HireDeps,
  req: HireRequest,
): Promise<
  | { ok: true; quote: HireQuote }
  | { ok: false; code: "payments_off" | "frozen" | "provider_free" | "no_matching_option" | "provider_unreachable" | "terms_changed" | ProviderRefusal; detail?: string }
  | { ok: false; code: "insufficient_balance"; amount: bigint; depositAddress: Address }
> {
  if (deps.off.all || deps.off.budget) return { ok: false, code: "payments_off" };
  const wallet = await ensureBudgetWallet({ store: deps.store, ops: deps.ops, network: deps.network, now: deps.now }, req.ownerRef);
  if (wallet.frozen) return { ok: false, code: "frozen" };
  const method = req.method ?? "POST";
  const call = providerCall(req.providerUrl, method, req.body);
  const peek = await peekExactTerms({ url: call.url, init: call.init, network: deps.network, fetchImpl: deps.fetchImpl });
  if (!peek.ok && "reason" in peek && isProviderRefusal(peek.reason)) return { ok: false, code: peek.reason, detail: peek.detail };
  if (!peek.ok) return { ok: false, code: peek.code === "no_matching_option" ? "no_matching_option" : "provider_unreachable", detail: peek.detail };
  if (!("option" in peek)) return { ok: false, code: "provider_free" };
  const now = deps.now();
  const fee = req.feeAddress ? feeFor(peek.option.amount, req.feeBps ?? 0) : 0n;
  const total = peek.option.amount + fee;
  if (req.expect && (peek.option.amount !== req.expect.amount || (req.expect.payTo && peek.option.payTo.toLowerCase() !== req.expect.payTo.toLowerCase()))) {
    return { ok: false, code: "terms_changed" };
  }
  if (req.balanceOf) {
    const needed = total + (fee > 0n ? (req.reserve ?? 0n) : 0n);
    const balance = await req.balanceOf(wallet.address).catch(() => null);
    if (balance !== null && balance < needed) return { ok: false, code: "insufficient_balance", amount: needed, depositAddress: wallet.address };
  }
  const job = newJob({
    parent: null,
    buyerRef: budgetWalletRef(req.ownerRef),
    providerRef: req.providerRef,
    providerLabel: req.providerLabel,
    network: deps.network.id,
    price: peek.option.amount,
    request: {
      url: req.providerUrl, body: req.body, payTo: peek.option.payTo, method,
      ...(fee > 0n ? { fee: fee.toString(), feeAddress: req.feeAddress } : {}),
    },
    now,
  });
  await deps.store.insertJob(job);
  const base = { jobId: job.jobId, amount: peek.option.amount, fee, total, payTo: peek.option.payTo, providerLabel: req.providerLabel, network: deps.network };
  // Limits apply to what the person pays in total, fee included.
  if (total <= wallet.perHireCap) {
    const { code, expiresAt } = await issueConfirmation(deps.store, { walletRef: budgetWalletRef(req.ownerRef), jobId: job.jobId, amount: total, payee: peek.option.payTo, now });
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
  return payJob(deps, wallet, job, job.priceAtomic + jobFee(job).fee);
}

async function payJob(deps: HireDeps, wallet: BudgetWallet, job: Job, perPaymentCap: bigint): Promise<HireOutcome> {
  if (deps.off.all || deps.off.budget) return { ok: false, code: "payments_off", jobId: job.jobId };
  if (wallet.frozen) return { ok: false, code: "frozen", jobId: job.jobId };
  if (job.state !== "quoted") return { ok: false, code: "already_processed", jobId: job.jobId };
  const walletRef = budgetWalletRef(wallet.ownerRef);
  const key = `hire:${job.jobId}`;
  const payTo = String(job.request.payTo).toLowerCase() as Address;
  const { fee, feeAddress } = jobFee(job);
  const reserved = await deps.store.reserveSpend({
    walletRef, idempotencyKey: key, network: deps.network.id, amount: job.priceAtomic + fee, payee: payTo, jobId: job.jobId,
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
  const call = providerCall(String(job.request.url), job.request.method === "GET" ? "GET" : "POST", (job.request.body ?? {}) as Record<string, unknown>, job.jobId);
  const purchase = await buyExact({
    url: call.url,
    init: call.init,
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

  if (purchase.ok && purchase.amount === 0n) {
    // The provider answered without asking for payment: nothing moved, so the daily limit is not charged.
    await deps.store.finishSpend(walletRef, key, { state: "failed" });
    await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: "no charge: the provider answered without payment", updatedAt: deps.now() });
    await deps.store.updateJob(job.jobId, { state: "delivered", result: purchase.data });
    return { ok: true, jobId: job.jobId, amount: 0n, txHash: null, result: purchase.data };
  }
  if (purchase.ok && (purchase.data === null || purchase.data === undefined)) {
    // Paid, but nothing came back: not delivered, and no routing fee.
    await deps.store.finishSpend(walletRef, key, { state: "settled", txHash: purchase.txHash });
    await deps.store.upsertJobPayment({ ...payment, status: "settled", txHash: purchase.txHash, detail: "settled; the provider sent an empty answer", updatedAt: deps.now() });
    await deps.store.updateJob(job.jobId, { state: "failed", result: { error: "delivery_failed", detail: "empty answer" } });
    return { ok: false, code: "delivery_failed", jobId: job.jobId, txHash: purchase.txHash };
  }
  if (purchase.ok) {
    // A provider that could not deliver and refunded the buyer (the lead agent does this) answers 200 with refunded: true.
    const refunded = (purchase.data as { ok?: unknown; refunded?: unknown } | null)?.ok === false && (purchase.data as { refunded?: unknown }).refunded === true;
    await deps.store.finishSpend(walletRef, key, { state: "settled", txHash: purchase.txHash });
    await deps.store.upsertJobPayment({ ...payment, status: "settled", txHash: purchase.txHash, updatedAt: deps.now() });
    await deps.store.updateJob(job.jobId, { state: refunded ? "refunded" : "delivered", result: purchase.data });
    // The routing fee is taken only for delivered work.
    if (!refunded && fee > 0n && feeAddress) await payFee(deps, wallet, job, fee, feeAddress);
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
  // A provider that refused before asking for payment (a closed market, say) names its reason; the job page shows it.
  const refused = purchase.code === "unexpected_status" ? (purchase.data as { error?: unknown } | null | undefined)?.error : undefined;
  const reason = typeof refused === "string" && /^[a-z][a-z0-9_]{2,40}$/.test(refused) ? refused : purchase.code;
  await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: `${job.providerLabel}: ${reason}`, updatedAt: deps.now() });
  await deps.store.updateJob(job.jobId, { state: "failed", result: { error: reason, detail: purchase.detail } });
  return { ok: false, code: isProviderRefusal(reason) ? reason : purchase.code, jobId: job.jobId, detail: purchase.detail };
}

/// Sends Agon's routing fee from the person's agent wallet. A failure leaves the
/// fee pending for reconciliation; it never changes the delivered job.
async function payFee(deps: HireDeps, wallet: BudgetWallet, job: Job, fee: bigint, feeAddress: Address): Promise<void> {
  const key = `fee:${job.jobId}`;
  const at = deps.now();
  const base = {
    idempotencyKey: key, jobId: job.jobId, kind: "fee" as const, payer: wallet.address, payee: feeAddress.toLowerCase() as Address, amount: fee,
    network: deps.network.id, txHash: null, authNonce: null, authValidBefore: null, createdAt: at,
  };
  await deps.store.upsertJobPayment({ ...base, status: "pending", detail: "Agon routing fee", updatedAt: at });
  await sendFee(deps, wallet.walletId, base);
}

type FeePayment = Omit<import("./types.ts").JobPayment, "status" | "detail" | "updatedAt">;

async function sendFee(deps: HireDeps, walletId: string, payment: FeePayment, waitMs = deps.feeWaitMs ?? 20_000): Promise<boolean> {
  let id: string;
  try {
    id = (await deps.ops.transfer({ walletId, destinationAddress: payment.payee, amountBaseUnits: payment.amount, idempotencyKey: stableUuid(payment.idempotencyKey), refId: payment.idempotencyKey })).id;
  } catch {
    // Stays pending, stamped so newer fees get their turn; reconcile retries with the same idempotency key.
    await deps.store.upsertJobPayment({ ...payment, status: "pending", detail: "Agon routing fee, transfer not accepted yet", updatedAt: deps.now() });
    return false;
  }
  if (!deps.feeTxState) {
    await deps.store.upsertJobPayment({ ...payment, status: "settled", detail: `Agon routing fee, transfer ${id}`, updatedAt: deps.now() });
    return true;
  }
  await deps.store.upsertJobPayment({ ...payment, status: "pending", detail: `Agon routing fee, transfer ${id}`, updatedAt: deps.now() });
  return checkFee(deps, payment, id, waitMs);
}

/// A fee is paid once its transfer has an on-chain hash; a failed transfer is
/// recorded as failed, and anything still in flight is left for reconcile.
async function checkFee(deps: HireDeps, payment: FeePayment, id: string, waitMs: number): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const state = await deps.feeTxState!(id).catch(() => null);
    if (state && ["CONFIRMED", "COMPLETE"].includes(state.state) && state.txHash) {
      await deps.store.upsertJobPayment({ ...payment, status: "settled", txHash: state.txHash.toLowerCase() as Hex, detail: `Agon routing fee, transfer ${id}`, updatedAt: deps.now() });
      return true;
    }
    if (state && ["FAILED", "DENIED", "CANCELLED"].includes(state.state)) {
      await deps.store.upsertJobPayment({ ...payment, status: "failed", detail: `Agon routing fee not paid: ${state.errorReason ?? state.state}`, updatedAt: deps.now() });
      return false;
    }
    if (Date.now() >= deadline) {
      await deps.store.upsertJobPayment({ ...payment, status: "pending", detail: `Agon routing fee, transfer ${id}`, updatedAt: deps.now() });
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

/// Hires stuck in "paying" (crash or lost response) are settled by asking USDC
/// whether the signed authorization was used: used means the money moved;
/// expired and unused means it never will, so the reservation is released.
export async function reconcileStuckHires(deps: HireDeps, input: { olderThanMs?: number } = {}): Promise<{ settled: number; released: number; waiting: number }> {
  const tally = { settled: 0, released: 0, waiting: 0 };
  const now = deps.now();
  // Each runtime settles only its own network's jobs: the other network's chain knows nothing of them.
  for (const job of await deps.store.listStuckJobs("paying", new Date(now.getTime() - (input.olderThanMs ?? 600_000)), deps.network.id)) {
    if (job.network !== deps.network.id) continue;
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
  // Routing fees: a sent transfer is checked, an unsent one is retried with the
  // same idempotency key, and a fee still unpaid after a day is given up.
  for (const fee of await deps.store.listPendingPayments("fee", new Date(now.getTime() - (input.olderThanMs ?? 600_000)), deps.network.id)) {
    if (fee.network !== deps.network.id) continue;
    if (now.getTime() - fee.createdAt.getTime() > FEE_GIVE_UP_MS) {
      await deps.store.upsertJobPayment({ ...fee, status: "failed", detail: "Agon routing fee not paid; given up after a day", updatedAt: now });
      continue;
    }
    const sent = /transfer (\S+)$/.exec(fee.detail ?? "")?.[1];
    if (sent && sent !== "yet" && deps.feeTxState) {
      await checkFee(deps, fee, sent, 0);
      continue;
    }
    const job = await deps.store.getJob(fee.jobId);
    const ownerRef = job ? ownerRefFromWalletRef(job.buyerRef) : null;
    const wallet = ownerRef ? await deps.store.getBudgetWallet(ownerRef, deps.network.id) : null;
    if (wallet && wallet.address.toLowerCase() === fee.payer.toLowerCase()) await sendFee(deps, wallet.walletId, fee, 0);
  }
  return tally;
}
