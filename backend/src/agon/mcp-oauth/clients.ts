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

async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/// Finds a client by id. An https URL id is a Client ID Metadata Document,
/// fetched from a public address only, and cached for an hour.
export async function resolveClient(
  clientId: string,
  deps: { store: ClientStore; fetch: typeof fetch; assertPublic: (url: string) => Promise<URL>; now: () => Date },
): Promise<OAuthClient | null> {
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

async function fetchDocument(
  clientId: string,
  deps: { store: ClientStore; fetch: typeof fetch; assertPublic: (url: string) => Promise<URL>; now: () => Date },
): Promise<OAuthClient | null> {
  try {
    const url = await deps.assertPublic(clientId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await Promise.race([
        deps.fetch(url, { redirect: "manual", signal: controller.signal, headers: { accept: "application/json" } }),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("timeout")))),
      ]);
      if (res.status !== 200) return null;
      const text = await readCapped(res);
      if (text === null) return null;
      const doc = JSON.parse(text) as Record<string, unknown>;
      if (doc.client_id !== clientId) return null;
      const parsed = parseRegistration(doc);
      if (!parsed.ok) return null;
      return deps.store.registerClient({ ...parsed.value, source: "cimd", clientId });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
