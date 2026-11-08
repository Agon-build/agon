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
