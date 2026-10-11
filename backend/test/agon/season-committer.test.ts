import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { commitRefId, createCircleRootCommitter, stableUuid, type CircleCommitterDeps } from "../../src/agon/playground/seasons/committer.ts";

const ROOT = `0x${"cd".repeat(32)}` as Hex;
const TX = `0x${"ef".repeat(32)}` as Hex;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

function deps(overrides: Partial<CircleCommitterDeps> = {}) {
  const calls: { execute: { idempotencyKey: string }[]; states: string[] } = { execute: [], states: [] };
  const states = ["INITIATED", "SENT", "CONFIRMED"];
  const base: CircleCommitterDeps = {
    walletId: "wallet-1",
    commitsAddress: "0x1111111111111111111111111111111111111111",
    network: "arc-testnet",
    execute: async (input) => {
      calls.execute.push(input);
      return { id: "circle-tx-1", state: "INITIATED" };
    },
    findByRefId: async () => null,
    getTxState: async () => {
      const s = states.shift() ?? "CONFIRMED";
      calls.states.push(s);
      return { state: s, txHash: s === "CONFIRMED" ? TX : null };
    },
    getReceipt: async () => ({ success: true, blockTime: new Date("2026-10-20T06:31:05Z") }),
    sleep: async () => {},
    pollMs: 1,
    timeoutMs: 1_000,
    ...overrides,
  };
  return { base, calls };
}

test("refIds are stable per network, season and round", () => {
  assert.equal(commitRefId("arc", 1n, 7n), "agon-season-arc-1-round-7");
  assert.equal(commitRefId("arc-testnet", 1n, 7n), "agon-season-arc-testnet-1-round-7");
});

test("stable UUIDs are v4-shaped and deterministic", () => {
  assert.match(stableUuid("a"), UUID);
  assert.equal(stableUuid("a"), stableUuid("a"));
  assert.notEqual(stableUuid("a"), stableUuid("b"));
});

test("submits commitRoot with the exact signature, parameters and a deterministic idempotency key", async () => {
  const { base, calls } = deps();
  const receipt = await createCircleRootCommitter(base).commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 });
  assert.deepEqual(calls.execute[0], {
    walletId: "wallet-1",
    contractAddress: "0x1111111111111111111111111111111111111111",
    abiFunctionSignature: "commitRoot(uint256,uint64,bytes32,uint32)",
    abiParameters: ["1", "7", ROOT, "12"],
    refId: "agon-season-arc-testnet-1-round-7",
    idempotencyKey: stableUuid("agon-season-arc-testnet-1-round-7"),
  });
  assert.deepEqual(receipt, { txHash: TX, blockTime: new Date("2026-10-20T06:31:05Z"), circleTxId: "circle-tx-1" });
});

test("an earlier submission with the same refId is reused, never resent", async () => {
  const { base, calls } = deps({ findByRefId: async () => ({ id: "circle-tx-0", state: "CONFIRMED", txHash: TX }) });
  const receipt = await createCircleRootCommitter(base).commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 });
  assert.equal(calls.execute.length, 0);
  assert.equal(receipt.circleTxId, "circle-tx-0");
});

test("after a FAILED submission the retry uses a new idempotency key", async () => {
  const { base, calls } = deps({ findByRefId: async () => ({ id: "circle-tx-0", state: "FAILED", txHash: null }) });
  await createCircleRootCommitter(base).commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 });
  assert.equal(calls.execute.length, 1);
  assert.notEqual(calls.execute[0]!.idempotencyKey, stableUuid("agon-season-arc-testnet-1-round-7"));
  assert.equal(calls.execute[0]!.idempotencyKey, stableUuid("agon-season-arc-testnet-1-round-7:circle-tx-0"));
});

test("a failed transaction throws with Circle's reason", async () => {
  const { base } = deps({ getTxState: async () => ({ state: "FAILED", txHash: null, errorReason: "INSUFFICIENT_NATIVE_TOKEN" }) });
  await assert.rejects(() => createCircleRootCommitter(base).commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 }), /INSUFFICIENT_NATIVE_TOKEN/);
});

test("a confirmed transaction whose receipt reverted is not recorded as a commit", async () => {
  const { base } = deps({ getReceipt: async () => ({ success: false, blockTime: new Date() }) });
  await assert.rejects(() => createCircleRootCommitter(base).commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 }), /reverted/);
});

test("a transaction that never confirms times out", async () => {
  const { base } = deps({ getTxState: async () => ({ state: "SENT", txHash: null }), timeoutMs: 5 });
  let clock = 0;
  base.sleep = async () => {
    clock += 10;
  };
  const committer = createCircleRootCommitter({ ...base, now: () => clock });
  await assert.rejects(() => committer.commit({ seasonId: 1n, round: 7n, root: ROOT, count: 12 }), /did not confirm/);
});
