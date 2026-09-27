type PlaygroundListing = { id: string; version: string; category: string };

/**
 * The note shown above the Playground service picker. It may only say a live
 * service exists when a listing in the current market matches a configured
 * provider scope; a scope left over from an older registry does not count.
 */
export function liveProviderMessage(input: {
  category: string;
  analysisCategoryId: string | null;
  providerScopes: readonly string[];
  listings: readonly PlaygroundListing[];
}): string | null {
  const connected = input.listings.filter((listing) =>
    listing.category === input.analysisCategoryId
    && input.providerScopes.includes(`${listing.id}@${listing.version}`.toLowerCase()));
  if (input.category !== "analysis") {
    return connected.length > 0
      ? "Live listed services can be tested in Analysis. This selection runs AGON's public sample."
      : "No listed service is connected to the live Playground yet. This selection runs AGON's public sample.";
  }
  if (input.providerScopes.length === 0) return "No listed service is connected to the live Playground yet.";
  return connected.length === 0 ? "No live service is available in this category yet." : null;
}
