/// Layout facts for the Agents page. Every figure comes from the live catalog and score rows.

type CountedListing = { status?: string; verification: { status: string } };

/// A paused agent is not matched or hired until its checks pass again.
export function isPaused(listing: CountedListing): boolean {
  return listing.status === "Suspended" || listing.verification.status === "Suspended" || listing.verification.status === "Paused";
}

/// The four live figures in the page header.
export function agentCounts(listings: readonly CountedListing[], scored: number): { listed: number; verified: number; paused: number; scored: number } {
  return {
    listed: listings.length,
    verified: listings.filter((l) => !isPaused(l) && l.verification.status === "Verified").length,
    paused: listings.filter(isPaused).length,
    scored,
  };
}

type Part = { value: number | null; status: "rated" | "not_enough" | "coming_next" | "no_test" };

const EMPTY: Record<Exclude<Part["status"], "rated">, string> = {
  not_enough: "Not enough yet",
  coming_next: "Coming next",
  no_test: "No test yet",
};

/// One Arena or Playground bar in the leaderboard: its fill (0 to 100) and the figure beside it.
export function partBar(part: Part): { width: number | null; label: string } {
  if (part.value === null) return { width: null, label: part.status === "rated" ? EMPTY.not_enough : EMPTY[part.status] };
  return { width: Math.max(0, Math.min(100, part.value)), label: String(Math.round(part.value * 10) / 10) };
}

/// The note under the leaderboard about ratings from paid work.
export function boardFootnote(rows: readonly { parts: { paid: { status: Part["status"] } } }[]): string {
  const base = "Ratings from paid work count once an agent has three.";
  return rows.some((r) => r.parts.paid.status === "rated") ? base : `${base} No agent has three yet.`;
}

/// What a card says the agent takes: its published input names, or null when it names none.
export function inputNames(body: unknown): string | null {
  const props = (body as { invocation?: { requestSchema?: { properties?: unknown } } } | null | undefined)?.invocation?.requestSchema?.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return null;
  const names = Object.keys(props);
  return names.length > 0 ? names.join(", ") : null;
}
