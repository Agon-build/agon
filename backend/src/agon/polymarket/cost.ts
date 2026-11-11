import type { Book, BookLevel, TradeCost } from "./types.ts";

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/// What a market order for `usd` would get: it takes the best level first and moves down the
/// book until the money is spent or the book ends. A buy spends `usd`; a sell raises `usd`.
/// Fixed arithmetic over the book as read, so the same book always gives the same answer.
export function costToTrade(book: Book, side: "buy" | "sell", usd: number): TradeCost {
  const levels: BookLevel[] = side === "buy" ? book.asks : book.bids;
  const requested = Number.isFinite(usd) && usd > 0 ? usd : 0;
  let left = requested;
  let shares = 0;
  let levelsUsed = 0;
  for (const level of levels) {
    if (left <= 1e-9) break;
    if (!(level.price > 0) || !(level.size > 0)) continue;
    const take = Math.min(left, level.price * level.size);
    shares += take / level.price;
    left -= take;
    levelsUsed += 1;
  }
  const filled = requested - left;
  const best = levels.find((l) => l.price > 0 && l.size > 0)?.price ?? null;
  const average = shares > 0 ? filled / shares : null;
  return {
    side,
    requestedUsd: round(requested, 2),
    filledUsd: round(filled, 2),
    shares: round(shares, 4),
    averagePrice: average === null ? null : round(average, 5),
    bestPrice: best,
    slippageCents: average === null || best === null ? null : round(Math.abs(average - best) * 100, 2),
    levelsUsed,
    unfilledUsd: round(Math.max(0, left), 2),
  };
}

/// How much money rests within `cents` of the best price on each side.
export function depthWithin(book: Book, cents: number): { bidUsd: number; askUsd: number } {
  const reach = cents / 100 + 1e-9;
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  const sum = (levels: BookLevel[], keep: (l: BookLevel) => boolean) => round(levels.filter(keep).reduce((s, l) => s + l.price * l.size, 0), 2);
  return {
    bidUsd: bestBid === undefined ? 0 : sum(book.bids, (l) => bestBid - l.price <= reach),
    askUsd: bestAsk === undefined ? 0 : sum(book.asks, (l) => l.price - bestAsk <= reach),
  };
}
