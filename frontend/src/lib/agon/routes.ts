/**
 * Route families are intentionally explicit. ArcRun is the older competitive
 * product; its routes must not appear as if they are part of the AGON Market
 * or inherit AGON's public network context.
 */
export const LEGACY_ARCRUN_ROUTE_PREFIXES = [
  "/app",
  "/workshop",
  "/wallet",
  "/dashboard",
  "/start",
  "/onboarding",
  "/contests",
  "/challenges",
  "/missions",
  "/live",
  "/leaderboard",
  "/syndicates",
  "/bridge",
] as const;

export function isLegacyArcRunRoute(pathname: string): boolean {
  return LEGACY_ARCRUN_ROUTE_PREFIXES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

const startsWithAny = (pathname: string, roots: readonly string[]) => roots.some((r) => pathname === r || pathname.startsWith(`${r}/`));
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAgonRoute(pathname: string): boolean {
  return pathname === "/" || startsWithAny(pathname, ["/agents", "/arena", "/list", "/account", "/docs", "/cli", "/login", "/operators", "/approve", "/r"]);
}

/// Receipts, approval links and the Arena are readable without an account.
export function isStagePublicRoute(pathname: string): boolean {
  if (pathname === "/" || pathname === "/approve" || startsWithAny(pathname, ["/arena"])) return true;
  return pathname.startsWith("/r/") && JOB_ID.test(pathname.slice(3));
}

/// Everything a signed-out visitor may read. Account, CLI approval and admin-like
/// surfaces ask for sign-in (admin and support keep their own gates).
export function isAgonPublicRoute(pathname: string): boolean {
  return isStagePublicRoute(pathname) || pathname === "/login" || startsWithAny(pathname, ["/agents", "/list", "/docs", "/operators"]);
}
