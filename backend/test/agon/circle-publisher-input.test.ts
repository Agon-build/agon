import assert from "node:assert/strict";
import test from "node:test";

import { publisherExecutionInput } from "../../src/chain/circle-publisher-input.ts";

test("publisher transactions carry the publisher's own EIP-1559 fee, never a Circle fee level", () => {
  const input = publisherExecutionInput({
    walletId: "w-1",
    contractAddress: "0x0000000000000000000000000000000000000001",
    callData: "0xabcdef",
    idempotencyKey: "6f1c2a4e-1111-4222-8333-444455556666",
    refId: "agon:x:register",
    fee: { gasLimit: "200000", maxFee: "41", priorityFee: "1" },
  });
  // MEDIUM set a 485 gwei tip on a 20 gwei base fee on Arc (17 Oct 2026); an absolute fee caps what is paid.
  assert.deepEqual(input.fee, { type: "absolute", config: { gasLimit: "200000", maxFee: "41", priorityFee: "1" } });
  assert.equal(input.callData, "0xabcdef");
  assert.equal(input.idempotencyKey, "6f1c2a4e-1111-4222-8333-444455556666");
  assert.equal("gasPrice" in (input.fee as { config: object }).config, false, "Arc is EIP-1559: Circle needs maxFee and priorityFee, not gasPrice");
});
