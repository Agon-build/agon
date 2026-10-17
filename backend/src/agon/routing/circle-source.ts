import { publicHttpsUri } from "../manifest-inspector.ts";
import { z } from "zod";
import type { Address } from "viem";

import { matchCount, type CatalogEntry, type RouteQuery, type RouteSource } from "./catalog.ts";

const ARC_MAINNET = "eip155:5042";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const PAGE = 200;
const MAX_PAGES = 30;

const accept = z.object({ scheme: z.string(), network: z.string(), asset: z.string(), payTo: z.string(), amount: z.string() }).passthrough();
const item = z.object({
  resource: z.string().url(),
  accepts: z.array(accept),
  metadata: z.object({
    provider: z.object({ name: z.string().default("Unknown"), category: z.string().default("OTHER") }).passthrough().default({}),
    method: z.string().default("GET"),
    description: z.string().default(""),
    input: z.object({ queryParams: z.record(z.unknown()).optional(), body: z.record(z.unknown()).optional() }).passthrough().optional(),
    supportsVanillax402: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

/// Only services Agon can pay: plain x402 `exact` in USDC on Arc mainnet, GET or POST.
function toEntry(raw: unknown): CatalogEntry | null {
  const parsed = item.safeParse(raw);
  if (!parsed.success) return null;
  const { resource, accepts, metadata } = parsed.data;
  if (!metadata.supportsVanillax402) return null;
  // Agon calls this address from its own servers: public https only.
  try { publicHttpsUri(resource); } catch { return null; }
  const method = metadata.method.toUpperCase();
  if (method !== "GET" && method !== "POST") return null;
  const option = accepts.find((a) => a.scheme === "exact" && a.network === ARC_MAINNET && a.asset.toLowerCase() === ARC_USDC && /^0x[0-9a-fA-F]{40}$/.test(a.payTo) && /^\d+$/.test(a.amount));
  if (!option) return null;
  const schema = method === "GET" ? metadata.input?.queryParams : metadata.input?.body;
  return {
    source: "circle",
    reference: `circle:${resource}`,
    name: metadata.description.slice(0, 80) || new URL(resource).hostname,
    provider: metadata.provider.name,
    category: metadata.provider.category,
    description: metadata.description,
    url: resource,
    method,
    inputSchema: schema ?? null,
    price: BigInt(option.amount),
    payTo: option.payTo.toLowerCase() as Address,
    network: "arc",
    rating: { tier: "unrated", score: null },
    latencyMs: null,
    tags: [],
  };
}

/// Circle's Agent Marketplace, read from the public discovery API and kept in
/// memory. A failed refresh keeps the last good copy and reports unavailable.
export function createCircleSource(opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): RouteSource & { refresh(): Promise<void>; entries(): CatalogEntry[] } {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? "https://api.circle.com/v2/x402/discovery/resources";
  let catalog: CatalogEntry[] = [];
  let healthy = false;

  async function refresh(): Promise<void> {
    try {
      const next: CatalogEntry[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await fetchImpl(`${base}?network=${ARC_MAINNET}&limit=${PAGE}&offset=${page * PAGE}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`circle discovery ${res.status}`);
        const body = (await res.json()) as { items?: unknown[]; pagination?: { total?: number } };
        for (const raw of body.items ?? []) {
          const entry = toEntry(raw);
          if (entry) next.push(entry);
        }
        const total = body.pagination?.total ?? 0;
        if ((page + 1) * PAGE >= total || (body.items ?? []).length === 0) break;
      }
      catalog = next;
      healthy = true;
    } catch {
      healthy = false;
    }
  }

  return {
    id: "circle",
    refresh,
    entries: () => catalog,
    status: () => (healthy ? "ok" : "unavailable"),
    async search(q: RouteQuery) {
      return catalog
        .filter((e) => q.circleCategories.includes(e.category))
        .map((e) => ({ e, hits: matchCount(e, q.words) }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 50)
        .map((x) => x.e);
    },
  };
}
