import { Hono } from "hono";
import type { Address } from "viem";

import { clientAddress } from "../http/client-address.ts";
import type { AgonNetwork } from "./network.ts";
import { formatUsdc } from "./payments/bargain.ts";
import type { AgonListingLite } from "./routing/agon-source.ts";
import type { Proof } from "./routing/catalog.ts";
import { createRateLimiter } from "./stage/rate-limit.ts";

/// One Agon agent as any caller, signed in or not, may read it: what it does, what it takes,
/// what it costs, where to call it and what proof Agon holds for it. Enough for an agent with
/// its own wallet to call the service and pay it over x402 with no Agon account.
export type DirectoryAgent = {
  reference: string;
  agentId: string;
  name: string;
  job: string;
  category: { id: string; name: string | null };
  /** JSON Schema of the request body; null when the listing names no inputs. */
  inputs: Record<string, unknown> | null;
  price: { usdc: string; atomic: string };
  call: { method: "POST"; url: string; payment: "x402 exact, USDC" };
  /** Known for the agents Agon runs itself. Otherwise null: the service names its payee in its 402. */
  payTo: Address | null;
  status: "Listed";
  verification: "Verified" | "Not verified yet";
  proof: { score: number | null; playground: Proof["playground"]; arena: Proof["arena"]; paid: Proof["paid"] } | null;
  links: { page: string; scores: string; tests: string };
};
export type Directory = {
  name: "Agon";
  about: string;
  readAt: string;
  network: { id: string; label: string; caip2: string; usdc: string; testnet: boolean };
  howToHire: string[];
  mcp: { public: string; signedIn: string };
  agents: DirectoryAgent[];
};

/// The Agon score of one agent from the scores route's answer; null when it has none to report.
export function proofFromScores(body: unknown): Proof | null {
  const all = (body as { windows?: { all?: { score?: number | null; parts?: Partial<Proof> } | null } } | null)?.windows?.all;
  const parts = all?.parts;
  if (!all || !parts?.playground || !parts.arena || !parts.paid) return null;
  const part = (p: Proof["playground"]): Proof["playground"] => ({ value: p.value ?? null, count: p.count ?? 0, status: p.status });
  return { score: all.score ?? null, playground: part(parts.playground), arena: part(parts.arena), paid: part(parts.paid) };
}

/// The wallet an agent Agon runs itself is paid at, from its service address; null for any other agent.
export function agonPayee(endpoint: string, sellers: { lead: Address | null; house: Record<string, Address>; specialists: Record<string, Address> }): Address | null {
  let path: string;
  try { path = new URL(endpoint).pathname; } catch { return null; }
  if (/\/agon\/agents\/lead\//.test(path)) return sellers.lead;
  const house = /\/agon\/agents\/house\/([a-z0-9-]+)/.exec(path);
  if (house) return sellers.house[house[1]!] ?? null;
  const specialist = /\/agon\/agents\/specialists\/([a-z0-9-]+)/.exec(path);
  return specialist ? sellers.specialists[specialist[1]!] ?? null : null;
}

const CATEGORY_NAMES: Readonly<Record<string, string>> = { "1": "Research", "3": "Analysis", "5": "Execution", "7": "Development", "8": "Verification" };
const TTL_MS = 60_000;

/// The public directory: every listed, unsuspended Agon agent, read from the indexed listings.
/// Kept for a minute, so reading it never costs more than one listing read a minute.
export function createDirectory(deps: {
  listListings: () => Promise<AgonListingLite[]>;
  proofFor: (agentId: string) => Promise<Proof | null>;
  /** The payee of an agent Agon runs itself, by its service address; null for any other. */
  payToFor: (endpoint: string) => Address | null;
  network: AgonNetwork;
  siteUrl: string;
  apiUrl: string;
  now?: () => Date;
}): () => Promise<Directory> {
  const now = deps.now ?? (() => new Date());
  let kept: { at: number; value: Promise<Directory> } | null = null;

  async function build(): Promise<Directory> {
    const listed = (await deps.listListings()).filter((l) => l.status === "Listed" && !l.suspended);
    const agents = await Promise.all(listed.map(async (l): Promise<DirectoryAgent> => {
      const proof = l.verified ? await deps.proofFor(l.agentId).catch(() => null) : null;
      return {
        reference: l.reference, agentId: l.agentId, name: l.name, job: l.description,
        category: { id: l.category, name: CATEGORY_NAMES[l.category] ?? null },
        inputs: l.inputSchema,
        price: { usdc: formatUsdc(l.priceAtomic), atomic: l.priceAtomic.toString() },
        call: { method: "POST", url: l.endpoint, payment: "x402 exact, USDC" },
        payTo: deps.payToFor(l.endpoint),
        status: "Listed",
        verification: l.verified ? "Verified" : "Not verified yet",
        proof: proof ? { score: proof.score, playground: proof.playground, arena: proof.arena, paid: proof.paid } : null,
        links: {
          page: `${deps.siteUrl}/agents/${encodeURIComponent(l.agentId)}`,
          scores: `${deps.apiUrl}/agon/scores/${encodeURIComponent(l.agentId)}`,
          tests: `${deps.apiUrl}/agon/tests?agentId=${encodeURIComponent(l.agentId)}`,
        },
      };
    }));
    agents.sort((a, b) => (b.proof?.score ?? -1) - (a.proof?.score ?? -1) || a.name.localeCompare(b.name));
    const n = deps.network;
    return {
      name: "Agon",
      about: "A market of AI agent services. Each agent is paid per call in USDC over x402, and ranked by proof Agon holds: Arena results, Playground tests and ratings of paid work.",
      readAt: now().toISOString(),
      network: { id: n.id, label: n.label, caip2: n.caip2, usdc: n.usdc, testnet: n.id !== "arc" },
      howToHire: [
        "With your own wallet: POST the inputs as JSON to the agent's call.url. It answers 402 with its price and payee; pay with an x402 exact USDC payment and send the request again.",
        "A request an agent cannot serve is refused before payment, with the reason in the error field.",
        "For a person's Agon account: connect the signed-in MCP server and use find_service and hire_service.",
      ],
      mcp: { public: `${deps.apiUrl}/agon/mcp/public`, signedIn: `${deps.apiUrl}/agon/mcp` },
      agents,
    };
  }

  return () => {
    const t = now().getTime();
    if (kept && t - kept.at < TTL_MS) return kept.value;
    const value = build();
    kept = { at: t, value };
    value.catch(() => { if (kept?.value === value) kept = null; });
    return value;
  };
}

/// `GET /agon/directory` with no sign-in, limited per caller. `?reference=` gives one agent.
export function createDirectoryRoutes(deps: { directory: () => Promise<Directory>; limit?: (key: string) => boolean }): Hono {
  const app = new Hono();
  const limit = deps.limit ?? createRateLimiter({ limit: 60, windowMs: 60_000 });
  app.get("/", async (c) => {
    if (!limit(clientAddress((name) => c.req.header(name)) ?? "unknown")) return c.json({ error: "rate_limited", message: "Too many requests. Try again in a minute." }, 429);
    const directory = await deps.directory().catch(() => null);
    if (!directory) return c.json({ error: "directory_unavailable", message: "The directory could not be read. Try again in a minute." }, 503);
    c.header("cache-control", "public, max-age=60");
    c.header("access-control-allow-origin", "*");
    const reference = c.req.query("reference");
    if (!reference) return c.json(directory);
    const agent = directory.agents.find((a) => a.reference === reference || a.agentId === reference);
    return agent ? c.json({ ...directory, agents: [agent] }) : c.json({ error: "not_found", message: "No listed agent has that reference." }, 404);
  });
  return app;
}
