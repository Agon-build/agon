import { createHash } from "node:crypto";

import { config } from "../config/index.js";
import { query } from "../db/pool.js";
import { sendEmail } from "../email/client.js";
import { otpEmailTemplate } from "../email/templates.js";
import { generateOtpCode, otpSendRefusal } from "./emailOtpLimits.js";

/// Email OTP proof-of-ownership. Required at first-time signup so an
/// attacker can't claim someone else's email and mint a Circle wallet
/// under it. Returning passkey users skip this; the passkey itself
/// is the proof.
///
/// Code: 6 digits, 10 minute TTL, 5 attempt cap, 60s resend cooldown,
/// and daily send caps per email and per address (emailOtpLimits.ts).
/// At-rest: sha256 of `${code}:${OTP_PEPPER}` so a DB dump doesn't
/// leak live codes (the pepper lives in env, not in the DB).
/// Verified state: a row's `verified_at` non-null within
/// VERIFY_TTL_MS lets /auth/email/begin proceed for that email.

const OTP_TTL_MS = 10 * 60 * 1000;
const VERIFY_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

export class OtpError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

function hashCode(code: string): string {
  const pepper = config.auth.emailOtp.pepper ?? "dev-pepper-not-for-prod";
  return createHash("sha256").update(`${code}:${pepper}`).digest("hex");
}

async function sendCode(email: string, code: string): Promise<void> {
  // Dev (non-resend) provider: log the code so test flows can read it without
  // an SMTP setup. Clearly tagged so prod logs never leak a code by accident.
  if (config.auth.emailOtp.provider !== "resend") {
    console.log(`[EMAIL OTP · DEV] ${email} → ${code} (expires in 10 min)`);
    return;
  }
  // Production: send the brand-styled email through the shared sender.
  const tpl = otpEmailTemplate(code);
  try {
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (err) {
    throw new OtpError("email_send_failed", err instanceof Error ? err.message : String(err), 502);
  }
}

/// Begin a verification: generate a code, persist its hash, send the
/// email. Honors a 60s resend cooldown so the endpoint can't be used
/// as a relay for outbound spam. Idempotent on email: replaces any
/// existing pending row.
export async function startEmailOtp(email: string, ip = "unknown"): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const counts = await query<{ email_today: string; ip_today: string }>(
    `select count(*) filter (where email = $1) as email_today, count(*) filter (where ip = $2) as ip_today
       from email_otp_sends where created_at > now() - interval '1 day' and (email = $1 or ip = $2)`,
    [normalized, ip],
  );
  const refusal = otpSendRefusal({ emailToday: Number(counts.rows[0]?.email_today ?? 0), ipToday: Number(counts.rows[0]?.ip_today ?? 0) });
  if (refusal) throw new OtpError(refusal, "too many codes requested today; try again tomorrow", 429);
  const { rows } = await query<{ created_at: string; verified_at: string | null }>(
    "select created_at, verified_at from email_otp where email = $1",
    [normalized],
  );
  const existing = rows[0];
  if (existing && !existing.verified_at) {
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < RESEND_COOLDOWN_MS) {
      throw new OtpError(
        "otp_cooldown",
        `please wait ${Math.ceil((RESEND_COOLDOWN_MS - age) / 1000)}s before requesting a new code`,
        429,
      );
    }
  }
  const code = generateOtpCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await query(
    `insert into email_otp (email, code_hash, expires_at, attempts, verified_at)
       values ($1, $2, $3, 0, null)
       on conflict (email)
       do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at,
                     attempts = 0, verified_at = null, created_at = now()`,
    [normalized, codeHash, expiresAt.toISOString()],
  );
  await query("insert into email_otp_sends (email, ip) values ($1, $2)", [normalized, ip.slice(0, 80)]);
  await sendCode(normalized, code);
}

/// Verify a submitted code. On success the row's verified_at is set;
/// the next /auth/email/begin within VERIFY_TTL_MS will accept this
/// email for first-time registration. Bumps attempt count on miss;
/// at MAX_ATTEMPTS the row is wiped and the caller must restart.
export async function verifyEmailOtp(email: string, code: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const submitted = code.trim();
  if (!/^[0-9]{6}$/.test(submitted)) {
    throw new OtpError("otp_invalid_format", "code must be 6 digits", 400);
  }
  const { rows } = await query<{ code_hash: string; expires_at: string; attempts: number }>(
    "select code_hash, expires_at, attempts from email_otp where email = $1",
    [normalized],
  );
  const row = rows[0];
  if (!row) {
    throw new OtpError("otp_not_started", "no pending verification for this email", 400);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await query("delete from email_otp where email = $1", [normalized]);
    throw new OtpError("otp_expired", "code expired; request a new one", 410);
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await query("delete from email_otp where email = $1", [normalized]);
    throw new OtpError("otp_too_many_attempts", "too many tries; request a new code", 429);
  }
  if (hashCode(submitted) !== row.code_hash) {
    await query("update email_otp set attempts = attempts + 1 where email = $1", [normalized]);
    throw new OtpError("otp_mismatch", "wrong code", 400);
  }
  await query(
    "update email_otp set verified_at = now() where email = $1",
    [normalized],
  );
}

/// Is this email cleared to proceed past /auth/email/begin? Returns
/// true within VERIFY_TTL_MS of a successful verify, false otherwise.
/// Callers that only want to gate FIRST-TIME signup should also check
/// whether the operators row exists for this email.
export async function isEmailVerified(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await query<{ verified_at: string | null }>(
    "select verified_at from email_otp where email = $1",
    [normalized],
  );
  const v = rows[0]?.verified_at;
  if (!v) return false;
  return Date.now() - new Date(v).getTime() < VERIFY_TTL_MS;
}

/// Mark a verification as consumed. Called once /auth/email/finish
/// completes a successful registration so the token can't be replayed
/// against a second signup attempt.
export async function consumeEmailVerification(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await query("delete from email_otp where email = $1", [normalized]);
}
