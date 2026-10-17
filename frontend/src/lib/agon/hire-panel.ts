import { parseUsdcText } from "./stage-view.ts";

const ONE = 1_000_000n;

/// Whole USDC to add so the wallet covers the price; never less than 1.
export function topUpAmount(price: string, balance: string | null): string {
  const need = parseUsdcText(price) ?? 0n;
  const have = balance ? parseUsdcText(balance) ?? 0n : 0n;
  const short = need > have ? need - have : 0n;
  const whole = (short + ONE - 1n) / ONE;
  return String(whole < 1n ? 1n : whole);
}

export function canAfford(price: string, balance: string | null): boolean {
  const need = parseUsdcText(price);
  const have = balance ? parseUsdcText(balance) : null;
  return need !== null && have !== null && have >= need;
}

export function shortWalletText(balance: string | null, price: string): string {
  return balance === null
    ? `Your agent wallet needs ${price} USDC for this hire.`
    : `Your agent wallet has ${balance} USDC. This hire costs ${price} USDC.`;
}
