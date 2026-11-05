import { createHash, randomInt } from "node:crypto";
import type pg from "pg";

/// An email a person added for deliveries, confirmed with a 6-digit code. It is kept
/// apart from the sign-in email, so adding one can never clash with an email account:
/// a wallet account gets its results by email without becoming an email account.

export const CODE_TTL_MS = 10 * 60_000;
export const CODE_ATTEMPTS = 5;
export const RESEND_MS = 60_000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function validEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

const hashCode = (operator: string, code: string) => createHash("sha256").update(`${operator}:${code}`).digest("hex");

export type StartOutcome = { ok: true; code: string; email: string } | { ok: false; reason: "invalid_email" | "too_soon" };
export type VerifyOutcome = { ok: true; email: string } | { ok: false; reason: "no_code" | "expired" | "wrong_code" | "too_many_attempts" };

export interface DeliveryEmails {
  start(operator: string, rawEmail: string, now: Date): Promise<StartOutcome>;
  verify(operator: string, code: string, now: Date): Promise<VerifyOutcome>;
  added(operator: string): Promise<string | null>;
  pending(operator: string, now: Date): Promise<string | null>;
  remove(operator: string): Promise<void>;
}

type CodeRow = { email: string; codeHash: string; expiresAt: Date; attempts: number; createdAt: Date };

/// The rules, shared by the stores: one code per minute, ten minutes to use it, five tries.
async function startWith(read: () => Promise<CodeRow | null>, write: (row: CodeRow) => Promise<void>, operator: string, rawEmail: string, now: Date): Promise<StartOutcome> {
  const email = validEmail(rawEmail);
  if (!email) return { ok: false, reason: "invalid_email" };
  const last = await read();
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_MS) return { ok: false, reason: "too_soon" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await write({ email, codeHash: hashCode(operator, code), expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0, createdAt: now });
  return { ok: true, code, email };
}

function check(row: CodeRow | null, operator: string, code: string, now: Date): VerifyOutcome | "count" {
  if (!row) return { ok: false, reason: "no_code" };
  if (row.attempts >= CODE_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (!/^\d{6}$/.test(code.trim()) || hashCode(operator, code.trim()) !== row.codeHash) return "count";
  return { ok: true, email: row.email };
}

export class MemoryDeliveryEmails implements DeliveryEmails {
  readonly codes = new Map<string, CodeRow>();
  readonly emails = new Map<string, string>();
  start(operator: string, rawEmail: string, now: Date) {
    return startWith(async () => this.codes.get(operator) ?? null, async (row) => { this.codes.set(operator, row); }, operator, rawEmail, now);
  }
  async verify(operator: string, code: string, now: Date): Promise<VerifyOutcome> {
    const row = this.codes.get(operator) ?? null;
    const out = check(row, operator, code, now);
    if (out === "count") { row!.attempts += 1; return { ok: false, reason: "wrong_code" }; }
    if (out.ok) { this.emails.set(operator, out.email); this.codes.delete(operator); }
    return out;
  }
  async added(operator: string) { return this.emails.get(operator) ?? null; }
  async pending(operator: string, now: Date) { const r = this.codes.get(operator); return r && r.expiresAt > now && r.attempts < CODE_ATTEMPTS ? r.email : null; }
  async remove(operator: string) { this.emails.delete(operator); this.codes.delete(operator); }
}

export class PostgresDeliveryEmails implements DeliveryEmails {
  private readonly pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.pool = pool;
  }
  private async row(operator: string): Promise<CodeRow | null> {
    const { rows } = await this.pool.query<{ email: string; code_hash: string; expires_at: Date; attempts: number; created_at: Date }>(
      "select email, code_hash, expires_at, attempts, created_at from agon_delivery_email_codes where operator = $1", [operator]);
    const r = rows[0];
    return r ? { email: r.email, codeHash: r.code_hash, expiresAt: r.expires_at, attempts: r.attempts, createdAt: r.created_at } : null;
  }
  start(operator: string, rawEmail: string, now: Date) {
    return startWith(() => this.row(operator), async (r) => {
      await this.pool.query(
        `insert into agon_delivery_email_codes (operator, email, code_hash, expires_at, attempts, created_at) values ($1, $2, $3, $4, 0, $5)
         on conflict (operator) do update set email = excluded.email, code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
        [operator, r.email, r.codeHash, r.expiresAt, r.createdAt]);
    }, operator, rawEmail, now);
  }
  async verify(operator: string, code: string, now: Date): Promise<VerifyOutcome> {
    const out = check(await this.row(operator), operator, code, now);
    if (out === "count") {
      await this.pool.query("update agon_delivery_email_codes set attempts = attempts + 1 where operator = $1", [operator]);
      return { ok: false, reason: "wrong_code" };
    }
    if (out.ok) {
      await this.pool.query(
        `insert into agon_delivery_emails (operator, email, verified_at) values ($1, $2, $3)
         on conflict (operator) do update set email = excluded.email, verified_at = excluded.verified_at`, [operator, out.email, now]);
      await this.pool.query("delete from agon_delivery_email_codes where operator = $1", [operator]);
    }
    return out;
  }
  async added(operator: string) {
    const { rows } = await this.pool.query<{ email: string }>("select email from agon_delivery_emails where operator = $1", [operator]);
    return rows[0]?.email ?? null;
  }
  async pending(operator: string, now: Date) {
    const r = await this.row(operator);
    return r && r.expiresAt > now && r.attempts < CODE_ATTEMPTS ? r.email : null;
  }
  async remove(operator: string) {
    await this.pool.query("delete from agon_delivery_emails where operator = $1", [operator]);
    await this.pool.query("delete from agon_delivery_email_codes where operator = $1", [operator]);
  }
}
