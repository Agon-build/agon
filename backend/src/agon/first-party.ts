import { z } from "zod";

/// Agon's own agents (env AGON_FIRST_PARTY_AGENTS), for example
/// {"lead":{"agentId":"41","owner":"0x..."},"atlas":{"agentId":"42","owner":"0x..."}}.
/// The owner is the wallet that published the listing, so a transferred agent
/// publishing from another wallet is never shown as Built by Agon.
export type FirstPartyAgent = { key: string; agentId: string; owner: string };

const entry = z.object({
  agentId: z.string().regex(/^[1-9]\d{0,30}$/),
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
}).strict();
const shape = z.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), entry);

export function parseFirstPartyAgents(raw: string | undefined): { ok: true; agents: FirstPartyAgent[] } | { ok: false; problem: string } {
  if (!raw?.trim()) return { ok: true, agents: [] };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, problem: "AGON_FIRST_PARTY_AGENTS must be JSON" }; }
  const parsed = shape.safeParse(json);
  if (!parsed.success || Array.isArray(json)) return { ok: false, problem: 'AGON_FIRST_PARTY_AGENTS must look like {"lead":{"agentId":"41","owner":"0x..."}}' };
  const agents = Object.entries(parsed.data).map(([key, v]) => ({ key, agentId: v.agentId, owner: v.owner.toLowerCase() }));
  const seen = new Set<string>();
  for (const a of agents) {
    if (seen.has(a.agentId)) return { ok: false, problem: `AGON_FIRST_PARTY_AGENTS lists agent ${a.agentId} twice` };
    seen.add(a.agentId);
  }
  return { ok: true, agents };
}

export function isFirstParty(listing: { agentId: bigint; providerSnapshot: string }, agents: readonly FirstPartyAgent[]): boolean {
  const id = listing.agentId.toString();
  const owner = listing.providerSnapshot.toLowerCase();
  return agents.some((a) => a.agentId === id && a.owner === owner);
}

/// House key to ERC-8004 id, for the Season's house entries.
export function houseAgentIdsFrom(agents: readonly FirstPartyAgent[], houseKeys: readonly string[]): Record<string, bigint> {
  const keys = new Set(houseKeys);
  return Object.fromEntries(agents.filter((a) => keys.has(a.key)).map((a) => [a.key, BigInt(a.agentId)]));
}

/// The provider ref Agon's jobs use for this agent.
export function providerRefFor(key: string, houseKeys: readonly string[]): string {
  return houseKeys.includes(key) ? `house:${key}` : `agent:${key}`;
}
