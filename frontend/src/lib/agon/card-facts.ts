import { presentListing } from "./catalog.ts";
import type { RatingsResponse, SeasonEntry } from "./stage-types.ts";
import type { AgonListing } from "./types.ts";

export type CardBadge = "Built by Agon" | "Verified" | "Listed";
export type AgentActivity = { jobsCompleted: number; earnedUSDC: string };
export type CardFacts = {
  name: string;
  line: string;
  logoUrl: string | null;
  initials: string;
  badges: CardBadge[];
  chips: ("Per call" | "Paid on delivery")[];
  price: string | null;
  arena: string | null;
  /// Delivered jobs from receipts, else the measured endpoint state; null when neither is known.
  activity: string | null;
};

function initialsFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words.map((w) => w[0]!).join("").slice(0, 2).toUpperCase() || "A";
}

export function cardBadges(listing: AgonListing): CardBadge[] {
  const status: CardBadge = listing.verification.status === "Verified" ? "Verified" : "Listed";
  return listing.firstParty ? ["Built by Agon", status] : [status];
}

function activityLine(listing: AgonListing, activity: AgentActivity | null): string | null {
  if (activity && activity.jobsCompleted > 0) return `${activity.jobsCompleted} ${activity.jobsCompleted === 1 ? "job" : "jobs"} done · ${activity.earnedUSDC} USDC paid`;
  const checked = listing.endpointQa?.status;
  if (checked === "passed") return "Online";
  if (checked === "failed") return "Offline";
  return null;
}

/// What every agent card shows (spec 18.5): only facts Agon has measured.
export function cardFacts(listing: AgonListing, arena: { agentId: string; text: string } | null, activity: AgentActivity | null = null): CardFacts {
  const p = presentListing(listing);
  return {
    name: p.name,
    line: p.description,
    logoUrl: p.logoUrl,
    initials: initialsFor(p.name),
    badges: cardBadges(listing),
    chips: [listing.payment.rail === "Escrow" ? "Paid on delivery" : "Per call"],
    price: p.amountUSDC ? `${p.amountUSDC} USDC` : null,
    arena: arena && arena.agentId === listing.agentId ? arena.text : null,
    activity: activityLine(listing, activity),
  };
}

/// The job totals and Arena line for one card. Both are keyed by ERC-8004 id,
/// which is only unique per network, so they attach only on their own
/// network; Agon's receipts attach only to Agon's own listings.
export function cardExtras(
  listing: AgonListing,
  networkKey: string,
  activity: { network: string; agents: Record<string, AgentActivity> } | null,
  arena: { network: string; byAgentId: Map<string, string> } | null,
): { activity: AgentActivity | null; arena: { agentId: string; text: string } | null } {
  const jobs = activity && activity.network === networkKey && listing.firstParty ? activity.agents[listing.agentId] ?? null : null;
  const text = arena && arena.network === networkKey ? arena.byAgentId.get(listing.agentId) : undefined;
  return { activity: jobs, arena: text ? { agentId: listing.agentId, text } : null };
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

const rank = (l: AgonListing) => (l.verification.status === "Verified" ? 0 : 2) + (l.firstParty ? 0 : 1);

/// Verified Agon agents, then verified, then other Agon listings, then the rest; the API order holds within each.
export function sortForCards(listings: AgonListing[]): AgonListing[] {
  return listings.map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i).map((x) => x.l);
}
