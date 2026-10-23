import assert from "node:assert/strict";
import test from "node:test";
import type { MiddlewareHandler } from "hono";

import { createDeliveryRoutes, maskEmail } from "../../src/agon/deliveries/routes.ts";
import type { TelegramLinks } from "../../src/agon/deliveries/telegram-link.ts";

const OP = `0x${"c3".repeat(20)}`;
const signedIn: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  if (c.req.header("authorization") !== "Bearer ok") return c.json({ error: "unauthorized" }, 401);
  c.set("address", OP);
  await next();
};

function links(): TelegramLinks & { chats: Map<string, string> } {
  const chats = new Map<string, string>();
  return {
    chats,
    createCode: async () => "a".repeat(24),
    claimCode: async () => null,
    chatOf: async (op) => chats.get(op) ?? null,
    unlink: async (op) => { chats.delete(op); },
  };
}

const auth = { headers: { authorization: "Bearer ok" } };

test("Account reads where deliveries go, with the email masked, and needs sign-in", async () => {
  const l = links();
  const app = createDeliveryRoutes({ requireAuth: signedIn, links: l, emailOf: async () => "blessing@example.com", emailOn: true, botUsername: "agon_bot" });
  assert.equal((await app.request("/")).status, 401);
  assert.deepEqual(await (await app.request("/", auth)).json(), { email: { on: true, address: "bl***@example.com" }, telegram: { available: true, connected: false } });
  l.chats.set(OP, "1");
  assert.equal(((await (await app.request("/", auth)).json()) as { telegram: { connected: boolean } }).telegram.connected, true);
});

test("Connect Telegram returns the bot link with a one-time code; disconnect removes the chat", async () => {
  const l = links();
  l.chats.set(OP, "1");
  const app = createDeliveryRoutes({ requireAuth: signedIn, links: l, emailOf: async () => null, emailOn: false, botUsername: "agon_bot" });
  assert.deepEqual(await (await app.request("/telegram", { method: "POST", ...auth })).json(), { url: `https://t.me/agon_bot?start=dl_${"a".repeat(24)}` });
  await app.request("/telegram", { method: "DELETE", ...auth });
  assert.equal(l.chats.has(OP), false);
  const off = createDeliveryRoutes({ requireAuth: signedIn, links: l, emailOf: async () => null, emailOn: false, botUsername: null });
  assert.equal((await off.request("/telegram", { method: "POST", ...auth })).status, 503);
});

test("emails are masked", () => {
  assert.equal(maskEmail("blessing@example.com"), "bl***@example.com");
  assert.equal(maskEmail("nope"), "your email");
});
