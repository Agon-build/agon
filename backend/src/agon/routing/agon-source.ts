import { matchCount, type CatalogEntry, type RouteQuery, type RouteSource } from "./catalog.ts";

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
  /** The listing's named input fields; null for a listing that names none, which Agon cannot fill. */
  inputSchema: { type: "object"; properties: Record<string, Record<string, unknown>>; required: string[] } | null;
};

/// The Lead and the house forecasters serve forecasts through the Lead, so routing
/// does not pick them; a person can still hire any of them from its page.
const NOT_ROUTED = [/\/agon\/agents\/lead\//, /\/agon\/agents\/house\//];

export function createAgonSource(deps: {
  listListings: () => Promise<AgonListingLite[]>;
  scoreFor: (agentId: string) => Promise<number | null>;
}): RouteSource & { entryFor(reference: string): Promise<CatalogEntry | null> } {
  let healthy = true;
  const entryOf = async (l: AgonListingLite): Promise<CatalogEntry> => {
    const score = l.verified ? await deps.scoreFor(l.agentId).catch(() => null) : null;
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
      rating: { tier: !l.verified ? "listed" : score === null ? "verified" : "scored", score },
      latencyMs: l.latencyMs,
    };
  };
  return {
    /// One agent a person chose themselves: listed, verified and with named inputs.
    async entryFor(reference: string) {
      const l = (await deps.listListings()).find((r) => r.reference === reference);
      return l && l.status === "Listed" && l.verified && l.inputSchema ? entryOf(l) : null;
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
      const fits = rows.filter((l) => l.status === "Listed" && l.inputSchema && q.agonCategories.includes(l.category) && !NOT_ROUTED.some((r) => r.test(l.endpoint)));
      const out: CatalogEntry[] = [];
      for (const l of fits) {
        if (matchCount({ name: l.name, description: l.description, provider: "Agon", tags: [] }, q.words) === 0) continue;
        out.push(await entryOf(l));
      }
      return out;
    },
  };
}
