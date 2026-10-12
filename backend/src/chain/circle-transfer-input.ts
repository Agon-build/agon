/// The request for a platform USDC transfer on Arc. Circle requires the chain
/// whenever a token address (rather than a token id) names the asset; without
/// it every refund and withdrawal is refused with a 400.
export function platformTransferInput(params: {
  walletId: string;
  destinationAddress: `0x${string}`;
  amountBaseUnits: bigint;
  idempotencyKey: string;
  refId?: string;
  blockchain: "ARC-TESTNET" | "ARC";
}) {
  if (params.amountBaseUnits <= 0n) throw new Error("agent transfer amount must be positive");
  const whole = params.amountBaseUnits / 1_000_000n;
  const fractional = (params.amountBaseUnits % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const amount = fractional ? `${whole.toString()}.${fractional}` : whole.toString();
  return {
    walletId: params.walletId,
    blockchain: params.blockchain,
    tokenAddress: "0x3600000000000000000000000000000000000000",
    amount: [amount],
    destinationAddress: params.destinationAddress,
    fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } },
    idempotencyKey: params.idempotencyKey,
    ...(params.refId ? { refId: params.refId } : {}),
  };
}
