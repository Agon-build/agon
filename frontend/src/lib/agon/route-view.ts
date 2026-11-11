import type { StageAnswer } from "./stage-types.ts";

/// Words for a routed hire: where the agent comes from, how far Agon trusts it,
/// what it costs with the routing fee, and which money it uses.
export type RouteRating = { tier: "scored" | "verified" | "listed" | "unrated"; score: number | null };

/// A fee above zero; a direct hire carries none.
export function hasFee(fee: string | undefined): boolean {
  return fee !== undefined && /^\d+(\.\d+)?$/.test(fee) && Number(fee) > 0;
}

export function priceLines(p: { price: string; fee?: string; total?: string }): { label: string; value: string }[] {
  const lines = [{ label: "Price", value: `${p.price} USDC` }];
  if (p.fee !== undefined && p.total && !hasFee(p.fee)) lines.push({ label: "Agon routing fee", value: "None" });
  else if (p.fee && p.total) lines.push({ label: "Agon routing fee", value: `${p.fee} USDC` }, { label: "Total", value: `${p.total} USDC` });
  return lines;
}

/// A listing that names its input fields, so Agon can fill them from a task in plain words.
export function hasNamedInputs(body: unknown): boolean {
  const props = (body as { invocation?: { requestSchema?: { properties?: unknown } } } | null | undefined)?.invocation?.requestSchema?.properties;
  return Boolean(props && typeof props === "object" && !Array.isArray(props) && Object.keys(props).length > 0);
}

export function sourceLabel(e: { source: "agon" | "circle"; provider: string; rating: RouteRating }): string {
  if (e.source === "circle") return `Circle, ${e.provider}, Not rated by Agon`;
  if (e.rating.tier === "scored") return `Agon, Verified, score ${e.rating.score}`;
  return e.rating.tier === "verified" ? "Agon, Verified" : "Agon, Listed";
}

export function networkLabel(network: "arc-testnet" | "arc"): string {
  return network === "arc" ? "Real USDC on Arc mainnet" : "Test USDC on Arc Testnet";
}

export function inputRows(input: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(input).map(([label, v]) => ({ label, value: typeof v === "string" ? v : JSON.stringify(v) }));
}

export type RulesAnswerView = {
  kind: "rules"; risk: "low" | "medium" | "high"; riskText: string; marketQuestion: string | null; marketUrl: string | null;
  decides: { label: string; text: string; quote: string }[]; traps: { label: string; explain: string; quote: string }[];
};
/// A Scout market check: the verdict, Polymarket's own numbers read at that moment, and each flag.
export type ScoutAnswerView = {
  kind: "scout"; verdict: "tradeable" | "watch" | "avoid"; verdictText: string; marketQuestion: string; marketUrl: string | null;
  metrics: { label: string; value: string }[]; flags: string[]; rulesNote: string | null; readLine: string | null;
};
/// A forecast from one of Agon's market agents, shown against the crowd price like a Lead forecast.
export type ForecastAnswerView = { kind: "forecast"; answer: StageAnswer; sources: { title: string; url: string; published: string | null }[]; readLine: string | null };
/// An image a service made.
export type ImageAnswerView = { kind: "image"; src: string; caption: string | null };
export type PricesAnswerView = { kind: "prices"; prices: { label: string; value: string }[]; readLine: string | null };
export type WatchAnswerView = { kind: "watch"; markets: { question: string; url: string }[]; until: string; watchPath: string };
export type AnswerView = { kind: "text"; text: string } | { kind: "rows"; rows: { label: string; value: string }[] } | RulesAnswerView | WatchAnswerView | ScoutAnswerView | ForecastAnswerView | ImageAnswerView | PricesAnswerView;

/// A Resolution Watch purchase: the markets watched, until when, and its status link.
function watchView(r: Record<string, unknown>): WatchAnswerView | null {
  if (typeof r.watchId !== "string" || typeof r.statusUrl !== "string" || typeof r.endsAt !== "string" || !Array.isArray(r.markets)) return null;
  const until = new Date(r.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return { kind: "watch", until, watchPath: `/watch/${encodeURIComponent(r.watchId)}`, markets: (r.markets as Record<string, unknown>[]).map((m) => ({ question: String(m.question ?? ""), url: String(m.url ?? "") })) };
}

const RISK_TEXT = { low: "Low dispute risk", medium: "Some dispute risk", high: "High dispute risk" } as const;
const DECIDES_LABEL = { source: "Decided by", cutoff: "Cutoff", threshold: "The line" } as const;
const TRAP_LABEL: Record<string, string> = { definition: "Definition", timing: "Timing", source: "Source", threshold: "The line", fallback: "If it is unclear", discretion: "Judgment call" };
const str = (v: unknown) => (typeof v === "string" ? v : "");

/// A Rules Check answer: dispute risk, what decides the market, and each trap with the words it quotes.
function rulesView(r: Record<string, unknown>): RulesAnswerView | null {
  if ((r.risk !== "low" && r.risk !== "medium" && r.risk !== "high") || !Array.isArray(r.traps)) return null;
  const decides = (r.decides ?? {}) as Record<string, { text?: unknown; quote?: unknown } | null>;
  const market = (r.market ?? {}) as { question?: unknown; url?: unknown };
  return {
    kind: "rules", risk: r.risk, riskText: RISK_TEXT[r.risk], marketQuestion: str(market.question) || null, marketUrl: str(market.url) || null,
    decides: (["source", "cutoff", "threshold"] as const).flatMap((k) => (decides[k] && str(decides[k]!.text) ? [{ label: DECIDES_LABEL[k], text: str(decides[k]!.text), quote: str(decides[k]!.quote) }] : [])),
    traps: (r.traps as Record<string, unknown>[]).filter((t) => t && str(t.quote)).map((t) => ({
      label: `${TRAP_LABEL[str(t.category)] ?? "Rule"} · ${t.kind === "ambiguous" ? "Open to argument" : "Fine print"}`, explain: str(t.explain), quote: str(t.quote),
    })),
  };
}

const httpsUrl = (v: unknown): string | null => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/// "Read from Polymarket at 09:41:07 UTC": the agents read the market when asked, never from memory.
function readLine(at: unknown): string | null {
  const d = typeof at === "string" ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime()) ? `Read from Polymarket at ${d.toISOString().slice(11, 19)} UTC` : null;
}

const VERDICT_TEXT = { tradeable: "Tradeable", watch: "Trade with care", avoid: "Avoid" } as const;

function scoutView(r: Record<string, unknown>): ScoutAnswerView | null {
  if ((r.verdict !== "tradeable" && r.verdict !== "watch" && r.verdict !== "avoid") || !Array.isArray(r.flags) || !r.metrics || typeof r.metrics !== "object") return null;
  const market = (r.market ?? {}) as { question?: unknown; url?: unknown; outcomes?: unknown };
  const m = r.metrics as Record<string, unknown>;
  const metrics: { label: string; value: string }[] = [];
  const add = (label: string, v: unknown, text: (n: number) => string) => { const n = num(v); if (n !== null) metrics.push({ label, value: text(n) }); };
  // A market between two named sides (teams, Over and Under) shows both prices by name.
  const sides = (Array.isArray(market.outcomes) ? market.outcomes : []).flatMap((o) => {
    const side = (o ?? {}) as { label?: unknown; pct?: unknown };
    const pct = num(side.pct);
    return typeof side.label === "string" && side.label.trim() && pct !== null ? [{ label: side.label.trim().slice(0, 40), pct }] : [];
  });
  if (sides.length === 2 && !(sides[0]!.label === "Yes" && sides[1]!.label === "No")) for (const s of sides) metrics.push({ label: `${s.label} price`, value: `${s.pct}%` });
  else add("Yes price", m.yesPct, (n) => `${n}%`);
  add("Spread", m.spreadCents, (n) => (n === 1 ? "1 cent" : `${n} cents`));
  add("Liquidity", m.liquidityUsd, usd);
  add("Traded in 24 hours", m.volume24hUsd, usd);
  add("Move this week", m.weekMovePts, (n) => `${n > 0 ? "+" : ""}${n} points`);
  add("Closes in", m.hoursLeft, (n) => (n < 48 ? `${Math.max(0, Math.round(n))} hours` : `${Math.round(n / 24)} days`));
  return {
    kind: "scout", verdict: r.verdict, verdictText: VERDICT_TEXT[r.verdict], marketQuestion: str(market.question), marketUrl: httpsUrl(market.url),
    metrics, flags: (r.flags as Record<string, unknown>[]).map((f) => str(f?.detail)).filter(Boolean), rulesNote: str(r.rulesNote) || null, readLine: readLine(r.readAt),
  };
}

function forecastView(r: Record<string, unknown>): ForecastAnswerView | null {
  const probabilityBps = num(r.probabilityBps);
  const market = r.market as { question?: unknown; slug?: unknown; closesAt?: unknown } | undefined;
  if (probabilityBps === null || !market || !str(market.question) || !Array.isArray(r.reasons)) return null;
  const agent = str(r.agent) || "Agon agent";
  const sources = (Array.isArray(r.sources) ? (r.sources as Record<string, unknown>[]) : []).flatMap((s) => {
    const url = httpsUrl(s?.url);
    const when = typeof s?.published === "string" ? new Date(s.published) : null;
    return url && str(s.title) ? [{ title: str(s.title), url, published: when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }) : null }] : [];
  });
  return {
    kind: "forecast", sources, readLine: readLine(r.readAt),
    answer: {
      probabilityBps, marketPriceBps: num(r.crowdBps), reasons: (r.reasons as unknown[]).filter((x): x is string => typeof x === "string"),
      marketQuestion: str(market.question), marketEndsAt: str(market.closesAt) || null, marketSlug: str(market.slug) || null,
      forecaster: { name: agent, reason: sources.length > 0 ? "It read this week's news before forecasting" : "An Agon market agent", asked: "", agreed: "" },
    },
  };
}

/// An image a service made: an https link or the image data itself. Nothing else is shown as an image.
function imageView(r: Record<string, unknown>): ImageAnswerView | null {
  const first = Array.isArray(r.data) ? (r.data[0] as Record<string, unknown> | undefined) : undefined;
  const listed = Array.isArray(r.images) ? r.images[0] : undefined;
  const b64 = first && typeof first.b64_json === "string" && /^[A-Za-z0-9+/=]+$/.test(first.b64_json) ? `data:image/png;base64,${first.b64_json}` : null;
  const src = httpsUrl(first?.url) ?? b64 ?? httpsUrl(listed) ?? httpsUrl((listed as { url?: unknown } | undefined)?.url) ?? httpsUrl(r.image_url);
  return src ? { kind: "image", src, caption: str(first?.revised_prompt) || null } : null;
}

const dollars = (n: number) => (n >= 1 ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${Number(n.toPrecision(3))}`);

/// A DefiLlama price answer ({ coins: { "coingecko:ethereum": { price, symbol, timestamp } } }): one price per coin.
function pricesView(r: Record<string, unknown>): PricesAnswerView | { kind: "text"; text: string } | null {
  const coins = r.coins;
  if (!coins || typeof coins !== "object" || Array.isArray(coins) || Object.keys(r).length !== 1) return null;
  const rows = Object.entries(coins as Record<string, Record<string, unknown> | null>).flatMap(([id, c]) => {
    const price = typeof c?.price === "number" && Number.isFinite(c.price) ? c.price : null;
    return price === null ? [] : [{ label: str(c?.symbol) || id.replace(/^[a-z-]+:/i, ""), value: dollars(price), at: typeof c?.timestamp === "number" ? c.timestamp : null }];
  });
  if (Object.keys(coins).length === 0) return { kind: "text", text: "The service sent no price for those coins." };
  if (rows.length === 0) return null;
  const at = rows.map((x) => x.at).find((x): x is number => x !== null);
  return { kind: "prices", prices: rows.map(({ label, value }) => ({ label, value })), readLine: at ? `Read at ${new Date(at * 1000).toISOString().slice(11, 19)} UTC` : null };
}

/// What a routed service returned, readable: text as text, a flat object as rows, a file by type and size.
export function answerView(result: unknown): AnswerView | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { kind: "text", text: result };
  if (typeof result !== "object") return { kind: "text", text: String(result) };
  const r = result as { contentType?: unknown; text?: unknown; bytes?: unknown };
  if (typeof r.contentType === "string" && typeof r.text === "string") return { kind: "text", text: r.text };
  if (typeof r.contentType === "string" && typeof r.bytes === "number") return { kind: "text", text: `The service sent a file: ${r.contentType}, ${r.bytes} bytes.` };
  if (Array.isArray(result)) return { kind: "text", text: JSON.stringify(result, null, 1) };
  // A queued job's ticket is not the work (BlockRun's images, 2026-11-10).
  const ticket = result as { status?: unknown; poll_url?: unknown };
  if (typeof ticket.poll_url === "string" && typeof ticket.status === "string" && /^(queued|in_progress|pending|processing|running)$/i.test(ticket.status)) return { kind: "text", text: "The service queued this work and did not send the result." };
  const rules = rulesView(result as Record<string, unknown>);
  if (rules) return rules;
  const watch = watchView(result as Record<string, unknown>);
  if (watch) return watch;
  const made = scoutView(result as Record<string, unknown>) ?? forecastView(result as Record<string, unknown>) ?? imageView(result as Record<string, unknown>) ?? pricesView(result as Record<string, unknown>);
  if (made) return made;
  return { kind: "rows", rows: inputRows(result as Record<string, unknown>) };
}

/// Answers to the service's input questions, kept across questions and sent together.
export function mergeAnswers(prev: Record<string, string>, next: Record<string, string> | undefined): Record<string, string> {
  return next ? { ...prev, ...next } : prev;
}

/// Names a source that could not be searched, so a thin result is not mistaken for the whole market.
export function sourcesNote(sources: { id: string; status: "ok" | "unavailable" }[] | undefined): string | null {
  return sources?.some((x) => x.id === "circle" && x.status === "unavailable") ? "Circle's marketplace could not be reached just now, so only Agon agents were searched." : null;
}

/// Whether the mainnet wallet is the one in play: a mainnet pick, quote, top-up or paid run.
export function mainnetInView(m: { kind: string; pickNetwork?: string; testnet?: boolean; network?: string; mainnet?: boolean }): boolean {
  if (m.kind === "routed") return m.pickNetwork === "arc";
  if (m.kind === "quote") return m.testnet === false;
  if (m.kind === "refused") return m.network === "arc";
  if (m.kind === "run") return m.mainnet === true;
  return false;
}
