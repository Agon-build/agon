import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import { refundUndeliveredLeadHires } from "../../src/agon/payments/auto-refund.ts";
import type { Job, JobPayment } from "../../src/agon/payments/types.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const LEAD = `0x${"c".repeat(40)}` as Address;
const BUYER = `0x${"b".repeat(40)}` as Address;
const NOW = new Date("2026-10-17T12:00:00Z");
const old = new Date(NOW.getTime() - 30 * 60_000);

function job(id: string, over: Partial<Job> = {}): Job {
  return {
    jobId: id, parentId: null, rootId: id, depth: 0, buyerRef: "budget:op:x", providerRef: "agent:lead", providerLabel: "Agon Lead Agent",
    network: "arc-testnet", priceAtomic: 300_000n, budgetAtomic: 0n, state: "failed", traceId: "t", request: {},
    result: { error: "delivery_failed" }, createdAt: old, updatedAt: old, ...over,
  };
}
const hirePay = (id: string, over: Partial<JobPayment> = {}): JobPayment => ({
  idempotencyKey: `hire:${id}`, jobId: id, kind: "hire", payer: BUYER, payee: LEAD, amount: 300_000n, network: "arc-testnet", status: "settled",
  txHash: null, detail: null, authNonce: null, authValidBefore: null, createdAt: old, updatedAt: old, ...over,
});

async function world() {
  const store = new MemoryPaymentsStore();
  const sent: { to: Address; amount: bigint; key: string }[] = [];
  const deps = {
    store, leadAddress: LEAD, network: "arc-testnet" as const, now: () => NOW,
    refund: async (to: Address, amount: bigint, key: string) => { sent.push({ to, amount, key }); return `0x${"fe".repeat(32)}` as Hex; },
  };
  return { store, sent, deps };
}

test("a Lead hire that was paid but not delivered is refunded once, automatically", async () => {
  const { store, sent, deps } = await world();
  const id = "00000000-0000-4000-8000-0000000000a1";
  await store.insertJob(job(id));
  store.jobs.get(id)!.updatedAt = old;
  await store.upsertJobPayment(hirePay(id));
  assert.deepEqual(await refundUndeliveredLeadHires(deps), { refunded: 1, skipped: 0 });
  assert.deepEqual(sent, [{ to: BUYER, amount: 300_000n, key: `refund:${id}` }]);
  assert.equal((await store.getJob(id))!.state, "refunded");
  const refund = (await store.listJobPayments(id)).find((p) => p.kind === "refund")!;
  assert.equal(refund.status, "settled");
  assert.equal(refund.payee, BUYER);
  assert.deepEqual(await refundUndeliveredLeadHires(deps), { refunded: 0, skipped: 0 }, "never twice");
  assert.equal(sent.length, 1);
});

test("recent failures, unpaid jobs, other providers and other errors are left alone", async () => {
  const { store, sent, deps } = await world();
  const recent = "00000000-0000-4000-8000-0000000000b1";
  await store.insertJob(job(recent));
  store.jobs.get(recent)!.updatedAt = new Date(NOW.getTime() - 60_000);
  await store.upsertJobPayment(hirePay(recent));
  const unpaid = "00000000-0000-4000-8000-0000000000b2";
  await store.insertJob(job(unpaid));
  store.jobs.get(unpaid)!.updatedAt = old;
  const house = "00000000-0000-4000-8000-0000000000b3";
  await store.insertJob(job(house, { providerRef: "house:atlas" }));
  store.jobs.get(house)!.updatedAt = old;
  await store.upsertJobPayment(hirePay(house));
  const other = "00000000-0000-4000-8000-0000000000b4";
  await store.insertJob(job(other, { result: { error: "price_over_limit" } }));
  store.jobs.get(other)!.updatedAt = old;
  await store.upsertJobPayment(hirePay(other));
  await refundUndeliveredLeadHires(deps);
  assert.equal(sent.length, 0);
});

test("a refund that fails is recorded and left for the operator, not retried blindly", async () => {
  const { store, deps } = await world();
  const id = "00000000-0000-4000-8000-0000000000c1";
  await store.insertJob(job(id, { result: { error: "delivery_unknown" } }));
  store.jobs.get(id)!.updatedAt = old;
  await store.upsertJobPayment(hirePay(id));
  let calls = 0;
  const failing = { ...deps, refund: async () => { calls += 1; throw new Error("circle down"); } };
  assert.deepEqual(await refundUndeliveredLeadHires(failing), { refunded: 0, skipped: 1 });
  assert.equal((await store.listJobPayments(id)).find((p) => p.kind === "refund")?.status, "failed");
  assert.deepEqual(await refundUndeliveredLeadHires(failing), { refunded: 0, skipped: 1 });
  assert.equal(calls, 1);
});
