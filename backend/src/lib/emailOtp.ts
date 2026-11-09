import { config } from "../config/index.js";
import { pool } from "../db/pool.js";
import { sendEmail } from "../email/client.js";
import { otpEmailTemplate } from "../email/templates.js";
import { generateOtpCode } from "./emailOtpLimits.js";
import { OtpError, checkVerification, claimVerification, startOtp, verifyOtp } from "./emailOtpStore.js";

/// Email code proof of ownership, wired to the app's pool, pepper and mail
/// sender. The rules live in emailOtpStore.ts. Required at first-time signup
/// and for code sign-in; returning passkey users skip it.

export { OtpError };

const pepper = () => config.auth.emailOtp.pepper ?? "dev-pepper-not-for-prod";

async function sendCode(email: string, code: string): Promise<void> {
  // Dev (non-resend) provider: log the code so test flows can read it without
  // an SMTP setup. Clearly tagged so prod logs never leak a code by accident.
  if (config.auth.emailOtp.provider !== "resend") {
    console.log(`[EMAIL OTP · DEV] ${email} → ${code} (expires in 10 min)`);
    return;
  }
  const tpl = otpEmailTemplate(code);
  try {
    await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  } catch (err) {
    throw new OtpError("email_send_failed", err instanceof Error ? err.message : String(err), 502);
  }
}

export async function startEmailOtp(email: string, ip = "unknown"): Promise<void> {
  await startOtp(pool, { email, ip, pepper: pepper(), now: new Date(), generate: generateOtpCode, deliver: sendCode });
}

/// Returns the one-time token only the client that typed the code receives.
export async function verifyEmailOtp(email: string, code: string): Promise<{ verificationToken: string }> {
  return verifyOtp(pool, { email, code, pepper: pepper(), now: new Date() });
}

/// Does this request carry the live token for the email? Does not use it up.
export async function hasEmailVerification(email: string, token: unknown): Promise<boolean> {
  return checkVerification(pool, { email, token, now: new Date() });
}

/// Uses the token up; true for exactly one caller.
export async function claimEmailVerification(email: string, token: unknown): Promise<boolean> {
  return claimVerification(pool, { email, token, now: new Date() });
}
