import { createHash, randomBytes } from "node:crypto";

import { ACCESS_LEVEL_SCOPES } from "../access-tokens.ts";

/// Pure rules for MCP sign-in: PKCE, redirect URIs, access levels and secrets.
export const OAUTH_CLIENT = "agon-mcp";
export const OAUTH_TTL = { requestMs: 600_000, codeMs: 60_000, accessMs: 3_600_000, idleMs: 90 * 86_400_000 } as const;

export type ConnectLevel = "read" | "listing" | "hiring" | "full";
const LEVEL_ORDER: ConnectLevel[] = ["read", "listing", "hiring", "full"];

export function scopesForLevel(level: ConnectLevel): string[] {
  return [...ACCESS_LEVEL_SCOPES[level]];
}

/// The least level whose scopes cover every known scope asked for.
export function smallestLevelFor(scopes: string[]): ConnectLevel {
  const known = new Set<string>(ACCESS_LEVEL_SCOPES.full);
  const wanted = scopes.filter((s) => known.has(s));
  return LEVEL_ORDER.find((level) => wanted.every((s) => (ACCESS_LEVEL_SCOPES[level] as readonly string[]).includes(s))) ?? "full";
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);
const APP_SCHEMES = new Set(["cursor:", "vscode:", "vscode-insiders:", "windsurf:", "zed:"]);

function parse(uri: string): URL | null {
  try { return new URL(uri); } catch { return null; }
}

/// Loopback http, https, or a private-use app scheme (RFC 8252); never a fragment.
export function isAllowedRedirectUri(uri: string): boolean {
  const u = parse(uri);
  if (!u || u.hash || uri.includes("#")) return false;
  if (BLOCKED_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  return APP_SCHEMES.has(u.protocol) || u.protocol.slice(0, -1).includes(".");
}

/// Exact match, except a loopback redirect may use any port (RFC 8252 section 7.3).
export function redirectAllowed(registered: string[], requested: string): boolean {
  if (!isAllowedRedirectUri(requested)) return false;
  const r = parse(requested)!;
  return registered.some((reg) => {
    if (reg === requested) return true;
    const g = parse(reg);
    if (!g || g.protocol !== "http:" || r.protocol !== "http:" || !LOOPBACK.has(g.hostname)) return false;
    return g.hostname === r.hostname && g.pathname === r.pathname && g.search === r.search;
  });
}

/// The MCP URL in one canonical form: lower-case scheme and host, no trailing slash.
export function normalizeResource(value: string): string {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value;
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newSecret(prefix: "agon_oac_" | "agon_oat_" | "agon_ort_"): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}
