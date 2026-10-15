/// Most USDC one Add funds transfer may move.
export const ADD_FUNDS_MAX = 1_000_000_000n; // 1,000 USDC

/// A positive USDC amount with at most six decimals, up to the per-transfer ceiling.
export function parseAmount(input: string): bigint | null {
  const v = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(v)) return null;
  const [whole, frac = ""] = v.split(".");
  const atomic = BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  return atomic > 0n && atomic <= ADD_FUNDS_MAX ? atomic : null;
}

/// How this account can add funds: sign in the browser wallet, confirm a
/// transfer from its Circle wallet, or just copy the address. Browser wallets
/// are set up for Arc Testnet only.
export function fundingPath(kind: "wagmi" | "circle" | undefined, testnet: boolean): "wallet" | "circle" | "address-only" {
  if (kind === "circle") return "circle";
  if (kind === "wagmi" && testnet) return "wallet";
  return "address-only";
}
