const MAX_USER_AMOUNT = 1_000_000_000_000n; // one million USDC in base units

/// Parses an amount a person typed ("0.50", "$0.5", "0.30 USDC") into USDC
/// base units. Never uses floating point. Returns null for anything that is
/// not a plain positive decimal with at most 6 places.
export function parseUsdc(text: string): bigint | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/\s*usdc$/i, "").trim();
  const match = /^(\d{0,7})(?:\.(\d{1,6}))?$/.exec(cleaned);
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  const whole = BigInt(match[1] || "0");
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  const value = whole * 1_000_000n + fraction;
  return value > 0n && value <= MAX_USER_AMOUNT ? value : null;
}
