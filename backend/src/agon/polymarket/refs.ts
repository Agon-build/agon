/// How a person names a market: a condition id, a market's name on Polymarket, or a pasted link.

const SLUG = /^[a-z0-9][a-z0-9-]{2,200}$/;
export const CONDITION = /^0x[0-9a-fA-F]{64}$/;
// A link as people paste it: with or without https, with tracking after it, inside a sentence.
// Only the name at the end is used and the link itself is never opened.
const LINK = /(?<![\w.\-/])(?:https?:\/\/)?(?:www\.)?polymarket\.com\/[^\s"'<>)]+/i;

export type MarketRef = { kind: "condition" | "market" | "event"; value: string };

/// What a person gave: a condition id, a market slug, or a polymarket.com link to one market
/// (`/event/<event>/<market>`, `/market/<market>`) or to a whole event (`/event/<event>`, a sports page).
export function marketRefParts(input: string): MarketRef | null {
  const value = input.trim();
  if (CONDITION.test(value)) return { kind: "condition", value: value.toLowerCase() };
  if (SLUG.test(value)) return { kind: "market", value };
  const link = value.match(LINK)?.[0]?.replace(/[.,;!?]+$/, "");
  if (!link) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    if (!/(^|\.)polymarket\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean).map((p) => p.toLowerCase());
    const last = parts.at(-1) ?? "";
    if (!SLUG.test(last)) return null;
    const at = parts.indexOf("event");
    return { kind: (at >= 0 && parts.length === at + 2) || parts.includes("sports") ? "event" : "market", value: last };
  } catch {
    return null;
  }
}

/// A polymarket.com link, a market slug or a condition id, as the name Gamma knows it; anything else is null.
export function marketRefFrom(input: string): string | null {
  return marketRefParts(input)?.value ?? null;
}
