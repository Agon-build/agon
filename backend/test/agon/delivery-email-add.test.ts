import assert from "node:assert/strict";
import test from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { CODE_ATTEMPTS, MemoryDeliveryEmails, RESEND_MS, validEmail } from "../../src/agon/deliveries/delivery-email.ts";
import { deliveryCodeEmail } from "../../src/agon/deliveries/email.ts";
import { createDeliveryRoutes } from "../../src/agon/deliveries/routes.ts";
import type { TelegramLinks } from "../../src/agon/deliveries/telegram-link.ts";

const WALLET = `0x${"a".repeat(40)}`;
const EMAILER = `0x${"b".repeat(40)}`;
const T0 = new Date("2026-11-05T10:00:00Z");

test("an added email needs its 6-digit code, within 10 minutes and 5 tries, and one code a minute", async () => {
  const e = new MemoryDeliveryEmails();
  assert.deepEqual(await e.start(WALLET, "not an email", T0), { ok: false, reason: "invalid_email" });
  const first = await e.start(WALLET, "  Me@Example.COM ", T0);
  assert.ok(first.ok && /^\d{6}$/.test(first.code) && first.email === "me@example.com");
  assert.deepEqual(await e.start(WALLET, "me@example.com", new Date(T0.getTime() + 1000)), { ok: false, reason: "too_soon" });
  assert.equal(await e.pending(WALLET, T0), "me@example.com");
  const wrong = first.code === "000000" ? "111111" : "000000";
  assert.deepEqual(await e.verify(WALLET, wrong, T0), { ok: false, reason: "wrong_code" });
  assert.equal(await e.added(WALLET), null, "a wrong code adds nothing");
  assert.deepEqual(await e.verify(WALLET, first.code, T0), { ok: true, email: "me@example.com" });
  assert.equal(await e.added(WALLET), "me@example.com");
  assert.deepEqual(await e.verify(WALLET, first.code, T0), { ok: false, reason: "no_code" }, "a code works once");

  const later = new Date(T0.getTime() + RESEND_MS);
  const again = await e.start(WALLET, "new@example.com", later);
  assert.ok(again.ok);
  assert.deepEqual(await e.verify(WALLET, again.code, new Date(later.getTime() + 10 * 60_000)), { ok: false, reason: "expired" });
  const third = await e.start(WALLET, "new@example.com", new Date(later.getTime() + RESEND_MS));
  assert.ok(third.ok);
  const bad = third.code === "000000" ? "111111" : "000000";
  for (let i = 0; i < CODE_ATTEMPTS; i++) await e.verify(WALLET, bad, later);
  assert.deepEqual(await e.verify(WALLET, third.code, later), { ok: false, reason: "too_many_attempts" });
  assert.equal(validEmail("a@b.co"), "a@b.co");
});

test("the code email names the code and says nothing changes without it", () => {
  const m = deliveryCodeEmail("123456");
  assert.equal(m.subject, "Your Agon code: 123456");
  assert.match(m.text, /123456/);
  assert.match(m.text, /Nothing changes until the code is entered/);
  assert.ok(!m.text.includes("—"));
});

function app(opts: { account?: string | null } = {}) {
  const emails = new MemoryDeliveryEmails();
  const sent: { to: string; code: string }[] = [];
  const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => { c.set("address", c.req.header("x-test-address") ?? ""); await next(); };
  const links = { chatOf: async () => null, createCode: async () => "c", unlink: async () => {} } as unknown as TelegramLinks;
  const h = new Hono();
  h.route("/d", createDeliveryRoutes({
    requireAuth, links, emailOn: true, botUsername: null, now: () => T0,
    emailOf: async (op) => (op === EMAILER ? "owner@agon.surf" : await emails.added(op)),
    accountEmailOf: async (op) => (op === EMAILER ? (opts.account ?? "owner@agon.surf") : null),
    emails, sendCode: async (to, code) => { sent.push({ to, code }); },
  }));
  const call = (method: string, path: string, as: string, body?: unknown) =>
    h.request(`/d${path}`, { method, headers: { "content-type": "application/json", "x-test-address": as }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { call, sent };
}

test("a wallet account adds an email from Account; an email account cannot add a second one", async () => {
  const { call, sent } = app();
  const before = (await (await call("GET", "", WALLET)).json()) as { email: { address: string | null; canAdd: boolean; source: string | null } };
  assert.deepEqual([before.email.address, before.email.canAdd, before.email.source], [null, true, null]);
  const start = await call("POST", "/email", WALLET, { email: "me@example.com" });
  assert.deepEqual(await start.json(), { pending: "me***@example.com" });
  assert.equal(sent[0]!.to, "me@example.com");
  assert.equal((await call("POST", "/email/verify", WALLET, { code: "999999" === sent[0]!.code ? "000000" : "999999" })).status, 400);
  assert.deepEqual(await (await call("POST", "/email/verify", WALLET, { code: sent[0]!.code })).json(), { address: "me***@example.com" });
  const after = (await (await call("GET", "", WALLET)).json()) as { email: { on: boolean; source: string } };
  assert.deepEqual([after.email.on, after.email.source], [true, "added"]);
  assert.equal((await call("POST", "/email", EMAILER, { email: "x@example.com" })).status, 409);
  const owner = (await (await call("GET", "", EMAILER)).json()) as { email: { source: string; canAdd: boolean } };
  assert.deepEqual([owner.email.source, owner.email.canAdd], ["account", false]);
  assert.deepEqual(await (await call("DELETE", "/email", WALLET)).json(), { removed: true });
});
