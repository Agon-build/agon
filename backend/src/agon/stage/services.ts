import type { Address } from "viem";

import { agonNetwork, type AgonNetwork, type AgonNetworkId } from "../network.ts";
import { LEAD_PROVIDER_REF, type LiveEvent } from "../lead-agent/lead-agent.ts";
import { formatUsdc, type BargainStep } from "../payments/bargain.ts";
import { budgetWalletRef } from "../payments/budget-wallets.ts";
import { MAX_CODE_ATTEMPTS } from "../payments/limits.ts";
import type { HireOutcome } from "../payments/hire.ts";
import { receiptTree, type ReceiptNode } from "../payments/jobs.ts";
import type { HireService } from "../payments/runtime.ts";
import type { BudgetWallet, Job, JobState, PaymentsStore } from "../payments/types.ts";
import type { LeaderboardRow } from "../playground/seasons/scoring.ts";

export type WalletView = {
  networkId: AgonNetworkId; network: string; testnet: boolean; explorer: string; address: Address; balance: bigint | null;
  perHireCap: bigint; dailyCap: bigint; spentToday: bigint; leftToday: bigint; frozen: boolean;
};
export type AskRefusal = "invalid_question" | "payments_off" | "frozen" | "over_your_max" | "insufficient_balance" | "provider_unreachable" | "no_matching_option" | "provider_free" | "busy" | "terms_changed";
export type AskResult =
  | { ok: true; step: "confirm_code"; jobId: string; amount: bigint; fee: bigint; total: bigint; providerLabel: string; network: string; testnet: boolean; expiresAt: Date; code: string }
  | { ok: true; step: "approval_link"; jobId: string; amount: bigint; fee: bigint; total: bigint; providerLabel: string; network: string; testnet: boolean; expiresAt: Date; approvalUrl: string }
  | { ok: false; code: AskRefusal; detail?: string; amount?: bigint; depositAddress?: Address };
export type LivePhase = "quoted" | "paying" | "working" | "answered" | "refunded" | "failed";
export type StageAnswer = {
  probabilityBps: number; marketPriceBps: number | null; reasons: string[]; marketQuestion: string; marketEndsAt: string | null; marketSlug: string | null;
  forecaster: { name: string; reason: string; asked: string; agreed: string };
};
export type LiveView = {
  jobId: string; rootId: string; question: string | null; phase: LivePhase; state: JobState; network: string; startedAt: string | null;
  events: LiveEvent[]; haggle: BargainStep[]; answer: StageAnswer | null; failure: string | null; refunded: boolean; receipt: ReceiptNode | null; receiptUrl: string;
  /** What a routed service returned, for hires of anything other than the Lead agent. */
  result: unknown;
};
export type HistoryItem = { jobId: string; question: string | null; state: JobState; price: string; createdAt: string; receiptUrl: string };
export type ApprovalLink = { approvalUrl: string; expiresAt: Date };

export type StageServices = {
  network: AgonNetwork;
  siteUrl: string;
  leadPrice: () => Promise<bigint | null>;
  wallet(ownerRef: string): Promise<WalletView>;
  /** The wallet if it exists; never creates one. */
  findWallet(ownerRef: string): Promise<WalletView | null>;
  /** Retires the pending confirmation code; true when one was open. */
  cancel(ownerRef: string): Promise<boolean>;
  ask(ownerRef: string, input: { question: string; maxPrice?: bigint }): Promise<AskResult>;
  confirm(ownerRef: string, code: string): Promise<HireOutcome>;
  pendingJob(ownerRef: string): Promise<string | null>;
  live(jobId: string): Promise<LiveView | null>;
  history(ownerRef: string, limit?: number, offset?: number): Promise<HistoryItem[]>;
  lowerLimits(ownerRef: string, limits: { perHireCap?: bigint; dailyCap?: bigint }): Promise<{ ok: true } | { ok: false; code: string }>;
  freeze(ownerRef: string): Promise<boolean>;
  requestUnfreeze(ownerRef: string): Promise<ApprovalLink | null>;
  requestWithdraw(ownerRef: string, to: Address, amount: bigint): Promise<({ ok: true } & ApprovalLink) | { ok: false; code: string }>;
  leaderboard(limit: number): Promise<LeaderboardRow[] | null>;
  receiptUrl(jobId: string): string;
  approvalUrl(token: string): string;
};

export type StageServiceDeps = {
  hire: Pick<HireService, "leadProviderUrl" | "quoteHire" | "confirmHire" | "wallets">;
  store: PaymentsStore;
  network: AgonNetwork;
  siteUrl: string;
  balanceOf: (address: Address) => Promise<bigint | null>;
  leaderboard: (limit: number) => Promise<LeaderboardRow[] | null>;
  leadPrice: () => Promise<bigint | null>;
  now: () => Date;
  /** Gate for creating a new budget wallet (each is a Circle wallet); unset means always allowed. */
  newWalletAllowed?: () => boolean;
  /** Agon routing fee on Lead hires: rate and where it goes. */
  fee?: { bps: number; address: Address | null };
};

export const LEAD_LABEL = "Agon Lead Agent";
const EVENT_KINDS = new Set(["note", "data", "haggle", "hire", "refund", "fail"]);

type StoredResult = {
  live?: unknown; startedAt?: unknown; events?: unknown; haggle?: unknown; ok?: unknown; refunded?: unknown; error?: unknown; code?: unknown;
  probabilityBps?: unknown; marketPriceBps?: unknown; reasons?: unknown; market?: unknown; forecaster?: unknown;
};

function eventsOf(result: StoredResult | null): LiveEvent[] {
  if (!result || !Array.isArray(result.events)) return [];
  return result.events.filter(
    (e): e is LiveEvent => Boolean(e) && typeof (e as LiveEvent).at === "string" && typeof (e as LiveEvent).text === "string" && EVENT_KINDS.has((e as LiveEvent).kind),
  );
}

function haggleOf(result: StoredResult | null): BargainStep[] {
  if (!result || !Array.isArray(result.haggle)) return [];
  return result.haggle.filter((s): s is BargainStep => Boolean(s) && typeof (s as BargainStep).step === "string" && typeof (s as BargainStep).detail === "string");
}

function answerOf(result: StoredResult | null): StageAnswer | null {
  if (!result || result.ok !== true || typeof result.probabilityBps !== "number") return null;
  const market = (result.market ?? {}) as { question?: unknown; endDate?: unknown; slug?: unknown };
  const forecaster = (result.forecaster ?? {}) as Record<string, unknown>;
  return {
    probabilityBps: result.probabilityBps,
    marketPriceBps: typeof result.marketPriceBps === "number" ? result.marketPriceBps : null,
    reasons: Array.isArray(result.reasons) ? result.reasons.filter((r): r is string => typeof r === "string").slice(0, 5) : [],
    marketQuestion: typeof market.question === "string" ? market.question : "",
    marketEndsAt: typeof market.endDate === "string" && market.endDate ? market.endDate : null,
    marketSlug: typeof market.slug === "string" && market.slug ? market.slug : null,
    forecaster: {
      name: String(forecaster.name ?? ""), reason: String(forecaster.reason ?? ""), asked: String(forecaster.asked ?? ""), agreed: String(forecaster.agreed ?? ""),
    },
  };
}

function questionOf(job: Job): string | null {
  const request = job.request as { question?: unknown; body?: { question?: unknown } };
  const q = request.question ?? request.body?.question;
  return typeof q === "string" ? q : null;
}

function phaseOf(job: Job, result: StoredResult | null, events: LiveEvent[], answer: StageAnswer | null): LivePhase {
  if (job.state === "quoted") return "quoted";
  if (job.state === "refunded" || (result?.ok === false && result.refunded === true)) return "refunded";
  if (answer) return "answered";
  // A routed service has no Lead answer: delivered means it answered.
  if (job.state === "delivered" && job.providerRef !== LEAD_PROVIDER_REF) return "answered";
  if (job.state === "failed" || job.state === "delivered") return "failed";
  return events.length > 0 ? "working" : "paying";
}

export function createStageServices(deps: StageServiceDeps): StageServices {
  const receiptUrl = (jobId: string) => `${deps.siteUrl}/r/${jobId}`;
  const approvalUrl = (token: string) => `${deps.siteUrl}/approve?t=${token}`;
  const testnet = deps.network.id === "arc-testnet";
  async function viewOf(ownerRef: string, w: BudgetWallet): Promise<WalletView> {
    const [balance, spentToday] = await Promise.all([
      deps.balanceOf(w.address).catch(() => null),
      deps.store.dailySpent(budgetWalletRef(ownerRef), deps.network.id, deps.now()),
    ]);
    const left = w.dailyCap - spentToday;
    return {
      networkId: deps.network.id, network: deps.network.label, testnet, explorer: deps.network.explorer, address: w.address, balance,
      perHireCap: w.perHireCap, dailyCap: w.dailyCap, spentToday, leftToday: left > 0n ? left : 0n, frozen: w.frozen,
    };
  }

  return {
    network: deps.network,
    siteUrl: deps.siteUrl,
    leadPrice: deps.leadPrice,
    receiptUrl,
    approvalUrl,

    wallet: async (ownerRef) => viewOf(ownerRef, await deps.hire.wallets.ensure(ownerRef)),

    async findWallet(ownerRef) {
      const w = await deps.store.getBudgetWallet(ownerRef, deps.network.id);
      return w ? viewOf(ownerRef, w) : null;
    },

    async cancel(ownerRef) {
      const latest = await deps.store.latestConfirmation(budgetWalletRef(ownerRef));
      if (!latest || latest.usedAt || latest.expiresAt <= deps.now()) return false;
      await deps.store.updateConfirmation(latest.codeHash, { usedAt: deps.now() });
      return true;
    },

    async ask(ownerRef, input) {
      const question = input.question.trim();
      if (question.length < 8 || question.length > 300) return { ok: false, code: "invalid_question" };
      // Each new owner costs a Circle wallet, so new wallets pass a global gate.
      if (deps.newWalletAllowed && !(await deps.store.getBudgetWallet(ownerRef, deps.network.id)) && !deps.newWalletAllowed()) return { ok: false, code: "busy" };
      const quoted = await deps.hire.quoteHire({ ownerRef, providerUrl: deps.hire.leadProviderUrl, providerRef: LEAD_PROVIDER_REF, providerLabel: LEAD_LABEL, body: { question }, feeBps: deps.fee?.bps ?? 0, feeAddress: deps.fee?.address ?? null });
      if (!quoted.ok) {
        if (quoted.code === "insufficient_balance") return { ok: false, code: quoted.code, amount: quoted.amount, depositAddress: quoted.depositAddress };
        return { ok: false, code: quoted.code, ...(quoted.detail ? { detail: quoted.detail } : {}) };
      }
      const q = quoted.quote;
      // The person's maximum covers what they pay in total, Agon's fee included.
      if (input.maxPrice !== undefined && q.total > input.maxPrice) return { ok: false, code: "over_your_max", amount: q.total };
      const wallet = await deps.hire.wallets.ensure(ownerRef);
      const balance = await deps.balanceOf(wallet.address).catch(() => null);
      if (balance !== null && balance < q.total) return { ok: false, code: "insufficient_balance", amount: q.total, depositAddress: wallet.address };
      const base = { jobId: q.jobId, amount: q.amount, fee: q.fee, total: q.total, providerLabel: q.providerLabel, network: deps.network.label, testnet, expiresAt: q.expiresAt };
      return q.step === "confirm_code" ? { ok: true, step: "confirm_code", ...base, code: q.code } : { ok: true, step: "approval_link", ...base, approvalUrl: approvalUrl(q.token) };
    },

    confirm: (ownerRef, code) => deps.hire.confirmHire({ ownerRef, code }),

    async pendingJob(ownerRef) {
      const latest = await deps.store.latestConfirmation(budgetWalletRef(ownerRef));
      if (!latest || latest.usedAt || latest.expiresAt <= deps.now() || latest.attempts >= MAX_CODE_ATTEMPTS) return null;
      return latest.jobId;
    },

    async live(jobId) {
      const job = await deps.store.getJob(jobId);
      if (!job) return null;
      const root = job.rootId === job.jobId ? job : await deps.store.getJob(job.rootId);
      if (!root) return null;
      const [tree, payments] = await Promise.all([deps.store.listJobTree(root.rootId), deps.store.listJobPayments(root.rootId)]);
      const result = (root.result ?? null) as StoredResult | null;
      const events = eventsOf(result);
      const answer = answerOf(result);
      const phase = phaseOf(root, result, events, answer);
      const failure = phase === "failed" || phase === "refunded" ? String(result?.error ?? result?.code ?? "not_delivered") : null;
      return {
        jobId: root.jobId, rootId: root.rootId, question: questionOf(root), phase, state: root.state, network: agonNetwork(root.network).label,
        startedAt: typeof result?.startedAt === "string" ? result.startedAt : (events[0]?.at ?? null),
        events, haggle: haggleOf(result), answer, failure, refunded: phase === "refunded",
        receipt: receiptTree(root.rootId, tree, payments), receiptUrl: receiptUrl(root.jobId),
        result: root.providerRef !== LEAD_PROVIDER_REF && root.state === "delivered" ? (root.result ?? null) : null,
      };
    },

    async history(ownerRef, limit = 10, offset = 0) {
      const jobs = await deps.store.listJobsByBuyer(budgetWalletRef(ownerRef), limit, offset);
      return jobs.map((j) => ({ jobId: j.jobId, question: questionOf(j), state: j.state, price: formatUsdc(j.priceAtomic), createdAt: j.createdAt.toISOString(), receiptUrl: receiptUrl(j.jobId) }));
    },

    async lowerLimits(ownerRef, limits) {
      const out = await deps.hire.wallets.lowerLimits(ownerRef, limits);
      return out.ok ? { ok: true } : { ok: false, code: out.code };
    },

    freeze: (ownerRef) => deps.hire.wallets.freeze(ownerRef),

    async requestUnfreeze(ownerRef) {
      const link = await deps.hire.wallets.requestUnfreeze(ownerRef);
      return link ? { approvalUrl: approvalUrl(link.token), expiresAt: link.expiresAt } : null;
    },

    async requestWithdraw(ownerRef, to, amount) {
      const out = await deps.hire.wallets.requestWithdraw(ownerRef, to, amount);
      return out.ok ? { ok: true, approvalUrl: approvalUrl(out.token), expiresAt: out.expiresAt } : { ok: false, code: out.code };
    },

    leaderboard: (limit) => deps.leaderboard(limit),
  };
}
