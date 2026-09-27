import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

import { canUseAgonScope, canUseBrowserSessionRoute } from "./scope-policy.ts";

/// Name of the httpOnly session cookie set at sign-in and cleared on logout.
/// The session must not live in localStorage where XSS can lift it.
export const SESSION_COOKIE = "arcrun_session";

export type SessionClaims = {
  address: string;
  client: string | null;
  scopes: string[];
};

type AddressVariables = { Variables: { address: string } };

function tokenFromRequest(c: Context): string {
  const cookieToken = getCookie(c, SESSION_COOKIE) ?? "";
  const header = c.req.header("authorization") ?? "";
  const headerToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  return cookieToken || headerToken;
}

/**
 * Session checks without the app config, so tests can drive them with a
 * fake verifier. A route with no declared scope accepts browser sessions
 * only; CLI and agent tokens must reach a route that names their scope.
 */
export function createSessionMiddleware(verify: (token: string) => Promise<SessionClaims | null>) {
  const requestClaims = (c: Context): Promise<SessionClaims | null> => verify(tokenFromRequest(c));

  const requireAuth: MiddlewareHandler<AddressVariables> = async (c, next) => {
    const claims = await requestClaims(c);
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    if (!canUseBrowserSessionRoute(claims)) {
      return c.json({ error: "browser_session_required", message: "Sign in on the AGON website to use this action. CLI and agent tokens cannot." }, 403);
    }
    c.set("address", claims.address);
    await next();
  };

  function requireAgonScope(scope: string): MiddlewareHandler<AddressVariables> {
    return async (c, next) => {
      const claims = await requestClaims(c);
      if (!claims) return c.json({ error: "unauthorized" }, 401);
      if (!canUseAgonScope(claims, scope)) return c.json({ error: "scope_required", scope }, 403);
      c.set("address", claims.address);
      await next();
    };
  }

  return { requireAuth, requireAgonScope, requestClaims };
}
