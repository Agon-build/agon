import { Hono } from "hono";

import { parseTelegramUpdate, type TelegramInbound } from "./parse.ts";
import { verifyTelegramSecret } from "./secret.ts";

/// Telegram retries any update that does not get a quick 200, so the work
/// runs after the response. Dedupe by update id makes retries harmless.
export function createTelegramWebhook(deps: {
  secret: string;
  claimUpdate: (updateId: string) => Promise<boolean>;
  onUpdate: (u: TelegramInbound) => Promise<void>;
  defer?: (fn: () => Promise<void>) => void;
  log?: (m: string) => void;
}): Hono {
  const app = new Hono();
  const defer = deps.defer ?? ((fn: () => Promise<void>) => { setImmediate(() => { void fn(); }); });
  app.post("/webhook", async (c) => {
    if (!verifyTelegramSecret(c.req.header("x-telegram-bot-api-secret-token"), deps.secret)) return c.text("unauthorized", 401);
    const inbound = parseTelegramUpdate(await c.req.json().catch(() => null));
    if (!inbound) return c.json({ ok: true });
    if (!(await deps.claimUpdate(inbound.updateId))) return c.json({ ok: true });
    defer(async () => {
      try {
        await deps.onUpdate(inbound);
      } catch (error) {
        deps.log?.(`telegram update failed: ${(error as Error).message}`);
      }
    });
    return c.json({ ok: true });
  });
  return app;
}
