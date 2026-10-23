import { Hono, type MiddlewareHandler } from "hono";

import type { TelegramLinks } from "./telegram-link.ts";

/// Account's Deliveries section: where finished work is sent, and connecting Telegram.
export function createDeliveryRoutes(deps: {
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
  links: TelegramLinks;
  emailOf: (operator: string) => Promise<string | null>;
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
    const [email, chat] = await Promise.all([deps.emailOf(operator), deps.links.chatOf(operator)]);
    return c.json({
      email: { on: deps.emailOn && email !== null, address: email ? maskEmail(email) : null },
      telegram: { available: deps.botUsername !== null, connected: chat !== null },
    });
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
