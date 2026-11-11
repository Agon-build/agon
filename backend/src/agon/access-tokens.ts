import { createHash, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";

/// Agent access tokens: named, revocable tokens a builder creates in Account to
/// connect a coding agent over MCP. Only a hash is stored.
export type AccessLevel = "read" | "listing" | "hiring" | "full" | "budget";
export const ACCESS_LEVEL_SCOPES: Record<AccessLevel, readonly string[]> = {
  read: ["agon:read"],
  listing: ["agon:read", "listing:prepare", "listing:write", "listing:confirm"],
  hiring: ["agon:read", "wallet:execute"],
  full: ["agon:read", "listing:prepare", "listing:write", "listing:confirm", "wallet:execute"],
  // A budget token never holds wallet:execute: it cannot confirm a code or approve a hire.
  // It pays only inside hire_service, inside its own caps.
  budget: ["agon:read", "budget:spend"],
};
/// A standing budget: what a budget token may spend with no per-hire code. Amounts are USDC base units.
export type TokenBudget = {
  perHireCap: bigint;
  dailyCap: bigint;
  /** Hire categories the token may spend in; null allows every category. */
  categories: string[] | null;
  /** False keeps the token to Agon's own agents, which are paid in test USDC. */
  allowOutside: boolean;
};
/// The budget as a connection carries it: the caps and the token they belong to.
export type BudgetClaim = TokenBudget & { tokenId: string };
/// The most a budget token may be given, whatever the person asks for: 5 USDC a hire, 50 USDC a day.
export const BUDGET_MAX_PER_HIRE = 5_000_000n;
export const BUDGET_MAX_DAILY = 50_000_000n;
export const BUDGET_DEFAULT_PER_HIRE = 500_000n;
export const BUDGET_DEFAULT_DAILY = 5_000_000n;
export const BUDGET_CATEGORIES = ["prediction", "research", "market_data", "social", "creative", "developer", "business"] as const;

/// Whether a budget is one a token may hold; the reason when it is not.
export function budgetProblem(b: TokenBudget): "invalid_caps" | "caps_too_high" | "invalid_categories" | null {
  if (b.perHireCap <= 0n || b.dailyCap < b.perHireCap) return "invalid_caps";
  if (b.perHireCap > BUDGET_MAX_PER_HIRE || b.dailyCap > BUDGET_MAX_DAILY) return "caps_too_high";
  if (b.categories && (b.categories.length === 0 || b.categories.some((c) => !(BUDGET_CATEGORIES as readonly string[]).includes(c)))) return "invalid_categories";
  return null;
}
export const ACCESS_TOKEN_PREFIX = "agon_pat_";
export const MAX_ACTIVE_TOKENS = 10;

export type AccessTokenRecord = { id: string; owner: string; name: string; level: AccessLevel; createdAt: Date; expiresAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; budget: TokenBudget | null };
export type McpClaims = { address: string; client: string | null; scopes: string[]; budget?: BudgetClaim };
export type BudgetReserve = "reserved" | "over_daily" | "duplicate";

/// The ledger of what budget tokens spend. A reservation is made before the payment and
/// released only when it is known that no money moved.
export interface BudgetLedger {
  reserve(input: { tokenId: string; jobId: string; amount: bigint; dailyCap: bigint; now: Date }): Promise<BudgetReserve>;
  release(tokenId: string, jobId: string): Promise<void>;
  spentToday(tokenId: string, now: Date): Promise<bigint>;
  /** Whether the token can still spend: not revoked and not expired at this moment. */
  usable(tokenId: string, now: Date): Promise<boolean>;
}
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);
export type McpTokenResult = McpClaims | { problem: "expired" | "revoked" | "unknown" } | null;

export interface AccessTokenStore {
  create(input: { owner: string; name: string; level: AccessLevel; days: 7 | 30 | 90; now: Date; budget?: TokenBudget }): Promise<{ ok: true; token: string; record: AccessTokenRecord } | { ok: false; code: "too_many_tokens" | "budget_required" | "budget_not_allowed" | NonNullable<ReturnType<typeof budgetProblem>> }>;
  list(owner: string): Promise<AccessTokenRecord[]>;
  revoke(owner: string, id: string, now: Date): Promise<boolean>;
  verify(token: string, now: Date): Promise<{ ok: true; claims: { address: string; client: "agon-cli"; scopes: string[]; budget?: BudgetClaim } } | { ok: false; reason: "unknown" | "expired" | "revoked" }>;
}

export function newAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

type Row = { id: string; owner_address: string; name: string; level: AccessLevel; created_at: Date; expires_at: Date; last_used_at: Date | null; revoked_at: Date | null; per_hire_cap: string | null; daily_cap: string | null; categories: string[] | null; allow_outside: boolean | null };
const budgetOf = (r: Row): TokenBudget | null =>
  r.level === "budget" && r.per_hire_cap !== null && r.daily_cap !== null
    ? { perHireCap: BigInt(r.per_hire_cap), dailyCap: BigInt(r.daily_cap), categories: r.categories ?? null, allowOutside: r.allow_outside === true }
    : null;
const toRecord = (r: Row): AccessTokenRecord => ({
  id: r.id, owner: r.owner_address, name: r.name, level: r.level, createdAt: r.created_at, expiresAt: r.expires_at, lastUsedAt: r.last_used_at, revokedAt: r.revoked_at, budget: budgetOf(r),
});

export class PostgresAccessTokenStore implements AccessTokenStore, BudgetLedger {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) { this.pool = pool; }

  async create(input: { owner: string; name: string; level: AccessLevel; days: 7 | 30 | 90; now: Date; budget?: TokenBudget }) {
    const owner = input.owner.toLowerCase();
    // A budget belongs to a budget token and to nothing else.
    if (input.level === "budget" && !input.budget) return { ok: false as const, code: "budget_required" as const };
    if (input.level !== "budget" && input.budget) return { ok: false as const, code: "budget_not_allowed" as const };
    const problem = input.budget ? budgetProblem(input.budget) : null;
    if (problem) return { ok: false as const, code: problem };
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      // One writer per owner at a time, so two parallel creates cannot both pass the cap.
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`agon_access_tokens:${owner}`]);
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from agon_access_tokens where owner_address = $1 and revoked_at is null and expires_at > $2",
        [owner, input.now],
      );
      if (Number(rows[0]!.n) >= MAX_ACTIVE_TOKENS) {
        await client.query("rollback");
        return { ok: false as const, code: "too_many_tokens" as const };
      }
      const token = newAccessToken();
      const expiresAt = new Date(input.now.getTime() + input.days * 86_400_000);
      const inserted = await client.query<Row>(
        `insert into agon_access_tokens (id, owner_address, name, level, token_hash, created_at, expires_at, per_hire_cap, daily_cap, categories, allow_outside)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
        [randomUUID(), owner, input.name.trim(), input.level, hashAccessToken(token), input.now, expiresAt,
          input.budget ? input.budget.perHireCap.toString() : null, input.budget ? input.budget.dailyCap.toString() : null, input.budget?.categories ?? null, input.budget?.allowOutside ?? false],
      );
      await client.query("commit");
      return { ok: true as const, token, record: toRecord(inserted.rows[0]!) };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async list(owner: string) {
    const { rows } = await this.pool.query<Row>("select * from agon_access_tokens where owner_address = $1 order by created_at desc limit 50", [owner.toLowerCase()]);
    return rows.map(toRecord);
  }

  async revoke(owner: string, id: string, now: Date) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const { rowCount } = await this.pool.query(
      "update agon_access_tokens set revoked_at = coalesce(revoked_at, $3) where id = $1 and owner_address = $2",
      [id, owner.toLowerCase(), now],
    );
    return (rowCount ?? 0) > 0;
  }

  async verify(token: string, now: Date) {
    const { rows } = await this.pool.query<Row>("select * from agon_access_tokens where token_hash = $1", [hashAccessToken(token)]);
    const row = rows[0];
    if (!row) return { ok: false as const, reason: "unknown" as const };
    if (row.revoked_at) return { ok: false as const, reason: "revoked" as const };
    if (row.expires_at <= now) return { ok: false as const, reason: "expired" as const };
    await this.pool.query("update agon_access_tokens set last_used_at = $2 where id = $1", [row.id, now]);
    const budget = budgetOf(row);
    // A budget token whose caps cannot be read spends nothing: it is treated as unknown.
    if (row.level === "budget" && !budget) return { ok: false as const, reason: "unknown" as const };
    return { ok: true as const, claims: { address: row.owner_address, client: "agon-cli" as const, scopes: [...ACCESS_LEVEL_SCOPES[row.level]], ...(budget ? { budget: { ...budget, tokenId: row.id } } : {}) } };
  }

  /// One advisory lock per token and day serialises reservations, so two hires at once
  /// cannot both pass the daily cap.
  async reserve(input: { tokenId: string; jobId: string; amount: bigint; dailyCap: bigint; now: Date }): Promise<BudgetReserve> {
    const day = utcDay(input.now);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`agon_token_spends:${input.tokenId}|${day}`]);
      const seen = await client.query("select 1 from agon_token_spends where token_id = $1 and job_id = $2", [input.tokenId, input.jobId]);
      if ((seen.rowCount ?? 0) > 0) { await client.query("rollback"); return "duplicate"; }
      const { rows } = await client.query<{ total: string }>("select coalesce(sum(amount), 0)::text as total from agon_token_spends where token_id = $1 and day = $2", [input.tokenId, day]);
      if (BigInt(rows[0]!.total) + input.amount > input.dailyCap) { await client.query("rollback"); return "over_daily"; }
      await client.query("insert into agon_token_spends (token_id, job_id, day, amount, created_at) values ($1, $2, $3, $4, $5)", [input.tokenId, input.jobId, day, input.amount.toString(), input.now]);
      await client.query("commit");
      return "reserved";
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async release(tokenId: string, jobId: string): Promise<void> {
    await this.pool.query("delete from agon_token_spends where token_id = $1 and job_id = $2", [tokenId, jobId]);
  }

  async spentToday(tokenId: string, now: Date): Promise<bigint> {
    const { rows } = await this.pool.query<{ total: string }>("select coalesce(sum(amount), 0)::text as total from agon_token_spends where token_id = $1 and day = $2", [tokenId, utcDay(now)]);
    return BigInt(rows[0]!.total);
  }

  async usable(tokenId: string, now: Date): Promise<boolean> {
    const { rows } = await this.pool.query("select 1 from agon_access_tokens where id = $1 and level = 'budget' and revoked_at is null and expires_at > $2", [tokenId, now]);
    return rows.length > 0;
  }
}

/// The MCP endpoint's token check: Agent access tokens first, then device sign-in tokens.
export function createMcpTokenVerifier(
  store: AccessTokenStore,
  verifyJwt: (token: string) => Promise<McpClaims | null>,
  now: () => Date = () => new Date(),
  oauth?: (token: string) => Promise<McpClaims | null>,
) {
  return async (raw: string): Promise<McpTokenResult> => {
    const token = raw.trim();
    if (token.startsWith("agon_oat_")) return (oauth ? await oauth(token) : null) ?? { problem: "unknown" };
    if (token.startsWith(ACCESS_TOKEN_PREFIX)) {
      const out = await store.verify(token, now());
      return out.ok ? out.claims : { problem: out.reason };
    }
    return verifyJwt(token);
  };
}
