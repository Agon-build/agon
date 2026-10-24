import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramApi, telegramPayload } from "../../src/agon/channels/telegram/api.ts";
import { parseTelegramUpdate, type TelegramInbound } from "../../src/agon/channels/telegram/parse.ts";
import { verifyTelegramSecret } from "../../src/agon/channels/telegram/secret.ts";
import { createTelegramWebhook } from "../../src/agon/channels/telegram/webhook.ts";

const SECRET = "s".repeat(40);
const TOKEN = "1234567890:AAH" + "x".repeat(32);
const text = (t: string, over: Record<string, unknown> = {}) => ({
  update_id: 1001, message: { message_id: 7, date: 1760000000, from: { id: 4242, is_bot: false, first_name: "Ada" }, chat: { id: 4242, type: "private" }, text: t, ...over },
});
const tap = (data: string) => ({ update_id: 1002, callback_query: { id: "cb-1", from: { id: 4242, is_bot: false }, data, message: { message_id: 9, chat: { id: 4242, type: "private" } } } });

test("private text, taps and /start are parsed; groups, bots and junk are ignored", () => {
  assert.deepEqual(parseTelegramUpdate(text("Will BTC close above $120k on Friday?")), {
    updateId: "1001", chatId: 4242, userId: "4242", callbackId: null, kind: "text", text: "Will BTC close above $120k on Friday?",
  });
  assert.deepEqual(parseTelegramUpdate(tap("yes:4821")), { updateId: "1002", chatId: 4242, userId: "4242", callbackId: "cb-1", kind: "tap", text: "yes:4821" });
  assert.equal(parseTelegramUpdate(text("/start"))!.kind, "start");
  assert.equal(parseTelegramUpdate(text("/start@agon_surf_bot hello"))!.kind, "start");
  assert.equal(parseTelegramUpdate(text("/balance"))!.kind, "text");
  assert.equal(parseTelegramUpdate({ update_id: 3, message: { message_id: 1, date: 1, from: { id: 1 }, chat: { id: 1, type: "private" }, sticker: {} } })!.kind, "other");
  assert.equal(parseTelegramUpdate(text("hi", { chat: { id: -100, type: "group" } })), null);
  assert.equal(parseTelegramUpdate(text("hi", { from: { id: 9, is_bot: true } })), null);
  assert.equal(parseTelegramUpdate({ update_id: 4 }), null);
  assert.equal(parseTelegramUpdate("nope"), null);
  assert.equal(parseTelegramUpdate(null), null);
});

test("the webhook secret is checked in constant time and exactly", () => {
  assert.equal(verifyTelegramSecret(SECRET, SECRET), true);
  assert.equal(verifyTelegramSecret(`${SECRET}x`, SECRET), false);
  assert.equal(verifyTelegramSecret("s".repeat(39) + "t", SECRET), false);
  assert.equal(verifyTelegramSecret(undefined, SECRET), false);
});

test("replies become plain text with link previews off and inline buttons", () => {
  assert.deepEqual(telegramPayload({ text: "Pay?", buttons: [[{ label: "Pay 0.30 USDC", data: "yes:4821" }, { label: "Receipt", url: "https://agon.surf/r/x" }]] }), {
    text: "Pay?", link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [[{ text: "Pay 0.30 USDC", callback_data: "yes:4821" }, { text: "Receipt", url: "https://agon.surf/r/x" }]] },
  });
  assert.deepEqual(telegramPayload({ text: "x".repeat(5000) }).text, "x".repeat(4096));
});

test("the API client posts to the Bot API, returns message ids and never throws", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const logs: string[] = [];
  let fail = false;
  const api = createTelegramApi({
    token: TOKEN,
    log: (m) => logs.push(m),
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      if (fail) return new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 55 } }));
    }) as typeof fetch,
  });
  assert.equal(await api.send(4242, { text: "Hi" }), 55);
  assert.equal(calls[0]!.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(calls[0]!.body, { chat_id: 4242, text: "Hi", link_preview_options: { is_disabled: true } });
  assert.equal(await api.edit(4242, 55, { text: "Hi again" }), true);
  assert.equal(calls[1]!.url.endsWith("/editMessageText"), true);
  assert.equal(calls[1]!.body.message_id, 55);
  fail = true;
  assert.equal(await api.send(4242, { text: "Hi" }), null);
  assert.ok(logs.length === 1 && logs[0]!.includes("chat not found"));
  assert.ok(logs.every((l) => !l.includes(TOKEN)), "the token never reaches a log line");
});

test("the webhook refuses a wrong secret, answers fast, dedupes and defers the work", async () => {
  const handled: TelegramInbound[] = [];
  const claimed = new Set<string>();
  const app = createTelegramWebhook({
    secret: SECRET,
    claimUpdate: async (id) => (claimed.has(id) ? false : (claimed.add(id), true)),
    onUpdate: async (u) => { handled.push(u); },
    defer: (fn) => void fn(),
  });
  const post = (body: unknown, secret: string | null = SECRET) =>
    app.request("/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post(text("hello"), "wrong")).status, 401);
  assert.equal((await post(text("hello"), null)).status, 401);
  assert.equal(handled.length, 0);
  assert.equal((await post(text("hello"))).status, 200);
  assert.equal((await post(text("hello"))).status, 200, "Telegram retries get 200");
  assert.equal(handled.length, 1, "the same update id is handled once");
  assert.equal((await post(text("hi", { chat: { id: -1, type: "group" } }))).status, 200);
  assert.equal(handled.length, 1);
  const bad = await app.request("/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET }, body: "{not json" });
  assert.equal(bad.status, 200);
});

test("a handler that throws is logged and still answers 200", async () => {
  const logs: string[] = [];
  const app = createTelegramWebhook({ secret: SECRET, claimUpdate: async () => true, onUpdate: async () => { throw new Error("boom"); }, defer: (fn) => void fn(), log: (m) => logs.push(m) });
  const res = await app.request("/webhook", { method: "POST", headers: { "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify(text("hello")) });
  assert.equal(res.status, 200);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(logs, ["telegram update failed: boom"]);
});

test("a button link Telegram refuses (localhost) is dropped so the message still sends", () => {
  const reply = { text: "Forecast. Receipt: http://localhost:3000/r/x", buttons: [[{ label: "Open receipt", url: "http://localhost:3000/r/x" }]] };
  assert.deepEqual(telegramPayload(reply), { text: reply.text, link_preview_options: { is_disabled: true } });
  const mixed = telegramPayload({ text: "Pay?", buttons: [[{ label: "Pay", data: "yes:1" }, { label: "Receipt", url: "http://127.0.0.1:3000/r/x" }]] });
  assert.deepEqual(mixed.reply_markup, { inline_keyboard: [[{ text: "Pay", callback_data: "yes:1" }]] });
});
