import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { LEAD_PROVIDER_REF } from "../../src/agon/lead-agent/lead-agent.ts";
import { checkSubHire, newJob, receiptSource, receiptTree, spentUnder } from "../../src/agon/payments/jobs.ts";
import type { JobPayment } from "../../src/agon/payments/types.ts";

const now = new Date("2026-10-27T12:00:00Z");
const A = `0x${"a".repeat(40)}` as Address;
const B = `0x${"b".repeat(40)}` as Address;

function setup() {
  const root = newJob({ parent: null, buyerRef: "budget:u", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc", price: 300_000n, budget: 250_000n, request: {}, now });
  const child = newJob({ parent: root, buyerRef: "agent:lead", providerRef: "house:atlas", providerLabel: "Atlas (house)", network: "arc", price: 174_240n, request: {}, now });
  const pay = (o: Partial<JobPayment>): JobPayment => ({
    idempotencyKey: Math.random().toString(), jobId: root.jobId, kind: "data", payer: A, payee: B, amount: 2_000n, network: "arc",
    status: "settled", txHash: null, detail: null, authNonce: null, authValidBefore: null, createdAt: now, updatedAt: now, ...o,
  });
  return { root, child, pay };
}

test("new jobs link to their parent and root with the right depth", () => {
  const { root, child } = setup();
  assert.equal(root.rootId, root.jobId);
  assert.equal(root.depth, 0);
  assert.equal(child.parentId, root.jobId);
  assert.equal(child.rootId, root.jobId);
  assert.equal(child.depth, 1);
  assert.equal(child.traceId, root.traceId);
  assert.equal(child.state, "quoted");
});

test("spent counts data payments and child hires, but not failed ones", () => {
  const { root, child, pay } = setup();
  const payments = [pay({ amount: 2_000n }), pay({ amount: 8_500n }), pay({ amount: 9_999n, status: "failed" }), pay({ jobId: child.jobId, kind: "hire", amount: 174_240n })];
  assert.equal(spentUnder(root.jobId, [root, child], payments), 2_000n + 8_500n + 174_240n);
  assert.equal(spentUnder(root.jobId, [root, { ...child, state: "quoted" }], [pay({ amount: 2_000n })]), 2_000n + 174_240n, "an unpaid live child still holds its price");
  assert.equal(spentUnder(root.jobId, [root, { ...child, state: "failed" }], []), 0n);
});

test("sub-hire rules: depth, self, ancestors and budget", () => {
  const { root, child, pay } = setup();
  const tree = [root, child];
  assert.deepEqual(checkSubHire({ tree, payments: [], parentJobId: "nope", hirerRef: "agent:lead", providerRef: "house:vesper", amount: 1n }), { ok: false, code: "parent_missing" });
  assert.deepEqual(checkSubHire({ tree, payments: [], parentJobId: root.jobId, hirerRef: "agent:lead", providerRef: "agent:lead", amount: 1n }), { ok: false, code: "self_hire" });
  assert.deepEqual(checkSubHire({ tree, payments: [], parentJobId: child.jobId, hirerRef: "house:atlas", providerRef: "agent:lead", amount: 1n }), { ok: false, code: "ancestor_hire" });
  const grand = newJob({ parent: child, buyerRef: "house:atlas", providerRef: "house:drift", providerLabel: "Drift", network: "arc", price: 1n, request: {}, now });
  assert.deepEqual(checkSubHire({ tree: [...tree, grand], payments: [], parentJobId: grand.jobId, hirerRef: "house:drift", providerRef: "house:kestrel", amount: 1n }), { ok: false, code: "depth_exceeded" });
  assert.deepEqual(checkSubHire({ tree: [root], payments: [pay({ amount: 100_000n })], parentJobId: root.jobId, hirerRef: "agent:lead", providerRef: "house:vesper", amount: 150_001n }), { ok: false, code: "over_parent_budget" });
  assert.deepEqual(checkSubHire({ tree: [root], payments: [pay({ amount: 100_000n })], parentJobId: root.jobId, hirerRef: "agent:lead", providerRef: "house:vesper", amount: 150_000n }), { ok: true });
});

test("the receipt tree nests children and links settled payments to the explorer", () => {
  const { root, child, pay } = setup();
  const tx = `0x${"12".repeat(32)}` as const;
  const view = receiptTree(root.jobId, [root, child], [pay({ amount: 2_000n, txHash: tx, detail: "BTC price from BlockRun" }), pay({ jobId: child.jobId, kind: "hire", amount: 174_240n, status: "pending" })])!;
  assert.equal(view.label, "Agon Lead Agent");
  assert.equal(view.price, "0.30");
  assert.equal(view.network, "Arc");
  assert.equal(view.payments[0]!.txUrl, `https://explorer.arc.io/tx/${tx}`);
  assert.equal(view.payments[0]!.amount, "0.002");
  assert.equal(view.children.length, 1);
  assert.equal(view.children[0]!.payments[0]!.txUrl, null);
  assert.equal(receiptTree("missing", [root], []), null);
});

test("the receipt says where each seller comes from: the Lead, an Agon listing or Circle", () => {
  const { root, child } = setup();
  const view = receiptTree(root.jobId, [root, child], [])!;
  assert.equal(view.source, "lead");
  assert.equal(view.children[0]!.source, "agon");
  const circle = newJob({ parent: null, buyerRef: "budget:u", providerRef: "circle:https://lonestar.example/forecast", providerLabel: "LoneStarOracle", network: "arc", price: 50_000n, request: {}, now });
  assert.equal(receiptTree(circle.jobId, [circle], [])!.source, "circle");
  const listed = newJob({ parent: null, buyerRef: "budget:u", providerRef: "0xabc:7", providerLabel: "Scout", network: "arc-testnet", price: 20_000n, request: {}, now });
  assert.equal(receiptTree(listed.jobId, [listed], [])!.source, "agon");
  assert.equal(receiptSource(LEAD_PROVIDER_REF), "lead", "kept in step with the Lead's provider reference");
});
