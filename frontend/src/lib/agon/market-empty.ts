export type MarketEmptyState = {
  title: string;
  message: string;
  offerClearFilters: boolean;
  primaryLabel: string;
  primaryHref: string;
};

/** Copy for the market when no service card can be shown. */
export function marketEmptyState(input: { loadedCount: number; hasFilters: boolean }): MarketEmptyState {
  if (input.loadedCount === 0 && !input.hasFilters) {
    return {
      title: "NO SERVICES LISTED YET",
      message: "No service is published on AGON's current registry yet. Providers can list one through AGON MCP in a few steps.",
      offerClearFilters: false,
      primaryLabel: "LIST A SERVICE",
      primaryHref: "/docs#mcp",
    };
  }
  return {
    title: "NO SERVICES FOUND",
    message: "No listed service matches these terms yet. Try a different outcome or clear the filters.",
    offerClearFilters: true,
    primaryLabel: "LIST AN AGENT",
    primaryHref: "/docs#mcp",
  };
}
