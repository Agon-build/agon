import { z } from "zod";
import type { Hex } from "viem";

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

export function createGammaClient(options: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): PolymarketClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";

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
      const [events, markets] = await Promise.all([
        getJson(`${base}/events?${new URLSearchParams({ ...window, tag_slug: "crypto" })}`),
        getJson(`${base}/markets?${new URLSearchParams({ ...window, order: "liquidityNum", ascending: "false" })}`),
      ]);
      const byId = new Map<string, PolymarketMarket>();
      for (const event of z.array(eventShape).catch([]).parse(events)) {
        const tags = (event.tags ?? []).map((t) => t.slug);
        for (const raw of event.markets ?? []) {
          const m = parseGammaMarket(raw, tags);
          if (m) byId.set(m.conditionId, m);
        }
      }
      for (const raw of z.array(z.unknown()).catch([]).parse(markets)) {
        const m = parseGammaMarket(raw);
        if (m && !byId.has(m.conditionId)) byId.set(m.conditionId, m);
      }
      return [...byId.values()];
    },
    async getMarkets(conditionIds) {
      const out: PolymarketMarket[] = [];
      for (let i = 0; i < conditionIds.length; i += 20) {
        const params = new URLSearchParams();
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

const isCrypto = (m: PolymarketMarket) => m.tags.includes("crypto") || m.tags.includes("crypto-prices");

export function selectSlate(
  candidates: PolymarketMarket[],
  now: Date,
  options: { size?: number; cryptoMax?: number; minLiquidity?: number } = {},
): PolymarketMarket[] {
  const size = options.size ?? 10;
  const cryptoMax = options.cryptoMax ?? 6;
  const minLiquidity = options.minLiquidity ?? 5_000;
  const earliest = now.getTime() + SLATE_MIN_END_MS;
  const latest = now.getTime() + SLATE_MAX_END_MS;
  const eligible = candidates
    .filter((m) => !m.closed && m.resolution === "pending")
    .filter((m) => m.endAt.getTime() >= earliest && m.endAt.getTime() <= latest)
    .filter((m) => m.yesPriceBps >= 500 && m.yesPriceBps <= 9500)
    .filter((m) => m.liquidity >= minLiquidity)
    .sort((a, b) => b.liquidity - a.liquidity || (a.conditionId < b.conditionId ? -1 : 1));
  const crypto = eligible.filter(isCrypto).slice(0, cryptoMax);
  // Fill the remaining slots with event markets only, so cryptoMax holds even
  // when more crypto markets have higher liquidity.
  const rest = eligible.filter((m) => !isCrypto(m)).slice(0, Math.max(0, size - crypto.length));
  return [...crypto, ...rest]
    .slice(0, size)
    .sort((a, b) => a.endAt.getTime() - b.endAt.getTime() || (a.conditionId < b.conditionId ? -1 : 1));
}
