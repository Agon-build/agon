import { createRateLimiter } from "../agon/stage/rate-limit.ts";

/// Limits on the email sign-in routes (code check, begin, session), per
/// network address and per email, over a sliding 10 minutes. Kept in memory:
/// one auth process serves these routes.
export const EMAIL_AUTH_LIMITS = { perIp: 30, perEmail: 10, windowMs: 10 * 60 * 1000 } as const;

export function createEmailAuthGate(limits: { perIp: number; perEmail: number; windowMs: number } = EMAIL_AUTH_LIMITS): (ip: string, email: string, nowMs?: number) => boolean {
  const byIp = createRateLimiter({ limit: limits.perIp, windowMs: limits.windowMs });
  const byEmail = createRateLimiter({ limit: limits.perEmail, windowMs: limits.windowMs });
  return (ip, email, nowMs = Date.now()) => byIp(ip, nowMs) && byEmail(email.trim().toLowerCase(), nowMs);
}
