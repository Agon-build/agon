import { z } from "zod";

import { marketRefFrom } from "../agents/market-lookup.ts";
import { fallbackQueryFor, matchMarket, searchQueryFor, type MarketCandidate } from "../lead-agent/market-parse.ts";

/// The open Polymarket market a request is about: its link, its question and the crowd price read just now.
export type FoundMarket = { ref: string; question: string; yesBps: number | null };
export type MarketFinder = (text: string, now: Date) => Promise<FoundMarket | null>;

const LINK = /https:\/\/(?:www\.)?polymarket\.com\/[^\s"'<>)]+/i;
const CONDITION = /\b0x[0-9a-fA-F]{64}\b/;

/// A Polymarket link or condition id the person typed, or null. Nothing else is taken as a market.
export function marketInText(text: string): string | null {
  const link = text.match(LINK)?.[0]?.replace(/[.,;!?]+$/, "");
  if (link && marketRefFrom(link)) return link;
  const id = text.match(CONDITION)?.[0];
  return id ? id.toLowerCase() : null;
}

const gammaMarket = z.object({
  conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  question: z.string().min(1),
  slug: z.string().min(1),
  endDate: z.string().default(""),
  outcomes: z.unknown(),
  outcomePrices: z.unknown(),
  closed: z.boolean().optional(),
});
const strings = (value: unknown): string[] | null => {
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    return null;
  }
};

type Hit = { market: MarketCandidate; eventSlug: string };

/// Finds the market on Polymarket itself (Gamma public search, keyless, open events only)
/// and picks it with the same fixed rules the Lead uses. Any failure is no match, never an error.
export function createMarketFinder(options: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): MarketFinder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";
  const search = async (q: string): Promise<Hit[]> => {
    // events_status=active: without it Polymarket ranks long-closed events first.
    const params = new URLSearchParams({ q, limit_per_type: "10", events_status: "active" });
    const res = await fetchImpl(`${base}/public-search?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`gamma ${res.status}`);
    const body = (await res.json()) as { events?: { title?: unknown; slug?: unknown; markets?: unknown[] }[] };
    const hits: Hit[] = [];
    for (const event of body.events ?? []) {
      for (const raw of event.markets ?? []) {
        const m = gammaMarket.safeParse(raw);
        if (!m.success || m.data.closed === true) continue;
        const outcomes = strings(m.data.outcomes);
        const prices = strings(m.data.outcomePrices)?.map(Number);
        if (!outcomes || outcomes[0] !== "Yes" || outcomes[1] !== "No" || !prices || !Number.isFinite(prices[0])) continue;
        hits.push({
          eventSlug: typeof event.slug === "string" ? event.slug : "",
          market: {
            conditionId: m.data.conditionId.toLowerCase() as MarketCandidate["conditionId"], question: m.data.question, slug: m.data.slug, endDate: m.data.endDate,
            yesPriceBps: Math.round(prices[0]! * 10_000), eventTitle: typeof event.title === "string" ? event.title : "",
          },
        });
      }
    }
    return hits;
  };
  return async (text, now) => {
    try {
      const query = searchQueryFor(text);
      if (query.length < 2) return null;
      let hits = await search(query);
      let found = matchMarket(hits.map((h) => h.market), text, now).market;
      const wider = fallbackQueryFor(text);
      if (!found && wider) {
        hits = [...hits, ...(await search(wider))];
        found = matchMarket(hits.map((h) => h.market), text, now).market;
      }
      if (!found) return null;
      const eventSlug = hits.find((h) => h.market === found)?.eventSlug ?? "";
      return {
        ref: eventSlug ? `https://polymarket.com/event/${eventSlug}/${found.slug}` : `https://polymarket.com/market/${found.slug}`,
        question: found.question,
        yesBps: found.yesPriceBps,
      };
    } catch {
      return null;
    }
  };
}
