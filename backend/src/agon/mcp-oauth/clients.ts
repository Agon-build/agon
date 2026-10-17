import https from "node:https";
import { isIP } from "node:net";

import { isPublicAddress } from "../manifest-inspector.ts";
import { isAllowedRedirectUri } from "./rules.ts";
import type { OAuthClient, PostgresOAuthStore } from "./store.ts";

type ClientStore = Pick<PostgresOAuthStore, "getClient" | "registerClient">;
type Registration = { clientName: string; redirectUris: string[]; logoUri: string | null };

const MAX_DOCUMENT_BYTES = 32 * 1024;
const FETCH_TIMEOUT_MS = 3_000;
const CACHE_MS = 60 * 60_000;
const FAILURE_MS = 5 * 60_000;
/// Ids whose metadata document failed recently, so a loop cannot make Agon fetch it again and again.
const recentFailures = new Map<string, number>();

/// Client metadata from Dynamic Client Registration (RFC 7591) or a metadata document.
export function parseRegistration(body: unknown): { ok: true; value: Registration } | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_client_metadata" };
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every((u) => typeof u === "string" && u.length <= 512 && isAllowedRedirectUri(u))) {
    return { ok: false, error: "invalid_redirect_uri" };
  }
  const name = typeof b.client_name === "string" ? b.client_name.trim().slice(0, 80) : "";
  const logo = typeof b.logo_uri === "string" && /^https:\/\//.test(b.logo_uri) && b.logo_uri.length <= 512 ? b.logo_uri : null;
  return { ok: true, value: { clientName: name || "MCP client", redirectUris: uris as string[], logoUri: logo } };
}

/// Fetches one https document from an already vetted address, so a second DNS
/// answer cannot point the request somewhere else. Body over the cap is null.
export type DocumentFetcher = (url: URL, address: string, signal: AbortSignal) => Promise<{ status: number; body: string | null }>;

type ResolveDeps = { store: ClientStore; resolve: (hostname: string) => Promise<string[]>; get: DocumentFetcher; now: () => Date };

export const pinnedHttpsGet: DocumentFetcher = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const req = https.get(url, {
      signal,
      headers: { accept: "application/json" },
      servername: url.hostname,
      lookup: (_host, options, callback) => {
        const family = isIP(address);
        if ((options as { all?: boolean }).all) (callback as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
        else (callback as (e: null, a: string, f: number) => void)(null, address, family);
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > MAX_DOCUMENT_BYTES) { res.destroy(); resolve({ status: res.statusCode ?? 0, body: null }); return; }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });

/// Finds a client by id. An https URL id is a Client ID Metadata Document,
/// fetched from a public address only, and cached for an hour.
export async function resolveClient(clientId: string, deps: ResolveDeps): Promise<OAuthClient | null> {
  if (!/^https:\/\//.test(clientId)) return clientId.length <= 512 ? deps.store.getClient(clientId) : null;
  const cached = await deps.store.getClient(clientId);
  if (cached && cached.source === "cimd" && deps.now().getTime() - cached.fetchedAt.getTime() < CACHE_MS) return cached;
  const failedAt = recentFailures.get(clientId);
  if (failedAt !== undefined && deps.now().getTime() - failedAt < FAILURE_MS) return null;
  const found = await fetchDocument(clientId, deps);
  if (found) recentFailures.delete(clientId);
  else {
    if (recentFailures.size > 5_000) recentFailures.clear();
    recentFailures.set(clientId, deps.now().getTime());
  }
  return found;
}

async function fetchDocument(clientId: string, deps: ResolveDeps): Promise<OAuthClient | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const timeout = new Promise<null>((resolve) => controller.signal.addEventListener("abort", () => resolve(null)));
  try {
    // One budget covers the DNS lookup, the connection and the body.
    return await Promise.race([timeout, (async () => {
      const url = new URL(clientId);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      const addresses = await deps.resolve(url.hostname);
      if (addresses.length === 0 || !addresses.every(isPublicAddress)) return null;
      const res = await deps.get(url, addresses[0]!, controller.signal);
      if (res.status !== 200 || res.body === null || res.body.length > MAX_DOCUMENT_BYTES) return null;
      const doc = JSON.parse(res.body) as Record<string, unknown>;
      if (doc.client_id !== clientId) return null;
      const parsed = parseRegistration(doc);
      if (!parsed.ok) return null;
      return deps.store.registerClient({ ...parsed.value, source: "cimd", clientId });
    })().catch(() => null)]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
