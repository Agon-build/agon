import { costToTrade, depthWithin, flowOf } from "../polymarket/index.ts";
import type { Book, HoldersOf, PricePoint, Read, Trade, TradeCost } from "../polymarket/index.ts";
import type { MarketSnapshot } from "./market-lookup.ts";

export type ScoutFlag = {
  code:
    | "thin_liquidity" | "wide_spread" | "low_activity" | "closing_soon" | "extreme_price" | "vague_rules"
    | "not_accepting_orders" | "settlement_started" | "book_too_thin" | "size_moves_price";
  detail: string;
};

/// What the buyer asked Scout to price: which side, and how many dollars.
export type ScoutAsk = { sideIndex: 0 | 1; sizeUsd: number; sizeGiven: boolean };
/// What Scout read from Polymarket for one answer. Only the order book is required.
export type ScoutReads = {
  book: Read<Book>;
  history: Read<PricePoint[]> | null;
  trades: Read<Trade[]> | null;
  holders: Read<HoldersOf[]> | null;
  openInterest: Read<number> | null;
};

export type ScoutTrade = {
  side: string;
  sizeUsd: number;
  sizeGiven: boolean;
  buy: TradeCost;
  sell: TradeCost;
  depth: { withinCents: number; bidUsd: number; askUsd: number };
};
export type ScoutFlow = {
  /** How far back the trades reach: 24, or less when Polymarket's newest 500 trades are all more recent. */
  hours: number;
  complete: boolean;
  toward: [{ label: string; usd: number }, { label: string; usd: number }];
  net: { label: string; usd: number } | null;
  trades: number;
  wallets: number;
  largest: { usd: number; side: "buy" | "sell"; outcome: string; price: number; at: string; wallet: string }[];
};
export type ScoutHolders = {
  sides: { label: string; top: { name: string; shares: number; valueUsd: number }[]; valueUsd: number }[];
  openInterestUsd: number | null;
  /** The top five of each side, at today's prices, as a share of open interest. Null when the two cannot be compared. */
  topFiveSharePct: number | null;
};
export type ScoutVolatility = { dayRangePts: number; weekRangePts: number; typicalHourlyMovePts: number };
export type ScoutSource = { what: "book" | "history" | "trades" | "holders" | "openInterest"; source: string; readAt: string; ageMs: number };

export type ScoutReport = {
  verdict: "tradeable" | "watch" | "avoid";
  flags: ScoutFlag[];
  metrics: { yesPct: number; spreadCents: number; liquidityUsd: number; volume24hUsd: number; weekMovePts: number; hoursLeft: number };
  resolution: "open" | "proposed" | "disputed";
  trade?: ScoutTrade;
  flow?: ScoutFlow | null;
  holders?: ScoutHolders | null;
  volatility?: ScoutVolatility | null;
  sources?: ScoutSource[];
  unavailable?: string[];
};

export const SCOUT_DEFAULT_SIZE_USD = 100;
export const SCOUT_MIN_SIZE_USD = 1;
export const SCOUT_MAX_SIZE_USD = 1_000_000;
/// The most trades one answer reads; when they do not reach back 24 hours the answer says so.
export const SCOUT_TRADES = 500;
export const SCOUT_TOP_HOLDERS = 5;
export const SCOUT_DEPTH_CENTS = 2;
const SLIPPAGE_FLAG_CENTS = 2;

const VAGUE = /(sole discretion|at the discretion|subjective|in the event of uncertainty)/i;
const CONSENSUS = /consensus of credible/i;
const OFFICIAL = /(primary resolution source|official (information|results|announcement|data)|according to the official)/i;

/// Vague when a judgment call decides it, or credible reporting is the only source named.
function vagueRules(description: string): boolean {
  if (description.trim().length < 40 || VAGUE.test(description)) return true;
  return CONSENSUS.test(description) && !OFFICIAL.test(description);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const SIZE = /^\$?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(k|m)?\s*(?:usd|usdc|dollars?)?$/i;

/// A size as people write it: 500, "500", "$1,500", "2k", "500 usd". Null when it is not an amount.
function sizeFrom(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = SIZE.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, "")) * (m[2] ? (m[2].toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(n) ? n : null;
}
const given = (v: unknown) => v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");

/// The side and size a request names. A missing size is 100 dollars and a missing side is the
/// market's first outcome; a size that is not an amount, or a side the market does not have, is refused.
export function scoutAsk(m: Pick<MarketSnapshot, "outcomes">, raw: { size?: unknown; side?: unknown }): { ok: true; ask: ScoutAsk } | { ok: false; code: "invalid_size" | "unknown_side" } {
  let sizeUsd = SCOUT_DEFAULT_SIZE_USD;
  if (given(raw.size)) {
    const n = sizeFrom(raw.size);
    if (n === null || n < SCOUT_MIN_SIZE_USD || n > SCOUT_MAX_SIZE_USD) return { ok: false, code: "invalid_size" };
    sizeUsd = round2(n);
  }
  let sideIndex: 0 | 1 = 0;
  if (given(raw.side)) {
    const want = String(raw.side).trim().toLowerCase();
    const at = m.outcomes.findIndex((o) => o.label.trim().toLowerCase() === want);
    if (at !== 0 && at !== 1) return { ok: false, code: "unknown_side" };
    sideIndex = at;
  }
  return { ok: true, ask: { sideIndex, sizeUsd, sizeGiven: given(raw.size) } };
}

const shortWallet = (w: string) => (w.length > 12 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w);

function flowFor(m: MarketSnapshot, trades: Trade[], now: Date): ScoutFlow {
  const nowSec = Math.floor(now.getTime() / 1_000);
  const since = nowSec - 86_400;
  const oldest = trades.reduce((min, t) => Math.min(min, t.at), Number.POSITIVE_INFINITY);
  // Polymarket gave its newest trades only; when all of them are inside the day, the day is not whole.
  const complete = !(trades.length >= SCOUT_TRADES && oldest > since);
  const f = flowOf(trades, since);
  const [a, b] = m.outcomes;
  return {
    hours: complete ? 24 : Math.max(0.1, round1((nowSec - oldest) / 3_600)),
    complete,
    toward: [{ label: a.label, usd: f.towardFirstUsd }, { label: b.label, usd: f.towardSecondUsd }],
    net: f.netTowardFirstUsd === 0 ? null : { label: f.netTowardFirstUsd > 0 ? a.label : b.label, usd: Math.abs(f.netTowardFirstUsd) },
    trades: f.count,
    wallets: f.wallets,
    largest: f.largest.map((t) => ({
      usd: t.usd, side: t.side, outcome: m.outcomes[t.outcomeIndex === 1 ? 1 : 0].label, price: t.price,
      at: new Date(t.at * 1_000).toISOString(), wallet: shortWallet(t.wallet),
    })),
  };
}

function holdersFor(m: MarketSnapshot, groups: HoldersOf[], openInterest: number | null): ScoutHolders {
  const sides = m.outcomes.map((o, i) => {
    // By the outcome's token; when Gamma gave no token id, by the side each holder is on.
    const group = o.tokenId !== "" ? groups.find((g) => g.tokenId === o.tokenId) : groups.find((g) => g.holders.length > 0 && g.holders.every((h) => h.outcomeIndex === i));
    const top = (group?.holders ?? []).slice(0, SCOUT_TOP_HOLDERS).map((h) => ({ name: h.name || shortWallet(h.wallet), shares: round2(h.shares), valueUsd: round2(h.shares * o.price) }));
    return { label: o.label, top, valueUsd: round2(top.reduce((s, h) => s + h.valueUsd, 0)) };
  });
  const held = sides.reduce((s, x) => s + x.valueUsd, 0);
  // Open interest is priced collateral; on a negative-risk market holdings are not held against it one to one.
  const share = !m.negRisk && openInterest !== null && openInterest > 0 && held > 0 ? round1((held / openInterest) * 100) : null;
  return { sides, openInterestUsd: openInterest === null ? null : round2(openInterest), topFiveSharePct: share !== null && share <= 100 ? share : null };
}

function volatilityFor(points: PricePoint[], now: Date): ScoutVolatility | null {
  if (points.length < 2) return null;
  const since = Math.floor(now.getTime() / 1_000) - 86_400;
  const range = (ps: PricePoint[]) => (ps.length === 0 ? 0 : round1((Math.max(...ps.map((p) => p.price)) - Math.min(...ps.map((p) => p.price))) * 100));
  let moved = 0;
  for (let i = 1; i < points.length; i += 1) moved += Math.abs(points[i]!.price - points[i - 1]!.price);
  return { dayRangePts: range(points.filter((p) => p.at >= since)), weekRangePts: range(points), typicalHourlyMovePts: round2((moved / (points.length - 1)) * 100) };
}

/// Scout's check is fixed rules over Polymarket's own numbers, so the same market, size and
/// book always get the same verdict. Flags come in a stable order. With `detail`, the answer
/// also prices the buyer's size against the order book and reports flow, holders and price swings.
export function scoutReport(m: MarketSnapshot, now: Date, detail?: { ask: ScoutAsk; reads: ScoutReads }): ScoutReport {
  const hoursLeft = round2((m.endAt.getTime() - now.getTime()) / 3_600_000);
  const metrics = {
    yesPct: m.yesBps / 100,
    spreadCents: round2(m.spread * 100),
    liquidityUsd: Math.round(m.liquidity),
    volume24hUsd: Math.round(m.volume24h),
    weekMovePts: round2(m.weekChange * 100),
    hoursLeft,
  };
  const statuses = m.umaStatuses ?? [];
  const resolution = statuses.length === 0 ? "open" : statuses.at(-1) === "disputed" ? "disputed" : "proposed";
  const flags: ScoutFlag[] = [];
  if (m.liquidity < 10_000) flags.push({ code: "thin_liquidity", detail: `Only ${usd(m.liquidity)} of liquidity; larger orders will move the price.` });
  if (m.spread > 0.03) flags.push({ code: "wide_spread", detail: `The spread is ${metrics.spreadCents} cents, so entering and leaving costs that much.` });
  if (m.volume24h < 500) flags.push({ code: "low_activity", detail: `Only ${usd(m.volume24h)} traded in the last 24 hours.` });
  if (hoursLeft < 24) flags.push({ code: "closing_soon", detail: `Closes in ${Math.max(0, Math.round(hoursLeft))} hours.` });
  if (m.yesBps < 300 || m.yesBps > 9_700) flags.push({ code: "extreme_price", detail: `${m.outcomes[0].label} is at ${metrics.yesPct}%, close to settled either way; little upside left.` });
  if (vagueRules(m.description)) flags.push({ code: "vague_rules", detail: "The resolution rules leave room for judgment; read them before trading." });
  if (m.acceptingOrders === false) flags.push({ code: "not_accepting_orders", detail: "Polymarket is not taking orders on this market right now." });
  if (resolution !== "open") flags.push({ code: "settlement_started", detail: resolution === "disputed" ? "A proposed result is being disputed; the market is settling." : "A result has been proposed; the market is settling." });

  let extra: Pick<ScoutReport, "trade" | "flow" | "holders" | "volatility" | "sources" | "unavailable"> = {};
  if (detail) {
    const { ask, reads } = detail;
    const side = m.outcomes[ask.sideIndex].label;
    const buy = costToTrade(reads.book.value, "buy", ask.sizeUsd);
    const sell = costToTrade(reads.book.value, "sell", ask.sizeUsd);
    if (buy.unfilledUsd > 0) flags.push({ code: "book_too_thin", detail: `The order book fills only ${usd(buy.filledUsd)} of a ${usd(ask.sizeUsd)} buy of ${side}.` });
    else if ((buy.slippageCents ?? 0) > SLIPPAGE_FLAG_CENTS) flags.push({ code: "size_moves_price", detail: `A ${usd(ask.sizeUsd)} buy of ${side} pays ${buy.slippageCents} cents a share above the best price.` });
    const read = <T,>(what: ScoutSource["what"], r: Read<T> | null): ScoutSource[] => (r ? [{ what, source: r.source, readAt: r.readAt, ageMs: r.ageMs }] : []);
    extra = {
      trade: { side, sizeUsd: ask.sizeUsd, sizeGiven: ask.sizeGiven, buy, sell, depth: { withinCents: SCOUT_DEPTH_CENTS, ...depthWithin(reads.book.value, SCOUT_DEPTH_CENTS) } },
      flow: reads.trades ? flowFor(m, reads.trades.value, now) : null,
      holders: reads.holders ? holdersFor(m, reads.holders.value, reads.openInterest?.value ?? null) : null,
      volatility: reads.history ? volatilityFor(reads.history.value, now) : null,
      sources: [...read("book", reads.book), ...read("history", reads.history), ...read("trades", reads.trades), ...read("holders", reads.holders), ...read("openInterest", reads.openInterest)],
      unavailable: [...(reads.trades ? [] : ["flow"]), ...(reads.holders ? [] : ["holders"]), ...(reads.openInterest ? [] : ["openInterest"]), ...(reads.history ? [] : ["volatility"])],
    };
  }
  const has = (code: ScoutFlag["code"]) => flags.some((f) => f.code === code);
  const stop = (has("thin_liquidity") && has("wide_spread")) || has("not_accepting_orders") || has("book_too_thin");
  const verdict = flags.length >= 3 || stop ? "avoid" : flags.length > 0 ? "watch" : "tradeable";
  return { verdict, flags, metrics, resolution, ...extra };
}

export function scoutRulesPrompt(m: MarketSnapshot): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: "You read prediction market rules. In one plain sentence under 30 words, say what source decides this market and the main way it could resolve unexpectedly. No preamble.",
    userPrompt: `Question: ${m.question}\nRules: ${m.description.slice(0, 1_500)}`,
  };
}
