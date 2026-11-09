import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";

import { otpSendRefusal } from "./emailOtpLimits.ts";

/// Email code storage and checks, with the database and pepper passed in so
/// the rules can be tested against Postgres. emailOtp.ts wires in the app's
/// pool and config.
///
/// Code: 6 digits, 10 minute TTL, 5 tries, 60 s resend cooldown, daily send
/// caps (emailOtpLimits.ts). At rest: sha256 of `${code}:${pepper}`.
///
/// A correct code returns a one-time verification token to the client that
/// typed it (32 random bytes, only its sha256 is stored, 15 minutes). The
/// sign-in routes need that token; knowing the email is not enough (audit B1,
/// 2026-11-09). The token hash is compared inside Postgres; it is a hash of a
/// 256-bit secret, so the comparison time says nothing useful about it.

export const OTP_TTL_MS = 10 * 60 * 1000;
export const VERIFY_TTL_MS = 15 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;

export type OtpDb = Pick<pg.Pool, "query">;

export class OtpError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");
const codeHash = (code: string, pepper: string) => sha256(`${code}:${pepper}`);
const tokenHash = (token: string) => sha256(`email-verification|${token}`);
const normal = (email: string) => email.trim().toLowerCase();

/// Records a new code and hands it to `deliver`. Replaces any earlier code
/// for the email, which also voids its verification token.
export async function startOtp(
  db: OtpDb,
  input: { email: string; ip: string; pepper: string; now: Date; generate: () => string; deliver: (email: string, code: string) => Promise<void> },
): Promise<void> {
  const email = normal(input.email);
  const counts = await db.query<{ email_today: string; ip_today: string }>(
    `select count(*) filter (where email = $1) as email_today, count(*) filter (where ip = $2) as ip_today
       from email_otp_sends where created_at > $3::timestamptz - interval '1 day' and (email = $1 or ip = $2)`,
    [email, input.ip, input.now],
  );
  const refusal = otpSendRefusal({ emailToday: Number(counts.rows[0]?.email_today ?? 0), ipToday: Number(counts.rows[0]?.ip_today ?? 0) });
  if (refusal) throw new OtpError(refusal, "too many codes requested today; try again tomorrow", 429);
  const { rows } = await db.query<{ created_at: Date; verified_at: Date | null }>(
    "select created_at, verified_at from email_otp where email = $1",
    [email],
  );
  const existing = rows[0];
  if (existing && !existing.verified_at) {
    const age = input.now.getTime() - new Date(existing.created_at).getTime();
    if (age < RESEND_COOLDOWN_MS) {
      throw new OtpError("otp_cooldown", `please wait ${Math.ceil((RESEND_COOLDOWN_MS - age) / 1000)}s before requesting a new code`, 429);
    }
  }
  const code = input.generate();
  await db.query(
    `insert into email_otp (email, code_hash, expires_at, attempts, verified_at, verification_hash, created_at)
       values ($1, $2, $3, 0, null, null, $4)
       on conflict (email)
       do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                     attempts = 0, verified_at = null, verification_hash = null, created_at = excluded.created_at`,
    [email, codeHash(code, input.pepper), new Date(input.now.getTime() + OTP_TTL_MS), input.now],
  );
  await db.query("insert into email_otp_sends (email, ip, created_at) values ($1, $2, $3)", [email, input.ip.slice(0, 80), input.now]);
  await input.deliver(email, code);
}

/// Checks a typed code. The try is counted in the same statement that reads
/// the code, so parallel guesses cannot pass the five-try cap (audit B3).
/// Returns the one-time token the caller must present to sign in.
export async function verifyOtp(
  db: OtpDb,
  input: { email: string; code: string; pepper: string; now: Date; token?: () => string },
): Promise<{ verificationToken: string }> {
  const email = normal(input.email);
  const submitted = input.code.trim();
  if (!/^[0-9]{6}$/.test(submitted)) throw new OtpError("otp_invalid_format", "code must be 6 digits", 400);
  const counted = await db.query<{ code_hash: string; expires_at: Date }>(
    "update email_otp set attempts = attempts + 1 where email = $1 and attempts < $2 returning code_hash, expires_at",
    [email, MAX_ATTEMPTS],
  );
  const row = counted.rows[0];
  if (!row) {
    const exists = await db.query("select 1 from email_otp where email = $1", [email]);
    if (exists.rowCount === 0) throw new OtpError("otp_not_started", "no pending verification for this email", 400);
    throw new OtpError("otp_too_many_attempts", "too many tries; request a new code", 429);
  }
  if (new Date(row.expires_at).getTime() < input.now.getTime()) {
    await db.query("delete from email_otp where email = $1 and code_hash = $2", [email, row.code_hash]);
    throw new OtpError("otp_expired", "code expired; request a new one", 410);
  }
  if (codeHash(submitted, input.pepper) !== row.code_hash) throw new OtpError("otp_mismatch", "wrong code", 400);
  const token = (input.token ?? (() => randomBytes(32).toString("base64url")))();
  const saved = await db.query(
    "update email_otp set verified_at = $3, verification_hash = $4 where email = $1 and code_hash = $2",
    [email, row.code_hash, input.now, tokenHash(token)],
  );
  // A new code was requested between the read and this write; this one is void.
  if (saved.rowCount !== 1) throw new OtpError("otp_expired", "code replaced; request a new one", 410);
  return { verificationToken: token };
}

const fresh = (now: Date) => new Date(now.getTime() - VERIFY_TTL_MS);

/// True when `token` is the live token for `email`. Does not use it up.
export async function checkVerification(db: OtpDb, input: { email: string; token: unknown; now: Date }): Promise<boolean> {
  if (typeof input.token !== "string" || input.token.length < 32 || input.token.length > 128) return false;
  const { rowCount } = await db.query(
    "select 1 from email_otp where email = $1 and verification_hash = $2 and verified_at > $3",
    [normal(input.email), tokenHash(input.token), fresh(input.now)],
  );
  return rowCount === 1;
}

/// Uses the token up. True for exactly one caller holding the live token.
export async function claimVerification(db: OtpDb, input: { email: string; token: unknown; now: Date }): Promise<boolean> {
  if (typeof input.token !== "string" || input.token.length < 32 || input.token.length > 128) return false;
  const { rowCount } = await db.query(
    "delete from email_otp where email = $1 and verification_hash = $2 and verified_at > $3",
    [normal(input.email), tokenHash(input.token), fresh(input.now)],
  );
  return rowCount === 1;
}
