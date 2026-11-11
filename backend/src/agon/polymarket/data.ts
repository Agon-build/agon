import { z } from "zod";

import { PolymarketUnavailable } from "./http.ts";
import type { Flow, HoldersOf, Trade } from "./types.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;
const amount = z.coerce.number().finite().nonnegative();
const index = z.coerce.number().int().min(0).max(1);

const tradeShape = z.object({
  proxy_wallet: z.string().min(1),
  side: z.enum(["BUY", "SELL"]),
  token_id: z.string().min(1),
  size: amount,
  price: amount,
  timestamp: z.coerce.number().int().positive(),
  outcome: z.string().nullable().optional(),
  outcome_index: index.nullable().optional(),
  transaction_hash: z.string().nullable().optional(),
});
const tradesShape = z.object({ data: z.array(z.unknown()) });

/// Trades of a market, newest first. A row Agon cannot read is left out; an envelope it
/// cannot read is unavailable.
export function parseTrades(raw: unknown): Trade[] {
  const parsed = tradesShape.safeParse(raw);
  if (!parsed.success) throw new PolymarketUnavailable("trades have an unknown shape");
  const trades: Trade[] = [];
  for (const row of parsed.data.data) {
    const t = tradeShape.safeParse(row);
    if (!t.success) continue;
    trades.push({
      wallet: t.data.proxy_wallet.toLowerCase(),
      side: t.data.side === "BUY" ? "buy" : "sell",
      tokenId: t.data.token_id,
      outcome: t.data.outcome ?? "",
      outcomeIndex: t.data.outcome_index ?? 0,
      shares: t.data.size,
      price: t.data.price,
      usd: round2(t.data.size * t.data.price),
      at: t.data.timestamp,
      txHash: t.data.transaction_hash ?? "",
    });
  }
  if (parsed.data.data.length > 0 && trades.length === 0) throw new PolymarketUnavailable("no trade row could be read");
  return trades.sort((a, b) => b.at - a.at);
}

const holderShape = z.object({
  proxy_wallet: z.string().min(1),
  amount,
  outcome_index: index.nullable().optional(),
  name: z.string().nullable().optional(),
  pseudonym: z.string().nullable().optional(),
});
const holdersShape = z.object({ data: z.array(z.object({ token_id: z.string().min(1), holders: z.array(z.unknown()) })) });

/// The largest holders of each outcome, largest first.
export function parseHolders(raw: unknown): HoldersOf[] {
  const parsed = holdersShape.safeParse(raw);
  if (!parsed.success) throw new PolymarketUnavailable("holders have an unknown shape");
  return parsed.data.data.map((group) => ({
    tokenId: group.token_id,
    holders: group.holders
      .flatMap((row) => { const h = holderShape.safeParse(row); return h.success ? [h.data] : []; })
      .map((h) => ({ wallet: h.proxy_wallet.toLowerCase(), name: h.name?.trim() || h.pseudonym?.trim() || "", shares: h.amount, outcomeIndex: h.outcome_index ?? 0 }))
      .sort((a, b) => b.shares - a.shares),
  }));
}

const oiShape = z.object({ data: z.array(z.object({ condition_id: z.string(), value: amount })).min(1) });

export function parseOpenInterest(raw: unknown): number {
  const parsed = oiShape.safeParse(raw);
  if (!parsed.success) throw new PolymarketUnavailable("open interest has an unknown shape");
  return parsed.data.data[0]!.value;
}

/// Where the money went since `sinceSec`. Buying an outcome, or selling the other one, is money
/// toward that outcome.
export function flowOf(trades: Trade[], sinceSec: number): Flow {
  const recent = trades.filter((t) => t.at >= sinceSec);
  let first = 0;
  let second = 0;
  for (const t of recent) {
    const towardFirst = (t.outcomeIndex === 0) === (t.side === "buy");
    if (towardFirst) first += t.usd; else second += t.usd;
  }
  return {
    towardFirstUsd: round2(first),
    towardSecondUsd: round2(second),
    netTowardFirstUsd: round2(first - second),
    count: recent.length,
    wallets: new Set(recent.map((t) => t.wallet)).size,
    largest: [...recent].sort((a, b) => b.usd - a.usd).slice(0, 3),
  };
}
