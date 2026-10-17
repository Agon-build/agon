/// Agon's routing fee in basis points of the agent's price, rounded up to the
/// next atomic USDC unit so a non-zero fee is never rounded away.
export function feeFor(price: bigint, bps: number): bigint {
  if (bps <= 0 || price <= 0n) return 0n;
  return (price * BigInt(bps) + 9_999n) / 10_000n;
}

export function totalWithFee(price: bigint, bps: number): bigint {
  return price + feeFor(price, bps);
}
