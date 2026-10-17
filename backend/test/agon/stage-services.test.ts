import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { QUESTION, SITE, stageWorld } from "./stage-test-world.ts";
import { show } from "./x402-test-helpers.ts";

const OWNER = `op:0x${"1".repeat(40)}`;

test("asking returns the lead agent quote with a code under the limit", async () => {
  const { services } = stageWorld();
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code", show(quote));
  assert.equal(quote.amount, 300_000n);
  assert.equal(quote.providerLabel, "Agon Lead Agent");
  assert.equal(quote.network, "Arc Testnet");
  assert.equal(quote.testnet, true);
  assert.match(quote.code, /^\d{4}$/);
});

test("a question that is too short or too long is refused before any quote", async () => {
  const { services, store } = stageWorld();
  assert.deepEqual(await services.ask(OWNER, { question: "btc?" }), { ok: false, code: "invalid_question" });
  assert.deepEqual(await services.ask(OWNER, { question: "x".repeat(301) }), { ok: false, code: "invalid_question" });
  assert.equal(store.jobs.size, 0);
});

test("a price above the user's own maximum is refused with the price", async () => {
  const { services } = stageWorld();
  assert.deepEqual(await services.ask(OWNER, { question: QUESTION, maxPrice: 200_000n }), { ok: false, code: "over_your_max", amount: 300_000n });
});

test("an empty wallet gets the deposit address and the amount needed", async () => {
  const { services, state } = stageWorld();
  state.balance = 100_000n;
  const out = await services.ask(OWNER, { question: QUESTION });
  assert.ok(!out.ok && out.code === "insufficient_balance", show(out));
  assert.equal(out.amount, 300_000n);
  assert.match(out.depositAddress ?? "", /^0x[0-9a-f]{40}$/);
});

test("over the per-hire limit the quote is an approval link on the site", async () => {
  const { services } = stageWorld({ price: 600_000n });
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "approval_link", show(quote));
  assert.match(quote.approvalUrl, /^https:\/\/agon\.surf\/approve\?t=[A-Za-z0-9_-]{43}$/);
});

test("confirming pays once and the live view shows the answer, events, haggle and receipt", async () => {
  const { services } = stageWorld();
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code");
  const out = await services.confirm(OWNER, quote.code);
  assert.ok(out.ok, show(out));
  const live = await services.live(quote.jobId);
  assert.ok(live, "live view exists");
  assert.equal(live.phase, "answered");
  assert.equal(live.question, QUESTION);
  assert.equal(live.answer!.probabilityBps, 3400);
  assert.equal(live.answer!.marketPriceBps, 4100);
  assert.equal(live.answer!.marketQuestion, "Will Bitcoin close above $120,000 on October 30?");
  assert.deepEqual(live.answer!.forecaster, { name: "Atlas (house)", reason: "Season 1 rank #1", asked: "0.22", agreed: "0.17424" });
  assert.deepEqual(live.events.map((e) => e.kind), ["note", "data", "hire"]);
  assert.equal(live.haggle.length, 2);
  assert.equal(live.receipt!.payments[0]!.amount, "0.30");
  assert.equal(live.receiptUrl, `${SITE}/r/${quote.jobId}`);
  assert.equal(live.network, "Arc Testnet");
});

test("a refunded run shows as refunded with its events", async () => {
  const { services, state } = stageWorld();
  state.refund = true;
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code");
  await services.confirm(OWNER, quote.code);
  const live = (await services.live(quote.jobId))!;
  assert.equal(live.phase, "refunded");
  assert.equal(live.refunded, true);
  assert.equal(live.failure, "no_market");
  assert.equal(live.events.at(-1)!.kind, "refund");
});

test("a run in progress shows as working; an unknown job is null", async () => {
  const { services, store } = stageWorld();
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok);
  assert.equal((await services.live(quote.jobId))!.phase, "quoted");
  await store.updateJob(quote.jobId, { state: "paying" });
  assert.equal((await services.live(quote.jobId))!.phase, "paying");
  await store.updateJob(quote.jobId, { result: { live: true, startedAt: new Date().toISOString(), events: [{ at: new Date().toISOString(), text: "x", kind: "note" }], haggle: [] } });
  assert.equal((await services.live(quote.jobId))!.phase, "working");
  assert.equal(await services.live("00000000-0000-4000-8000-000000000000"), null);
  assert.equal(await services.live("not-a-uuid"), null);
});

test("the wallet view shows balance, limits and what is left today", async () => {
  const { services } = stageWorld();
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code");
  await services.confirm(OWNER, quote.code);
  const w = await services.wallet(OWNER);
  assert.deepEqual([w.balance, w.perHireCap, w.dailyCap, w.spentToday, w.leftToday, w.frozen, w.testnet], [5_000_000n, 500_000n, 2_000_000n, 300_000n, 1_700_000n, false, true]);
  assert.equal(w.network, "Arc Testnet");
  assert.equal(w.explorer, "https://explorer.testnet.arc.io");
});

test("history lists the user's asks newest first with receipt links", async () => {
  const { services, store } = stageWorld();
  const first = await services.ask(OWNER, { question: QUESTION });
  const second = await services.ask(OWNER, { question: `${QUESTION} And ETH?` });
  assert.ok(first.ok && second.ok);
  store.jobs.get(first.jobId)!.createdAt = new Date(Date.now() - 60_000);
  const items = await services.history(OWNER);
  assert.deepEqual(items.map((i) => i.jobId), [second.jobId, first.jobId]);
  assert.equal(items[1]!.question, QUESTION);
  assert.equal(items[0]!.receiptUrl, `${SITE}/r/${second.jobId}`);
  assert.equal(items[0]!.price, "0.30");
  assert.deepEqual(await services.history(`op:0x${"9".repeat(40)}`), []);
});

test("unfreeze and withdraw return approval links on the site", async () => {
  const { services } = stageWorld();
  await services.wallet(OWNER);
  assert.equal(await services.freeze(OWNER), true);
  const unfreeze = await services.requestUnfreeze(OWNER);
  assert.match(unfreeze!.approvalUrl, /^https:\/\/agon\.surf\/approve\?t=/);
  const withdraw = await services.requestWithdraw(OWNER, `0x${"7".repeat(40)}` as Address, 1_000_000n);
  assert.ok(withdraw.ok && withdraw.approvalUrl.startsWith(`${SITE}/approve?t=`));
  assert.deepEqual(await services.requestWithdraw(OWNER, `0x${"7".repeat(40)}` as Address, 0n), { ok: false, code: "bad_amount" });
  assert.deepEqual(await services.lowerLimits(OWNER, { perHireCap: 900_000n }), { ok: false, code: "above_default" });
  assert.deepEqual(await services.lowerLimits(OWNER, { perHireCap: 200_000n }), { ok: true });
});

test("the pending job is the latest unused, unexpired quote", async () => {
  const { services } = stageWorld();
  assert.equal(await services.pendingJob(OWNER), null);
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code");
  assert.equal(await services.pendingJob(OWNER), quote.jobId);
  await services.confirm(OWNER, quote.code);
  assert.equal(await services.pendingJob(OWNER), null);
});

test("findWallet never creates a wallet; new wallets pass the creation gate", async () => {
  const world = stageWorld();
  assert.equal(await world.services.findWallet(OWNER), null);
  assert.equal(world.store.wallets.size, 0);
  await world.services.ask(OWNER, { question: QUESTION });
  assert.equal((await world.services.findWallet(OWNER))!.address.length, 42);
});

test("when the wallet creation gate is shut a new owner is refused before any wallet exists", async () => {
  const world = stageWorld({ newWalletAllowed: () => false });
  assert.deepEqual(await world.services.ask(OWNER, { question: QUESTION }), { ok: false, code: "busy" });
  assert.equal(world.store.wallets.size, 0);
});

test("cancel retires the pending code", async () => {
  const { services } = stageWorld();
  const quote = await services.ask(OWNER, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "confirm_code");
  assert.equal(await services.cancel(OWNER), true);
  assert.equal(await services.pendingJob(OWNER), null);
  const out = await services.confirm(OWNER, quote.code);
  assert.ok(!out.ok && out.code === "already_used");
  assert.equal(await services.cancel(OWNER), false, "nothing left to cancel");
});

test("final C2: a delivered routed hire reads as answered with the service's result, on its own network", async () => {
  const { services, store } = stageWorld();
  const jobId = "44444444-4444-4444-8444-444444444444";
  const at = new Date();
  await store.insertJob({
    jobId, parentId: null, rootId: jobId, depth: 0, buyerRef: "budget:op:x", providerRef: "circle:https://analyst.example/ratings", providerLabel: "Analyst ratings", network: "arc",
    priceAtomic: 10_000n, budgetAtomic: 0n, state: "delivered", traceId: "t", request: { body: { symbol: "AAPL" } }, result: { symbol: "AAPL", rating: "buy" }, createdAt: at, updatedAt: at,
  });
  const live = await services.live(jobId);
  assert.ok(live);
  assert.equal(live.phase, "answered");
  assert.deepEqual(live.result, { symbol: "AAPL", rating: "buy" });
  assert.equal(live.failure, null);
  assert.equal(live.network, "Arc");
});

test("minor: the person's maximum is checked against the total with Agon's fee", async () => {
  const { services } = stageWorld({ fee: { bps: 150, address: `0x${"fe".repeat(20)}` as Address } });
  const out = await services.ask(OWNER, { question: QUESTION, maxPrice: 302_000n });
  assert.deepEqual(out, { ok: false, code: "over_your_max", amount: 304_500n });
});
