import { z } from "zod";

import { PolymarketUnavailable } from "./http.ts";
import type { Book, BookLevel, PricePoint } from "./types.ts";

const amount = z.coerce.number().finite().nonnegative();
const level = z.object({ price: amount, size: amount });
const bookShape = z.object({
  asset_id: z.string().min(1),
  bids: z.array(level),
  asks: z.array(level),
  tick_size: amount.optional(),
  min_order_size: amount.optional(),
  last_trade_price: z.union([z.string(), z.number()]).nullable().optional(),
});

/// Polymarket sends bids lowest first and asks highest first (checked 2026-11-11). Agon never
/// relies on that order: both sides are sorted here so the best price is always first.
export function parseBook(raw: unknown): Book {
  const parsed = bookShape.safeParse(raw);
  if (!parsed.success) throw new PolymarketUnavailable("order book has an unknown shape");
  const real = (l: BookLevel) => l.price > 0 && l.price < 1 && l.size > 0;
  const last = Number(parsed.data.last_trade_price);
  return {
    tokenId: parsed.data.asset_id,
    bids: parsed.data.bids.filter(real).sort((a, b) => b.price - a.price),
    asks: parsed.data.asks.filter(real).sort((a, b) => a.price - b.price),
    tickSize: parsed.data.tick_size ?? 0.01,
    minOrderSize: parsed.data.min_order_size ?? 0,
    lastTradePrice: parsed.data.last_trade_price == null || !Number.isFinite(last) || last <= 0 ? null : last,
  };
}

const historyShape = z.object({ history: z.array(z.object({ t: z.number().int().positive(), p: z.number().finite().min(0).max(1) })) });

/// A token's price over time, oldest first.
export function parseHistory(raw: unknown): PricePoint[] {
  const parsed = historyShape.safeParse(raw);
  if (!parsed.success) throw new PolymarketUnavailable("price history has an unknown shape");
  return parsed.data.history.map((h) => ({ at: h.t, price: h.p })).sort((a, b) => a.at - b.at);
}

export type HistoryWindow = "1d" | "1w" | "1m";
/// Minutes between points for each window: about 144, 168 and 180 points.
export const HISTORY_FIDELITY: Readonly<Record<HistoryWindow, number>> = { "1d": 10, "1w": 60, "1m": 240 };
