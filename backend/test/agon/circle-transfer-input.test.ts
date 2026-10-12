import assert from "node:assert/strict";
import test from "node:test";

import { platformTransferInput } from "../../src/chain/circle-transfer-input.ts";

const base = { walletId: "w-lead", destinationAddress: "0x00000000000000000000000000000000000000aa" as const, idempotencyKey: "k", refId: "refund:job" };

test("a platform USDC transfer names the chain, because Circle needs it with a token address", () => {
  const input = platformTransferInput({ ...base, amountBaseUnits: 300_000n, blockchain: "ARC-TESTNET" });
  assert.equal(input.blockchain, "ARC-TESTNET");
  assert.equal(input.tokenAddress, "0x3600000000000000000000000000000000000000");
  assert.deepEqual(input.amount, ["0.3"]);
  assert.equal(platformTransferInput({ ...base, amountBaseUnits: 1n, blockchain: "ARC" }).blockchain, "ARC");
});

test("amounts are written as decimal USDC without trailing zeros", () => {
  assert.deepEqual(platformTransferInput({ ...base, amountBaseUnits: 2_000_000n, blockchain: "ARC" }).amount, ["2"]);
  assert.deepEqual(platformTransferInput({ ...base, amountBaseUnits: 8_500n, blockchain: "ARC" }).amount, ["0.0085"]);
  assert.throws(() => platformTransferInput({ ...base, amountBaseUnits: 0n, blockchain: "ARC" }), /positive/);
});
