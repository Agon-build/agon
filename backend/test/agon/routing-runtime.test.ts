import assert from "node:assert/strict";
import test from "node:test";

import { listingLiteFrom } from "../../src/agon/routing/runtime.ts";

const view = {
  id: "5042002:0xreg:9", agentId: "9", category: "3", status: "Listed", verification: { status: "Verified" },
  manifest: { body: {
    service: { name: "Scout", description: "A trade, watch or avoid verdict for any Polymarket market.", category: "3" },
    invocation: { endpoint: "https://api.agon.surf/agon/agents/specialists/scout", requestSchema: { type: "object", properties: { market: { type: "string", description: "a Polymarket link, slug or condition id" } }, required: ["market"] }, timeoutMs: 15000 },
    pricing: { amountUSDC: "0.10" },
  } },
};

test("an indexed listing with its service record becomes a route entry", () => {
  assert.deepEqual(listingLiteFrom(view), {
    reference: "5042002:0xreg:9", agentId: "9", name: "Scout", description: "A trade, watch or avoid verdict for any Polymarket market.", category: "3",
    endpoint: "https://api.agon.surf/agon/agents/specialists/scout", priceAtomic: 100_000n, latencyMs: 15000, status: "Listed", verified: true,
    inputSchema: { type: "object", properties: { market: { type: "string", description: "a Polymarket link, slug or condition id" } }, required: ["market"] },
  });
});

test("a listing that names no input fields has no input schema, so routing leaves it out", () => {
  const legacy = { ...view, manifest: { body: { ...view.manifest.body, invocation: { ...view.manifest.body.invocation, requestSchema: { type: "object", required: ["market-a-polymarket-market-link"] } } } } };
  assert.equal(listingLiteFrom(legacy)!.inputSchema, null);
});

test("a listing without a readable service record is skipped", () => {
  assert.equal(listingLiteFrom({ ...view, manifest: { body: null } }), null);
  assert.equal(listingLiteFrom({ ...view, manifest: { body: { ...view.manifest.body, pricing: { amountUSDC: "free" } } } }), null);
});

import { issueApproval } from "../../src/agon/payments/limits.ts";
import type { HireService } from "../../src/agon/payments/runtime.ts";
import { approvalsByNetwork } from "../../src/agon/routing/runtime.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

function fakeHire(network: string, calls: string[]): HireService {
  const w = (name: string) => async () => { calls.push(`${network}:${name}`); return { ok: true as const, transferId: "t" }; };
  return {
    leadProviderUrl: "", network: { id: network } as never,
    quoteHire: async () => ({ ok: false, code: "payments_off" }), confirmHire: async () => ({ ok: false, code: "x" }),
    completeApprovedHire: async () => { calls.push(`${network}:approvedHire`); return { ok: false, code: "x" }; },
    reconcile: async () => ({ settled: 0, released: 0, waiting: 0 }),
    wallets: { ensure: async () => { throw new Error("x"); }, lowerLimits: async () => ({ ok: true }), freeze: async () => true, requestUnfreeze: async () => null,
      completeUnfreeze: w("unfreeze") as never, requestWithdraw: async () => ({ ok: false, code: "no_wallet" }), completeWithdraw: w("withdraw") as never },
  } as HireService;
}

test("approval links finish on the runtime of the network they were made for", async () => {
  const store = new MemoryPaymentsStore();
  const calls: string[] = [];
  const hire = approvalsByNetwork(fakeHire("arc-testnet", calls), fakeHire("arc", calls), store);
  const main = await issueApproval(store, { walletRef: "budget:op:x", action: "withdraw", payload: { to: `0x${"1".repeat(40)}`, amount: "1000", network: "arc" }, now: new Date() });
  const test2 = await issueApproval(store, { walletRef: "budget:op:x", action: "withdraw", payload: { to: `0x${"1".repeat(40)}`, amount: "1000", network: "arc-testnet" }, now: new Date() });
  await hire.wallets.completeWithdraw(main.token);
  await hire.wallets.completeWithdraw(test2.token);
  const un = await issueApproval(store, { walletRef: "budget:op:x", action: "unfreeze", payload: { network: "arc" }, now: new Date() });
  await hire.wallets.completeUnfreeze(un.token);
  assert.deepEqual(calls, ["arc:withdraw", "arc-testnet:withdraw", "arc:unfreeze"]);
  const noOutside = approvalsByNetwork(fakeHire("arc-testnet", calls), null, store);
  const again = await issueApproval(store, { walletRef: "budget:op:x", action: "withdraw", payload: { to: `0x${"1".repeat(40)}`, amount: "1", network: "arc" }, now: new Date() });
  assert.deepEqual(await noOutside.wallets.completeWithdraw(again.token), { ok: false, code: "outside_off" });
});
