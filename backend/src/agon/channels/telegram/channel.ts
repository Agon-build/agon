import type { Hono } from "hono";

import type { StageServices } from "../../stage/services.ts";
import { telegramOwnerRef, type TelegramSettings } from "../../stage/settings.ts";
import { handleChatMessage, type ConversationDeps } from "../chat/conversation.ts";
import { createRateLimiter } from "../../stage/rate-limit.ts";
import type { ChatIntent } from "../chat/intents.ts";
import type { ChannelStore } from "../types.ts";
import { createTelegramApi, type TelegramApi } from "./api.ts";
import { createTelegramWebhook } from "./webhook.ts";

export function createTelegramChannel(deps: {
  telegram: TelegramSettings;
  pepper: string;
  services: StageServices;
  /** The aggregator and the Arc mainnet wallet, when routing is on. */
  router?: ConversationDeps["router"];
  outside?: StageServices;
  channels: ChannelStore;
  classify: (text: string) => Promise<ChatIntent>;
  off: () => boolean;
  fetchImpl?: typeof fetch;
  defer?: (fn: () => Promise<void>) => void;
  log?: (m: string) => void;
  now?: () => Date;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): { routes: Hono; api: TelegramApi } {
  const now = deps.now ?? (() => new Date());
  const perUser = createRateLimiter({ limit: 20, windowMs: 60_000 });
  const api = createTelegramApi({ token: deps.telegram.botToken, fetchImpl: deps.fetchImpl, log: deps.log });
  const routes = createTelegramWebhook({
    secret: deps.telegram.webhookSecret,
    claimUpdate: (updateId) => deps.channels.claimUpdate("telegram", updateId, now()),
    defer: deps.defer,
    log: deps.log,
    onUpdate: async (u) => {
      if (u.callbackId) await api.answerTap(u.callbackId);
      await handleChatMessage(
        {
          services: deps.services, channels: deps.channels, channel: "telegram", ownerRefOf: telegramOwnerRef, pepper: deps.pepper,
          classify: deps.classify, off: deps.off, now, pollMs: deps.pollMs, sleep: deps.sleep, limit: (userHash) => perUser(userHash),
          ...(deps.router ? { router: deps.router } : {}), ...(deps.outside ? { outside: deps.outside } : {}),
          reply: { send: (r) => api.send(u.chatId, r), edit: (id, r) => api.edit(u.chatId, id, r) },
        },
        { userId: u.userId, kind: u.kind, text: u.text },
      );
    },
  });
  return { routes, api };
}
