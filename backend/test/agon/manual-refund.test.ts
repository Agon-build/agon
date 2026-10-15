import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { manualRefundPlan } from "../../src/agon/payments/manual-refund.ts";
import type { Job, JobPayment } from "../../src/agon/payments/types.ts";

const LEAD = `0x${"c".repeat(40)}` as Address;
const BUYER = `0x${"b".repeat(40)}` as Address;
const now = new Date("2026-10-15T12:00:00Z");
const job = (over: Partial<Job> = {}): Job => ({
  jobId: "4598ef4b-0000-4000-8000-000000000001", parentId: null, rootId: "4598ef4b-0000-4000-8000-000000000001", depth: 0, buyerRef: "budget:op:x",
  providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc-testnet", priceAtomic: 300_000n, budgetAtomic: 0n, state: "failed",
  traceId: "t", request: {}, result: null, createdAt: now, updatedAt: now, ...over,
});
const pay = (over: Partial<JobPayment>): JobPayment => ({
  idempotencyKey: "k", jobId: job().jobId, kind: "hire", payer: BUYER, payee: LEAD, amount: 300_000n, network: "arc-testnet", status: "settled",
  txHash: null, detail: null, authNonce: null, authValidBefore: null, createdAt: now, updatedAt: now, ...over,
});

test("a failed refund is retried to the same buyer, for the same amount, under the same refund key", () => {
  const failed = pay({ idempotencyKey: `refund:${job().jobId}`, kind: "refund", payer: LEAD, payee: BUYER, status: "failed" });
  assert.deepEqual(manualRefundPlan(job(), [pay({ idempotencyKey: `hire:${job().jobId}` }), failed], LEAD), {
    ok: true, key: `refund:${job().jobId}`, to: BUYER, amount: 300_000n,
  });
});

test("with no refund attempt on record, the paid hire decides who gets what back", () => {
  assert.deepEqual(manualRefundPlan(job(), [pay({ idempotencyKey: `hire:${job().jobId}` })], LEAD), {
    ok: true, key: `refund:${job().jobId}`, to: BUYER, amount: 300_000n,
  });
});

test("never refunds twice, never refunds delivered work, never refunds an unpaid job", () => {
  const settled = pay({ idempotencyKey: `refund:${job().jobId}`, kind: "refund", payer: LEAD, payee: BUYER, status: "settled", txHash: `0x${"a".repeat(64)}` });
  assert.deepEqual(manualRefundPlan(job(), [pay({}), settled], LEAD), { ok: false, reason: "already_refunded" });
  assert.deepEqual(manualRefundPlan(job({ state: "delivered" }), [pay({})], LEAD), { ok: false, reason: "delivered" });
  assert.deepEqual(manualRefundPlan(job(), [], LEAD), { ok: false, reason: "not_paid" });
  assert.deepEqual(manualRefundPlan(job(), [pay({ status: "failed" })], LEAD), { ok: false, reason: "not_paid" });
  assert.deepEqual(manualRefundPlan(job({ providerRef: "house:atlas" }), [pay({})], LEAD), { ok: false, reason: "not_a_lead_job" });
});
