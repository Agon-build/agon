import { randomInt } from "node:crypto";

/// Daily caps on sign-up codes. The per-code attempt cap resets with each new
/// code, so these caps bound how many guesses one email or address gets a day.
export const OTP_DAILY_PER_EMAIL = 10;
export const OTP_DAILY_PER_IP = 30;

export function otpSendRefusal(counts: { emailToday: number; ipToday: number }): "otp_daily_limit" | null {
  return counts.emailToday >= OTP_DAILY_PER_EMAIL || counts.ipToday >= OTP_DAILY_PER_IP ? "otp_daily_limit" : null;
}

/// Six digits from the operating system's secure random source.
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
