import type { CreateContractExecutionTransactionInput } from "@circle-fin/developer-controlled-wallets";

/// The Circle request for a managed publisher transaction. Arc is an EIP-1559 chain, so
/// Circle takes maxFee and priorityFee (gwei) with a gasLimit; a bare gasPrice is refused
/// (Circle error 155235). The MEDIUM fee level it replaced set a 485 gwei tip on a 20 gwei
/// base fee (17 Oct 2026), so the publisher now sends the fee it quoted and capped itself.
/// The idempotency key keeps a retry from sending twice.
export function publisherExecutionInput(input: {
  walletId: string;
  contractAddress: `0x${string}`;
  callData: `0x${string}`;
  idempotencyKey: string;
  refId: string;
  fee: { gasLimit: string; maxFee: string; priorityFee: string };
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
