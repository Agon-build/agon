import type { Hex } from "viem";

export type MarketCandidate = { conditionId: Hex; question: string; slug: string; endDate: string; yesPriceBps: number | null };

function yesPrice(o: Record<string, unknown>): number | null {
  if (typeof o.yesPriceBps === "number" && o.yesPriceBps >= 0 && o.yesPriceBps <= 10_000) return Math.round(o.yesPriceBps);
  let prices: unknown = o.outcomePrices;
  let outcomes: unknown = o.outcomes;
  try {
    if (typeof prices === "string") prices = JSON.parse(prices);
    if (typeof outcomes === "string") outcomes = JSON.parse(outcomes);
  } catch {
    return null;
  }
  if (Array.isArray(prices) && Array.isArray(outcomes) && outcomes[0] === "Yes") {
    const p = Number(prices[0]);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return Math.round(p * 10_000);
  }
  for (const key of ["yesPrice", "lastTradePrice", "probability"]) {
    const p = Number(o[key]);
    if (typeof o[key] !== "undefined" && Number.isFinite(p) && p >= 0 && p <= 1) return Math.round(p * 10_000);
  }
  return null;
}

/// Walks any JSON payload (the stand-in, BlockRun, or a wrapper around either)
/// and collects objects that look like a Polymarket market. Defensive on
/// purpose: a seller's response shape can change without notice.
export function findMarkets(payload: unknown): MarketCandidate[] {
  const out = new Map<string, MarketCandidate>();
  let visited = 0;
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || visited++ > 2_000 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.conditionId === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.conditionId) && typeof o.question === "string") {
      const id = o.conditionId.toLowerCase();
      if (!out.has(id)) {
        out.set(id, {
          conditionId: id as Hex, question: o.question, slug: typeof o.slug === "string" ? o.slug : "",
          endDate: typeof o.endDate === "string" ? o.endDate : "", yesPriceBps: yesPrice(o),
        });
      }
    }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return [...out.values()];
}

export function priceFromPayload(payload: unknown, coinId: string): number | null {
  let found: number | null = null;
  const walk = (node: unknown, depth: number) => {
    if (found !== null || depth > 5 || node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const hit = o[coinId] as Record<string, unknown> | undefined;
    if (hit && typeof hit.price === "number" && Number.isFinite(hit.price)) {
      found = hit.price;
      return;
    }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return found;
}

const STOP = new Set([
  "what", "whats", "is", "the", "real", "chance", "of", "will", "spend", "up", "to", "usdc", "a", "an", "on", "by", "be", "price", "that", "this", "it", "for", "in", "at", "and", "or",
  "close", "closes", "closing", "end", "ends", "today", "tomorrow", "week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Words about trading the market rather than its subject; Polymarket questions rarely contain them.
  "market", "markets", "polymarket", "worth", "trading", "trade", "bet", "betting", "odds", "likely", "probability", "should", "buy", "sell",
  "good", "now", "do", "does", "how", "you", "your", "my", "me", "can", "are",
]);
const SYNONYMS: Record<string, string> = { btc: "bitcoin", eth: "ethereum", ether: "ethereum", sol: "solana" };

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/\$/g, "")
    .replace(/(\d+(?:\.\d+)?)k\b/g, (_m, n) => String(Math.round(Number(n) * 1000)))
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ""))
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^0?\.\d+$/.test(t));
}

export function searchQueryFor(question: string): string {
  return tokens(question).slice(0, 8).join(" ");
}

export function pickMarket(markets: MarketCandidate[], question: string, now: Date): MarketCandidate | null {
  const want = new Set(tokens(question));
  let best: { m: MarketCandidate; score: number } | null = null;
  for (const m of markets) {
    if (m.endDate && new Date(m.endDate).getTime() <= now.getTime()) continue;
    const have = new Set(tokens(m.question));
    let score = 0;
    for (const t of want) if (have.has(t)) score += /^\d/.test(t) ? 3 : 1;
    if (score < 2) continue;
    if (m.yesPriceBps !== null) score += 0.5;
    if (!best || score > best.score || (score === best.score && m.endDate < best.m.endDate)) best = { m, score };
  }
  return best?.m ?? null;
}
