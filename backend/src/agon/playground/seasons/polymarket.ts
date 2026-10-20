import { z } from "zod";
import type { Hex } from "viem";

import { CATEGORY_QUERY_TAGS, SEASON_CATEGORIES, categoryFor } from "./categories.ts";

/// Polymarket Gamma API adapter (public, keyless). Field shapes verified on
/// 2026-10-11: outcomes and outcomePrices are JSON-encoded strings; resolution
/// is final only when umaResolutionStatus is "resolved".

export const SLATE_MIN_END_MS = 6 * 3_600_000;
export const SLATE_MAX_END_MS = 7 * 86_400_000;

export type PolymarketMarket = {
  conditionId: Hex;
  question: string;
  slug: string;
  endAt: Date;
  yesPriceBps: number;
  liquidity: number;
  closed: boolean;
  resolution: "pending" | "yes" | "no" | "void";
  tags: string[];
};

const gammaMarket = z.object({
  conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  question: z.string().min(1),
  slug: z.string().default(""),
  endDate: z.string().min(1),
  outcomes: z.string(),
  outcomePrices: z.string(),
  liquidityNum: z.coerce.number().optional(),
  closed: z.boolean().optional(),
  umaResolutionStatus: z.string().nullable().optional(),
});

function jsonStrings(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function parseGammaMarket(raw: unknown, eventTags: string[] = []): PolymarketMarket | null {
  const parsed = gammaMarket.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  const outcomes = jsonStrings(m.outcomes);
  const prices = jsonStrings(m.outcomePrices)?.map(Number);
  if (!outcomes || outcomes.length !== 2 || outcomes[0] !== "Yes" || outcomes[1] !== "No") return null;
  if (!prices || prices.length !== 2 || prices.some((p) => !Number.isFinite(p))) return null;
  const endAt = new Date(m.endDate);
  if (Number.isNaN(endAt.getTime())) return null;
  const closed = m.closed ?? false;
  let resolution: PolymarketMarket["resolution"] = "pending";
  if (closed && m.umaResolutionStatus === "resolved") {
    // Only an exact 1/0 or 0.5/0.5 is final. Anything else is a lagging read
    // and stays pending, because a stored result is never overwritten.
    if (prices[0] === 1 && prices[1] === 0) resolution = "yes";
    else if (prices[0] === 0 && prices[1] === 1) resolution = "no";
    else if (prices[0] === 0.5 && prices[1] === 0.5) resolution = "void";
  }
  return {
    conditionId: m.conditionId.toLowerCase() as Hex,
    question: m.question,
    slug: m.slug,
    endAt,
    yesPriceBps: Math.round(prices[0]! * 10_000),
    liquidity: m.liquidityNum ?? 0,
    closed,
    resolution,
    tags: eventTags,
  };
}

export type PolymarketClient = {
  listCandidates(now: Date): Promise<PolymarketMarket[]>;
  getMarkets(conditionIds: Hex[]): Promise<PolymarketMarket[]>;
};

const eventShape = z.object({
  tags: z.array(z.object({ slug: z.string() })).optional(),
  markets: z.array(z.unknown()).optional(),
});

export function createGammaClient(options: { fetchImpl?: typeof fetch; baseUrl?: string; log?: (m: string) => void } = {}): PolymarketClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";
  const log = options.log ?? ((m: string) => console.warn(m));

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`gamma ${new URL(url).pathname} ${response.status}`);
    return response.json();
  }

  return {
    async listCandidates(now) {
      const window = {
        closed: "false",
        limit: "100",
        end_date_min: new Date(now.getTime() + SLATE_MIN_END_MS).toISOString(),
        end_date_max: new Date(now.getTime() + SLATE_MAX_END_MS).toISOString(),
      };
      // One events query per category (events carry the tags that decide a
      // market's category), then the most liquid markets overall for refill.
      const requests = [
        ...SEASON_CATEGORIES.map((c) => ({ events: true, url: `${base}/events?${new URLSearchParams({ ...window, tag_slug: CATEGORY_QUERY_TAGS[c], order: "liquidity", ascending: "false" })}` })),
        { events: false, url: `${base}/markets?${new URLSearchParams({ ...window, order: "liquidityNum", ascending: "false" })}` },
      ];
      const settled = await Promise.allSettled(requests.map((r) => getJson(r.url)));
      if (settled.every((s) => s.status === "rejected")) throw (settled[0] as PromiseRejectedResult).reason;
      const byId = new Map<string, PolymarketMarket>();
      settled.forEach((s, i) => {
        if (s.status === "rejected") {
          log(`season candidates: ${(s.reason as Error).message}`);
          return;
        }
        if (!requests[i]!.events) return;
        for (const event of z.array(eventShape).catch([]).parse(s.value)) {
          const tags = (event.tags ?? []).map((t) => t.slug);
          for (const raw of event.markets ?? []) {
            const m = parseGammaMarket(raw, tags);
            if (m && !byId.has(m.conditionId)) byId.set(m.conditionId, m);
          }
        }
      });
      // Market-only results come last so a market's event tags always win.
      settled.forEach((s, i) => {
        if (s.status !== "fulfilled" || requests[i]!.events) return;
        for (const raw of z.array(z.unknown()).catch([]).parse(s.value)) {
          const m = parseGammaMarket(raw);
          if (m && !byId.has(m.conditionId)) byId.set(m.conditionId, m);
        }
      });
      return [...byId.values()];
    },
    async getMarkets(conditionIds) {
      const out: PolymarketMarket[] = [];
      for (let i = 0; i < conditionIds.length; i += 20) {
        // Results are read once a market has closed, and Gamma leaves closed markets out unless asked
        // (checked 2026-10-20: without this every ended Season 9001 market came back empty and stayed pending).
        const params = new URLSearchParams({ closed: "true" });
        for (const id of conditionIds.slice(i, i + 20)) params.append("condition_ids", id);
        for (const raw of z.array(z.unknown()).catch([]).parse(await getJson(`${base}/markets?${params}`))) {
          const m = parseGammaMarket(raw);
          if (m) out.push(m);
        }
      }
      return out;
    },
  };
}

/// Season slate (structure spec section 7): the two most liquid eligible
/// markets of each category, then the most liquid remaining eligible markets
/// of any category (Other included) until the slate is full. Output is sorted
/// by end time, then condition id, so the same input always gives the same slate.
export function selectSlate(
  candidates: PolymarketMarket[],
  now: Date,
  options: { size?: number; perCategory?: number; minLiquidity?: number } = {},
): PolymarketMarket[] {
  const size = options.size ?? 12;
  const perCategory = options.perCategory ?? 2;
  const minLiquidity = options.minLiquidity ?? 5_000;
  const earliest = now.getTime() + SLATE_MIN_END_MS;
  const latest = now.getTime() + SLATE_MAX_END_MS;
  const eligible = candidates
    .filter((m) => !m.closed && m.resolution === "pending")
    .filter((m) => m.endAt.getTime() >= earliest && m.endAt.getTime() <= latest)
    .filter((m) => m.yesPriceBps >= 500 && m.yesPriceBps <= 9500)
    .filter((m) => m.liquidity >= minLiquidity)
    .sort((a, b) => b.liquidity - a.liquidity || (a.conditionId < b.conditionId ? -1 : 1));
  const picked: PolymarketMarket[] = [];
  const taken = new Set<string>();
  for (const category of SEASON_CATEGORIES) {
    for (const m of eligible.filter((c) => categoryFor(c.tags) === category).slice(0, perCategory)) {
      picked.push(m);
      taken.add(m.conditionId);
    }
  }
  for (const m of eligible) {
    if (picked.length >= size) break;
    if (taken.has(m.conditionId)) continue;
    picked.push(m);
    taken.add(m.conditionId);
  }
  return picked
    .slice(0, size)
    .sort((a, b) => a.endAt.getTime() - b.endAt.getTime() || (a.conditionId < b.conditionId ? -1 : 1));
}
