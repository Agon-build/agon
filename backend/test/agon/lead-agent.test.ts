import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

import { runLeadForecast, type LeadDeps } from "../../src/agon/lead-agent/lead-agent.ts";
import { createStandinRoutes } from "../../src/agon/payments/standin-seller.ts";
import { createHouseSellerRoutes } from "../../src/agon/playground/seasons/house-seller.ts";
import { DEFAULT_HOUSE_AGENTS } from "../../src/agon/playground/seasons/house-agents.ts";
import { createGuardedSigner } from "../../src/agon/payments/guarded-signer.ts";
import { newJob } from "../../src/agon/payments/jobs.ts";
import { dataServicesFor } from "../../src/agon/router/data-services.ts";
import type { ForecasterCandidate } from "../../src/agon/router/forecasters.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { OTHER_KEY, circleSignJson, fakeSettler } from "./x402-test-helpers.ts";

const leadAccount = privateKeyToAccount(OTHER_KEY);
const network = agonNetwork("arc-testnet");
const USER = `0x${"9".repeat(40)}` as Address;
const QUESTION = "What's the real chance BTC closes above $82k on Friday?";
const cid = `0x${"ab".repeat(32)}`;

function world(opts: { atlasReply?: string; markets?: boolean; subHireBudget?: bigint; sellers?: string[]; failSettleFor?: string[]; searchFails?: boolean; quoteThrowsFor?: string } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const upstream = (async (url: string) => {
    if (url.startsWith("https://coins.llama.fi/")) return new Response(JSON.stringify({ coins: { "coingecko:bitcoin": { price: 82953.31 } } }));
    if (opts.searchFails) return new Response("down", { status: 500 });
    return new Response(JSON.stringify({ events: opts.markets === false ? [] : [{ markets: [{
      conditionId: cid, question: "Will the price of Bitcoin be above $82,000 on October 30?", slug: "btc", endDate: "2026-10-30T16:00:00Z",
      outcomes: '["Yes","No"]', outcomePrices: '["0.41","0.59"]', liquidityNum: 40000,
    }] }] }));
  }) as typeof fetch;
  const replies: Record<string, string> = { atlas: opts.atlasReply ?? '{"probability":0.34,"reasons":["r1","r2","r3"]}', vesper: '{"probability":0.38,"reasons":["v1","v2","v3"]}' };
  const sellerKeys = opts.sellers ?? ["atlas", "vesper"];
  const sellers = Object.fromEntries(sellerKeys.map((k) => [k, { spec: DEFAULT_HOUSE_AGENTS.find((a) => a.key === k)!, payTo: `0x${(k === "atlas" ? "a" : "e").repeat(40)}` as Address, settle: (opts.failSettleFor ?? []).includes(k) ? async () => { throw new Error("circle down"); } : settler.settle }]));
  const app = new Hono();
  app.route("/agon/standin", createStandinRoutes({ network, payTo: `0x${"5".repeat(40)}`, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), fetchImpl: upstream }));
  app.route("/agon/agents/house", createHouseSellerRoutes({
    network, store, ask: 220_000n, floor: 160_000n, sellers,
    callModel: async (p) => ({ text: p.model.startsWith("anthropic/") ? replies.atlas! : replies.vesper! }),
  }));
  const candidate = (key: string, name: string, rank: number): ForecasterCandidate => ({
    agentAddress: `0x${String(rank).repeat(40)}` as Address, displayName: name, house: true, providerRef: `house:${key}`,
    quoteUrl: `http://api.test/agon/agents/house/${key}/quote`, forecastUrl: `http://api.test/agon/agents/house/${key}/forecast`,
    rating: 0.02 / rank, ranked: true, forecastsResolved: 140, reason: `Season 1 rank #${rank}`,
  });
  const refunds: { to: Address; amount: bigint; key: string }[] = [];
  const deps: LeadDeps = {
    store, network, leadAddress: leadAccount.address.toLowerCase() as Address,
    signerFor: (payTo, maxValue, onSigned) => createGuardedSigner({
      address: leadAccount.address, walletId: "w-lead", signJson: circleSignJson(leadAccount),
      context: () => ({ network, from: leadAccount.address, payTo, maxValue, now: new Date() }), onSigned,
    }),
    data: dataServicesFor(network, "http://api.test"),
    forecasters: async () => [candidate("atlas", "Atlas (house)", 1), candidate("vesper", "Vesper (house)", 2)],
    refund: async (to, amount, key) => {
      refunds.push({ to, amount, key });
      return `0x${"fe".repeat(32)}`;
    },
    leadPrice: 300_000n, subHireBudget: opts.subHireBudget ?? 250_000n, now: () => new Date("2026-10-27T12:00:00Z"),
    fetchImpl: (async (url: string, init?: RequestInit) => {
      if (opts.quoteThrowsFor && url === `http://api.test/agon/agents/house/${opts.quoteThrowsFor}/quote`) throw new Error("connection refused");
      return app.request(url, init);
    }) as typeof fetch,
  };
  return { store, settler, deps, refunds };
}

async function userJob(store: MemoryPaymentsStore) {
  const job = newJob({ parent: null, buyerRef: "budget:wa:abc", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc-testnet", price: 300_000n, request: {}, now: new Date() });
  job.state = "paying";
  await store.insertJob(job);
  await store.upsertJobPayment({
    idempotencyKey: `hire:${job.jobId}`, jobId: job.jobId, kind: "hire", payer: USER, payee: `0x${"c".repeat(40)}`, amount: 300_000n, network: "arc-testnet",
    status: "settled", txHash: `0x${"11".repeat(32)}`, detail: null, authNonce: null, authValidBefore: null, createdAt: new Date(), updatedAt: new Date(),
  });
  return job;
}

test("buys market data and a price, haggles with the top forecaster, hires it and answers", async () => {
  const { store, deps } = world();
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(answer.probabilityBps, 3400);
  assert.equal(answer.marketPriceBps, 4100);
  assert.deepEqual(answer.forecaster, { name: "Atlas (house)", reason: "Season 1 rank #1", asked: "0.22", agreed: "0.17424" });
  assert.ok(answer.progress.some((p) => p.startsWith("Bought market search from AGON testnet stand-in: 0.0085 USDC")));
  assert.ok(answer.progress.some((p) => p.startsWith("Bought Bitcoin price from AGON testnet stand-in: 0.002 USDC")));
  assert.ok(answer.progress.some((p) => p === "Hired Atlas (house), Season 1 rank #1: 0.17424 USDC (asked 0.22, agreed 0.17424)"));
  const tree = await store.listJobTree(parent.jobId);
  assert.equal(tree.length, 2);
  assert.equal(tree.find((j) => j.parentId === parent.jobId)!.state, "delivered");
  const payments = await store.listJobPayments(parent.jobId);
  assert.deepEqual(payments.filter((p) => p.kind === "data").map((p) => p.amount).sort(), [2_000n, 8_500n]);
  assert.equal(payments.find((p) => p.kind === "hire" && p.jobId !== parent.jobId)!.amount, 174_240n);
});

test("a forecaster that is not selling is skipped and the next one is hired", async () => {
  const { store, deps, refunds } = world({ sellers: ["vesper"] });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(answer.forecaster.name, "Vesper (house)");
  assert.equal(answer.probabilityBps, 3800);
  assert.ok(answer.progress.some((p) => p === "Atlas (house) is not selling forecasts right now"));
  assert.equal(refunds.length, 0);
});

test("a forecaster paid but failing is recorded; when the rest of the budget cannot cover another, the user is refunded", async () => {
  const { store, deps, refunds } = world({ atlasReply: "no idea" });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.code === "no_forecaster" && answer.refunded, JSON.stringify(answer));
  assert.ok(answer.progress.some((p) => p === "Atlas (house) was paid but did not deliver; trying the next forecaster"));
  const children = (await store.listJobTree(parent.jobId)).filter((j) => j.parentId === parent.jobId);
  assert.deepEqual(children.map((c) => c.state), ["failed"]);
  const spent = (await store.listJobPayments(parent.jobId))
    .filter((p) => p.kind !== "refund" && p.idempotencyKey !== `hire:${parent.jobId}`)
    .reduce((t, p) => t + (p.status !== "failed" ? p.amount : 0n), 0n);
  assert.ok(spent <= 250_000n, `spent ${spent}`);
  assert.equal(refunds.length, 1);
});

test("no market found means a refund, and only one refund however often it runs", async () => {
  const { store, deps, refunds } = world({ markets: false });
  const parent = await userJob(store);
  const first = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.deepEqual([first.ok, !first.ok && first.code, !first.ok && first.refunded], [false, "no_market", true]);
  const second = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!second.ok && second.refunded);
  assert.equal(refunds.length, 1);
  assert.deepEqual(refunds[0], { to: USER, amount: 300_000n, key: `refund:${parent.jobId}` });
  assert.equal((await store.getJob(parent.jobId))!.state, "refunded");
});

test("when no forecaster can be hired within budget the user is refunded", async () => {
  const { store, deps, refunds } = world({ subHireBudget: 120_000n });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.code === "no_forecaster" && answer.refunded);
  assert.ok(answer.progress.some((p) => p.includes("would not meet the budget")));
  assert.equal(refunds.length, 1);
});

test("an outside caller without a parent job gets its own job, marked delivered", async () => {
  const { store, deps } = world();
  const answer = await runLeadForecast(deps, { parentJobId: null, payer: USER, question: QUESTION });
  assert.ok(answer.ok);
  const job = await store.getJob(answer.jobId);
  assert.equal(job!.buyerRef, `agent:${USER}`);
  assert.equal(job!.state, "delivered");
});

const childOf = async (store: MemoryPaymentsStore, rootId: string, label: string) => (await store.listJobTree(rootId)).find((j) => j.parentId === rootId && j.providerLabel === label);

test("a forecaster payment with an unknown outcome is counted, kept with its nonce for reconciliation, and never re-spent", async () => {
  const { store, deps, refunds } = world({ failSettleFor: ["atlas"] });
  deps.authorizationUsed = async () => false;
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.code === "no_forecaster", JSON.stringify(answer));
  const atlas = (await childOf(store, parent.jobId, "Atlas (house)"))!;
  assert.equal(atlas.state, "paying", "left for reconciliation");
  const payment = (await store.listJobPayments(parent.jobId)).find((p) => p.jobId === atlas.jobId)!;
  assert.equal(payment.status, "pending");
  assert.match(payment.authNonce ?? "", /^0x[0-9a-f]{64}$/);
  assert.equal(store.spends.get(`agent:lead|hire:${atlas.jobId}`)!.state, "reserved");
  assert.equal(await childOf(store, parent.jobId, "Vesper (house)"), undefined, "the unknown payment still counts against the budget");
  assert.equal(refunds.length, 1);
});

test("a forecaster payment the chain shows as used is recorded as paid", async () => {
  const { store, deps } = world({ failSettleFor: ["atlas"] });
  deps.authorizationUsed = async () => true;
  const parent = await userJob(store);
  await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  const atlas = (await childOf(store, parent.jobId, "Atlas (house)"))!;
  assert.equal(atlas.state, "failed");
  assert.equal((await store.listJobPayments(parent.jobId)).find((p) => p.jobId === atlas.jobId)!.status, "settled");
  assert.equal(store.spends.get(`agent:lead|hire:${atlas.jobId}`)!.state, "settled");
});

test("data that was paid for but not delivered is recorded at its real price", async () => {
  const { store, deps } = world({ searchFails: true });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.code === "no_market");
  const data = (await store.listJobPayments(parent.jobId)).filter((p) => p.kind === "data");
  assert.deepEqual(data.map((p) => [p.amount, p.status]), [[8_500n, "settled"]]);
  assert.equal(store.spends.get(`agent:lead|data:${parent.jobId}:1`)!.state, "settled");
});

test("a forecaster whose quote endpoint is unreachable is skipped", async () => {
  const { store, deps } = world({ quoteThrowsFor: "atlas" });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(answer.ok, JSON.stringify(answer));
  assert.equal(answer.forecaster.name, "Vesper (house)");
});

test("an unexpected error after the user paid still refunds them once", async () => {
  const { store, deps, refunds } = world();
  deps.forecasters = async () => {
    throw new Error("season store down");
  };
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.code === "lead_error" && answer.refunded, JSON.stringify(answer));
  assert.equal(refunds.length, 1);
});

test("an outside buyer who paid the lead directly is refunded when nothing can be delivered, and the payment shows on its receipt", async () => {
  const { store, deps, refunds } = world({ markets: false });
  const txHash = `0x${"22".repeat(32)}` as Hex;
  const answer = await runLeadForecast(deps, { parentJobId: null, payer: USER, question: QUESTION, payment: { txHash, amount: 300_000n } });
  assert.ok(!answer.ok && answer.code === "no_market" && answer.refunded, JSON.stringify(answer));
  assert.deepEqual(refunds, [{ to: USER, amount: 300_000n, key: `refund:${answer.jobId}` }]);
  const incoming = (await store.listJobPayments(answer.jobId)).find((p) => p.jobId === answer.jobId && p.kind === "hire")!;
  assert.deepEqual([incoming.payer, incoming.amount, incoming.status, incoming.txHash], [USER, 300_000n, "settled", txHash]);
});

test("a linked run stores its answer on the user job and leaves the state to the hire", async () => {
  const { store, deps } = world();
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(answer.ok);
  const root = (await store.getJob(parent.jobId))!;
  assert.equal(root.state, "paying");
  assert.equal((root.result as { probabilityBps: number }).probabilityBps, 3400);
});

test("the run writes timed events and the haggle onto the user job while it works, and the answer carries them", async () => {
  const { store, deps } = world();
  const parent = await userJob(store);
  const snapshots: unknown[] = [];
  const update = store.updateJob.bind(store);
  store.updateJob = async (jobId, patch) => {
    if (jobId === parent.jobId && patch.result !== undefined) snapshots.push(structuredClone(patch.result));
    return update(jobId, patch);
  };
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(answer.ok);
  const live = snapshots.filter((s) => (s as { live?: boolean }).live === true) as { startedAt: string; events: { kind: string; text: string; at: string }[]; haggle: unknown[] }[];
  assert.ok(live.length >= 3, "progress is saved as it happens, not only at the end");
  assert.ok(live.every((s) => typeof s.startedAt === "string"));
  assert.ok(live.at(-1)!.haggle.length > 0, "the haggle is visible before the hire is paid");
  const kinds = answer.events!.map((e) => e.kind);
  assert.ok(kinds.includes("data") && kinds.includes("hire"), JSON.stringify(kinds));
  assert.ok(answer.events!.every((e) => !Number.isNaN(Date.parse(e.at))));
  const stored = (await store.getJob(parent.jobId))!.result as { events: unknown[]; probabilityBps: number };
  assert.equal(stored.probabilityBps, 3400);
  assert.equal(stored.events.length, answer.events!.length);
});

test("a refunded run keeps its events on the job", async () => {
  const { store, deps } = world({ markets: false });
  const parent = await userJob(store);
  const answer = await runLeadForecast(deps, { parentJobId: parent.jobId, payer: USER, question: QUESTION });
  assert.ok(!answer.ok && answer.refunded);
  const stored = (await store.getJob(parent.jobId))!.result as { error: string; events: { kind: string }[] };
  assert.equal(stored.error, "no_market");
  assert.ok(stored.events.some((e) => e.kind === "refund"));
});
