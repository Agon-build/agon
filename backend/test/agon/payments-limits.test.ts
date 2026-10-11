import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { issueApproval, issueConfirmation, peekApproval, redeemApproval, redeemConfirmation } from "../../src/agon/payments/limits.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const PAYEE = `0x${"b".repeat(40)}` as Address;
const now = new Date("2026-10-27T12:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

test("a code is four digits, works once, and is stored only as a hash", async () => {
  const store = new MemoryPaymentsStore();
  const { code, expiresAt } = await issueConfirmation(store, { walletRef: "budget:u", jobId: "job-1", amount: 300_000n, payee: PAYEE, now, digits: () => 482 });
  assert.equal(code, "0482");
  assert.equal(expiresAt.toISOString(), later(300_000).toISOString());
  assert.ok(store.confirmations.every((c) => !Object.values(c).some((v) => v === "0482")), "the plain code is never stored");
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:u", code: "0482", now: later(1000) }), { ok: true, jobId: "job-1", amount: 300_000n, payee: PAYEE });
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:u", code: "0482", now: later(2000) }), { ok: false, code: "already_used" });
});

test("codes expire after five minutes and lock after five wrong attempts", async () => {
  const store = new MemoryPaymentsStore();
  await issueConfirmation(store, { walletRef: "budget:u", jobId: "job-1", amount: 1n, payee: PAYEE, now, digits: () => 1111 });
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:u", code: "1111", now: later(300_001) }), { ok: false, code: "expired" });

  await issueConfirmation(store, { walletRef: "budget:v", jobId: "job-2", amount: 1n, payee: PAYEE, now, digits: () => 2222 });
  for (let i = 0; i < 5; i++) assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:v", code: "9999", now }), { ok: false, code: "wrong_code" });
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:v", code: "2222", now }), { ok: false, code: "too_many_attempts" });
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:none", code: "2222", now }), { ok: false, code: "no_pending" });
});

test("a newer quote replaces the older code", async () => {
  const store = new MemoryPaymentsStore();
  await issueConfirmation(store, { walletRef: "budget:u", jobId: "job-old", amount: 1n, payee: PAYEE, now, digits: () => 1234 });
  await issueConfirmation(store, { walletRef: "budget:u", jobId: "job-new", amount: 1n, payee: PAYEE, now: later(10), digits: () => 5678 });
  assert.deepEqual(await redeemConfirmation(store, { walletRef: "budget:u", code: "1234", now: later(20) }), { ok: false, code: "wrong_code" });
  const ok = await redeemConfirmation(store, { walletRef: "budget:u", code: "5678", now: later(20) });
  assert.ok(ok.ok && ok.jobId === "job-new");
});

test("approval links are single use, action-bound and expire", async () => {
  const store = new MemoryPaymentsStore();
  const { token } = await issueApproval(store, { walletRef: "budget:u", action: "withdraw", payload: { amount: "1" }, now });
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await redeemApproval(store, { token, action: "unfreeze", now }), { ok: false, code: "wrong_action" });
  assert.deepEqual(await redeemApproval(store, { token, action: "withdraw", now }), { ok: true, walletRef: "budget:u", payload: { amount: "1" } });
  assert.deepEqual(await redeemApproval(store, { token, action: "withdraw", now }), { ok: false, code: "used" });
  const second = await issueApproval(store, { walletRef: "budget:u", action: "unfreeze", payload: {}, now });
  assert.deepEqual(await redeemApproval(store, { token: second.token, action: "unfreeze", now: later(900_001) }), { ok: false, code: "expired" });
  assert.deepEqual(await redeemApproval(store, { token: "not-a-token", action: "unfreeze", now }), { ok: false, code: "unknown" });
});

test("peeking an approval shows it without using it", async () => {
  const store = new MemoryPaymentsStore();
  const now = new Date("2026-10-27T12:00:00Z");
  const { token } = await issueApproval(store, { walletRef: "budget:op:x", action: "withdraw", payload: { amount: "1000000" }, now });
  const seen = await peekApproval(store, { token, now });
  assert.ok(seen.ok && seen.approval.action === "withdraw" && seen.approval.walletRef === "budget:op:x");
  assert.ok((await redeemApproval(store, { token, action: "withdraw", now })).ok, "still redeemable after a peek");
  assert.deepEqual(await peekApproval(store, { token, now }), { ok: false, code: "used" });
  assert.deepEqual(await peekApproval(store, { token: "not a token", now }), { ok: false, code: "unknown" });
  const late = await issueApproval(store, { walletRef: "budget:op:x", action: "unfreeze", payload: {}, now });
  assert.deepEqual(await peekApproval(store, { token: late.token, now: new Date(now.getTime() + 16 * 60_000) }), { ok: false, code: "expired" });
});
