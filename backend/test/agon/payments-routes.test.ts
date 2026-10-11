import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import { createPaymentRoutes } from "../../src/agon/payments/routes.ts";
import { buyExact } from "../../src/agon/payments/exact-buyer.ts";
import { newJob } from "../../src/agon/payments/jobs.ts";
import type { LeadAnswer } from "../../src/agon/lead-agent/lead-agent.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, fakeSettler, localSigner, show } from "./x402-test-helpers.ts";

const buyer = privateKeyToAccount(BUYER_KEY);
const network = agonNetwork("arc-testnet");
const LEAD = `0x${"c".repeat(40)}` as Address;
const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function setup(off = false) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const runs: { parentJobId: string | null; payer: Address; question: string; payment?: { txHash: string; amount: bigint } }[] = [];
  const app = createPaymentRoutes({
    store, network,
    lead: {
      address: LEAD, price: 300_000n, settle: settler.settle,
      run: async (input) => {
        runs.push(input);
        return { ok: false, jobId: input.parentJobId ?? "new", code: "no_market", refunded: false, refundTx: null, progress: [] } satisfies LeadAnswer;
      },
    },
    off: () => off,
  });
  const fetchImpl = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  return { app, store, settler, runs, fetchImpl };
}

test("the lead agent endpoint charges 0.30 and passes the payer and a valid parent job", async () => {
  const { store, runs, fetchImpl } = setup();
  const parent = newJob({ parent: null, buyerRef: "budget:wa:abc", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc-testnet", price: 300_000n, request: {}, now: new Date() });
  parent.state = "paying";
  await store.insertJob(parent);
  const out = await buyExact({
    url: "http://api.test/agents/lead/forecast", init: post({ question: "Will BTC close above $82k on Friday?" }, { "x-agon-job": parent.jobId }),
    network, maxAmount: 300_000n, signerFor: () => localSigner(buyer), fetchImpl,
  });
  assert.ok(out.ok && out.amount === 300_000n, show(out));
  assert.deepEqual(runs[0], {
    parentJobId: parent.jobId, payer: buyer.address.toLowerCase(), question: "Will BTC close above $82k on Friday?",
    payment: { txHash: `0x${"ab".repeat(32)}`, amount: 300_000n },
  });
});

test("a missing or foreign parent job is ignored", async () => {
  const { runs, fetchImpl } = setup();
  await buyExact({ url: "http://api.test/agents/lead/forecast", init: post({ question: "Will BTC close above $82k?" }, { "x-agon-job": "00000000-0000-4000-8000-000000000000" }), network, maxAmount: 300_000n, signerFor: () => localSigner(buyer), fetchImpl });
  assert.equal(runs[0]!.parentJobId, null);
});

test("bad questions and the off switch are refused before payment", async () => {
  const a = setup();
  assert.equal((await a.app.request("http://api.test/agents/lead/forecast", post({ question: "hi" }))).status, 400);
  const b = setup(true);
  assert.equal((await b.app.request("http://api.test/agents/lead/forecast", post({ question: "Will BTC close above $82k?" }))).status, 503);
  assert.equal(a.settler.calls.length + b.settler.calls.length, 0);
});

test("receipts are public by job id and show the whole tree", async () => {
  const { app, store } = setup();
  const root = newJob({ parent: null, buyerRef: "budget:wa:abc", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc-testnet", price: 300_000n, request: {}, now: new Date() });
  const child = newJob({ parent: root, buyerRef: "agent:lead", providerRef: "house:atlas", providerLabel: "Atlas (house)", network: "arc-testnet", price: 174_240n, request: {}, now: new Date() });
  await store.insertJob(root);
  await store.insertJob(child);
  const res = await app.request(`http://api.test/jobs/${child.jobId}`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { receipt: { label: string; children: { label: string }[] } };
  assert.equal(body.receipt.label, "Agon Lead Agent", "any job id in the tree shows the whole tree");
  assert.equal(body.receipt.children[0]!.label, "Atlas (house)");
  assert.equal((await app.request("http://api.test/jobs/not-a-job")).status, 404);
});
