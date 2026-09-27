import { SignJWT, jwtVerify } from "jose";
import { config } from "../config/index.js";
import { createSessionMiddleware, SESSION_COOKIE } from "./session-middleware.ts";

export { SESSION_COOKIE };

const secret = new TextEncoder().encode(config.auth.jwtSecret);
const ALG = "HS256";

export type AgonAuthClaims = {
  address: string;
  client: string | null;
  scopes: string[];
};

/// Issues a 7-day session token whose subject is the operator's wallet address.
export async function issueToken(
  address: string,
  claims: { client?: string; scopes?: string[] } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<string | null> {
  const claims = await verifyTokenClaims(token);
  return claims?.address ?? null;
}

export async function verifyTokenClaims(token: string): Promise<AgonAuthClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
    if (typeof payload.sub !== "string") return null;
    const rawScopes = payload.scopes;
    return {
      address: payload.sub,
      client: typeof payload.client === "string" ? payload.client : null,
      scopes: Array.isArray(rawScopes) ? rawScopes.filter((scope): scope is string => typeof scope === "string") : [],
    };
  } catch {
    return null;
  }
}

const session = createSessionMiddleware(verifyTokenClaims);

/// Browser-session middleware. Reads the httpOnly session cookie first, then a
/// Bearer header. CLI and agent tokens are refused here; they must use a route
/// wrapped in `requireAgonScope`. Exposes the address as `c.get("address")`.
export const requireAuth = session.requireAuth;

/// Capability middleware for routes that CLI and agent tokens may call.
/// Browser sessions pass; CLI tokens need the named scope.
export const requireAgonScope = session.requireAgonScope;

/// The verified claims behind the current request, or null.
export const requestClaims = session.requestClaims;
