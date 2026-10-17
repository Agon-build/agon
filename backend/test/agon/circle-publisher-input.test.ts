import assert from "node:assert/strict";
import test from "node:test";

import { publisherExecutionInput, publisherFeeFromEstimate } from "../../src/chain/circle-publisher-input.ts";

test("publisher transactions carry their pinned EIP-1559 fee as given, never a Circle fee level", () => {
  const input = publisherExecutionInput({
    walletId: "w-1",
    contractAddress: "0x0000000000000000000000000000000000000001",
    callData: "0xabcdef",
    idempotencyKey: "6f1c2a4e-1111-4222-8333-444455556666",
    refId: "agon:x:register",
    fee: { gasLimit: "200000", maxFee: "41", priorityFee: "1" },
  });
  // An absolute fee is what lets the publisher cap gasLimit x maxFee; a fee level leaves the price to Circle.
  assert.deepEqual(input.fee, { type: "absolute", config: { gasLimit: "200000", maxFee: "41", priorityFee: "1" } });
  assert.equal(input.callData, "0xabcdef");
  assert.equal(input.idempotencyKey, "6f1c2a4e-1111-4222-8333-444455556666");
  assert.equal("gasPrice" in (input.fee as { config: object }).config, false, "Arc is EIP-1559: Circle needs maxFee and priorityFee, not gasPrice");
});

test("the publisher fee is Circle's LOW tier estimate, and a malformed estimate is refused", () => {
  // Shape of Circle's estimateContractExecutionFee for ARC-TESTNET (17 Oct 2026).
  const estimate = {
    low: { gasLimit: "158830", baseFee: "20", priorityFee: "528.71", maxFee: "568.71", networkFee: "0.0903282093" },
    medium: { gasLimit: "158830", baseFee: "20", priorityFee: "665.99", maxFee: "705.99", networkFee: "0.1121323917" },
  };
  assert.deepEqual(publisherFeeFromEstimate(estimate), { gasLimit: "158830", maxFee: "568.71", priorityFee: "528.71" });
  for (const bad of [{}, { low: { gasLimit: "abc", maxFee: "1", priorityFee: "1" } }, { low: { gasLimit: "1", maxFee: "1", priorityFee: "2" } }, { low: { gasLimit: "1", maxFee: "-1", priorityFee: "0" } }]) {
    assert.throws(() => publisherFeeFromEstimate(bad), /Circle fee estimate/);
  }
});
