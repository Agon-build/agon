import { createHash } from "node:crypto";
import type { Address, Hex } from "viem";

import type { AgonNetworkId } from "../../network.ts";
import type { RootCommitter } from "./rounds.ts";

export type CircleCommitterDeps = {
  walletId: string;
  commitsAddress: Address;
  network: AgonNetworkId;
  execute(input: {
    walletId: string;
    contractAddress: Address;
    abiFunctionSignature: string;
    abiParameters: string[];
    refId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; state: string }>;
  findByRefId(refId: string): Promise<{ id: string; state: string; txHash: string | null } | null>;
  getTxState(id: string): Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
  getReceipt(txHash: Hex): Promise<{ success: boolean; blockTime: Date }>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  timeoutMs?: number;
};

const DONE = new Set(["CONFIRMED", "COMPLETE"]);
const FAILED = new Set(["FAILED", "DENIED", "CANCELLED"]);

export function commitRefId(network: AgonNetworkId, seasonId: bigint, round: bigint): string {
  return `agon-season-${network}-${seasonId}-round-${round}`;
}

/// Circle idempotency keys must be UUIDs. A key derived from the refId makes a
/// resubmission after an uncertain response return the same transaction.
export function stableUuid(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/// Commits a round root from a Circle developer-controlled wallet. A retry
/// first looks the refId up, and every submission carries an idempotency key
/// derived from the refId, so one round never produces two transactions
/// unless an earlier one failed (the retry then gets a new key).
export function createCircleRootCommitter(deps: CircleCommitterDeps): RootCommitter {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? 2_000;
  const timeoutMs = deps.timeoutMs ?? 180_000;

  return {
    async commit({ seasonId, round, root, count }) {
      const refId = commitRefId(deps.network, seasonId, round);
      const earlier = await deps.findByRefId(refId);
      let circleTxId: string;
      if (earlier && !FAILED.has(earlier.state)) {
        circleTxId = earlier.id;
      } else {
        const submitted = await deps.execute({
          walletId: deps.walletId,
          contractAddress: deps.commitsAddress,
          abiFunctionSignature: "commitRoot(uint256,uint64,bytes32,uint32)",
          abiParameters: [seasonId.toString(), round.toString(), root, count.toString()],
          refId,
          idempotencyKey: stableUuid(earlier ? `${refId}:${earlier.id}` : refId),
        });
        circleTxId = submitted.id;
      }
      const started = now();
      for (;;) {
        const state = await deps.getTxState(circleTxId);
        if (FAILED.has(state.state)) throw new Error(`season commit ${refId} failed: ${state.errorReason ?? state.state}`);
        if (DONE.has(state.state) && state.txHash) {
          const txHash = state.txHash.toLowerCase() as Hex;
          const receipt = await deps.getReceipt(txHash);
          if (!receipt.success) throw new Error(`season commit ${refId} reverted in ${txHash}`);
          return { txHash, blockTime: receipt.blockTime, circleTxId };
        }
        if (now() - started > timeoutMs) throw new Error(`season commit ${refId} did not confirm within ${timeoutMs}ms`);
        await sleep(pollMs);
      }
    },
  };
}
