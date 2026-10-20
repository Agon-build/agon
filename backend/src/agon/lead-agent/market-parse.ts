import type { Hex } from "viem";

/// eventTitle names the event a market sits in ("Paris Saint-Germain FC vs. FC Barcelona"), when the seller sends it.
export type MarketCandidate = { conditionId: Hex; question: string; slug: string; endDate: string; yesPriceBps: number | null; eventTitle?: string };

function yesPrice(o: Record<string, unknown>): number | null {
  if (typeof o.yesPriceBps === "number" && o.yesPriceBps >= 0 && o.yesPriceBps <= 10_000) return Math.round(o.yesPriceBps);
  let prices: unknown = o.outcomePrices;
  let outcomes: unknown = o.outcomes;
  try {
    if (typeof prices === "string") prices = JSON.parse(prices);
    if (typeof outcomes === "string") outcomes = JSON.parse(outcomes);
  } catch {
    return null;
  }
  if (Array.isArray(prices) && Array.isArray(outcomes) && outcomes[0] === "Yes") {
    const p = Number(prices[0]);
    if (Number.isFinite(p) && p >= 0 && p <= 1) return Math.round(p * 10_000);
  }
  for (const key of ["yesPrice", "lastTradePrice", "probability"]) {
    const p = Number(o[key]);
    if (typeof o[key] !== "undefined" && Number.isFinite(p) && p >= 0 && p <= 1) return Math.round(p * 10_000);
  }
  return null;
}

/// Walks any JSON payload (the stand-in, BlockRun, or a wrapper around either)
/// and collects objects that look like a Polymarket market. Defensive on
/// purpose: a seller's response shape can change without notice.
export function findMarkets(payload: unknown): MarketCandidate[] {
  const out = new Map<string, MarketCandidate>();
  let visited = 0;
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || visited++ > 2_000 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    if (typeof o.conditionId === "string" && /^0x[0-9a-fA-F]{64}$/.test(o.conditionId) && typeof o.question === "string") {
      const id = o.conditionId.toLowerCase();
      if (!out.has(id)) {
        out.set(id, {
          conditionId: id as Hex, question: o.question, slug: typeof o.slug === "string" ? o.slug : "",
          endDate: typeof o.endDate === "string" ? o.endDate : "", yesPriceBps: yesPrice(o),
          ...(typeof o.eventTitle === "string" && o.eventTitle ? { eventTitle: o.eventTitle } : {}),
        });
      }
    }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return [...out.values()];
}

export function priceFromPayload(payload: unknown, coinId: string): number | null {
  let found: number | null = null;
  const walk = (node: unknown, depth: number) => {
    if (found !== null || depth > 5 || node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const hit = o[coinId] as Record<string, unknown> | undefined;
    if (hit && typeof hit.price === "number" && Number.isFinite(hit.price)) {
      found = hit.price;
      return;
    }
    for (const value of Object.values(o)) walk(value, depth + 1);
  };
  walk(payload, 0);
  return found;
}

const STOP = new Set([
  "what", "whats", "is", "the", "chance", "of", "will", "spend", "up", "to", "usdc", "a", "an", "on", "by", "be", "price", "that", "this", "it", "for", "in", "at", "and", "or",
  "close", "closes", "closing", "end", "ends", "today", "tomorrow", "week", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Words about trading the market rather than its subject; Polymarket questions rarely contain them.
  "market", "markets", "polymarket", "worth", "trading", "trade", "bet", "betting", "odds", "likely", "probability", "should", "buy", "sell",
  "good", "now", "do", "does", "how", "you", "your", "my", "me", "can", "are",
  // Question words; Polymarket search treats them as subject words and drifts to unrelated events.
  "who", "whom", "which", "when", "where", "why", "between", "vs", "versus", "against", "than", "there", "game", "match", "happen", "happens",
  "did", "was", "were", "has", "have", "had", "get", "gets", "from", "with", "its", "if", "not", "about", "any", "tonight", "think", "going", "year",
]);
const SYNONYMS: Record<string, string> = {
  btc: "bitcoin", eth: "ethereum", ether: "ethereum", sol: "solana",
  // Price questions say hit, Polymarket says reach: "Will Bitcoin reach $120,000 by December 31?".
  hit: "reach", hits: "reach", reaches: "reach",
  // Polymarket match markets ask "Will <team> win on <date>?".
  beat: "win", beats: "win", defeat: "win", defeats: "win", wins: "win", winner: "win",
  // Polymarket names the party and asks who will control a chamber: "Will the Democratic Party control the Senate?".
  democrat: "democratic", democrats: "democratic", control: "win", controls: "win", keep: "win", keeps: "win",
};
/// Short names spelled the way Polymarket titles its markets. Applied before splitting into words.
const ALIASES: [RegExp, string][] = [
  [/\breal (chance|odds|probability)\b/g, "$1"],
  [/\bpsg\b/g, "paris saint germain"],
  [/\bbarca\b/g, "barcelona"],
  [/\bman (utd|united)\b/g, "manchester united"],
  [/\bman city\b/g, "manchester city"],
  [/\bgop\b/g, "republican"],
  [/\bdems\b/g, "democrats"],
];
// Kept for matching but not searched for: every match market says "win".
const NOT_SEARCHED = new Set(["win"]);

function tokens(text: string): string[] {
  let t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (const [pattern, to] of ALIASES) t = t.replace(pattern, to);
  return t
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/\$/g, "")
    .replace(/(\d+(?:\.\d+)?)k\b/g, (_m, n) => String(Math.round(Number(n) * 1000)))
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, ""))
    .map((t) => SYNONYMS[t] ?? t)
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^0?\.\d+$/.test(t));
}

/// Plural and singular match each other ("democrats", "democrat"). Only for matching, never searched.
const stem = (t: string) => (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);

const searchWords = (question: string) => tokens(question).filter((t) => !NOT_SEARCHED.has(t));

export function searchQueryFor(question: string): string {
  return searchWords(question).slice(0, 6).join(" ");
}

/// A second, wider search: the first name in the question on its own. Null when it adds nothing.
export function fallbackQueryFor(question: string): string | null {
  const first = searchWords(question).find((t) => t.length >= 4 && !/^\d/.test(t));
  return first && first !== searchQueryFor(question) ? first : null;
}

type Scored = { m: MarketCandidate; score: number; positions: number[]; extra: number; rank: number };

const isNumber = (t: string) => /^\d/.test(t);
// "Barcelona vs PSG", "Will City beat Liverpool": a market that names only one side answers something else.
const MATCHUP = /\b(beat|beats|defeat|defeats|vs|versus|against|between)\b/i;
// "Will there be a shutdown ... and will the Democrats win the House?" answers two questions at once.
const COMBINED = /\band (will|the (democratic|republican) party win)\b/i;

const marketWords = (m: MarketCandidate) => new Set([...tokens(m.question), ...tokens(m.eventTitle ?? "")].map(stem));

/// The question's most specific words: of the words that markets near the
/// question share with it, the ones the fewest of them contain ("shutdown",
/// not "us" or "government"). A market must contain one of them.
function specificWords(markets: MarketCandidate[], want: string[]): Set<string> {
  const near = markets.map(marketWords).filter((words) => want.filter((t) => words.has(t)).length >= 2);
  const counts = want.filter((t) => t !== "win").map((t) => [t, near.filter((words) => words.has(t)).length] as const).filter(([, n]) => n > 0);
  const fewest = Math.min(...counts.map(([, n]) => n));
  return new Set(counts.filter(([, n]) => n === fewest).map(([t]) => t));
}

function scoreMarket(m: MarketCandidate, want: string[], rank: number, matchup: boolean, combined: boolean, specific: Set<string>): Scored {
  const inQuestion = new Set(tokens(m.question).map(stem));
  const inMarket = marketWords(m);
  let score = 0;
  const positions: number[] = [];
  want.forEach((t, i) => {
    if (inMarket.has(t)) score += isNumber(t) ? 3 : 1;
    if (inQuestion.has(t)) positions.push(i);
  });
  // A question that names a number ($120k, 2026, the 30th) is about that number.
  const numbers = want.filter(isNumber);
  if (numbers.length > 0 && !numbers.some((t) => inMarket.has(t))) score = 0;
  if (matchup && want.some((t) => t !== "win" && !isNumber(t) && !inMarket.has(t))) score = 0;
  if (!combined && COMBINED.test(m.question)) score = 0;
  if (specific.size > 0 && ![...specific].some((t) => inMarket.has(t))) score = 0;
  if (score >= 2 && m.yesPriceBps !== null) score += 0.5;
  return { m, score, positions, extra: [...inQuestion].filter((t) => !want.includes(t)).length, rank };
}

/// Ties inside one event go to the market whose own question names what the
/// person named first ("Barcelona and PSG" picks the Barcelona market). Ties
/// across events go to the market whose own question covers more of the
/// question, then to the one that adds the least to it (a combined "X and Y"
/// market loses to plain X), then to the one the search ranked first, then
/// the earlier end.
function better(a: Scored, b: Scored): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.m.eventTitle && a.m.eventTitle === b.m.eventTitle) {
    for (let i = 0; i < Math.max(a.positions.length, b.positions.length); i++) {
      const x = a.positions[i] ?? Infinity;
      const y = b.positions[i] ?? Infinity;
      if (x !== y) return x < y;
    }
  }
  if (a.positions.length !== b.positions.length) return a.positions.length > b.positions.length;
  if (a.extra !== b.extra) return a.extra < b.extra;
  if (a.rank !== b.rank) return a.rank < b.rank;
  return a.m.endDate < b.m.endDate;
}

/// The best open market for the question. When the best match has already
/// passed its end date (a game that kicked off) and no open market matches as
/// well, it is returned as started instead of a weaker substitute.
export function matchMarket(markets: MarketCandidate[], question: string, now: Date): { market: MarketCandidate | null; started: MarketCandidate | null } {
  const want = [...new Set(tokens(question).map(stem))];
  const matchup = MATCHUP.test(question);
  const combined = COMBINED.test(question);
  const specific = specificWords(markets, want);
  let open: Scored | null = null;
  let ended: Scored | null = null;
  for (const [rank, m] of markets.entries()) {
    const s = scoreMarket(m, want, rank, matchup, combined, specific);
    if (s.score < 2) continue;
    const isOpen = !m.endDate || new Date(m.endDate).getTime() > now.getTime();
    if (isOpen && (!open || better(s, open))) open = s;
    if (!isOpen && (!ended || better(s, ended))) ended = s;
  }
  if (ended && (!open || ended.score > open.score)) return { market: null, started: ended.m };
  return { market: open?.m ?? null, started: null };
}

export function pickMarket(markets: MarketCandidate[], question: string, now: Date): MarketCandidate | null {
  return matchMarket(markets, question, now).market;
}
