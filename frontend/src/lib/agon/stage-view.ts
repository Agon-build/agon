import { SEASON_CATEGORY_TABS, type BargainStep, type HistoryItem, type LeaderboardResponse, type LeaderboardRow, type LivePhase, type RatingsResponse, type ReceiptNode, type SeasonEntry, type StageAnswer, type StageEvent, type StageEventKind } from "./stage-types.ts";

export type FlowStatus = "pending" | "settled" | "failed";
export type FlowNode = { id: string; role: "lead" | "data" | "forecaster" | "refund"; label: string; sublabel: string; amount: string; status: FlowStatus; txUrl: string | null };
export type FlowModel = { lead: FlowNode | null; sellers: FlowNode[]; refund: FlowNode | null; agentSpend: string };
export type LedgerRow = { key: string; offset: string; text: string; kind: StageEventKind };
export type HaggleRow = { key: string; side: "seller" | "agon" | "deal" | "walk"; label: string; amount: string | null };
export type ProbabilityComparison = { agonPct: number; marketPct: number | null; deltaPts: number | null; sentence: string };

export function parseUsdcText(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

export function formatUsdcAtomic(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  let frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${whole}.${frac}`;
}

const status = (s: string): FlowStatus => (s === "settled" ? "settled" : s === "failed" ? "failed" : "pending");
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/// The receipt tree as a money flow: you pay the lead agent, the lead agent
/// pays data sellers and forecasters. Only settled payments count as spent.
export function moneyFlow(receipt: ReceiptNode | null): FlowModel {
  if (!receipt) return { lead: null, sellers: [], refund: null, agentSpend: "0.00" };
  const userPayment = receipt.payments.find((p) => p.kind === "hire");
  const lead: FlowNode = {
    id: receipt.jobId, role: "lead", label: receipt.label, sublabel: "Built by Agon", amount: userPayment?.amount ?? receipt.price,
    status: userPayment ? status(userPayment.status) : "pending", txUrl: userPayment?.txUrl ?? null,
  };
  const sellers: FlowNode[] = [];
  receipt.payments.filter((p) => p.kind === "data").forEach((p, i) => {
    const [what, seller] = (p.detail ?? "Data").split(" from ");
    sellers.push({ id: `${receipt.jobId}-data-${i}`, role: "data", label: seller ?? "Data seller", sublabel: capital(what ?? "Data"), amount: p.amount, status: status(p.status), txUrl: p.txUrl });
  });
  for (const child of receipt.children) {
    const pay = child.payments.find((p) => p.kind === "hire");
    sellers.push({ id: child.jobId, role: "forecaster", label: child.label, sublabel: "Forecaster", amount: pay?.amount ?? child.price, status: pay ? status(pay.status) : "pending", txUrl: pay?.txUrl ?? null });
  }
  const refundPay = receipt.payments.find((p) => p.kind === "refund");
  const refund: FlowNode | null = refundPay
    ? { id: `${receipt.jobId}-refund`, role: "refund", label: "Refund to you", sublabel: refundPay.detail ?? "Refund", amount: refundPay.amount, status: status(refundPay.status), txUrl: refundPay.txUrl }
    : null;
  let spent = 0n;
  for (const s of sellers) if (s.status === "settled") spent += parseUsdcText(s.amount) ?? 0n;
  return { lead, sellers, refund, agentSpend: formatUsdcAtomic(spent) };
}

export function ledgerRows(events: StageEvent[], startedAt: string | null): LedgerRow[] {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  return events.map((e, i) => {
    const at = Date.parse(e.at);
    const offset = Number.isNaN(start) || Number.isNaN(at) ? "" : `+${Math.max(0, (at - start) / 1000).toFixed(1)}s`;
    return { key: `${i}-${e.at}`, offset, text: e.text, kind: e.kind };
  });
}

export function moneySegments(text: string): { text: string; money: boolean }[] {
  return text.split(/(\d+(?:\.\d+)? USDC)/).filter(Boolean).map((part) => ({ text: part, money: /^\d+(?:\.\d+)? USDC$/.test(part) }));
}

const amountIn = (detail: string) => /(\d+(?:\.\d+)?) USDC/.exec(detail)?.[1] ?? null;

export function haggleRows(steps: BargainStep[]): HaggleRow[] {
  return steps.map((s, i) => {
    const key = `${i}-${s.step}`;
    if (s.step === "request") return { key, side: "seller", label: "Listed at", amount: amountIn(s.detail) };
    if (s.step === "offer") return { key, side: "agon", label: "Offered", amount: amountIn(s.detail) };
    if (s.step === "counter") return { key, side: "seller", label: "Countered", amount: amountIn(s.detail) };
    if (s.step === "accept") return { key, side: "deal", label: "Agreed", amount: amountIn(s.detail) };
    if (s.step === "pay") return { key, side: "agon", label: "Paid", amount: amountIn(s.detail) };
    return { key, side: "walk", label: "Walked away", amount: null };
  });
}

export function haggleSummary(steps: BargainStep[]): { asked: string; agreed: string; percentOff: number } | null {
  const asked = steps.find((s) => s.step === "request");
  const agreed = steps.find((s) => s.step === "accept");
  const a = asked ? amountIn(asked.detail) : null;
  const b = agreed ? amountIn(agreed.detail) : null;
  const av = a ? parseUsdcText(a) : null;
  const bv = b ? parseUsdcText(b) : null;
  if (!a || !b || !av || bv === null) return null;
  return { asked: a, agreed: b, percentOff: Math.round(Number(((av - bv) * 100n * 1000n) / av) / 1000) };
}

export function compareProbability(answer: StageAnswer): ProbabilityComparison {
  const agonPct = Math.round(answer.probabilityBps / 100);
  if (answer.marketPriceBps === null) return { agonPct, marketPct: null, deltaPts: null, sentence: "No market price to compare" };
  const marketPct = Math.round(answer.marketPriceBps / 100);
  const deltaPts = agonPct - marketPct;
  const n = Math.abs(deltaPts);
  const sentence = deltaPts === 0 ? "Level with the market" : `${n} point${n === 1 ? "" : "s"} ${deltaPts < 0 ? "below" : "above"} the market`;
  return { agonPct, marketPct, deltaPts, sentence };
}

export function phaseStep(phase: LivePhase | "idle" | "quote"): 0 | 1 | 2 | 3 {
  if (phase === "idle") return 0;
  if (phase === "quote" || phase === "quoted") return 1;
  if (phase === "paying" || phase === "working") return 2;
  return 3;
}

/// "quoted" means nothing was paid; it is final unless a payment is in flight (callers keep polling then).
export const isTerminal = (phase: LivePhase) => phase === "quoted" || phase === "answered" || phase === "refunded" || phase === "failed";

export function formatCountdown(expiresAt: string, nowMs: number): string {
  const left = Math.max(0, Math.floor((Date.parse(expiresAt) - nowMs) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export const shortHash = (hash: string) => (hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash);
export const explorerBase = (commitsUrl: string) => commitsUrl.replace(/\/address\/.*$/, "");

export function timeAgo(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function beatsMarketText(row: LeaderboardRow): string {
  if (!row.ranked) return `${row.forecastsResolved} scored forecasts so far; ranking starts at 20`;
  const by = Math.abs(row.meanSkill).toFixed(3);
  return `${row.meanSkill >= 0 ? "Beat" : "Behind"} the market by ${by} over ${row.forecastsResolved} forecasts`;
}

export function flattenPayments(receipt: ReceiptNode | null): { key: string; what: string; from: string; to: string; amount: string; status: FlowStatus; txUrl: string | null }[] {
  if (!receipt) return [];
  const rows: { key: string; what: string; from: string; to: string; amount: string; status: FlowStatus; txUrl: string | null }[] = [];
  receipt.payments.forEach((p, i) => {
    const key = `${receipt.jobId}-${i}`;
    if (p.kind === "hire") rows.push({ key, what: "Hire", from: receipt.buyer === "you" ? "You" : receipt.buyer, to: receipt.label, amount: p.amount, status: status(p.status), txUrl: p.txUrl });
    else if (p.kind === "data") {
      const [what, seller] = (p.detail ?? "Data").split(" from ");
      rows.push({ key, what: capital(what ?? "Data"), from: receipt.label, to: seller ?? "Data seller", amount: p.amount, status: status(p.status), txUrl: p.txUrl });
    } else if (p.kind === "refund") rows.push({ key, what: "Refund", from: receipt.label, to: "You", amount: p.amount, status: status(p.status), txUrl: p.txUrl });
  });
  for (const child of receipt.children) {
    child.payments.filter((p) => p.kind === "hire").forEach((p, i) => rows.push({ key: `${child.jobId}-${i}`, what: "Forecast", from: receipt.label, to: child.label, amount: p.amount, status: status(p.status), txUrl: p.txUrl }));
  }
  return rows;
}

export function ratingForAgent(agentId: string, entries: SeasonEntry[], rows: LeaderboardRow[]): LeaderboardRow | null {
  const entry = entries.find((e) => e.erc8004AgentId === agentId);
  if (!entry) return null;
  return rows.find((r) => r.agentAddress.toLowerCase() === entry.agentAddress.toLowerCase()) ?? null;
}

/// One cell per Arena tab for an agent: its rank, a provisional count, or nothing yet.
export function categoryCells(ratings: RatingsResponse, agentAddress: string): { key: string; label: string; text: string }[] {
  const agent = ratings.agents.find((a) => a.agentAddress.toLowerCase() === agentAddress.toLowerCase());
  if (!agent) return [];
  return SEASON_CATEGORY_TABS.map((t) => {
    const c = t.key === "overall" ? agent.overall : agent.categories[t.key];
    const min = t.key === "overall" ? ratings.minRanked.overall : ratings.minRanked.category;
    const text = c.forecastsResolved === 0 ? "No forecasts yet"
      : c.ranked && c.rank ? (t.key === "overall" ? `#${c.rank} of ranked · ${c.forecastsResolved} scored` : `#${c.rank} · ${c.forecastsResolved} scored`)
      : `Provisional · ${c.forecastsResolved} of ${min}`;
    return { key: t.key, label: t.label, text };
  });
}

const CATEGORY_LABEL: Record<string, string> = { overall: "Overall", crypto: "Crypto", politics: "Politics", sports: "Sports", economics: "Economics", world: "World", culture: "Culture" };

/// A plain line above the table when the board cannot rank anyone yet.
export function boardNotice(board: LeaderboardResponse): string | null {
  const min = board.minRanked ?? 20;
  const cat = board.category ?? "overall";
  if (board.rows.every((r) => r.forecastsResolved === 0) && cat !== "overall") return `No ${CATEGORY_LABEL[cat] ?? cat} forecasts have been scored yet. Rankings appear after ${min} scored forecasts.`;
  if (!board.rows.some((r) => r.ranked)) return `Rankings appear after ${min} scored forecasts. Agents below that are shown as provisional.`;
  return null;
}

/// Account hire history: newest first, each with its receipt.
export function historyRows(items: HistoryItem[], nowMs: number): { jobId: string; when: string; label: string; amount: string; state: string; href: string }[] {
  return [...items]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((h) => ({
      jobId: h.jobId, when: timeAgo(h.createdAt, nowMs), label: h.question ?? "Agent job", amount: h.price,
      state: h.state.charAt(0).toUpperCase() + h.state.slice(1), href: `/r/${h.jobId}`,
    }));
}

/// The Season page address for a tab, keeping every other parameter (stage mode, network).
export function categoryHref(search: string, key: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (key === "overall") params.delete("category"); else params.set("category", key);
  const query = params.toString();
  return `/arena/season-1${query ? `?${query}` : ""}`;
}
