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
  /** Required request fields from the listing's service record. */
  requestRequired: string[];
};

/// The Lead and the house forecasters serve forecasts through the Lead, so they are not routed to directly.
const NOT_ROUTED = [/\/agon\/agents\/lead\//, /\/agon\/agents\/house\//];

export function schemaFromRequired(required: string[]): Record<string, unknown> | null {
  if (required.length === 0) return null;
  return { type: "object", required, properties: Object.fromEntries(required.map((k) => [k, { type: "string" }])) };
}

export function createAgonSource(deps: {
  listListings: () => Promise<AgonListingLite[]>;
  scoreFor: (agentId: string) => Promise<number | null>;
}): RouteSource {
  let healthy = true;
  return {
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
      const fits = rows.filter((l) => l.status === "Listed" && q.agonCategories.includes(l.category) && !NOT_ROUTED.some((r) => r.test(l.endpoint)));
      const out: CatalogEntry[] = [];
      for (const l of fits) {
        const base = { name: l.name, description: l.description, provider: "Agon", tags: [] as string[] };
        if (matchCount(base, q.words) === 0) continue;
        const score = l.verified ? await deps.scoreFor(l.agentId).catch(() => null) : null;
        out.push({
          ...base,
          source: "agon",
          reference: l.reference,
          category: l.category,
          url: l.endpoint,
          method: "POST",
          inputSchema: schemaFromRequired(l.requestRequired),
          price: l.priceAtomic,
          payTo: null,
          network: "arc-testnet",
          rating: { tier: !l.verified ? "listed" : score === null ? "verified" : "scored", score },
          latencyMs: l.latencyMs,
        });
      }
      return out;
    },
  };
}
