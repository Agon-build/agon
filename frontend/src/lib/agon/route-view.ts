/// Words for a routed hire: where the agent comes from, how far Agon trusts it,
/// what it costs with the routing fee, and which money it uses.
export type RouteRating = { tier: "scored" | "verified" | "listed" | "unrated"; score: number | null };

export function priceLines(p: { price: string; fee?: string; total?: string }): { label: string; value: string }[] {
  const lines = [{ label: "Price", value: `${p.price} USDC` }];
  if (p.fee && p.total) lines.push({ label: "Agon routing fee", value: `${p.fee} USDC` }, { label: "Total", value: `${p.total} USDC` });
  return lines;
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

export type AnswerView = { kind: "text"; text: string } | { kind: "rows"; rows: { label: string; value: string }[] };

/// What a routed service returned, readable: text as text, a flat object as rows, a file by type and size.
export function answerView(result: unknown): AnswerView | null {
  if (result === null || result === undefined) return null;
  if (typeof result === "string") return { kind: "text", text: result };
  if (typeof result !== "object") return { kind: "text", text: String(result) };
  const r = result as { contentType?: unknown; text?: unknown; bytes?: unknown };
  if (typeof r.contentType === "string" && typeof r.text === "string") return { kind: "text", text: r.text };
  if (typeof r.contentType === "string" && typeof r.bytes === "number") return { kind: "text", text: `The service sent a file: ${r.contentType}, ${r.bytes} bytes.` };
  if (Array.isArray(result)) return { kind: "text", text: JSON.stringify(result, null, 1) };
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
