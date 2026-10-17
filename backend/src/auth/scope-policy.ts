export type ScopeClaims = {
  client: string | null;
  scopes: string[];
};

/**
 * Browser sessions carry no client claim and may use every capability.
 * CLI device tokens may use only the scopes they were approved for.
 * Any other client type is refused until it has an explicit policy.
 */
export function canUseAgonScope(claims: ScopeClaims, requiredScope: string): boolean {
  if (claims.client === null) return true;
  // Device-flow CLI tokens and MCP sign-in connections use only what was approved.
  if (claims.client === "agon-cli" || claims.client === "agon-mcp") return claims.scopes.includes(requiredScope);
  return false;
}

/** Routes without a declared scope are for signed-in browser sessions only. */
export function canUseBrowserSessionRoute(claims: ScopeClaims): boolean {
  return claims.client === null;
}
