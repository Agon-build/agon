import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../network.ts";

export type BudgetWallet = {
  ownerRef: string;
  network: AgonNetworkId;
  walletId: string;
  address: Address;
  perHireCap: bigint;
  dailyCap: bigint;
  frozen: boolean;
  createdAt: Date;
};

export type SpendReservation = {
  walletRef: string;
  idempotencyKey: string;
  network: AgonNetworkId;
  amount: bigint;
  payee: Address;
  jobId: string | null;
  perPaymentCap: bigint;
  dailyCap: bigint;
  now: Date;
};
export type ReserveResult = "reserved" | "duplicate" | "over_per_payment" | "over_daily";
export type SpendOutcome = { state: "settled"; txHash: Hex | null } | { state: "failed" };

export type Confirmation = {
  codeHash: Hex;
  walletRef: string;
  jobId: string;
  amount: bigint;
  payee: Address;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

export type ApprovalAction = "over_limit_hire" | "withdraw" | "unfreeze";
export type Approval = {
  tokenHash: Hex;
  walletRef: string;
  action: ApprovalAction;
  payload: Record<string, unknown>;
  expiresAt: Date;
  usedAt: Date | null;
};

export type Quote = {
  quoteId: string;
  sellerKey: string;
  buyer: Address;
  amount: bigint;
  expiresAt: Date;
  usedAt: Date | null;
  transcript: unknown[];
};

export type JobState = "quoted" | "paying" | "paid" | "delivered" | "failed" | "refunded";
export type Job = {
  jobId: string;
  parentId: string | null;
  rootId: string;
  depth: number;
  buyerRef: string;
  providerRef: string;
  providerLabel: string;
  network: AgonNetworkId;
  priceAtomic: bigint;
  budgetAtomic: bigint;
  state: JobState;
  traceId: string;
  request: Record<string, unknown>;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type JobPaymentKind = "hire" | "data" | "refund" | "fee";
export type JobPayment = {
  idempotencyKey: string;
  jobId: string;
  kind: JobPaymentKind;
  payer: Address;
  payee: Address;
  amount: bigint;
  network: AgonNetworkId;
  status: "pending" | "settled" | "failed";
  txHash: Hex | null;
  detail: string | null;
  authNonce: Hex | null;
  authValidBefore: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface PaymentsStore {
  getBudgetWallet(ownerRef: string, network: AgonNetworkId): Promise<BudgetWallet | null>;
  /** Inserts, or returns the existing wallet when one is already recorded. */
  insertBudgetWallet(wallet: BudgetWallet): Promise<BudgetWallet>;
  updateBudgetWallet(ownerRef: string, network: AgonNetworkId, patch: { perHireCap?: bigint; dailyCap?: bigint; frozen?: boolean }): Promise<BudgetWallet | null>;
  /** Atomic per wallet and UTC day: reserved plus settled spends never exceed the daily cap. */
  reserveSpend(reservation: SpendReservation): Promise<ReserveResult>;
  finishSpend(walletRef: string, idempotencyKey: string, outcome: SpendOutcome): Promise<void>;
  insertConfirmation(confirmation: Confirmation): Promise<void>;
  latestConfirmation(walletRef: string): Promise<Confirmation | null>;
  updateConfirmation(codeHash: Hex, patch: { attempts?: number; usedAt?: Date }): Promise<void>;
  insertApproval(approval: Approval): Promise<void>;
  getApproval(tokenHash: Hex): Promise<Approval | null>;
  /** True only for the first use of an unexpired approval. */
  useApproval(tokenHash: Hex, now: Date): Promise<boolean>;
  claimSellerNonce(network: AgonNetworkId, payer: Address, nonce: Hex): Promise<boolean>;
  insertQuote(quote: Quote): Promise<void>;
  getQuote(quoteId: string): Promise<Quote | null>;
  /** True only for the first use, by the quoted buyer, before expiry. */
  useQuote(quoteId: string, buyer: Address, now: Date): Promise<boolean>;
  insertJob(job: Job): Promise<void>;
  updateJob(jobId: string, patch: { state?: JobState; result?: unknown; budgetAtomic?: bigint }): Promise<void>;
  getJob(jobId: string): Promise<Job | null>;
  listJobTree(rootId: string): Promise<Job[]>;
  listStuckJobs(state: JobState, updatedBefore: Date, network?: string): Promise<Job[]>;
  /** Failed top-level jobs of one provider, last changed inside the window, newest first. */
  listFailedJobs(providerRef: string, updatedAfter: Date, updatedBefore: Date): Promise<Job[]>;
  /** Root jobs this buyer started, newest first. */
  listJobsByBuyer(buyerRef: string, limit: number, offset?: number): Promise<Job[]>;
  /// Delivered jobs and their total price per provider on one network (providers with none are left out).
  deliveredJobStats(network: AgonNetworkId, providerRefs: string[]): Promise<Record<string, { jobs: number; earnedAtomic: bigint }>>;
  /** Reserved plus settled spend for the wallet on the UTC day of `now`. */
  dailySpent(walletRef: string, network: AgonNetworkId, now: Date): Promise<bigint>;
  /** Insert or update by idempotency key; a recorded nonce is never erased. */
  upsertJobPayment(payment: JobPayment): Promise<void>;
  listJobPayments(rootId: string): Promise<JobPayment[]>;
  /** Payments of one kind still pending and last changed before the cutoff, oldest first. */
  listPendingPayments(kind: JobPaymentKind, updatedBefore: Date, network?: string): Promise<JobPayment[]>;
  /** Every routing fee a wallet still owes on one network, oldest first: its fee tab. */
  listOwedFees(payer: Address, network: string): Promise<JobPayment[]>;
}
