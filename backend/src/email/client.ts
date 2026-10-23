import { config } from "../config/index.js";

/// Transactional email sender. One place every Agon email goes through, so
/// the provider wiring and the from-address formatting live in a single spot.
///
/// Provider is chosen by EMAIL_PROVIDER: `resend` posts to the Resend API;
/// anything else (default `console`) just logs, so local dev needs no SMTP.
/// Throws on a hard send failure; callers that must deliver (OTP) surface it,
/// best-effort callers (welcome, receipts) should catch.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sender for this message; defaults to EMAIL_FROM (sign-in codes). */
  from?: string;
}

/// Format the from header. EMAIL_FROM may be a bare address
/// (noreply@agon.surf) or already include a display name; we wrap a bare
/// address as `Agon <addr>` so inboxes show the brand, not just the address.
function fromHeader(from: string): string {
  return from.includes("<") ? from : `Agon <${from}>`;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (config.auth.emailOtp.provider === "resend") {
    await sendViaResend(msg);
  } else {
    console.log(`[EMAIL · DEV] to=${msg.to} subject="${msg.subject}"`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendViaResend(msg: EmailMessage): Promise<void> {
  const apiKey = config.auth.emailOtp.resendApiKey;
  const from = msg.from ?? config.auth.emailOtp.from;
  if (!apiKey || !from) {
    throw new Error("RESEND_API_KEY and EMAIL_FROM are required when EMAIL_PROVIDER=resend");
  }
  const payload = JSON.stringify({
    from: fromHeader(from),
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });

  // Resend (and any provider) rate-limits and has the occasional 5xx. Under a
  // signup burst that would otherwise drop or delay codes, so retry on 429 /
  // 5xx / network error with exponential backoff. 4xx other than 429 is a real
  // rejection (bad address, unverified domain) and is not retried.
  const MAX_ATTEMPTS = 3;
  let lastErr = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(300 * 2 ** (attempt - 1)); // 300ms, 600ms

    let res: Response;
    try {
      // 10s ceiling so a hung provider call doesn't stall the request thread.
      res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      continue; // network error / timeout -> retry
    }

    if (res.ok) return;

    const retryable = res.status === 429 || res.status >= 500;
    lastErr = `resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
    if (!retryable) throw new Error(lastErr); // hard rejection, don't retry
  }
  throw new Error(`email send failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`);
}
