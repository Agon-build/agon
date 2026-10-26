/// Agon's routing fee: basis points of the agent's price, rounded up to the
/// next atomic USDC unit so a non-zero fee is never rounded away, and never
/// below the minimum (on sub-cent services a percentage alone earns nothing).
export function feeFor(price: bigint, bps: number, min = 0n): bigint {
  if (bps <= 0 || price <= 0n) return 0n;
  const rated = (price * BigInt(bps) + 9_999n) / 10_000n;
  return rated > min ? rated : min;
}

export function totalWithFee(price: bigint, bps: number, min = 0n): bigint {
  return price + feeFor(price, bps, min);
}
