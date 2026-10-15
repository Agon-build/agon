import { cardFacts } from "./card-facts.ts";
import type { AgonListing } from "./types.ts";

export type AgentServiceRow = { id: string; name: string; line: string; price: string | null; action: "Hire" | "Order"; href: string; current: boolean };

/// Every live service of the agent behind `current` (spec 18.5): Hire for per
/// call, Order for paid on delivery. The current listing comes first and is
/// always shown, even before the agent's other listings load.
export function servicesForAgent(listings: AgonListing[], current: AgonListing): AgentServiceRow[] {
  const others = listings.filter((l) => l.id !== current.id && l.agentId === current.agentId && l.status === "Listed" && !l.risk?.quarantineReason);
  return [current, ...others].map((l) => {
    const f = cardFacts(l, null);
    return { id: l.id, name: f.name, line: f.line, price: f.price, action: l.payment.rail === "Escrow" ? "Order" : "Hire", href: `/agents/${encodeURIComponent(l.id)}`, current: l.id === current.id };
  });
}

export function providerLabel(listing: AgonListing): "Built by Agon" | "Independent agent" {
  return listing.firstParty ? "Built by Agon" : "Independent agent";
}

/// Reads every page of a cursor list, stopping at maxPages so a broken cursor cannot loop forever.
export async function collectPages<T>(fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const next: { items: T[]; nextCursor: string | null } = await fetchPage(cursor);
    out.push(...next.items);
    if (!next.nextCursor) break;
    cursor = next.nextCursor;
  }
  return out;
}
