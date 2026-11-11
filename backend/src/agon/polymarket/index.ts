import { createCache } from "./cache.ts";
import { HISTORY_FIDELITY, parseBook, parseHistory, type HistoryWindow } from "./clob.ts";
import { parseHolders, parseOpenInterest, parseTrades } from "./data.ts";
import { CLOB, DATA, createGet } from "./http.ts";
import type { Book, HoldersOf, PricePoint, Read, Trade } from "./types.ts";

export { costToTrade, depthWithin } from "./cost.ts";
export { flowOf } from "./data.ts";
export { PolymarketUnavailable } from "./http.ts";
export type * from "./types.ts";
export type { HistoryWindow } from "./clob.ts";

/// How long each kind of read is kept, and how old a kept copy may be served when Polymarket fails.
const KEEP = {
  book: { ttl: 2_000, stale: 30_000 },
  history: { ttl: 60_000, stale: 600_000 },
  trades: { ttl: 5_000, stale: 60_000 },
  holders: { ttl: 60_000, stale: 600_000 },
  openInterest: { ttl: 60_000, stale: 600_000 },
} as const;

const TOKEN = /^\d{1,90}$/;
const CONDITION = /^0x[0-9a-fA-F]{64}$/;

/// Agon's one way of reading Polymarket: keyless, read-only, each call inside a time limit,
/// every payload checked, and every answer stamped with when and where it was read.
export type Polymarket = {
  book(tokenId: string): Promise<Read<Book>>;
  history(tokenId: string, window: HistoryWindow): Promise<Read<PricePoint[]>>;
  /** Newest first, at most `limit` (default 200, most 500). */
  trades(conditionId: string, limit?: number): Promise<Read<Trade[]>>;
  /** The largest holders of each outcome, at most `limit` each (default 20, most 100). */
  holders(conditionId: string, limit?: number): Promise<Read<HoldersOf[]>>;
  openInterest(conditionId: string): Promise<Read<number>>;
};

export function createPolymarket(opts: { fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number } = {}): Polymarket {
  const now = opts.now ?? Date.now;
  const get = createGet({ ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  const cache = createCache({ now });

  async function read<T>(key: string, keep: { ttl: number; stale: number }, base: string, path: string, parse: (raw: unknown) => T): Promise<Read<T>> {
    const got = await cache.read(key, keep.ttl, keep.stale, async () => parse(await get(base, path)));
    return { value: got.value, readAt: new Date(got.at).toISOString(), source: `${base}${path.split("?")[0]}`, ageMs: got.ageMs };
  }
  const token = (id: string) => { if (!TOKEN.test(id)) throw new TypeError("token id must be a decimal number"); return id; };
  const condition = (id: string) => { if (!CONDITION.test(id)) throw new TypeError("condition id must be 0x and 64 hex characters"); return id.toLowerCase(); };
  const capped = (n: number | undefined, normal: number, most: number) => Math.max(1, Math.min(Math.trunc(n ?? normal) || normal, most));

  return {
    book: async (tokenId) => read(`book:${token(tokenId)}`, KEEP.book, CLOB, `/book?token_id=${tokenId}`, parseBook),
    history: async (tokenId, window) =>
      read(`history:${token(tokenId)}:${window}`, KEEP.history, CLOB, `/prices-history?market=${tokenId}&interval=${window}&fidelity=${HISTORY_FIDELITY[window]}`, parseHistory),
    trades: async (conditionId, limit) => {
      const id = condition(conditionId);
      const n = capped(limit, 200, 500);
      return read(`trades:${id}:${n}`, KEEP.trades, DATA, `/v2/trades?condition_id=${id}&limit=${n}`, parseTrades);
    },
    holders: async (conditionId, limit) => {
      const id = condition(conditionId);
      const n = capped(limit, 20, 100);
      return read(`holders:${id}:${n}`, KEEP.holders, DATA, `/v2/holders?condition_id=${id}&limit=${n}`, parseHolders);
    },
    openInterest: async (conditionId) => {
      const id = condition(conditionId);
      return read(`oi:${id}`, KEEP.openInterest, DATA, `/v2/oi?condition_id=${id}`, parseOpenInterest);
    },
  };
}
