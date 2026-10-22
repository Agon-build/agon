import { z } from "zod";

/// One Polymarket market as the specialist agents read it, straight from Gamma.
export type MarketSnapshot = {
  conditionId: string;
  slug: string;
  url: string;
  question: string;
  endAt: Date;
  yesBps: number;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number;
  liquidity: number;
  volume24h: number;
  weekChange: number;
  description: string;
  tags: string[];
  closed: boolean;
  /** Polymarket's proposal and dispute rounds for this market, oldest first ("proposed", "disputed"). */
  umaStatuses: string[];
};
export type LookupResult = { ok: true; market: MarketSnapshot } | { ok: false; code: "market_not_found" | "market_unavailable" | "not_yes_no" };
export type MarketLookup = (ref: string) => Promise<LookupResult>;

const SLUG = /^[a-z0-9][a-z0-9-]{2,200}$/;
const CONDITION = /^0x[0-9a-fA-F]{64}$/;

/// A polymarket.com link, a market slug or a condition id; anything else is null.
export function marketRefFrom(input: string): string | null {
  const value = input.trim();
  if (CONDITION.test(value)) return value.toLowerCase();
  if (SLUG.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)polymarket\.com$/.test(url.hostname)) return null;
    const last = url.pathname.split("/").filter(Boolean).pop() ?? "";
    return SLUG.test(last) ? last : null;
  } catch {
    return null;
  }
}

const num = z.coerce.number().catch(0);
const market = z.object({
  conditionId: z.string(),
  slug: z.string(),
  question: z.string().min(1),
  outcomes: z.string(),
  outcomePrices: z.string(),
  bestBid: z.coerce.number().nullable().optional(),
  bestAsk: z.coerce.number().nullable().optional(),
  spread: num.optional(),
  liquidityNum: num.optional(),
  volume24hr: num.optional(),
  oneWeekPriceChange: num.nullable().optional(),
  endDate: z.string(),
  closed: z.boolean().optional(),
  description: z.string().nullable().optional(),
  umaResolutionStatuses: z.unknown().optional(),
  events: z.array(z.object({ slug: z.string() })).optional(),
});

/// Gamma sends the rounds as a JSON string, sometimes as an array; anything else reads as none.
function umaStatuses(value: unknown): string[] {
  let parsed = value;
  try {
    if (typeof value === "string") parsed = JSON.parse(value);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
}

export function createMarketLookup(options: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): MarketLookup {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`gamma ${res.status}`);
    return res.json();
  };
  return async (input) => {
    const ref = marketRefFrom(input);
    if (!ref) return { ok: false, code: "market_not_found" };
    try {
      const query = CONDITION.test(ref) ? `condition_ids=${ref}` : `slug=${encodeURIComponent(ref)}`;
      // Gamma leaves closed markets out unless asked, so a settled market would read as missing.
      const first = (path: string) => get(path).then((r) => z.array(z.unknown()).catch([]).parse(r)[0]);
      const raw = (await first(`/markets?${query}`)) ?? (await first(`/markets?${query}&closed=true`));
      const m = market.safeParse(raw);
      if (!m.success) return { ok: false, code: "market_not_found" };
      const outcomes = JSON.parse(m.data.outcomes) as unknown;
      const prices = (JSON.parse(m.data.outcomePrices) as unknown[]).map(Number);
      if (!Array.isArray(outcomes) || outcomes[0] !== "Yes" || outcomes[1] !== "No" || prices.length !== 2 || !Number.isFinite(prices[0])) {
        return { ok: false, code: "not_yes_no" };
      }
      const eventSlug = m.data.events?.[0]?.slug ?? "";
      let tags: string[] = [];
      if (eventSlug) {
        const eventShape = z.array(z.object({ tags: z.array(z.object({ slug: z.string() })).optional() })).catch([]);
        const events = eventShape.parse(await get(`/events?slug=${encodeURIComponent(eventSlug)}`).catch(() => []));
        tags = (events[0]?.tags ?? []).map((t) => t.slug.toLowerCase());
      }
      return {
        ok: true,
        market: {
          conditionId: m.data.conditionId.toLowerCase(),
          slug: m.data.slug,
          url: eventSlug ? `https://polymarket.com/event/${eventSlug}/${m.data.slug}` : `https://polymarket.com/market/${m.data.slug}`,
          question: m.data.question,
          endAt: new Date(m.data.endDate),
          yesBps: Math.round(prices[0]! * 10_000),
          bestBid: m.data.bestBid ?? null,
          bestAsk: m.data.bestAsk ?? null,
          spread: m.data.spread ?? 0,
          liquidity: m.data.liquidityNum ?? 0,
          volume24h: m.data.volume24hr ?? 0,
          weekChange: m.data.oneWeekPriceChange ?? 0,
          // Long enough for the full rules: Rules Check quotes from them.
          description: (m.data.description ?? "").slice(0, 8_000),
          tags,
          closed: m.data.closed ?? false,
          umaStatuses: umaStatuses(m.data.umaResolutionStatuses),
        },
      };
    } catch {
      return { ok: false, code: "market_unavailable" };
    }
  };
}
