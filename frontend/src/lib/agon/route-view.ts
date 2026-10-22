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
export type WatchAnswerView = { kind: "watch"; markets: { question: string; url: string }[]; until: string; statusUrl: string };
export type AnswerView = { kind: "text"; text: string } | { kind: "rows"; rows: { label: string; value: string }[] } | RulesAnswerView | WatchAnswerView;

/// A Resolution Watch purchase: the markets watched, until when, and its status link.
function watchView(r: Record<string, unknown>): WatchAnswerView | null {
  if (typeof r.watchId !== "string" || typeof r.statusUrl !== "string" || typeof r.endsAt !== "string" || !Array.isArray(r.markets)) return null;
  const until = new Date(r.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return { kind: "watch", until, statusUrl: r.statusUrl, markets: (r.markets as Record<string, unknown>[]).map((m) => ({ question: String(m.question ?? ""), url: String(m.url ?? "") })) };
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

/// What a routed service returned, readable: text as text, a flat object as rows, a file by type and size.
export function answerView(result: unknown): AnswerView | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { kind: "text", text: result };
  if (typeof result !== "object") return { kind: "text", text: String(result) };
  const r = result as { contentType?: unknown; text?: unknown; bytes?: unknown };
  if (typeof r.contentType === "string" && typeof r.text === "string") return { kind: "text", text: r.text };
  if (typeof r.contentType === "string" && typeof r.bytes === "number") return { kind: "text", text: `The service sent a file: ${r.contentType}, ${r.bytes} bytes.` };
  if (Array.isArray(result)) return { kind: "text", text: JSON.stringify(result, null, 1) };
  const rules = rulesView(result as Record<string, unknown>);
  if (rules) return rules;
  const watch = watchView(result as Record<string, unknown>);
  if (watch) return watch;
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
