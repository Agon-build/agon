import type pg from "pg";
import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../network.ts";
import type {
  Approval, BudgetWallet, Confirmation, Job, JobPayment, JobState, PaymentsStore, Quote, ReserveResult, SpendOutcome, SpendReservation,
} from "./types.ts";

const lower = <T extends string>(v: T) => v.toLowerCase() as T;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

type WalletRow = { owner_ref: string; network: AgonNetworkId; circle_wallet_id: string; address: Address; per_hire_cap: string; daily_cap: string; frozen: boolean; created_at: Date };
type ConfirmationRow = { code_hash: Hex; wallet_ref: string; job_id: string; amount: string; payee: Address; expires_at: Date; used_at: Date | null; attempts: number; created_at: Date };
type ApprovalRow = { token_hash: Hex; wallet_ref: string; action: Approval["action"]; payload: Record<string, unknown>; expires_at: Date; used_at: Date | null };
type QuoteRow = { quote_id: string; seller_key: string; buyer: Address; amount: string; expires_at: Date; used_at: Date | null; transcript: unknown[] };
export type JobRow = {
  job_id: string; parent_id: string | null; root_id: string; depth: number; buyer_ref: string; provider_ref: string; provider_label: string; network: AgonNetworkId;
  price_atomic: string; budget_atomic: string; state: JobState; trace_id: string; request: Record<string, unknown>; result: unknown; created_at: Date; updated_at: Date;
};
export type PaymentRow = {
  idempotency_key: string; job_id: string; kind: JobPayment["kind"]; payer: Address; payee: Address; amount: string; network: AgonNetworkId; status: JobPayment["status"];
  tx_hash: Hex | null; detail: string | null; auth_nonce: Hex | null; auth_valid_before: Date | null; created_at: Date; updated_at: Date;
};

const toWallet = (r: WalletRow): BudgetWallet => ({
  ownerRef: r.owner_ref, network: r.network, walletId: r.circle_wallet_id, address: r.address,
  perHireCap: BigInt(r.per_hire_cap), dailyCap: BigInt(r.daily_cap), frozen: r.frozen, createdAt: r.created_at,
});
const toConfirmation = (r: ConfirmationRow): Confirmation => ({
  codeHash: r.code_hash, walletRef: r.wallet_ref, jobId: r.job_id, amount: BigInt(r.amount), payee: r.payee,
  expiresAt: r.expires_at, usedAt: r.used_at, attempts: r.attempts, createdAt: r.created_at,
});
const toApproval = (r: ApprovalRow): Approval => ({ tokenHash: r.token_hash, walletRef: r.wallet_ref, action: r.action, payload: r.payload, expiresAt: r.expires_at, usedAt: r.used_at });
const toQuote = (r: QuoteRow): Quote => ({ quoteId: r.quote_id, sellerKey: r.seller_key, buyer: r.buyer, amount: BigInt(r.amount), expiresAt: r.expires_at, usedAt: r.used_at, transcript: r.transcript });
export const toJob = (r: JobRow): Job => ({
  jobId: r.job_id, parentId: r.parent_id, rootId: r.root_id, depth: r.depth, buyerRef: r.buyer_ref, providerRef: r.provider_ref, providerLabel: r.provider_label,
  network: r.network, priceAtomic: BigInt(r.price_atomic), budgetAtomic: BigInt(r.budget_atomic), state: r.state, traceId: r.trace_id,
  request: r.request, result: r.result, createdAt: r.created_at, updatedAt: r.updated_at,
});
export const toPayment = (r: PaymentRow): JobPayment => ({
  idempotencyKey: r.idempotency_key, jobId: r.job_id, kind: r.kind, payer: r.payer, payee: r.payee, amount: BigInt(r.amount), network: r.network,
  status: r.status, txHash: r.tx_hash, detail: r.detail, authNonce: r.auth_nonce, authValidBefore: r.auth_valid_before, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class PostgresPaymentsStore implements PaymentsStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async getBudgetWallet(ownerRef: string, network: AgonNetworkId): Promise<BudgetWallet | null> {
    const { rows } = await this.pool.query<WalletRow>("select * from agon_budget_wallets where owner_ref = $1 and network = $2", [ownerRef, network]);
    return rows[0] ? toWallet(rows[0]) : null;
  }

  async insertBudgetWallet(w: BudgetWallet): Promise<BudgetWallet> {
    await this.pool.query(
      `insert into agon_budget_wallets (owner_ref, network, circle_wallet_id, address, per_hire_cap, daily_cap, frozen)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
      [w.ownerRef, w.network, w.walletId, lower(w.address), w.perHireCap.toString(), w.dailyCap.toString(), w.frozen],
    );
    return (await this.getBudgetWallet(w.ownerRef, w.network))!;
  }

  async updateBudgetWallet(ownerRef: string, network: AgonNetworkId, patch: { perHireCap?: bigint; dailyCap?: bigint; frozen?: boolean }): Promise<BudgetWallet | null> {
    const { rows } = await this.pool.query<WalletRow>(
      `update agon_budget_wallets
          set per_hire_cap = coalesce($3, per_hire_cap), daily_cap = coalesce($4, daily_cap), frozen = coalesce($5, frozen)
        where owner_ref = $1 and network = $2 returning *`,
      [ownerRef, network, patch.perHireCap?.toString() ?? null, patch.dailyCap?.toString() ?? null, patch.frozen ?? null],
    );
    return rows[0] ? toWallet(rows[0]) : null;
  }

  /// One advisory lock per wallet and day serialises reservations, so two
  /// confirmations at the same moment cannot both pass the daily cap.
  async reserveSpend(s: SpendReservation): Promise<ReserveResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const day = utcDay(s.now);
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${s.walletRef}|${s.network}|${day}`]);
      const existing = await client.query("select 1 from agon_wallet_spends where wallet_ref = $1 and idempotency_key = $2", [s.walletRef, s.idempotencyKey]);
      if (existing.rowCount) {
        await client.query("commit");
        return "duplicate";
      }
      if (s.amount > s.perPaymentCap) {
        await client.query("rollback");
        return "over_per_payment";
      }
      const { rows } = await client.query<{ total: string }>(
        `select coalesce(sum(amount), 0)::text as total from agon_wallet_spends
          where wallet_ref = $1 and network = $2 and day = $3 and state in ('reserved', 'settled')`,
        [s.walletRef, s.network, day],
      );
      if (BigInt(rows[0]!.total) + s.amount > s.dailyCap) {
        await client.query("rollback");
        return "over_daily";
      }
      await client.query(
        `insert into agon_wallet_spends (wallet_ref, idempotency_key, network, day, amount, payee, job_id, state)
         values ($1, $2, $3, $4, $5, $6, $7, 'reserved')`,
        [s.walletRef, s.idempotencyKey, s.network, day, s.amount.toString(), lower(s.payee), s.jobId],
      );
      await client.query("commit");
      return "reserved";
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async finishSpend(walletRef: string, idempotencyKey: string, outcome: SpendOutcome): Promise<void> {
    await this.pool.query(
      "update agon_wallet_spends set state = $3, tx_hash = $4, updated_at = now() where wallet_ref = $1 and idempotency_key = $2 and state = 'reserved'",
      [walletRef, idempotencyKey, outcome.state, outcome.state === "settled" ? (outcome.txHash ? lower(outcome.txHash) : null) : null],
    );
  }

  async insertConfirmation(c: Confirmation): Promise<void> {
    await this.pool.query(
      `insert into agon_pay_confirmations (code_hash, wallet_ref, job_id, amount, payee, expires_at, used_at, attempts, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [lower(c.codeHash), c.walletRef, c.jobId, c.amount.toString(), lower(c.payee), c.expiresAt, c.usedAt, c.attempts, c.createdAt],
    );
  }

  async latestConfirmation(walletRef: string): Promise<Confirmation | null> {
    const { rows } = await this.pool.query<ConfirmationRow>("select * from agon_pay_confirmations where wallet_ref = $1 order by created_at desc limit 1", [walletRef]);
    return rows[0] ? toConfirmation(rows[0]) : null;
  }

  async updateConfirmation(codeHash: Hex, patch: { attempts?: number; usedAt?: Date }): Promise<void> {
    await this.pool.query(
      "update agon_pay_confirmations set attempts = coalesce($2, attempts), used_at = coalesce($3, used_at) where code_hash = $1",
      [lower(codeHash), patch.attempts ?? null, patch.usedAt ?? null],
    );
  }

  async insertApproval(a: Approval): Promise<void> {
    await this.pool.query(
      "insert into agon_wallet_approvals (token_hash, wallet_ref, action, payload, expires_at, used_at) values ($1, $2, $3, $4, $5, $6)",
      [lower(a.tokenHash), a.walletRef, a.action, JSON.stringify(a.payload), a.expiresAt, a.usedAt],
    );
  }

  async getApproval(tokenHash: Hex): Promise<Approval | null> {
    const { rows } = await this.pool.query<ApprovalRow>("select * from agon_wallet_approvals where token_hash = $1", [lower(tokenHash)]);
    return rows[0] ? toApproval(rows[0]) : null;
  }

  async useApproval(tokenHash: Hex, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      "update agon_wallet_approvals set used_at = $2 where token_hash = $1 and used_at is null and expires_at > $2",
      [lower(tokenHash), now],
    );
    return result.rowCount === 1;
  }

  async claimSellerNonce(network: AgonNetworkId, payer: Address, nonce: Hex): Promise<boolean> {
    const result = await this.pool.query(
      "insert into agon_x402_seller_nonces (network, payer, nonce) values ($1, $2, $3) on conflict do nothing",
      [network, lower(payer), lower(nonce)],
    );
    return result.rowCount === 1;
  }

  async insertQuote(q: Quote): Promise<void> {
    await this.pool.query(
      "insert into agon_x402_quotes (quote_id, seller_key, buyer, amount, expires_at, used_at, transcript) values ($1, $2, $3, $4, $5, $6, $7)",
      [q.quoteId, q.sellerKey, lower(q.buyer), q.amount.toString(), q.expiresAt, q.usedAt, JSON.stringify(q.transcript)],
    );
  }

  async getQuote(quoteId: string): Promise<Quote | null> {
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) return null;
    const { rows } = await this.pool.query<QuoteRow>("select * from agon_x402_quotes where quote_id = $1", [quoteId]);
    return rows[0] ? toQuote(rows[0]) : null;
  }

  async useQuote(quoteId: string, buyer: Address, now: Date): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/i.test(quoteId)) return false;
    const result = await this.pool.query(
      "update agon_x402_quotes set used_at = $3 where quote_id = $1 and buyer = $2 and used_at is null and expires_at > $3",
      [quoteId, lower(buyer), now],
    );
    return result.rowCount === 1;
  }

  async insertJob(j: Job): Promise<void> {
    await this.pool.query(
      `insert into agon_jobs (job_id, parent_id, root_id, depth, buyer_ref, provider_ref, provider_label, network, price_atomic, budget_atomic, state, trace_id, request, result, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [j.jobId, j.parentId, j.rootId, j.depth, j.buyerRef, j.providerRef, j.providerLabel, j.network, j.priceAtomic.toString(), j.budgetAtomic.toString(),
        j.state, j.traceId, JSON.stringify(j.request), j.result === null || j.result === undefined ? null : JSON.stringify(j.result), j.createdAt, j.updatedAt],
    );
  }

  async updateJob(jobId: string, patch: { state?: JobState; result?: unknown; budgetAtomic?: bigint }): Promise<void> {
    await this.pool.query(
      `update agon_jobs set state = coalesce($2, state), result = coalesce($3::jsonb, result), budget_atomic = coalesce($4, budget_atomic), updated_at = now()
        where job_id = $1`,
      [jobId, patch.state ?? null, patch.result === undefined ? null : JSON.stringify(patch.result), patch.budgetAtomic?.toString() ?? null],
    );
  }

  async getJob(jobId: string): Promise<Job | null> {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
    const { rows } = await this.pool.query<JobRow>("select * from agon_jobs where job_id = $1", [jobId]);
    return rows[0] ? toJob(rows[0]) : null;
  }

  async listJobTree(rootId: string): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>("select * from agon_jobs where root_id = $1 order by depth, created_at", [rootId]);
    return rows.map(toJob);
  }

  async listStuckJobs(state: JobState, updatedBefore: Date): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>("select * from agon_jobs where state = $1 and updated_at < $2 order by updated_at limit 100", [state, updatedBefore]);
    return rows.map(toJob);
  }

  async listJobsByBuyer(buyerRef: string, limit: number): Promise<Job[]> {
    const { rows } = await this.pool.query<JobRow>(
      "select * from agon_jobs where buyer_ref = $1 and parent_id is null order by created_at desc limit $2",
      [buyerRef, Math.max(1, Math.min(limit, 100))],
    );
    return rows.map(toJob);
  }

  async dailySpent(walletRef: string, network: AgonNetworkId, now: Date): Promise<bigint> {
    const { rows } = await this.pool.query<{ total: string }>(
      `select coalesce(sum(amount), 0)::text as total from agon_wallet_spends
        where wallet_ref = $1 and network = $2 and day = $3 and state in ('reserved', 'settled')`,
      [walletRef, network, utcDay(now)],
    );
    return BigInt(rows[0]!.total);
  }

  async upsertJobPayment(p: JobPayment): Promise<void> {
    await this.pool.query(
      `insert into agon_job_payments (idempotency_key, job_id, kind, payer, payee, amount, network, status, tx_hash, detail, auth_nonce, auth_valid_before)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (idempotency_key) do update set
         status = excluded.status,
         tx_hash = coalesce(excluded.tx_hash, agon_job_payments.tx_hash),
         detail = coalesce(excluded.detail, agon_job_payments.detail),
         auth_nonce = coalesce(agon_job_payments.auth_nonce, excluded.auth_nonce),
         auth_valid_before = coalesce(agon_job_payments.auth_valid_before, excluded.auth_valid_before),
         updated_at = now()`,
      [p.idempotencyKey, p.jobId, p.kind, lower(p.payer), lower(p.payee), p.amount.toString(), p.network, p.status,
        p.txHash ? lower(p.txHash) : null, p.detail, p.authNonce ? lower(p.authNonce) : null, p.authValidBefore],
    );
  }

  async listJobPayments(rootId: string): Promise<JobPayment[]> {
    const { rows } = await this.pool.query<PaymentRow>(
      "select p.* from agon_job_payments p join agon_jobs j on j.job_id = p.job_id where j.root_id = $1 order by p.created_at",
      [rootId],
    );
    return rows.map(toPayment);
  }
}
