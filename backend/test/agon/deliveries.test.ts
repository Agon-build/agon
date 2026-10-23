import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { PostgresDeliveryStore } from "../../src/agon/deliveries/store.ts";
import { PostgresTelegramLinks } from "../../src/agon/deliveries/telegram-link.ts";
import { operatorOf, runDeliveryTick, type DeliveryDeps } from "../../src/agon/deliveries/worker.ts";
import type { DeliveryMessage } from "../../src/agon/deliveries/summary.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const OWNER = `0x${"a1".repeat(20)}`;
const SITE = "https://agon.surf";
let db: AgonTestDatabase;
let store: PostgresDeliveryStore;

before(async () => {
  db = await createAgonTestDatabase("deliveries");
  store = new PostgresDeliveryStore(db.pool);
  await db.pool.query("insert into operators (address, email) values ($1, $2)", [OWNER, "owner@example.com"]);
});
after(async () => db.close());

async function job(opts: { state: string; result: unknown; buyerRef?: string; label?: string; updatedAt: Date }): Promise<string> {
  const id = randomUUID();
  await db.pool.query(
    `insert into agon_jobs (job_id, root_id, depth, buyer_ref, provider_ref, provider_label, network, price_atomic, state, trace_id, request, result, created_at, updated_at)
     values ($1, $1, 0, $2, 'agent:pitch', $3, 'arc-testnet', 150000, $4, 't', '{}'::jsonb, $5::jsonb, $6, $6)`,
    [id, opts.buyerRef ?? `budget:op:${OWNER}`, opts.label ?? "Pitch", opts.state, JSON.stringify(opts.result), opts.updatedAt],
  );
  return id;
}

function deps(now: Date, sent: { bell: DeliveryMessage[]; email: { to: string; m: DeliveryMessage }[] }, emailFails = 0): DeliveryDeps {
  let failing = emailFails;
  return {
    store, siteUrl: SITE, now: () => now,
    bell: async (_op, m) => { sent.bell.push(m); },
    email: async (to, m) => { if (failing > 0) { failing -= 1; throw new Error("resend 503"); } sent.email.push({ to, m }); },
  };
}

test("a finished hire goes to the bell and to email once, however often the worker runs", async () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const id = await job({ state: "delivered", result: { market: { question: "Will Arsenal win?" }, probabilityBps: 6200, crowdBps: 5500, reasons: [] }, updatedAt: new Date(now.getTime() - 60_000) });
  const sent = { bell: [] as DeliveryMessage[], email: [] as { to: string; m: DeliveryMessage }[] };
  const first = await runDeliveryTick(deps(now, sent));
  assert.deepEqual(first, { queued: 2, sent: 2, failed: 0 });
  await runDeliveryTick(deps(now, sent));
  assert.equal(sent.bell.length, 1);
  assert.equal(sent.email.length, 1);
  assert.equal(sent.email[0]!.to, "owner@example.com");
  assert.equal(sent.email[0]!.m.title, "Your answer from Pitch");
  assert.equal(sent.email[0]!.m.href, `${SITE}/r/${id}`);
});

test("a failed email is retried with backoff and then sent; old jobs and chat-only buyers are left alone", async () => {
  const now = new Date("2026-10-23T12:00:00Z");
  await job({ state: "refunded", result: { ok: false, refunded: true, code: "no_market" }, label: "Agon Lead Agent", updatedAt: new Date(now.getTime() - 60_000) });
  await job({ state: "delivered", result: { probabilityBps: 1 }, updatedAt: new Date(now.getTime() - 5 * 3_600_000) });
  await job({ state: "delivered", result: { probabilityBps: 1 }, buyerRef: "budget:tg:123", updatedAt: new Date(now.getTime() - 60_000) });
  const sent = { bell: [] as DeliveryMessage[], email: [] as { to: string; m: DeliveryMessage }[] };
  const first = await runDeliveryTick(deps(now, sent, 1));
  assert.deepEqual(first, { queued: 2, sent: 1, failed: 1 });
  assert.equal(sent.email.length, 0);
  const soon = await runDeliveryTick(deps(new Date(now.getTime() + 30_000), sent));
  assert.equal(soon.sent, 0, "not before the backoff");
  const later = await runDeliveryTick(deps(new Date(now.getTime() + 61_000), sent));
  assert.equal(later.sent, 1);
  assert.equal(sent.email[0]!.m.title, "Agon Lead Agent could not finish, and you were refunded");
});

test("without a sender address only the bell is used, and watch alerts reach email when it is on", async () => {
  const now = new Date("2026-10-23T14:00:00Z");
  await job({ state: "delivered", result: { probabilityBps: 5000 }, updatedAt: new Date(now.getTime() - 60_000) });
  const sent = { bell: [] as DeliveryMessage[], email: [] as { to: string; m: DeliveryMessage }[] };
  const noEmail = { ...deps(now, sent), email: undefined };
  const r = await runDeliveryTick(noEmail);
  assert.deepEqual([r.queued, sent.bell.length, sent.email.length], [1, 1, 0]);

  await db.pool.query("insert into agon_watches (watch_id, owner_address, payer, network, ends_at) values ('w1', $1, '0xp', 'arc-testnet', $2)", [OWNER, new Date(now.getTime() + 86_400_000)]);
  await db.pool.query("insert into agon_watch_alerts (watch_id, condition_id, kind, state_key, title, body, created_at) values ('w1', '0xc', 'settled', 'k1', 'Settled No: Q?', 'The market settled No.', $1)", [new Date(now.getTime() - 60_000)]);
  await runDeliveryTick(deps(now, sent));
  const watchMail = sent.email.find((e) => e.m.title === "Settled No: Q?")!;
  assert.equal(watchMail.m.href, `${SITE}/watch/w1`);
  assert.equal(sent.bell.filter((b) => b.title === "Settled No: Q?").length, 0, "the watch worker already rings the bell");
});

test("only Agon accounts are delivered to", () => {
  assert.equal(operatorOf(`budget:op:${OWNER.toUpperCase().replace("0X", "0x")}`), OWNER);
  assert.equal(operatorOf("budget:tg:42"), null);
  assert.equal(operatorOf("op:0x1"), null);
});

test("a linked Telegram chat gets the delivery through the AGON bot; an unlinked account is skipped", async () => {
  const now = new Date("2026-10-23T16:00:00Z");
  const links = new PostgresTelegramLinks(db.pool);
  const code = await links.createCode(OWNER, now);
  assert.equal(await links.claimCode(code, "777", now), OWNER);
  assert.equal(await links.claimCode(code, "777", now), null, "a code links once");
  const other = await links.createCode(OWNER, now);
  assert.equal(await links.claimCode(other, "778", new Date(now.getTime() + 16 * 60_000)), null, "an expired code does not link");

  const other2 = `0x${"b2".repeat(20)}`;
  await db.pool.query("insert into operators (address) values ($1)", [other2]);
  await job({ state: "delivered", result: { probabilityBps: 7000 }, updatedAt: new Date(now.getTime() - 60_000) });
  await job({ state: "delivered", result: { probabilityBps: 7000 }, buyerRef: `budget:op:${other2}`, updatedAt: new Date(now.getTime() - 60_000) });
  const chats: { chat: string; m: DeliveryMessage }[] = [];
  const sent = { bell: [] as DeliveryMessage[], email: [] as { to: string; m: DeliveryMessage }[] };
  await runDeliveryTick({ ...deps(now, sent), email: undefined, telegram: async (chat, m) => { chats.push({ chat, m }); } });
  assert.deepEqual(chats.map((c) => c.chat), ["777"]);
  const { rows } = await db.pool.query("select status, last_error from agon_deliveries where channel = 'telegram' and operator = $1", [other2]);
  assert.deepEqual(rows[0], { status: "skipped", last_error: "not_linked" });
  await links.unlink(OWNER);
  assert.equal(await links.chatOf(OWNER), null);
});
