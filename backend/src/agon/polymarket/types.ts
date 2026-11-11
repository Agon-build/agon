/// Shared shapes of the Polymarket data module. Prices are 0 to 1 (USDC a share), sizes are shares.

/// A value read from Polymarket: when it was read, from where, and how old a kept copy is.
export type Read<T> = { value: T; readAt: string; source: string; ageMs: number };

export type BookLevel = { price: number; size: number };
/// One outcome's order book. Bids are highest first and asks lowest first, so index 0 is the best price.
export type Book = {
  tokenId: string;
  bids: BookLevel[];
  asks: BookLevel[];
  tickSize: number;
  minOrderSize: number;
  lastTradePrice: number | null;
};

/// What a market order of a given size would really get against a book.
export type TradeCost = {
  side: "buy" | "sell";
  requestedUsd: number;
  filledUsd: number;
  shares: number;
  /** Null when nothing could be filled. */
  averagePrice: number | null;
  bestPrice: number | null;
  /** How much worse than the best price the average is, in cents a share. */
  slippageCents: number | null;
  levelsUsed: number;
  unfilledUsd: number;
};

/// `at` is unix seconds.
export type PricePoint = { at: number; price: number };

export type Trade = {
  wallet: string;
  side: "buy" | "sell";
  tokenId: string;
  outcome: string;
  /** 0 for the market's first outcome, 1 for its second. */
  outcomeIndex: number;
  shares: number;
  price: number;
  usd: number;
  /** Unix seconds. */
  at: number;
  txHash: string;
};

export type Holder = { wallet: string; name: string; shares: number; outcomeIndex: number };
export type HoldersOf = { tokenId: string; holders: Holder[] };

/// Money that moved toward each outcome: buying an outcome or selling the other one.
export type Flow = {
  towardFirstUsd: number;
  towardSecondUsd: number;
  netTowardFirstUsd: number;
  count: number;
  wallets: number;
  /** The three largest trades, largest first. */
  largest: Trade[];
};
