import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../../src/agon/network.ts";
import type {
  Approval, BudgetWallet, Confirmation, Job, JobPayment, JobState, PaymentsStore, Quote, ReserveResult, SpendOutcome, SpendReservation,
} from "../../src/agon/payments/types.ts";

type Spend = { walletRef: string; key: string; network: AgonNetworkId; day: string; amount: bigint; state: "reserved" | "settled" | "failed"; txHash: Hex | null };

/// Behaviour-compatible stand-in for PostgresPaymentsStore. Keep it in step
/// with payments-store.test.ts.
export class MemoryPaymentsStore implements PaymentsStore {
  wallets = new Map<string, BudgetWallet>();
  spends = new Map<string, Spend>();
  confirmations: Confirmation[] = [];
  approvals = new Map<string, Approval>();
  nonces = new Set<string>();
  quotes = new Map<string, Quote>();
  jobs = new Map<string, Job>();
  payments = new Map<string, JobPayment>();

  async getBudgetWallet(ownerRef: string, network: AgonNetworkId) {
    return this.wallets.get(`${ownerRef}|${network}`) ?? null;
  }
  async insertBudgetWallet(w: BudgetWallet) {
    const k = `${w.ownerRef}|${w.network}`;
    if (!this.wallets.has(k)) this.wallets.set(k, { ...w, address: w.address.toLowerCase() as Address });
    return this.wallets.get(k)!;
  }
  async updateBudgetWallet(ownerRef: string, network: AgonNetworkId, patch: { perHireCap?: bigint; dailyCap?: bigint; frozen?: boolean }) {
    const w = this.wallets.get(`${ownerRef}|${network}`);
    if (!w) return null;
    Object.assign(w, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return w;
  }
  async reserveSpend(s: SpendReservation): Promise<ReserveResult> {
    const k = `${s.walletRef}|${s.idempotencyKey}`;
    if (this.spends.has(k)) return "duplicate";
    if (s.amount > s.perPaymentCap) return "over_per_payment";
    const day = s.now.toISOString().slice(0, 10);
    let total = 0n;
    for (const sp of this.spends.values()) {
      if (sp.walletRef === s.walletRef && sp.network === s.network && sp.day === day && sp.state !== "failed") total += sp.amount;
    }
    if (total + s.amount > s.dailyCap) return "over_daily";
    this.spends.set(k, { walletRef: s.walletRef, key: s.idempotencyKey, network: s.network, day, amount: s.amount, state: "reserved", txHash: null });
    return "reserved";
  }
  async finishSpend(walletRef: string, idempotencyKey: string, outcome: SpendOutcome) {
    const sp = this.spends.get(`${walletRef}|${idempotencyKey}`);
    if (!sp || sp.state !== "reserved") return;
    sp.state = outcome.state;
    sp.txHash = outcome.state === "settled" ? outcome.txHash : null;
  }
  async insertConfirmation(c: Confirmation) {
    this.confirmations.push({ ...c });
  }
  async latestConfirmation(walletRef: string) {
    const mine = this.confirmations.filter((c) => c.walletRef === walletRef).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0] ?? null;
  }
  async updateConfirmation(codeHash: Hex, patch: { attempts?: number; usedAt?: Date }) {
    const c = this.confirmations.find((x) => x.codeHash === codeHash);
    if (!c) return;
    if (patch.attempts !== undefined) c.attempts = patch.attempts;
    if (patch.usedAt !== undefined) c.usedAt = patch.usedAt;
  }
  async insertApproval(a: Approval) {
    this.approvals.set(a.tokenHash, { ...a });
  }
  async getApproval(tokenHash: Hex) {
    return this.approvals.get(tokenHash) ?? null;
  }
  async useApproval(tokenHash: Hex, now: Date) {
    const a = this.approvals.get(tokenHash);
    if (!a || a.usedAt || a.expiresAt <= now) return false;
    a.usedAt = now;
    return true;
  }
  async claimSellerNonce(network: AgonNetworkId, payer: Address, nonce: Hex) {
    const k = `${network}|${payer.toLowerCase()}|${nonce.toLowerCase()}`;
    if (this.nonces.has(k)) return false;
    this.nonces.add(k);
    return true;
  }
  async insertQuote(q: Quote) {
    this.quotes.set(q.quoteId, { ...q, buyer: q.buyer.toLowerCase() as Address });
  }
  async getQuote(quoteId: string) {
    return this.quotes.get(quoteId) ?? null;
  }
  async useQuote(quoteId: string, buyer: Address, now: Date) {
    const q = this.quotes.get(quoteId);
    if (!q || q.usedAt || q.expiresAt <= now || q.buyer !== buyer.toLowerCase()) return false;
    q.usedAt = now;
    return true;
  }
  async insertJob(j: Job) {
    this.jobs.set(j.jobId, { ...j });
  }
  async updateJob(jobId: string, patch: { state?: JobState; result?: unknown; budgetAtomic?: bigint }) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    if (patch.state !== undefined) j.state = patch.state;
    if (patch.result !== undefined) j.result = patch.result;
    if (patch.budgetAtomic !== undefined) j.budgetAtomic = patch.budgetAtomic;
    j.updatedAt = new Date();
  }
  async getJob(jobId: string) {
    return this.jobs.get(jobId) ?? null;
  }
  async listJobTree(rootId: string) {
    return [...this.jobs.values()].filter((j) => j.rootId === rootId).sort((a, b) => a.depth - b.depth);
  }
  async listStuckJobs(state: JobState, updatedBefore: Date) {
    return [...this.jobs.values()].filter((j) => j.state === state && j.updatedAt < updatedBefore);
  }
  async deliveredJobStats(network: AgonNetworkId, providerRefs: string[]) {
    const out: Record<string, { jobs: number; earnedAtomic: bigint }> = {};
    for (const j of this.jobs.values()) {
      if (j.network !== network || j.state !== "delivered" || !providerRefs.includes(j.providerRef)) continue;
      const prev = out[j.providerRef] ?? { jobs: 0, earnedAtomic: 0n };
      out[j.providerRef] = { jobs: prev.jobs + 1, earnedAtomic: prev.earnedAtomic + j.priceAtomic };
    }
    return out;
  }
  async listJobsByBuyer(buyerRef: string, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => j.buyerRef === buyerRef && j.parentId === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, Math.max(1, Math.min(limit, 100)));
  }
  async dailySpent(walletRef: string, network: AgonNetworkId, now: Date) {
    const day = now.toISOString().slice(0, 10);
    let total = 0n;
    for (const sp of this.spends.values()) if (sp.walletRef === walletRef && sp.network === network && sp.day === day && sp.state !== "failed") total += sp.amount;
    return total;
  }
  async upsertJobPayment(p: JobPayment) {
    const prev = this.payments.get(p.idempotencyKey);
    this.payments.set(p.idempotencyKey, prev
      ? { ...prev, status: p.status, txHash: p.txHash ?? prev.txHash, detail: p.detail ?? prev.detail, authNonce: prev.authNonce ?? p.authNonce, authValidBefore: prev.authValidBefore ?? p.authValidBefore, updatedAt: new Date() }
      : { ...p });
  }
  async listJobPayments(rootId: string) {
    const ids = new Set([...this.jobs.values()].filter((j) => j.rootId === rootId).map((j) => j.jobId));
    return [...this.payments.values()].filter((p) => ids.has(p.jobId));
  }
}
