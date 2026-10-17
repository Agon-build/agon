import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

import { HIRE_PAID_TIMEOUT_MS, completeApprovedHire, confirmHire, quoteHire, reconcileStuckHires, type HireDeps } from "../../src/agon/payments/hire.ts";
import { budgetWalletRef } from "../../src/agon/payments/budget-wallets.ts";
import { exactPayment, type X402Paid } from "../../src/agon/payments/exact-seller.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, circleSignJson, fakeSettler, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const LEAD = `0x${"c".repeat(40)}` as Address;

function world(opts: { price?: bigint } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const state = { price: opts.price ?? 300_000n, payTo: LEAD, fail: false, refundBody: false, free: false };
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  app.post(
    "/agon/agents/lead/forecast",
    async (c, next) => (state.free ? c.json({ ok: true, probabilityBps: 5000 }) : next()),
    exactPayment({ network, payTo: LEAD, price: async () => state.price, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), description: "Lead" }),
    async (c) => (state.fail
      ? c.json({ error: "boom" }, 500)
      : state.refundBody
        ? c.json({ ok: false, code: "no_market", refunded: true, refundTx: `0x${"fe".repeat(32)}`, progress: [] })
        : c.json({ ok: true, probabilityBps: 3400, job: c.req.header("x-agon-job") })),
  );
  const deps: HireDeps = {
    store, network, now: () => new Date(), off: { all: false, budget: false },
    fetchImpl: ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch,
    signJson: circleSignJson(buyer),
    ops: {
      // The budget wallet "is" the local buyer key so signatures verify at the seller.
      createWallet: async () => ({ walletId: "w-budget", address: buyer.address.toLowerCase() as Address }),
      seedTestnet: async () => ({}),
      transfer: async () => ({ id: "t", state: "INITIATED" }),
    },
  };
  const req = { ownerRef: "wa:abc", providerUrl: "http://api.test/agon/agents/lead/forecast", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", body: { question: "BTC above 82k on Friday?" } };
  return { store, settler, state, deps, req };
}

test("quote under the limit returns a code; confirming pays once and delivers", async () => {
  const { deps, req, settler, store } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code", show(q));
  assert.equal(q.quote.amount, 300_000n);
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  assert.equal(out.txHash, `0x${"ab".repeat(32)}`);
  assert.equal((out.result as { job: string }).job, q.quote.jobId, "the provider learns the job id for linked receipts");
  assert.equal(settler.calls.length, 1);
  const job = await store.getJob(q.quote.jobId);
  assert.equal(job!.state, "delivered");
  const payments = await store.listJobPayments(q.quote.jobId);
  assert.equal(payments[0]!.status, "settled");
  assert.match(payments[0]!.authNonce ?? "", /^0x[0-9a-f]{64}$/, "the signed nonce is recorded before sending");
});

test("concurrent confirmations pay once", async () => {
  const { deps, req, settler } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  const results = await Promise.all([confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code }), confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code })]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(settler.calls.length, 1);
});

test("price change after quote is refused without charge", async () => {
  const { deps, req, settler, state, store } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  state.price = 350_000n;
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(!out.ok && out.code === "price_over_limit");
  assert.equal(settler.calls.length, 0);
  assert.equal((await store.getJob(q.quote.jobId))!.state, "failed");
  const spend = [...store.spends.values()][0]!;
  assert.equal(spend.state, "failed", "the reservation is released");
});

test("over the per-hire limit needs the approval link, which pays once", async () => {
  const { deps, req, settler } = world({ price: 600_000n });
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "approval_link");
  const out = await completeApprovedHire(deps, { token: q.quote.token });
  assert.ok(out.ok, show(out));
  assert.deepEqual(await completeApprovedHire(deps, { token: q.quote.token }), { ok: false, code: "used" });
  assert.equal(settler.calls.length, 1);
});

test("the daily limit holds across hires", async () => {
  const { deps, req, store } = world();
  const first = await quoteHire(deps, req);
  assert.ok(first.ok && first.quote.step === "confirm_code");
  await store.updateBudgetWallet("wa:abc", "arc-testnet", { dailyCap: 400_000n });
  assert.ok((await confirmHire(deps, { ownerRef: "wa:abc", code: first.quote.code })).ok);
  const second = await quoteHire(deps, req);
  assert.ok(second.ok && second.quote.step === "confirm_code");
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: second.quote.code });
  assert.ok(!out.ok && out.code === "over_daily");
});

test("frozen wallets and the off switch refuse at quote time", async () => {
  const a = world();
  await quoteHire(a.deps, a.req);
  await a.store.updateBudgetWallet("wa:abc", "arc-testnet", { frozen: true });
  assert.deepEqual(await quoteHire(a.deps, a.req), { ok: false, code: "frozen" });
  const b = world();
  b.deps.off.budget = true;
  assert.deepEqual(await quoteHire(b.deps, b.req), { ok: false, code: "payments_off" });
});

test("a provider that takes payment then fails is recorded as paid but undelivered", async () => {
  const { deps, req, state, store } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  state.fail = true;
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(!out.ok && out.code === "delivery_failed" && out.txHash === `0x${"ab".repeat(32)}`);
  assert.equal((await store.getJob(q.quote.jobId))!.state, "failed");
  assert.equal((await store.listJobPayments(q.quote.jobId))[0]!.status, "settled");
});

test("reconcile settles a stuck hire whose nonce was used, and releases one whose authorization expired unused", async () => {
  const { deps, store } = world();
  const used = new Set<string>([`0x${"01".repeat(32)}`]);
  deps.authorizationUsed = async (_a, nonce) => used.has(nonce);
  const old = new Date(Date.now() - 3_600_000);
  for (const [jobId, nonce, validBefore] of [
    ["11111111-1111-4111-8111-111111111111", `0x${"01".repeat(32)}`, new Date(Date.now() + 60_000)],
    ["22222222-2222-4222-8222-222222222222", `0x${"02".repeat(32)}`, new Date(Date.now() - 60_000)],
    ["33333333-3333-4333-8333-333333333333", `0x${"03".repeat(32)}`, new Date(Date.now() + 60_000)],
  ] as [string, Hex, Date][]) {
    await store.insertJob({
      jobId, parentId: null, rootId: jobId, depth: 0, buyerRef: budgetWalletRef("wa:abc"), providerRef: "agent:lead", providerLabel: "Lead", network: "arc-testnet",
      priceAtomic: 300_000n, budgetAtomic: 0n, state: "paying", traceId: "t", request: {}, result: null, createdAt: old, updatedAt: old,
    });
    await store.reserveSpend({ walletRef: budgetWalletRef("wa:abc"), idempotencyKey: `hire:${jobId}`, network: "arc-testnet", amount: 300_000n, payee: LEAD, jobId, perPaymentCap: 500_000n, dailyCap: 10_000_000n, now: new Date() });
    await store.upsertJobPayment({
      idempotencyKey: `hire:${jobId}`, jobId, kind: "hire", payer: buyer.address, payee: LEAD, amount: 300_000n, network: "arc-testnet",
      status: "pending", txHash: null, detail: null, authNonce: nonce, authValidBefore: validBefore, createdAt: old, updatedAt: old,
    });
    store.jobs.get(jobId)!.updatedAt = old;
  }
  assert.deepEqual(await reconcileStuckHires(deps), { settled: 1, released: 1, waiting: 1 });
  assert.equal((await store.getJob("11111111-1111-4111-8111-111111111111"))!.state, "failed");
  assert.equal((await store.listJobPayments("11111111-1111-4111-8111-111111111111"))[0]!.status, "settled");
  assert.equal((await store.listJobPayments("22222222-2222-4222-8222-222222222222"))[0]!.status, "failed");
  assert.equal(store.spends.get(`${budgetWalletRef("wa:abc")}|hire:22222222-2222-4222-8222-222222222222`)!.state, "failed");
  assert.equal((await store.getJob("33333333-3333-4333-8333-333333333333"))!.state, "paying");
});

test("a seller error without a settlement header after the payment was sent is never written off as unpaid", async () => {
  for (const used of [false, true]) {
    const { deps, req, settler, store } = world();
    const checked: Hex[] = [];
    deps.authorizationUsed = async (_a, nonce) => {
      checked.push(nonce);
      return used;
    };
    const q = await quoteHire(deps, req);
    assert.ok(q.ok && q.quote.step === "confirm_code");
    settler.fail(true);
    const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
    const spend = store.spends.get(`${budgetWalletRef("wa:abc")}|hire:${q.quote.jobId}`)!;
    const payment = (await store.listJobPayments(q.quote.jobId))[0]!;
    assert.equal(checked.length, 1, "the chain is asked whether the authorization was used");
    if (used) {
      assert.ok(!out.ok && out.code === "delivery_failed", show(out));
      assert.equal(spend.state, "settled");
      assert.equal(payment.status, "settled");
      assert.equal((await store.getJob(q.quote.jobId))!.state, "failed");
    } else {
      assert.ok(!out.ok && out.code === "payment_unknown", show(out));
      assert.equal(spend.state, "reserved", "the daily limit still counts it");
      assert.equal(payment.status, "pending");
      assert.equal((await store.getJob(q.quote.jobId))!.state, "paying", "left for reconciliation");
    }
  }
});

test("hires wait long enough for a full lead agent run, and a timed-out hire is left for reconciliation", async () => {
  assert.ok(HIRE_PAID_TIMEOUT_MS >= 180_000);
  const { deps, req, store } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  const real = deps.fetchImpl!;
  deps.fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (!headers["PAYMENT-SIGNATURE"] && !headers["payment-signature"]) return real(url, init);
    return new Promise<Response>((_resolve, reject) => {
      // AbortSignal.timeout does not hold the event loop open; this timer does.
      const hold = setTimeout(() => {}, 5_000);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(hold);
        reject(new Error("timed out"));
      });
    });
  }) as typeof fetch;
  deps.paidTimeoutMs = 30;
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(!out.ok && out.code === "payment_unknown", show(out));
  assert.equal((await store.getJob(q.quote.jobId))!.state, "paying");
});

test("reconcile delivers a stuck hire whose payment settled and whose answer was stored", async () => {
  const { deps, store } = world();
  deps.authorizationUsed = async () => true;
  const old = new Date(Date.now() - 3_600_000);
  const jobId = "44444444-4444-4444-8444-444444444444";
  await store.insertJob({
    jobId, parentId: null, rootId: jobId, depth: 0, buyerRef: budgetWalletRef("wa:abc"), providerRef: "agent:lead", providerLabel: "Lead", network: "arc-testnet",
    priceAtomic: 300_000n, budgetAtomic: 0n, state: "paying", traceId: "t", request: {}, result: { ok: true, probabilityBps: 3400 }, createdAt: old, updatedAt: old,
  });
  await store.reserveSpend({ walletRef: budgetWalletRef("wa:abc"), idempotencyKey: `hire:${jobId}`, network: "arc-testnet", amount: 300_000n, payee: LEAD, jobId, perPaymentCap: 500_000n, dailyCap: 10_000_000n, now: new Date() });
  await store.upsertJobPayment({
    idempotencyKey: `hire:${jobId}`, jobId, kind: "hire", payer: buyer.address, payee: LEAD, amount: 300_000n, network: "arc-testnet",
    status: "pending", txHash: null, detail: null, authNonce: `0x${"04".repeat(32)}`, authValidBefore: new Date(Date.now() + 60_000), createdAt: old, updatedAt: old,
  });
  store.jobs.get(jobId)!.updatedAt = old;
  assert.deepEqual(await reconcileStuckHires(deps), { settled: 1, released: 0, waiting: 0 });
  const job = await store.getJob(jobId);
  assert.equal(job!.state, "delivered");
  assert.deepEqual(job!.result, { ok: true, probabilityBps: 3400 });
});

test("a provider that refunds the buyer leaves the hire refunded, not delivered", async () => {
  const { deps, req, store, state } = world();
  state.refundBody = true;
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  assert.equal((await store.getJob(q.quote.jobId))!.state, "refunded");
});

test("a provider that answers without charging delivers, releases the reservation and records no payment", async () => {
  const { deps, req, state, store, settler } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  state.free = true;
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  assert.equal(out.amount, 0n);
  assert.equal(settler.calls.length, 0);
  assert.equal((await store.getJob(q.quote.jobId))!.state, "delivered");
  assert.equal([...store.spends.values()][0]!.state, "failed", "the daily limit is not charged");
  assert.notEqual((await store.listJobPayments(q.quote.jobId))[0]?.status, "settled", "no settled payment is recorded");
});
