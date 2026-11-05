import { Hono, type MiddlewareHandler } from "hono";

import type { DeliveryEmails } from "./delivery-email.ts";
import type { TelegramLinks } from "./telegram-link.ts";

/// Account's Deliveries section: where finished work is sent, and connecting Telegram.
export function createDeliveryRoutes(deps: {
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
  links: TelegramLinks;
  emailOf: (operator: string) => Promise<string | null>;
  /** The sign-in email of an email account; a wallet account has none. */
  accountEmailOf?: (operator: string) => Promise<string | null>;
  /** Emails added for deliveries, and the sender of their 6-digit codes. */
  emails?: DeliveryEmails;
  sendCode?: (to: string, code: string) => Promise<void>;
  /** True when deliveries have a sender address. */
  emailOn: boolean;
  /** The AGON bot's username, when the bot is set up. */
  botUsername: string | null;
  now?: () => Date;
}): Hono {
  const app = new Hono<{ Variables: { address: string } }>();
  const now = deps.now ?? (() => new Date());
  app.use("*", deps.requireAuth);

  app.get("/", async (c) => {
    const operator = c.get("address").toLowerCase();
    const [email, chat, account, pending] = await Promise.all([
      deps.emailOf(operator), deps.links.chatOf(operator),
      deps.accountEmailOf ? deps.accountEmailOf(operator) : Promise.resolve(null),
      deps.emails ? deps.emails.pending(operator, now()) : Promise.resolve(null),
    ]);
    return c.json({
      email: {
        on: deps.emailOn && email !== null, address: email ? maskEmail(email) : null,
        source: email === null ? null : account ? "account" : "added",
        canAdd: deps.emailOn && Boolean(deps.emails && deps.sendCode) && !account,
        pending: pending ? maskEmail(pending) : null,
      },
      telegram: { available: deps.botUsername !== null, connected: chat !== null },
    });
  });

  // A wallet account adds an email for deliveries: Agon sends a 6-digit code to it first.
  app.post("/email", async (c) => {
    if (!deps.emailOn || !deps.emails || !deps.sendCode) return c.json({ error: "email_off" }, 503);
    const operator = c.get("address").toLowerCase();
    if (deps.accountEmailOf && (await deps.accountEmailOf(operator))) return c.json({ error: "account_email" }, 409);
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const out = await deps.emails.start(operator, typeof body?.email === "string" ? body.email : "", now());
    if (!out.ok) return c.json({ error: out.reason }, out.reason === "too_soon" ? 429 : 400);
    try {
      await deps.sendCode(out.email, out.code);
    } catch {
      return c.json({ error: "send_failed" }, 502);
    }
    return c.json({ pending: maskEmail(out.email) });
  });

  app.post("/email/verify", async (c) => {
    if (!deps.emails) return c.json({ error: "email_off" }, 503);
    const body = (await c.req.json().catch(() => null)) as { code?: unknown } | null;
    const out = await deps.emails.verify(c.get("address").toLowerCase(), typeof body?.code === "string" ? body.code : "", now());
    if (!out.ok) return c.json({ error: out.reason }, 400);
    return c.json({ address: maskEmail(out.email) });
  });

  app.delete("/email", async (c) => {
    if (!deps.emails) return c.json({ error: "email_off" }, 503);
    await deps.emails.remove(c.get("address").toLowerCase());
    return c.json({ removed: true });
  });

  app.post("/telegram", async (c) => {
    if (!deps.botUsername) return c.json({ error: "telegram_off" }, 503);
    const code = await deps.links.createCode(c.get("address").toLowerCase(), now());
    return c.json({ url: `https://t.me/${deps.botUsername}?start=dl_${code}` });
  });

  app.delete("/telegram", async (c) => {
    await deps.links.unlink(c.get("address").toLowerCase());
    return c.json({ connected: false });
  });

  return app as unknown as Hono;
}

/// "bl***@gmail.com": enough to recognise, not enough to copy.
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your email";
  return `${user.slice(0, 2)}***@${domain}`;
}
