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
/// One market of an event that holds several, offered when a link names only the event.
export type MarketChoice = { label: string; url: string; yesPct: number | null };
export type LookupResult =
  | { ok: true; market: MarketSnapshot }
  | { ok: false; code: "market_not_found" | "market_unavailable" | "not_yes_no" }
  | { ok: false; code: "which_market"; title: string; choices: MarketChoice[] };
export type MarketLookup = (ref: string) => Promise<LookupResult>;

const SLUG = /^[a-z0-9][a-z0-9-]{2,200}$/;
const CONDITION = /^0x[0-9a-fA-F]{64}$/;
// A link as people paste it: with or without https, with tracking after it, inside a sentence.
// Only the name at the end is used and the link itself is never opened.
const LINK = /(?<![\w.\-/])(?:https?:\/\/)?(?:www\.)?polymarket\.com\/[^\s"'<>)]+/i;
const MAX_CHOICES = 5;

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

const eventRow = z.object({ title: z.string().optional(), markets: z.array(z.unknown()).default([]) });
const eventMarket = z.object({
  slug: z.string().min(1), question: z.string().min(1), groupItemTitle: z.string().nullable().optional(),
  outcomes: z.unknown(), outcomePrices: z.unknown(), volume24hr: z.coerce.number().catch(0).optional(), closed: z.boolean().optional(),
});
/// Gamma sends lists as a JSON string, sometimes as an array; anything else reads as none.
function jsonList(value: unknown): unknown[] | null {
  try {
    const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

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
  const first = (path: string) => get(path).then((r) => z.array(z.unknown()).catch([]).parse(r)[0]);
  // Gamma leaves closed markets out unless asked, so a settled market would read as missing.
  const marketBy = async (query: string) => (await first(`/markets?${query}`)) ?? (await first(`/markets?${query}&closed=true`));
  /// The one market an event link means: its only market, or the market that carries the event's own
  /// name (a game's main market). Several with none named is a question back, busiest first.
  const fromEvent = async (slug: string): Promise<{ slug: string } | Extract<LookupResult, { code: "which_market" }> | null> => {
    const event = eventRow.safeParse(await first(`/events?slug=${encodeURIComponent(slug)}`));
    if (!event.success) return null;
    const all = event.data.markets.flatMap((raw) => { const m = eventMarket.safeParse(raw); return m.success ? [m.data] : []; });
    const open = all.filter((m) => m.closed !== true);
    const list = open.length > 0 ? open : all;
    if (list.length === 0) return null;
    const own = list.length === 1 ? list[0]! : list.find((m) => m.slug === slug);
    if (own) return { slug: own.slug };
    const choices = [...list].sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0)).slice(0, MAX_CHOICES).map((m) => {
      const outcomes = jsonList(m.outcomes);
      const yes = Number(jsonList(m.outcomePrices)?.[0]);
      return { label: m.groupItemTitle?.trim() || m.question, url: `https://polymarket.com/event/${slug}/${m.slug}`, yesPct: outcomes?.[0] === "Yes" && Number.isFinite(yes) ? Math.round(yes * 100) : null };
    });
    return { ok: false, code: "which_market", title: event.data.title ?? "", choices };
  };
  return async (input) => {
    const ref = marketRefParts(input);
    if (!ref) return { ok: false, code: "market_not_found" };
    try {
      let raw: unknown;
      if (ref.kind === "condition") raw = await marketBy(`condition_ids=${ref.value}`);
      else {
        const bySlug = () => marketBy(`slug=${encodeURIComponent(ref.value)}`);
        // An event link is read as an event first; a bare name or a market link as a market first.
        if (ref.kind === "market") raw = await bySlug();
        if (!raw) {
          const picked = await fromEvent(ref.value);
          if (picked && "code" in picked) return picked;
          raw = picked ? await marketBy(`slug=${encodeURIComponent(picked.slug)}`) : ref.kind === "event" ? await bySlug() : undefined;
        }
      }
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
