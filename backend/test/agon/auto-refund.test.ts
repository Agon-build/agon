import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import { refundUndeliveredAgonHires, type AgonSellerWallet } from "../../src/agon/payments/auto-refund.ts";
import type { Job, JobPayment } from "../../src/agon/payments/types.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const LEAD = `0x${"c".repeat(40)}` as Address;
const PITCH = `0x${"c1".repeat(20)}` as Address;
const OUTSIDE = `0x${"9".repeat(40)}` as Address;
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

function world() {
  const store = new MemoryPaymentsStore();
  const sent: { from: Address; to: Address; amount: bigint; key: string }[] = [];
  const seller = (address: Address): AgonSellerWallet => ({
    address,
    refund: async (to, amount, key) => { sent.push({ from: address, to, amount, key }); return `0x${"fe".repeat(32)}` as Hex; },
  });
  const deps = { store, sellers: [seller(LEAD), seller(PITCH)], network: "arc-testnet" as const, now: () => NOW };
  const add = async (j: Job, pay?: JobPayment) => {
    await store.insertJob(j);
    store.jobs.get(j.jobId)!.updatedAt = j.updatedAt;
    if (pay) await store.upsertJobPayment(pay);
  };
  return { store, sent, deps, add };
}

test("a Lead hire that was paid but not delivered is refunded once, automatically", async () => {
  const { store, sent, deps, add } = world();
  const id = "00000000-0000-4000-8000-0000000000a1";
  await add(job(id), hirePay(id));
  assert.deepEqual(await refundUndeliveredAgonHires(deps), { refunded: 1, skipped: 0 });
  assert.deepEqual(sent, [{ from: LEAD, to: BUYER, amount: 300_000n, key: `refund:${id}` }]);
  assert.equal((await store.getJob(id))!.state, "refunded");
  const refund = (await store.listJobPayments(id)).find((p) => p.kind === "refund")!;
  assert.deepEqual([refund.status, refund.payer, refund.payee], ["settled", LEAD, BUYER]);
  assert.deepEqual(await refundUndeliveredAgonHires(deps), { refunded: 0, skipped: 0 }, "never twice");
  assert.equal(sent.length, 1);
});

// Audit H1 (2026-11-09): only the Lead was refunded; a Pitch, Rules Check,
// Scout, Resolution Watch or house forecaster hire that failed after the
// payment settled stayed paid.
test("a hire of another Agon agent that failed after payment is refunded from that agent's wallet", async () => {
  const { store, sent, deps, add } = world();
  const id = "00000000-0000-4000-8000-0000000000a2";
  await add(job(id, { providerRef: "listing:7", providerLabel: "Pitch", priceAtomic: 150_000n }), hirePay(id, { payee: PITCH, amount: 150_000n }));
  assert.deepEqual(await refundUndeliveredAgonHires(deps), { refunded: 1, skipped: 0 });
  assert.deepEqual(sent, [{ from: PITCH, to: BUYER, amount: 150_000n, key: `refund:${id}` }]);
  assert.equal((await store.getJob(id))!.state, "refunded");
});

test("a seller wallet address is matched without regard to case", async () => {
  const { sent, deps, add } = world();
  const id = "00000000-0000-4000-8000-0000000000a3";
  await add(job(id, { providerRef: "listing:7" }), hirePay(id, { payee: PITCH.toUpperCase().replace("0X", "0x") as Address, amount: 150_000n }));
  await refundUndeliveredAgonHires(deps);
  assert.equal(sent[0]?.from, PITCH);
});

test("outside services, recent failures, unpaid jobs, sub-hires and other errors are left alone", async () => {
  const { sent, deps, add } = world();
  const outside = "00000000-0000-4000-8000-0000000000b0";
  await add(job(outside, { providerRef: "circle:x" }), hirePay(outside, { payee: OUTSIDE }));
  const recent = "00000000-0000-4000-8000-0000000000b1";
  await add(job(recent, { updatedAt: new Date(NOW.getTime() - 60_000) }), hirePay(recent));
  const unpaid = "00000000-0000-4000-8000-0000000000b2";
  await add(job(unpaid));
  const pending = "00000000-0000-4000-8000-0000000000b3";
  await add(job(pending), hirePay(pending, { status: "pending" }));
  const other = "00000000-0000-4000-8000-0000000000b4";
  await add(job(other, { result: { error: "price_over_limit" } }), hirePay(other));
  const sub = "00000000-0000-4000-8000-0000000000b5";
  await add(job(sub, { parentId: "00000000-0000-4000-8000-0000000000ff", rootId: "00000000-0000-4000-8000-0000000000ff", depth: 1 }), hirePay(sub, { payer: LEAD, payee: PITCH }));
  await refundUndeliveredAgonHires(deps);
  assert.equal(sent.length, 0);
});

test("a job the agent already refunded itself is not refunded again", async () => {
  const { sent, deps, add, store } = world();
  const id = "00000000-0000-4000-8000-0000000000c0";
  await add(job(id), hirePay(id));
  await store.upsertJobPayment({ ...hirePay(id), idempotencyKey: `refund:${id}`, kind: "refund", payer: LEAD, payee: BUYER });
  await refundUndeliveredAgonHires(deps);
  assert.equal(sent.length, 0);
});

test("a refund that fails is recorded and left for the operator, not retried blindly", async () => {
  const { store, deps, add } = world();
  const id = "00000000-0000-4000-8000-0000000000c1";
  await add(job(id, { providerRef: "listing:7", result: { error: "delivery_unknown" } }), hirePay(id, { payee: PITCH, amount: 150_000n }));
  let calls = 0;
  const failing = { ...deps, sellers: deps.sellers.map((s) => ({ ...s, refund: async () => { calls += 1; throw new Error("circle down"); } })) };
  assert.deepEqual(await refundUndeliveredAgonHires(failing), { refunded: 0, skipped: 1 });
  const refund = (await store.listJobPayments(id)).find((p) => p.kind === "refund")!;
  assert.deepEqual([refund.status, refund.payer], ["failed", PITCH]);
  assert.deepEqual(await refundUndeliveredAgonHires(failing), { refunded: 0, skipped: 1 });
  assert.equal(calls, 1);
});
