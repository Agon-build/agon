import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramChannel } from "../../src/agon/channels/telegram/channel.ts";
import { keywordIntent, parseCodeIntent } from "../../src/agon/channels/chat/intents.ts";
import { MemoryChannelStore } from "./channel-memory-store.ts";
import { stageWorld } from "./stage-test-world.ts";

const SECRET = "s".repeat(40);
const TOKEN = "1234567890:AAH" + "x".repeat(32);

test("a Telegram update reaches the chat core and the reply goes back to the same chat", async () => {
  const world = stageWorld();
  const channels = new MemoryChannelStore();
  const api: { method: string; body: Record<string, unknown> }[] = [];
  const pending: Promise<void>[] = [];
  const tg = createTelegramChannel({
    telegram: { botToken: TOKEN, webhookSecret: SECRET, botUsername: "agon_surf_bot" },
    pepper: "p".repeat(40), services: world.services, channels,
    classify: async (t) => parseCodeIntent(t) ?? keywordIntent(t), off: () => false,
    defer: (fn) => { pending.push(fn()); },
    fetchImpl: (async (url: string, init: RequestInit) => {
      api.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: api.length } }));
    }) as typeof fetch,
  });
  const res = await tg.routes.request("/webhook", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET, "content-type": "application/json" },
    body: JSON.stringify({ update_id: 1, message: { message_id: 1, date: 1, from: { id: 777, is_bot: false }, chat: { id: 777, type: "private" }, text: "hello" } }),
  });
  assert.equal(res.status, 200);
  await Promise.all(pending);
  assert.equal(api[0]!.method, "sendMessage");
  assert.equal(api[0]!.body.chat_id, 777);
  assert.match(String(api[0]!.body.text), /Welcome to Agon/);

  await tg.routes.request("/webhook", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET, "content-type": "application/json" },
    body: JSON.stringify({ update_id: 2, callback_query: { id: "cb-9", from: { id: 777, is_bot: false }, data: "terms:accept", message: { message_id: 1, chat: { id: 777, type: "private" } } } }),
  });
  await Promise.all(pending);
  assert.deepEqual(api.slice(1).map((c) => c.method), ["answerCallbackQuery", "sendMessage"]);
  assert.match(String(api[2]!.body.text), /Your Agon wallet/);
});
