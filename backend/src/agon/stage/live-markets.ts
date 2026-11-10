import { z } from "zod";

/// One market trading on Polymarket now, as Hire shows it.
export type LiveMarket = { question: string; url: string; yesBps: number; volume24h: number; liquidity: number; endsAt: string };
export type LiveMarkets = { readAt: string; markets: LiveMarket[] };

const row = z.object({
  question: z.string().min(1),
  slug: z.string().min(1),
  outcomes: z.string(),
  outcomePrices: z.string(),
  volume24hr: z.coerce.number().catch(0),
  liquidityNum: z.coerce.number().catch(0),
  endDate: z.string(),
  closed: z.boolean().optional(),
  events: z.array(z.object({ slug: z.string() })).optional(),
});

const MIN_LIQUIDITY = 10_000;
const HOUR_MS = 3_600_000;

/// The busiest open Yes or No markets on Polymarket by 24 hour volume (Gamma, keyless; query
/// checked against the live API on 2026-11-10). One market per event, none nearly settled
/// (Yes between 5% and 95%), none closing within the hour. Read at most every half minute;
/// when Polymarket does not answer, the last good read is kept.
export function createLiveMarkets(options: { fetchImpl?: typeof fetch; baseUrl?: string; now?: () => Date; ttlMs?: number; count?: number } = {}): () => Promise<LiveMarkets | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl ?? "https://gamma-api.polymarket.com";
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlMs ?? 30_000;
  const count = options.count ?? 8;
  let last: { at: number; value: LiveMarkets } | null = null;
  let running: Promise<LiveMarkets | null> | null = null;

  async function read(): Promise<LiveMarkets | null> {
    const at = now();
    try {
      const res = await fetchImpl(`${base}/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=80`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`gamma ${res.status}`);
      const markets: LiveMarket[] = [];
      const events = new Set<string>();
      for (const raw of z.array(z.unknown()).catch([]).parse(await res.json())) {
        const m = row.safeParse(raw);
        if (!m.success || m.data.closed === true) continue;
        let outcomes: unknown;
        let prices: number[];
        try {
          outcomes = JSON.parse(m.data.outcomes);
          prices = (JSON.parse(m.data.outcomePrices) as unknown[]).map(Number);
        } catch {
          continue;
        }
        if (!Array.isArray(outcomes) || outcomes[0] !== "Yes" || outcomes[1] !== "No" || !Number.isFinite(prices[0])) continue;
        const yesBps = Math.round(prices[0]! * 10_000);
        const ends = new Date(m.data.endDate).getTime();
        if (yesBps < 500 || yesBps > 9_500 || m.data.liquidityNum < MIN_LIQUIDITY || !Number.isFinite(ends) || ends < at.getTime() + HOUR_MS) continue;
        const event = m.data.events?.[0]?.slug ?? "";
        if (events.has(event || m.data.slug)) continue;
        events.add(event || m.data.slug);
        markets.push({
          question: m.data.question,
          url: event ? `https://polymarket.com/event/${event}/${m.data.slug}` : `https://polymarket.com/market/${m.data.slug}`,
          yesBps, volume24h: Math.round(m.data.volume24hr), liquidity: Math.round(m.data.liquidityNum), endsAt: m.data.endDate,
        });
        if (markets.length >= count) break;
      }
      last = { at: at.getTime(), value: { readAt: at.toISOString(), markets } };
      return last.value;
    } catch {
      return last?.value ?? null;
    }
  }

  return () => {
    if (last && now().getTime() - last.at < ttlMs) return Promise.resolve(last.value);
    running ??= read().finally(() => { running = null; });
    return running;
  };
}
