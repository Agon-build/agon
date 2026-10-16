import assert from "node:assert/strict";
import test from "node:test";

import { publisherExecutionInput } from "../../src/chain/circle-publisher-input.ts";

test("publisher transactions use Circle's fee level, the same setting as every working Agon contract call", () => {
  const input = publisherExecutionInput({
    walletId: "w-1",
    contractAddress: "0x0000000000000000000000000000000000000001",
    callData: "0xabcdef",
    idempotencyKey: "6f1c2a4e-1111-4222-8333-444455556666",
    refId: "agon:x:register",
  });
  assert.deepEqual(input.fee, { type: "level", config: { feeLevel: "MEDIUM" } });
  assert.equal(input.callData, "0xabcdef");
  assert.equal(input.idempotencyKey, "6f1c2a4e-1111-4222-8333-444455556666");
  assert.equal("gasPrice" in (input.fee as { config: object }).config, false, "Circle rejects a bare gasPrice on Arc");
});
