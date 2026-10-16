import type { CreateContractExecutionTransactionInput } from "@circle-fin/developer-controlled-wallets";

/// The Circle request for a managed publisher transaction. Circle rejects a bare
/// gasPrice on Arc ("API parameter invalid"), so it uses the MEDIUM fee level like
/// every other Agon contract call. The publisher still estimates gas first to check
/// the wallet can pay, and the idempotency key keeps a retry from sending twice.
export function publisherExecutionInput(input: {
  walletId: string;
  contractAddress: `0x${string}`;
  callData: `0x${string}`;
  idempotencyKey: string;
  refId: string;
}): CreateContractExecutionTransactionInput {
  return {
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    callData: input.callData,
    idempotencyKey: input.idempotencyKey,
    refId: input.refId,
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  };
}
