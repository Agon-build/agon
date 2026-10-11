import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import {
  budgetWalletRef, completeUnfreeze, completeWithdraw, ensureBudgetWallet, freeze, lowerLimits, ownerRefFromWalletRef, requestUnfreeze, requestWithdraw, type WalletOps,
} from "../../src/agon/payments/budget-wallets.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

function deps(networkId: "arc-testnet" | "arc" = "arc-testnet") {
  const created: { refId: string; idempotencyKey: string; circleChain: string }[] = [];
  const seeded: string[] = [];
  const transfers: { walletId: string; destinationAddress: string; amountBaseUnits: bigint; idempotencyKey: string }[] = [];
  const ops: WalletOps = {
    createWallet: async (input) => {
      created.push(input);
      return { walletId: `w-${created.length}`, address: `0x${String(created.length).repeat(40)}` as Address };
    },
    seedTestnet: async (address) => {
      seeded.push(address);
      return { requested: true };
    },
    transfer: async (input) => {
      transfers.push(input);
      return { id: "t-1", state: "INITIATED" };
    },
  };
  return { d: { store: new MemoryPaymentsStore(), ops, network: agonNetwork(networkId), now: () => new Date("2026-10-27T12:00:00Z") }, created, seeded, transfers };
}

test("wallet refs round-trip", () => {
  assert.equal(budgetWalletRef("wa:abc"), "budget:wa:abc");
  assert.equal(ownerRefFromWalletRef("budget:wa:abc"), "wa:abc");
  assert.equal(ownerRefFromWalletRef("agent:lead"), null);
});

test("a budget wallet is created once with spec limits and seeded on testnet only", async () => {
  const { d, created, seeded } = deps();
  const w = await ensureBudgetWallet(d, "wa:abc");
  assert.equal(w.perHireCap, 500_000n);
  assert.equal(w.dailyCap, 2_000_000n);
  assert.equal((await ensureBudgetWallet(d, "wa:abc")).walletId, w.walletId);
  assert.equal(created.length, 1);
  assert.equal(created[0]!.circleChain, "ARC-TESTNET");
  assert.ok(!created[0]!.refId.includes("wa:abc"), "the refId does not leak the owner reference");
  assert.equal(seeded.length, 1);
  const mainnet = deps("arc");
  await ensureBudgetWallet(mainnet.d, "wa:abc");
  assert.equal(mainnet.created[0]!.circleChain, "ARC");
  assert.equal(mainnet.seeded.length, 0);
});

test("limits can be lowered or restored up to the defaults, never raised above them", async () => {
  const { d } = deps();
  await ensureBudgetWallet(d, "wa:abc");
  const lowered = await lowerLimits(d, "wa:abc", { perHireCap: 100_000n });
  assert.ok(lowered.ok && lowered.wallet.perHireCap === 100_000n);
  assert.ok((await lowerLimits(d, "wa:abc", { perHireCap: 500_000n })).ok);
  assert.deepEqual(await lowerLimits(d, "wa:abc", { dailyCap: 2_000_001n }), { ok: false, code: "above_default" });
  assert.deepEqual(await lowerLimits(d, "wa:abc", { perHireCap: 0n }), { ok: false, code: "not_positive" });
  assert.deepEqual(await lowerLimits(d, "wa:none", { perHireCap: 1n }), { ok: false, code: "no_wallet" });
});

test("freeze is instant; unfreeze needs the one-time link", async () => {
  const { d } = deps();
  await ensureBudgetWallet(d, "wa:abc");
  assert.equal(await freeze(d, "wa:abc"), true);
  assert.equal((await d.store.getBudgetWallet("wa:abc", "arc-testnet"))!.frozen, true);
  const link = await requestUnfreeze(d, "wa:abc");
  assert.ok(link);
  assert.deepEqual(await completeUnfreeze(d, link.token), { ok: true });
  assert.equal((await d.store.getBudgetWallet("wa:abc", "arc-testnet"))!.frozen, false);
  assert.deepEqual(await completeUnfreeze(d, link.token), { ok: false, code: "used" });
});

test("withdrawals move money only through the approval link, once", async () => {
  const { d, transfers } = deps();
  await ensureBudgetWallet(d, "wa:abc");
  const to = `0x${"9".repeat(40)}` as Address;
  assert.deepEqual(await requestWithdraw(d, "wa:abc", to, 0n), { ok: false, code: "bad_amount" });
  assert.deepEqual(await requestWithdraw(d, "wa:abc", "0x123" as Address, 1n), { ok: false, code: "bad_address" });
  const req = await requestWithdraw(d, "wa:abc", to, 1_500_000n);
  assert.ok(req.ok);
  assert.equal(transfers.length, 0);
  assert.deepEqual(await completeWithdraw(d, req.token), { ok: true, transferId: "t-1" });
  assert.equal(transfers[0]!.amountBaseUnits, 1_500_000n);
  assert.equal(transfers[0]!.destinationAddress, to);
  assert.deepEqual(await completeWithdraw(d, req.token), { ok: false, code: "used" });
});
