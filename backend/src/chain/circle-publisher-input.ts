import type { CreateContractExecutionTransactionInput } from "@circle-fin/developer-controlled-wallets";

type PinnedFee = { gasLimit: string; maxFee: string; priorityFee: string };

/// The Circle request for a managed publisher transaction, sent with its pinned EIP-1559 fee
/// (gwei) so the publisher knows the most it can cost. On Arc, Circle refuses a bare gasPrice
/// and any tip under its own floating minimum with "API parameter invalid" (probed 17 Oct 2026:
/// 1 to 49 gwei refused at random, its LOW estimate accepted), so the pinned fee comes from
/// Circle's estimate (publisherFeeFromEstimate). The idempotency key keeps a retry from sending twice.
export function publisherExecutionInput(input: {
  walletId: string;
  contractAddress: `0x${string}`;
  callData: `0x${string}`;
  idempotencyKey: string;
  refId: string;
  fee: PinnedFee;
}): CreateContractExecutionTransactionInput {
  return {
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    callData: input.callData,
    idempotencyKey: input.idempotencyKey,
    refId: input.refId,
    fee: { type: "absolute", config: { gasLimit: input.fee.gasLimit, maxFee: input.fee.maxFee, priorityFee: input.fee.priorityFee } },
  };
}

const GWEI = /^\d+(?:\.\d{1,9})?$/;

/// Circle's LOW tier from estimateContractExecutionFee, the cheapest fee it accepts right now.
export function publisherFeeFromEstimate(data: unknown): PinnedFee {
  const low = (data as { low?: Record<string, unknown> } | null)?.low;
  const gasLimit = low?.gasLimit, maxFee = low?.maxFee, priorityFee = low?.priorityFee;
  if (typeof gasLimit !== "string" || !/^\d+$/.test(gasLimit) || gasLimit === "0"
    || typeof maxFee !== "string" || !GWEI.test(maxFee) || typeof priorityFee !== "string" || !GWEI.test(priorityFee)
    || Number(priorityFee) > Number(maxFee)) {
    throw new Error("Circle fee estimate is missing or malformed");
  }
  return { gasLimit, maxFee, priorityFee };
}
