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

/// A Polymarket event: a group of markets, such as one per person in "Who will leave the Trump
/// administration before 2027?". Its link names only the event, so it is not one market.
export type EventMarket = { label: string; question: string; ref: string; yesBps: number; volume24h: number };
export type EventMarkets = { title: string; markets: EventMarket[] };

const EVENT_LINK = /https:\/\/(?:www\.)?polymarket\.com\/event\/([a-z0-9-]+)\/?(?=[\s"'<>)?.,;!]|$)/i;

/// A link to a whole event (polymarket.com/event/<event>, with no market after it), or null.
export function eventLinkIn(text: string): { link: string; slug: string } | null {
  const m = text.match(EVENT_LINK);
  return m ? { link: m[0], slug: m[1]!.toLowerCase() } : null;
}

const eventMarket = z.object({
  question: z.string().min(1), slug: z.string().min(1), groupItemTitle: z.string().optional(), outcomes: z.unknown(), outcomePrices: z.unknown(),
  volume24hr: z.coerce.number().catch(0).optional(), closed: z.boolean().optional(),
});

/// Reads an event from Polymarket (Gamma, keyless): its open Yes or No markets, busiest first.
/// Any failure is null, never an error.
export function createEventReader(options: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): (slug: string) => Promise<EventMarkets | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";
  return async (slug) => {
    try {
      const res = await fetchImpl(`${base}/events?slug=${encodeURIComponent(slug)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const body = (await res.json()) as { title?: unknown; closed?: unknown; markets?: unknown[] }[];
      const event = Array.isArray(body) ? body.find((e) => e.closed !== true) : undefined;
      if (!event) return null;
      const markets: EventMarket[] = [];
      for (const raw of event.markets ?? []) {
        const m = eventMarket.safeParse(raw);
        if (!m.success || m.data.closed === true) continue;
        const outcomes = strings(m.data.outcomes);
        const prices = strings(m.data.outcomePrices)?.map(Number);
        if (!outcomes || outcomes[0] !== "Yes" || outcomes[1] !== "No" || !prices || !Number.isFinite(prices[0])) continue;
        markets.push({ label: m.data.groupItemTitle?.trim() || m.data.question, question: m.data.question, ref: `https://polymarket.com/event/${slug}/${m.data.slug}`, yesBps: Math.round(prices[0]! * 10_000), volume24h: m.data.volume24hr ?? 0 });
      }
      markets.sort((a, b) => b.volume24h - a.volume24h);
      return { title: typeof event.title === "string" ? event.title : "", markets };
    } catch {
      return null;
    }
  };
}

const LABEL_SKIP = new Set(["will", "the", "and", "for", "before", "after", "more", "less", "than", "yes", "not"]);
const wordsIn = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/// The market whose name the person used ("Hegseth" picks "Pete Hegseth"). Null when none
/// is named or two are named equally.
export function outcomeIn(event: EventMarkets, text: string): EventMarket | null {
  const said = new Set(wordsIn(text));
  let best: EventMarket | null = null;
  let top = 0;
  let tie = false;
  for (const m of event.markets) {
    const score = wordsIn(m.label).filter((w) => w.length >= 3 && !LABEL_SKIP.has(w) && said.has(w)).length;
    if (score > top) { best = m; top = score; tie = false; } else if (score === top && score > 0) tie = true;
  }
  return top > 0 && !tie ? best : null;
}

/// Asked when an event link holds several markets: the busiest five with their Yes price.
export function outcomeQuestion(event: EventMarkets): string {
  const top = event.markets.slice(0, 5).map((m) => `${m.label} ${Math.round(m.yesBps / 100)}%`).join(", ");
  return `That link is a group of ${event.markets.length} markets. Which one? ${top}. Name one, or paste its own link.`;
}
