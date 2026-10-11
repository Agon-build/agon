// Registers the Agon Telegram webhook and the bot's command list, then prints
// the webhook status. Reads keys from the environment only; prints no secrets.
// Usage: npx tsx scripts/telegram-webhook.ts [--info]
import "dotenv/config";

import { createTelegramApi } from "../src/agon/channels/telegram/api.ts";
import { resolveStageSettings } from "../src/agon/stage/settings.ts";

async function main(): Promise<void> {
  const { settings, problems } = resolveStageSettings(process.env);
  if (!settings.telegram) throw new Error(`Telegram is not configured: ${problems.join("; ") || "set AGON_TELEGRAM_ENABLED=true and its keys"}`);
  const api = createTelegramApi({ token: settings.telegram.botToken, log: (m) => console.error(m) });
  const me = await api.call("getMe", {});
  if (!me) throw new Error("getMe failed: check AGON_TELEGRAM_BOT_TOKEN");
  const username = String(me.username ?? "");
  console.log(`bot @${username}`);
  if (username.toLowerCase() !== settings.telegram.botUsername.toLowerCase()) throw new Error(`AGON_TELEGRAM_BOT_USERNAME is ${settings.telegram.botUsername} but the token belongs to @${username}`);
  if (!process.argv.includes("--info")) {
    const base = (process.env.AGON_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
    if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error("AGON_PUBLIC_API_URL must be the https API origin");
    const url = `${base}/agon/telegram/webhook`;
    const set = await api.call("setWebhook", { url, secret_token: settings.telegram.webhookSecret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
    if (!set) throw new Error("setWebhook failed (a bot that is polled with getUpdates elsewhere cannot take a webhook)");
    await api.call("setMyCommands", {
      commands: [
        { command: "balance", description: "Your Agon wallet balance and limits" },
        { command: "deposit", description: "Address to add USDC" },
        { command: "history", description: "Your recent asks with receipts" },
        { command: "leaderboard", description: "Season 1 forecasters" },
        { command: "limits", description: "See or lower your spending limits" },
        { command: "freeze", description: "Stop all spending now" },
        { command: "withdraw", description: "Send USDC out (approved in your browser)" },
        { command: "help", description: "What Agon can do" },
      ],
    });
    console.log(`webhook set to ${url}`);
  }
  const info = await api.call("getWebhookInfo", {});
  console.log(JSON.stringify({ url: info?.url ?? null, pendingUpdates: info?.pending_update_count ?? null, lastError: info?.last_error_message ?? null }, null, 2));
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
