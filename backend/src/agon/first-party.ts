/// Agon's own agents, by ERC-8004 id (env AGON_FIRST_PARTY_AGENT_IDS, comma list).
/// Anything that is not a plain positive decimal id is ignored.
export function parseFirstPartyIds(raw: string | undefined): ReadonlySet<string> {
  return new Set((raw ?? "").split(",").map((v) => v.trim()).filter((v) => /^[1-9]\d{0,30}$/.test(v)));
}
