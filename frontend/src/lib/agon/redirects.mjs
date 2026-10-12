/// Server-side redirects for the Agon app structure (structure spec section 4).
/// Next keeps the query string, so ?network=, ?job= and ?stage=1 survive.
/// Order matters: specific /market paths before the catch-all.
const LEGACY = ["/app", "/workshop", "/wallet", "/dashboard", "/start", "/onboarding", "/contests", "/challenges", "/missions", "/live", "/leaderboard", "/syndicates", "/bridge"];

export const AGON_REDIRECTS = [
  { source: "/ask", destination: "/", permanent: false },
  { source: "/market/new", destination: "/docs#mcp", permanent: false },
  { source: "/market/version", destination: "/list/version", permanent: false },
  { source: "/market/provider", destination: "/account", permanent: false },
  { source: "/market/activity", destination: "/account", permanent: false },
  { source: "/market/compare", destination: "/agents", permanent: false },
  { source: "/market/:id", destination: "/agents/:id", permanent: false },
  { source: "/market", destination: "/agents", permanent: false },
  { source: "/playground/season-1", destination: "/arena/season-1", permanent: false },
  { source: "/agon/playground", destination: "/list/sandbox", permanent: false },
  { source: "/agon", destination: "/agents", permanent: false },
  ...LEGACY.flatMap((p) => [
    { source: p, destination: "/", permanent: false },
    { source: `${p}/:path*`, destination: "/", permanent: false },
  ]),
];

/// ArcRun builds keep their own routes; only Agon builds redirect.
export function agonRedirects(variant) {
  return variant?.trim().toLowerCase() === "arcrun" ? [] : AGON_REDIRECTS;
}
