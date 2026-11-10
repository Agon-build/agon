import { matchCount, type CatalogEntry, type Proof, type RouteQuery, type RouteSource } from "./catalog.ts";

/// The fields of an Agon listing the router needs, read from the indexed market.
export type AgonListingLite = {
  reference: string;
  agentId: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  priceAtomic: bigint;
  latencyMs: number | null;
  status: "Listed" | "Paused" | string;
  verified: boolean;
  /** Agon suspended its verification after failed checks: shown as Paused, never routed. */
  suspended: boolean;
  /** The listing's named input fields; null for a listing that names none, which Agon cannot fill. */
  inputSchema: { type: "object"; properties: Record<string, Record<string, unknown>>; required: string[] } | null;
};

/// The Lead and the house forecasters serve forecasts through the Lead, so routing
/// does not pick them; a person can still hire any of them from its page.
export const LEAD = /\/agon\/agents\/lead\//;
const NOT_ROUTED = [LEAD, /\/agon\/agents\/house\//];

export function createAgonSource(deps: {
  listListings: () => Promise<AgonListingLite[]>;
  proofFor: (agentId: string) => Promise<Proof | null>;
}): RouteSource & { entryFor(reference: string): Promise<CatalogEntry | null>; leadEntry(): Promise<CatalogEntry | null> } {
  let healthy = true;
  const entryOf = async (l: AgonListingLite, withProof = true): Promise<CatalogEntry> => {
    const proof = l.verified && withProof ? await deps.proofFor(l.agentId).catch(() => null) : null;
    const score = proof?.score ?? null;
    return {
      name: l.name, description: l.description, provider: "Agon", tags: [],
      source: "agon",
      reference: l.reference,
      category: l.category,
      url: l.endpoint,
      method: "POST",
      inputSchema: l.inputSchema,
      price: l.priceAtomic,
      payTo: null,
      network: "arc-testnet",
      rating: { tier: !l.verified ? "listed" : score === null ? "verified" : "scored", score, proof },
      latencyMs: l.latencyMs,
    };
  };
  return {
    /// One agent a person chose themselves: listed, verified and with named inputs.
    async entryFor(reference: string) {
      const l = (await deps.listListings()).find((r) => r.reference === reference);
      return l && l.status === "Listed" && l.verified && l.inputSchema ? entryOf(l) : null;
    },
    /// The Lead as a choice on Hire: its listed, verified listing, with its price and proof.
    /// It runs its own ask, so it needs no named inputs.
    async leadEntry() {
      const l = (await deps.listListings()).find((r) => r.status === "Listed" && r.verified && LEAD.test(r.endpoint));
      return l ? entryOf(l) : null;
    },
    async all() {
      const rows = await deps.listListings();
      return Promise.all(rows.filter((l) => l.status === "Listed" && !l.suspended && (LEAD.test(l.endpoint) ? l.verified : l.inputSchema && !NOT_ROUTED.some((r) => r.test(l.endpoint)))).map((l) => entryOf(l, false)));
    },
    id: "agon",
    status: () => (healthy ? "ok" : "unavailable"),
    async search(q: RouteQuery) {
      let rows: AgonListingLite[];
      try {
        rows = await deps.listListings();
        healthy = true;
      } catch {
        healthy = false;
        return [];
      }
      const fits = rows.filter((l) => l.status === "Listed" && !l.suspended && l.inputSchema && q.agonCategories.includes(l.category) && !NOT_ROUTED.some((r) => r.test(l.endpoint)));
      const out: CatalogEntry[] = [];
      for (const l of fits) {
        if (!q.whole && matchCount({ name: l.name, description: l.description, provider: "Agon", tags: [] }, q.words) === 0) continue;
        out.push(await entryOf(l));
      }
      return out;
    },
  };
}
