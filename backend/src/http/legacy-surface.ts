import type { MiddlewareHandler } from "hono";

/// The public ArcRun API (missions, contests, challenges, syndicates, mystery
/// boxes, traits, training, skins) still lives in this process next to Agon. It
/// shares the database and Circle credentials with Agon's agent wallets, so it
/// is off unless ARCRUN_LEGACY_API=on (audit B4, 2026-11-09). Admin routes stay
/// mounted: the operator console uses them and they need the admin token.

const LEGACY_PREFIXES = [
  "/missions", "/leaderboard", "/contests", "/challenges", "/syndicates", "/syndicate-pool", "/mystery", "/arcana",
  "/entry", "/loadouts", "/scout", "/tier-gates", "/traits", "/activity", "/custom-requests", "/feedback", "/agents",
];

export function isLegacyPath(path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (LEGACY_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return true;
  // Per-event settings of contests and challenges: /events/:source/:id/...
  if (/^\/events\/[^/]+\/[^/]+(\/|$)/.test(p)) return true;
  // Operator profile extras; the plain profile (/operators/:address) is used by Agon.
  if (/^\/operators\/(resolve|identity-mode)$/.test(p)) return true;
  if (/^\/operators\/[^/]+\/.+/.test(p)) return true;
  return false;
}

export const legacyApiEnabled = (env: Record<string, string | undefined>): boolean => env.ARCRUN_LEGACY_API?.trim().toLowerCase() === "on";

/// Answers 410 for a legacy route while the switch is off, before any handler runs.
export function legacyGate(enabled: boolean): MiddlewareHandler {
  return async (c, next) => {
    if (!enabled && isLegacyPath(c.req.path)) return c.json({ error: "legacy_api_off" }, 410);
    await next();
  };
}
