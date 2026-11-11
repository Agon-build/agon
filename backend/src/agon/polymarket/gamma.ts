import { z } from "zod";

import { GAMMA, PolymarketUnavailable, type Get } from "./http.ts";
import { marketRefParts } from "./refs.ts";
import type { Market, MarketChoice, ResolveResult } from "./types.ts";

const MAX_CHOICES = 5;
const num = z.coerce.number().catch(0);
const optionalNumber = z.coerce.number().finite().nullable().optional().catch(undefined);

const marketShape = z.object({
  conditionId: z.string().min(1),
  slug: z.string().min(1),
  question: z.string().min(1),
  outcomes: z.unknown(),
  outcomePrices: z.unknown(),
  clobTokenIds: z.unknown().optional(),
  bestBid: optionalNumber,
  bestAsk: optionalNumber,
  spread: num.optional(),
  liquidityNum: num.optional(),
  volume24hr: num.optional(),
  oneWeekPriceChange: num.nullable().optional(),
  endDate: z.string(),
  closed: z.boolean().optional(),
  acceptingOrders: z.boolean().optional(),
  negRisk: z.boolean().optional(),
  orderMinSize: optionalNumber,
  orderPriceMinTickSize: optionalNumber,
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
const strings = (value: unknown): string[] => (jsonList(value) ?? []).filter((s): s is string => typeof s === "string");

/// One market as Gamma sends it. A market is two named outcomes with a price each; a record
/// without exactly two is refused as `not_yes_no`, and one Agon cannot read as `market_not_found`.
/// Tags are left empty here: they come from the market's event.
export function parseMarket(raw: unknown): { ok: true; market: Market } | { ok: false; code: "market_not_found" | "not_yes_no" } {
  const m = marketShape.safeParse(raw);
  if (!m.success) return { ok: false, code: "market_not_found" };
  const labels = jsonList(m.data.outcomes);
  const prices = jsonList(m.data.outcomePrices)?.map(Number);
  if (!labels || !prices || labels.length !== 2 || prices.length !== 2 || !labels.every((l) => typeof l === "string" && l.trim()) || !prices.every(Number.isFinite)) {
    return { ok: false, code: "not_yes_no" };
  }
  const tokens = strings(m.data.clobTokenIds);
  const [first, second] = labels as [string, string];
  const eventSlug = m.data.events?.[0]?.slug ?? "";
  return {
    ok: true,
    market: {
      conditionId: m.data.conditionId.toLowerCase(),
      slug: m.data.slug,
      url: eventSlug ? `https://polymarket.com/event/${eventSlug}/${m.data.slug}` : `https://polymarket.com/market/${m.data.slug}`,
      question: m.data.question,
      endAt: new Date(m.data.endDate),
      outcomes: [
        { label: first.trim(), tokenId: tokens.length === 2 ? tokens[0]! : "", price: prices[0]! },
        { label: second.trim(), tokenId: tokens.length === 2 ? tokens[1]! : "", price: prices[1]! },
      ],
      yesNo: first === "Yes" && second === "No",
      yesBps: Math.round(prices[0]! * 10_000),
      bestBid: m.data.bestBid ?? null,
      bestAsk: m.data.bestAsk ?? null,
      spread: m.data.spread ?? 0,
      liquidity: m.data.liquidityNum ?? 0,
      volume24h: m.data.volume24hr ?? 0,
      weekChange: m.data.oneWeekPriceChange ?? 0,
      // Long enough for the full rules: Rules Check quotes from them.
      description: (m.data.description ?? "").slice(0, 8_000),
      tags: [],
      closed: m.data.closed ?? false,
      umaStatuses: strings(m.data.umaResolutionStatuses),
      tickSize: m.data.orderPriceMinTickSize ?? null,
      minOrderSize: m.data.orderMinSize ?? null,
      acceptingOrders: m.data.acceptingOrders ?? !(m.data.closed ?? false),
      negRisk: m.data.negRisk ?? false,
    },
  };
}

/// The busiest open markets by money traded in the last 24 hours, busiest first. Records Agon
/// cannot read as two outcomes are left out; a list it cannot read at all is unavailable.
export function parseTopMarkets(raw: unknown): Market[] {
  const rows = z.array(z.unknown()).safeParse(raw);
  if (!rows.success) throw new PolymarketUnavailable("market list has an unknown shape");
  const markets = rows.data.flatMap((row) => { const m = parseMarket(row); return m.ok && !m.market.closed ? [m.market] : []; });
  if (rows.data.length > 0 && markets.length === 0) throw new PolymarketUnavailable("no market in the list could be read");
  return markets.sort((a, b) => b.volume24h - a.volume24h);
}

/// Finds the one market a person named. A link, a market's name or a condition id is looked up
/// on Gamma; an event link means its only open market or the market that carries the event's own
/// name (a game's main market); an event with several markets comes back as a question, busiest first.
export function createMarketResolver(deps: { get: Get; base?: string }): (input: string) => Promise<ResolveResult> {
  const base = deps.base ?? GAMMA;
  const first = (path: string) => deps.get(base, path).then((r) => z.array(z.unknown()).catch([]).parse(r)[0]);
  // Gamma leaves closed markets out unless asked, so a settled market would read as missing.
  const marketBy = async (query: string) => (await first(`/markets?${query}`)) ?? (await first(`/markets?${query}&closed=true`));

  const fromEvent = async (slug: string): Promise<{ slug: string } | Extract<ResolveResult, { code: "which_market" }> | null> => {
    const event = eventRow.safeParse(await first(`/events?slug=${encodeURIComponent(slug)}`));
    if (!event.success) return null;
    const all = event.data.markets.flatMap((raw) => { const m = eventMarket.safeParse(raw); return m.success ? [m.data] : []; });
    const open = all.filter((m) => m.closed !== true);
    const list = open.length > 0 ? open : all;
    if (list.length === 0) return null;
    const own = list.length === 1 ? list[0]! : list.find((m) => m.slug === slug);
    if (own) return { slug: own.slug };
    const choices: MarketChoice[] = [...list].sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0)).slice(0, MAX_CHOICES).map((m) => {
      const yes = Number(jsonList(m.outcomePrices)?.[0]);
      return { label: m.groupItemTitle?.trim() || m.question, url: `https://polymarket.com/event/${slug}/${m.slug}`, yesPct: jsonList(m.outcomes)?.[0] === "Yes" && Number.isFinite(yes) ? Math.round(yes * 100) : null };
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
      const parsed = parseMarket(raw);
      if (!parsed.ok) return parsed;
      const eventSlug = parsed.market.url.match(/\/event\/([^/]+)\//)?.[1] ?? "";
      let tags: string[] = [];
      if (eventSlug) {
        const eventShape = z.array(z.object({ tags: z.array(z.object({ slug: z.string() })).optional() })).catch([]);
        const events = eventShape.parse(await deps.get(base, `/events?slug=${encodeURIComponent(eventSlug)}`).catch(() => []));
        tags = (events[0]?.tags ?? []).map((t) => t.slug.toLowerCase());
      }
      return { ok: true, market: { ...parsed.market, tags } };
    } catch {
      return { ok: false, code: "market_unavailable" };
    }
  };
}
