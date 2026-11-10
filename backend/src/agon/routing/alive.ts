import type { CatalogEntry } from "./catalog.ts";

const TTL_MS = 60_000;
const TIMEOUT_MS = 2_500;

/// Whether a service is answering now. Agon calls it once, unpaid, with its own method:
/// a paid service answers 402, and any answer below 500 means it is up. An error, a 5xx or
/// no answer in time means it is not. The answer is kept for a minute.
/// Not called, and taken as up: an address with an input in it (there is nothing to fill it
/// with yet), a free call (it could act without payment) and an address that is not public.
export function createLiveness(opts: { fetchImpl?: typeof fetch; safe: (url: string) => Promise<boolean>; now?: () => number; ttlMs?: number; timeoutMs?: number }): (entry: CatalogEntry) => Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? TTL_MS;
  const seen = new Map<string, { at: number; up: Promise<boolean> }>();

  async function call(entry: CatalogEntry): Promise<boolean> {
    if (entry.price === 0n || entry.url.includes("{") || !(await opts.safe(entry.url).catch(() => false))) return true;
    try {
      const post = entry.method === "POST";
      const res = await fetchImpl(entry.url, {
        method: entry.method, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        ...(post ? { headers: { "content-type": "application/json" }, body: "{}" } : {}),
      });
      await res.body?.cancel().catch(() => {});
      return res.status < 500;
    } catch {
      return false;
    }
  }

  return (entry) => {
    const t = now();
    const kept = seen.get(entry.reference);
    if (kept && t - kept.at < ttl) return kept.up;
    if (seen.size > 2_000) for (const [ref, k] of seen) if (t - k.at >= ttl) seen.delete(ref);
    const up = call(entry);
    seen.set(entry.reference, { at: t, up });
    return up;
  };
}
