import { presentListing } from "./catalog.ts";
import type { RatingsResponse, SeasonEntry } from "./stage-types.ts";
import type { AgonListing } from "./types.ts";

export type CardBadge = "Built by Agon" | "Verified" | "Listed";
export type CardFacts = {
  name: string;
  line: string;
  logoUrl: string | null;
  initials: string;
  badge: CardBadge;
  chips: ("Per call" | "Paid on delivery")[];
  price: string | null;
  arena: string | null;
  /// "New" only when the card has no measured activity to show.
  activity: "New" | null;
};

function initialsFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.map((w) => w[0]!).join("").slice(0, 2).toUpperCase() || "A";
}

export function cardBadge(listing: AgonListing): CardBadge {
  return listing.firstParty ? "Built by Agon" : listing.verification.status === "Verified" ? "Verified" : "Listed";
}

/// What every agent card shows (spec 18.5). Jobs and ratings join with the
/// Orders plan; until then every card says "New".
export function cardFacts(listing: AgonListing, arena: { agentId: string; text: string } | null): CardFacts {
  const p = presentListing(listing);
  return {
    name: p.name,
    line: p.description,
    logoUrl: p.logoUrl,
    initials: initialsFor(p.name),
    badge: cardBadge(listing),
    chips: [listing.payment.rail === "Escrow" ? "Paid on delivery" : "Per call"],
    price: p.amountUSDC ? `From ${p.amountUSDC} USDC` : null,
    arena: arena && arena.agentId === listing.agentId ? arena.text : null,
    activity: arena && arena.agentId === listing.agentId ? null : "New",
  };
}

/// Arena line per ERC-8004 id, from the Season entries (which carry the id)
/// joined to the ratings (which carry the address).
export function arenaTextByAgentId(entries: SeasonEntry[], ratings: RatingsResponse): Map<string, string> {
  const byAddress = new Map(ratings.agents.map((a) => [a.agentAddress.toLowerCase(), a]));
  const out = new Map<string, string>();
  for (const e of entries) {
    const r = e.erc8004AgentId ? byAddress.get(e.agentAddress.toLowerCase()) : undefined;
    if (!r || !e.erc8004AgentId) continue;
    const { ranked, rank, forecastsResolved } = r.overall;
    out.set(e.erc8004AgentId, ranked && rank ? `#${rank} in the Arena` : forecastsResolved > 0 ? `${forecastsResolved} Arena forecasts scored` : "In the Arena");
  }
  return out;
}

const BADGE_ORDER: Record<CardBadge, number> = { "Built by Agon": 0, Verified: 1, Listed: 2 };

/// Built by Agon first, then Verified, then Listed; the API order holds within each.
export function sortForCards(listings: AgonListing[]): AgonListing[] {
  return listings.map((l, i) => ({ l, i })).sort((a, b) => BADGE_ORDER[cardBadge(a.l)] - BADGE_ORDER[cardBadge(b.l)] || a.i - b.i).map((x) => x.l);
}
