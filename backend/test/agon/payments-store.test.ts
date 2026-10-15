import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";

import { PostgresPaymentsStore } from "../../src/agon/payments/store.ts";
import type { Job, JobPayment, SpendReservation } from "../../src/agon/payments/types.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresPaymentsStore;
const PAYEE = `0x${"b".repeat(40)}` as Address;
const now = new Date("2026-10-27T12:00:00Z");

before(async () => {
  db = await createAgonTestDatabase("payments");
  store = new PostgresPaymentsStore(db.pool);
});
after(async () => db.close());

const reservation = (key: string, amount: bigint, o: Partial<SpendReservation> = {}): SpendReservation => ({
  walletRef: "budget:user-1", idempotencyKey: key, network: "arc", amount, payee: PAYEE, jobId: null,
  perPaymentCap: 500_000n, dailyCap: 1_000_000n, now, ...o,
});

test("budget wallets insert once and update limits and freeze", async () => {
  const w = { ownerRef: "user-1", network: "arc" as const, walletId: "w-1", address: `0x${"a".repeat(40)}` as Address, perHireCap: 500_000n, dailyCap: 2_000_000n, frozen: false, createdAt: now };
  assert.equal((await store.insertBudgetWallet(w)).walletId, "w-1");
  assert.equal((await store.insertBudgetWallet({ ...w, walletId: "w-2" })).walletId, "w-1");
  const updated = await store.updateBudgetWallet("user-1", "arc", { perHireCap: 100_000n, frozen: true });
  assert.equal(updated!.perHireCap, 100_000n);
  assert.equal(updated!.frozen, true);
  assert.equal(await store.getBudgetWallet("user-1", "arc-testnet"), null);
});

test("spend reservations enforce per-payment and daily caps and are idempotent", async () => {
  assert.equal(await store.reserveSpend(reservation("a", 600_000n)), "over_per_payment");
  assert.equal(await store.reserveSpend(reservation("b", 400_000n)), "reserved");
  assert.equal(await store.reserveSpend(reservation("b", 400_000n)), "duplicate");
  assert.equal(await store.reserveSpend(reservation("c", 400_000n)), "reserved");
  assert.equal(await store.reserveSpend(reservation("d", 300_000n)), "over_daily");
  await store.finishSpend("budget:user-1", "c", { state: "failed" });
  assert.equal(await store.reserveSpend(reservation("d", 300_000n)), "reserved", "a failed spend frees its share of the day");
  await store.finishSpend("budget:user-1", "b", { state: "settled", txHash: `0x${"1".repeat(64)}` });
  assert.equal(await store.reserveSpend(reservation("e", 400_000n, { now: new Date("2026-10-28T00:00:01Z") })), "reserved", "a new UTC day starts fresh");
});

test("concurrent reservations cannot both pass the daily cap", async () => {
  const results = await Promise.all([1, 2, 3, 4].map((i) => store.reserveSpend(reservation(`p${i}`, 400_000n, { walletRef: "budget:race" }))));
  assert.equal(results.filter((r) => r === "reserved").length, 2);
  assert.equal(results.filter((r) => r === "over_daily").length, 2);
});

test("confirmations: latest first, attempts and use recorded", async () => {
  const base = { walletRef: "budget:user-1", amount: 300_000n, payee: PAYEE, expiresAt: new Date(now.getTime() + 300_000), usedAt: null, attempts: 0 };
  await store.insertConfirmation({ ...base, codeHash: `0x${"a1".repeat(32)}`, jobId: randomUUID(), createdAt: new Date(now.getTime() - 1000) });
  await store.insertConfirmation({ ...base, codeHash: `0x${"a2".repeat(32)}`, jobId: randomUUID(), createdAt: now });
  const latest = await store.latestConfirmation("budget:user-1");
  assert.equal(latest!.codeHash, `0x${"a2".repeat(32)}`);
  await store.updateConfirmation(latest!.codeHash, { attempts: 3, usedAt: now });
  const again = await store.latestConfirmation("budget:user-1");
  assert.equal(again!.attempts, 3);
  assert.equal(again!.usedAt!.toISOString(), now.toISOString());
});

test("approvals and quotes can be used once; nonces can be claimed once", async () => {
  const tokenHash = `0x${"c3".repeat(32)}` as const;
  await store.insertApproval({ tokenHash, walletRef: "budget:user-1", action: "withdraw", payload: { to: PAYEE }, expiresAt: new Date(now.getTime() + 900_000), usedAt: null });
  assert.equal((await store.getApproval(tokenHash))!.action, "withdraw");
  assert.equal(await store.useApproval(tokenHash, now), true);
  assert.equal(await store.useApproval(tokenHash, now), false);

  const quoteId = randomUUID();
  await store.insertQuote({ quoteId, sellerKey: "atlas", buyer: PAYEE, amount: 174_240n, expiresAt: new Date(now.getTime() + 300_000), usedAt: null, transcript: [{ step: "offer", detail: "x" }] });
  assert.equal(await store.useQuote(quoteId, `0x${"9".repeat(40)}`, now), false, "wrong buyer");
  assert.equal(await store.useQuote(quoteId, PAYEE, new Date(now.getTime() + 400_000)), false, "expired");
  assert.equal(await store.useQuote(quoteId, PAYEE, now), true);
  assert.equal(await store.useQuote(quoteId, PAYEE, now), false, "used");
  assert.equal((await store.getQuote(quoteId))!.amount, 174_240n);

  const nonce = `0x${"d4".repeat(32)}` as const;
  assert.equal(await store.claimSellerNonce("arc", PAYEE, nonce), true);
  assert.equal(await store.claimSellerNonce("arc", PAYEE, nonce), false);
});

test("jobs form a tree with payments, and stuck jobs are listed", async () => {
  const root: Job = {
    jobId: randomUUID(), parentId: null, rootId: "", depth: 0, buyerRef: "budget:user-1", providerRef: "agent:lead", providerLabel: "Agon Lead Agent",
    network: "arc", priceAtomic: 300_000n, budgetAtomic: 0n, state: "quoted", traceId: "t-1", request: { url: "https://x" }, result: null, createdAt: now, updatedAt: now,
  };
  root.rootId = root.jobId;
  await store.insertJob(root);
  const child: Job = { ...root, jobId: randomUUID(), parentId: root.jobId, depth: 1, buyerRef: "agent:lead", providerRef: "house:atlas", providerLabel: "Atlas (house)", priceAtomic: 174_240n };
  await store.insertJob(child);
  await store.updateJob(root.jobId, { state: "paying", budgetAtomic: 250_000n });
  const pay: JobPayment = {
    idempotencyKey: `hire:${child.jobId}`, jobId: child.jobId, kind: "hire", payer: PAYEE, payee: PAYEE, amount: 174_240n, network: "arc",
    status: "pending", txHash: null, detail: null, authNonce: `0x${"e5".repeat(32)}`, authValidBefore: new Date(now.getTime() + 300_000), createdAt: now, updatedAt: now,
  };
  await store.upsertJobPayment(pay);
  await store.upsertJobPayment({ ...pay, status: "settled", txHash: `0x${"f6".repeat(32)}`, authNonce: null });
  const tree = await store.listJobTree(root.jobId);
  assert.equal(tree.length, 2);
  assert.equal(tree.find((j) => j.jobId === root.jobId)!.budgetAtomic, 250_000n);
  const payments = await store.listJobPayments(root.jobId);
  assert.equal(payments.length, 1);
  assert.equal(payments[0]!.status, "settled");
  assert.equal(payments[0]!.authNonce, `0x${"e5".repeat(32)}`, "a later update never erases the recorded nonce");
  const stuck = await store.listStuckJobs("paying", new Date(Date.now() + 60_000));
  assert.ok(stuck.some((j) => j.jobId === root.jobId));
});

test("root jobs list by buyer, newest first, and daily spend sums reserved and settled", async () => {
  const mk = (id: string, createdAt: Date, parent: string | null = null): Job => ({
    jobId: id, parentId: parent, rootId: parent ?? id, depth: parent ? 1 : 0, buyerRef: "budget:op:list", providerRef: "agent:lead", providerLabel: "Agon Lead Agent",
    network: "arc", priceAtomic: 300_000n, budgetAtomic: 0n, state: "delivered", traceId: "t", request: { question: "Q?" }, result: null, createdAt, updatedAt: createdAt,
  });
  const a = randomUUID();
  const b = randomUUID();
  await store.insertJob(mk(a, new Date("2026-10-27T10:00:00Z")));
  await store.insertJob(mk(b, new Date("2026-10-27T11:00:00Z")));
  await store.insertJob({ ...mk(randomUUID(), new Date("2026-10-27T11:30:00Z"), b), buyerRef: "budget:op:list" });
  assert.deepEqual((await store.listJobsByBuyer("budget:op:list", 10)).map((j) => j.jobId), [b, a]);
  assert.deepEqual((await store.listJobsByBuyer("budget:op:list", 1)).map((j) => j.jobId), [b]);
  assert.deepEqual((await store.listJobsByBuyer("budget:op:list", 1, 1)).map((j) => j.jobId), [a], "offset pages through older hires");
  assert.deepEqual(await store.listJobsByBuyer("budget:op:list", 10, 2), []);

  const wallet = "budget:op:spend";
  await store.reserveSpend(reservation("d1", 200_000n, { walletRef: wallet }));
  await store.reserveSpend(reservation("d2", 100_000n, { walletRef: wallet }));
  await store.reserveSpend(reservation("d3", 50_000n, { walletRef: wallet }));
  await store.finishSpend(wallet, "d2", { state: "settled", txHash: null });
  await store.finishSpend(wallet, "d3", { state: "failed" });
  assert.equal(await store.dailySpent(wallet, "arc", now), 300_000n);
  assert.equal(await store.dailySpent(wallet, "arc", new Date("2026-10-28T12:00:00Z")), 0n);
  assert.equal(await store.dailySpent(wallet, "arc-testnet", now), 0n);
});

test("delivered job totals per provider, on one network, count only delivered work", async () => {
  const mk = (provider: string, state: Job["state"], network: Job["network"], price: bigint): Job => {
    const id = randomUUID();
    return {
      jobId: id, parentId: null, rootId: id, depth: 0, buyerRef: "budget:op:stats", providerRef: provider, providerLabel: provider,
      network, priceAtomic: price, budgetAtomic: 0n, state, traceId: "t", request: {}, result: null, createdAt: now, updatedAt: now,
    };
  };
  for (const j of [mk("house:stat-a", "delivered", "arc-testnet", 174_240n), mk("house:stat-a", "delivered", "arc-testnet", 200_000n), mk("house:stat-a", "refunded", "arc-testnet", 220_000n), mk("house:stat-a", "delivered", "arc", 220_000n), mk("agent:stat-b", "failed", "arc-testnet", 300_000n)]) await store.insertJob(j);
  assert.deepEqual(await store.deliveredJobStats("arc-testnet", ["house:stat-a", "agent:stat-b", "agent:stat-none"]), {
    "house:stat-a": { jobs: 2, earnedAtomic: 374_240n },
  });
  assert.deepEqual(await store.deliveredJobStats("arc-testnet", []), {});
});
