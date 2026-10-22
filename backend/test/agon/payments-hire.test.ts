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
  const state = { price: opts.price ?? 300_000n, payTo: LEAD, fail: false, refundBody: false, free: false, refuse: null as string | null, transferFails: 0 };
  const transfers: { destinationAddress: string; amountBaseUnits: bigint; idempotencyKey: string }[] = [];
  const seen: { method: string; url: string; body: string }[] = [];
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  app.get(
    "/agon/data/ticker",
    async (c, next) => { seen.push({ method: c.req.method, url: c.req.url, body: await c.req.text() }); return next(); },
    exactPayment({ network, payTo: LEAD, price: async () => 10_000n, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), description: "Ticker" }),
    async (c) => c.json({ ticker: c.req.query("ticker"), price: 1.23 }),
  );
  app.get(
    "/agon/data/text",
    exactPayment({ network, payTo: LEAD, price: async () => 10_000n, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), description: "Text" }),
    async (c) => (c.req.query("empty") ? c.body(null, 200) : c.text("Apple: Buy, target 250")),
  );
  app.post(
    "/agon/agents/lead/forecast",
    async (c, next) => (state.refuse ? c.json({ error: state.refuse, message: "That market has already closed." }, 422) : state.free ? c.json({ ok: true, probabilityBps: 5000 }) : next()),
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
      transfer: async (input) => {
        transfers.push(input);
        if (state.transferFails > 0) { state.transferFails -= 1; throw new Error("circle busy"); }
        return { id: `t-${transfers.length}`, state: "INITIATED" };
      },
    },
  };
  const req = { ownerRef: "wa:abc", providerUrl: "http://api.test/agon/agents/lead/forecast", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", body: { question: "BTC above 82k on Friday?" } };
  return { store, settler, state, deps, req, transfers, seen };
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

test("a provider that refuses the job before payment fails it at once with its reason, and nothing is signed or charged", async () => {
  const { deps, req, settler, state, store } = world();
  const q = await quoteHire(deps, req);
  assert.ok(q.ok && q.quote.step === "confirm_code");
  state.refuse = "market_closed";
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(!out.ok && out.code === "market_closed", show(out));
  assert.equal(settler.calls.length, 0);
  const job = (await store.getJob(q.quote.jobId))!;
  assert.equal(job.state, "failed");
  assert.equal((job.result as { error?: string }).error, "market_closed", "the job page names the provider's reason");
  assert.deepEqual(await store.listJobPayments(q.quote.jobId).then((p) => p.map((x) => x.status)), ["failed"]);
  assert.equal([...store.spends.values()][0]!.state, "failed", "the reservation is released");
});

test("a provider that refuses at quote time gives its reason, not 'did not answer'", async () => {
  const { deps, req, state } = world();
  state.refuse = "market_closed";
  assert.deepEqual(await quoteHire(deps, req), { ok: false, code: "market_closed", detail: "status 422" });
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

const FEE_TO = `0x${"fe".repeat(20)}` as Address;

test("a GET provider gets the input as a query string and no body", async () => {
  const { deps, seen } = world();
  const q = await quoteHire(deps, { ownerRef: "wa:abc", providerUrl: "http://api.test/agon/data/ticker", providerRef: "circle:ticker", providerLabel: "Ticker", method: "GET", body: { ticker: "ARC" } });
  assert.ok(q.ok && q.quote.step === "confirm_code", show(q));
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  assert.deepEqual(out.result, { ticker: "ARC", price: 1.23 });
  assert.ok(seen.every((r) => r.method === "GET" && r.body === "" && r.url.includes("ticker=ARC")), JSON.stringify(seen));
});

test("the quote shows price, fee and total, and limits apply to the total", async () => {
  const { deps, req, store } = world();
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok);
  assert.deepEqual([q.quote.amount, q.quote.fee, q.quote.total], [300_000n, 4_500n, 304_500n]);
  await store.updateBudgetWallet("wa:abc", "arc-testnet", { perHireCap: 302_000n });
  const over = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(over.ok && over.quote.step === "approval_link", "the fee pushes this hire over the per-hire limit");
});

test("the fee is paid only after delivery, as its own payment", async () => {
  const { deps, req, store, transfers } = world();
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  const payments = await store.listJobPayments(q.quote.jobId);
  const fee = payments.find((p) => p.kind === "fee")!;
  assert.deepEqual([fee.payee, fee.amount, fee.status], [FEE_TO, 4_500n, "settled"]);
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0]!.amountBaseUnits, 4_500n);
});

test("a provider that fails after payment is charged no fee", async () => {
  const { deps, req, state, store, transfers } = world();
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  state.fail = true;
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(!out.ok && out.code === "delivery_failed");
  assert.equal((await store.listJobPayments(q.quote.jobId)).some((p) => p.kind === "fee"), false);
  assert.equal(transfers.length, 0);
});

test("a failed fee transfer is retried by reconcile and never undoes the delivery", async () => {
  const { deps, req, state, store } = world();
  state.transferFails = 1;
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  const out = await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  assert.ok(out.ok, show(out));
  assert.equal((await store.getJob(q.quote.jobId))!.state, "delivered");
  assert.equal((await store.listJobPayments(q.quote.jobId)).find((p) => p.kind === "fee")!.status, "pending");
  const later = { ...deps, now: () => new Date(Date.now() + 11 * 60_000) };
  await reconcileStuckHires(later);
  assert.equal((await store.listJobPayments(q.quote.jobId)).find((p) => p.kind === "fee")!.status, "settled");
});

test("final C1: a runtime's reconcile never touches jobs or fees from the other network", async () => {
  const { deps, req, store, state } = world();
  state.transferFails = 1;
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  // A stuck testnet hire, as the mainnet runtime would see it.
  const stuck = await quoteHire(deps, req);
  assert.ok(stuck.ok);
  await store.updateJob(stuck.quote.jobId, { state: "paying" });
  const mainnet = { ...deps, network: agonNetwork("arc"), authorizationUsed: async () => false, now: () => new Date(Date.now() + 60 * 60_000) };
  await reconcileStuckHires(mainnet);
  assert.equal((await store.getJob(stuck.quote.jobId))!.state, "paying", "the testnet job is left for the testnet runtime");
  assert.equal((await store.listJobPayments(q.quote.jobId)).find((p) => p.kind === "fee")!.status, "pending", "the testnet fee is not retried from mainnet");
});

test("final I2: a fee is settled only when its transfer confirms, and a failed transfer is recorded as failed", async () => {
  const { deps, req, store } = world();
  const states: Record<string, { state: string; txHash?: string; errorReason?: string }> = {};
  const withState = { ...deps, feeTxState: async (id: string) => states[id] ?? { state: "QUEUED" }, feeWaitMs: 0 };
  const q = await quoteHire(withState, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  await confirmHire(withState, { ownerRef: "wa:abc", code: q.quote.code });
  const fee = () => store.listJobPayments(q.quote.jobId).then((ps) => ps.find((p) => p.kind === "fee")!);
  assert.equal((await fee()).status, "pending", "accepted by Circle is not paid");
  states["t-1"] = { state: "COMPLETE", txHash: `0x${"cd".repeat(32)}` };
  await reconcileStuckHires({ ...withState, now: () => new Date(Date.now() + 11 * 60_000) });
  assert.deepEqual([(await fee()).status, (await fee()).txHash], ["settled", `0x${"cd".repeat(32)}`]);

  const w2 = world();
  const states2: Record<string, { state: string; errorReason?: string }> = { "t-1": { state: "FAILED", errorReason: "INSUFFICIENT_NATIVE_TOKEN" } };
  const d2 = { ...w2.deps, feeTxState: async (id: string) => states2[id] ?? { state: "QUEUED" }, feeWaitMs: 0 };
  const q2 = await quoteHire(d2, { ...w2.req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q2.ok && q2.quote.step === "confirm_code");
  const out2 = await confirmHire(d2, { ownerRef: "wa:abc", code: q2.quote.code });
  assert.ok(out2.ok, "the delivered answer stands");
  const fee2 = (await w2.store.listJobPayments(q2.quote.jobId)).find((p) => p.kind === "fee")!;
  assert.equal(fee2.status, "failed");
  assert.match(fee2.detail ?? "", /INSUFFICIENT_NATIVE_TOKEN/);
});

test("final I7: a fee that keeps failing moves to the back of the queue and is given up after a day", async () => {
  const { deps, req, store, state, transfers } = world();
  state.transferFails = 99;
  const q = await quoteHire(deps, { ...req, feeBps: 150, feeAddress: FEE_TO });
  assert.ok(q.ok && q.quote.step === "confirm_code");
  await confirmHire(deps, { ownerRef: "wa:abc", code: q.quote.code });
  const fee = () => store.listJobPayments(q.quote.jobId).then((ps) => ps.find((p) => p.kind === "fee")!);
  // Reconcile looks at fees untouched for 10 minutes; a failed retry is stamped, so it waits its turn again.
  store.payments.get(`fee:${q.quote.jobId}`)!.updatedAt = new Date(Date.now() - 20 * 60_000);
  const tries = transfers.length;
  await reconcileStuckHires(deps);
  assert.equal(transfers.length, tries + 1, "retried once");
  assert.equal((await fee()).status, "pending");
  await reconcileStuckHires(deps);
  assert.equal(transfers.length, tries + 1, "a fee retried a moment ago goes to the back and is not picked again at once");
  await reconcileStuckHires({ ...deps, now: () => new Date(Date.now() + 25 * 60 * 60_000) });
  assert.equal((await fee()).status, "failed", "given up after a day");
});

test("final I9: a text answer is kept, and an empty answer is not delivered and carries no fee", async () => {
  const { deps, store, transfers } = world();
  const ask = (q: string) => quoteHire(deps, { ownerRef: "wa:abc", providerUrl: `http://api.test/agon/data/text${q}`, providerRef: "circle:text", providerLabel: "Text", method: "GET", body: {}, feeBps: 150, feeAddress: FEE_TO });
  const q1 = await ask("");
  assert.ok(q1.ok && q1.quote.step === "confirm_code", show(q1));
  const out1 = await confirmHire(deps, { ownerRef: "wa:abc", code: q1.quote.code });
  assert.ok(out1.ok, show(out1));
  assert.deepEqual(out1.result, { contentType: "text/plain;charset=UTF-8", text: "Apple: Buy, target 250" });
  assert.equal(transfers.length, 1, "the fee for a delivered text answer");
  const q2 = await ask("?empty=1");
  assert.ok(q2.ok && q2.quote.step === "confirm_code", show(q2));
  const out2 = await confirmHire(deps, { ownerRef: "wa:abc", code: q2.quote.code });
  assert.ok(!out2.ok && out2.code === "delivery_failed", show(out2));
  assert.equal((await store.getJob(q2.quote.jobId))!.state, "failed");
  assert.equal(transfers.length, 1, "no fee for an empty answer");
});

test("minor: changed terms or a short wallet are refused before any job or code is made", async () => {
  const { deps, req, store } = world();
  const changed = await quoteHire(deps, { ...req, expect: { amount: 200_000n, payTo: null } });
  assert.deepEqual(changed, { ok: false, code: "terms_changed" });
  const short = await quoteHire(deps, { ...req, balanceOf: async () => 100_000n, reserve: 5_000n });
  assert.ok(!short.ok && short.code === "insufficient_balance", show(short));
  assert.equal((short as { amount: bigint }).amount, 300_000n);
  assert.equal(store.jobs.size, 0, "no job was written");
});
