/// Facts for the Account summary strip and hire table.

type Deliveries = { email: { on: boolean; address: string | null }; telegram: { available: boolean; connected: boolean } };

/// How much of today's limit is left, from 0 to 1. A zero or unreadable limit is 0.
export function leftFraction(w: { leftToday: string; daily: string }): number {
  const left = Number(w.leftToday);
  const daily = Number(w.daily);
  if (!Number.isFinite(left) || !Number.isFinite(daily) || daily <= 0) return 0;
  return Math.max(0, Math.min(1, left / daily));
}

/// Where finished hires and alerts go. The bell is always on.
export function resultsLine(d: Deliveries): string {
  const extra = [d.email.on ? "email" : null, d.telegram.connected ? "Telegram" : null].filter(Boolean) as string[];
  if (extra.length === 0) return "Bell";
  if (extra.length === 1) return `Bell and ${extra[0]}`;
  return `Bell, ${extra[0]} and ${extra[1]}`;
}

export function telegramLine(d: Deliveries): string {
  if (!d.telegram.available) return "Telegram is not available right now.";
  return d.telegram.connected ? "Telegram is connected." : "Telegram is not connected.";
}

/// The step a hire row offers: watch one still running, retry one never paid, else its receipt.
export function hireAction(state: string): "Watch" | "Receipt" | "Retry" {
  if (state === "working" || state === "paying") return "Watch";
  if (state === "quoted") return "Retry";
  return "Receipt";
}

/// Account, Wallet: the second wallet, on Arc mainnet, that pays services from outside Agon.
/// Null means it does not exist yet; reading never creates one.
export function outsideWalletCopy(wallet: { balance: string | null } | null): { title: string; line: string } {
  const state = !wallet ? "It is created the first time you choose one on Hire." : wallet.balance === null ? "Its balance could not be read." : `It holds ${wallet.balance} USDC.`;
  return { title: "Add funds for outside services", line: `Outside services are paid in real USDC on Arc mainnet, from a wallet of its own. ${state}` };
}
