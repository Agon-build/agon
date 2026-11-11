import { agonNetwork } from "../network.ts";
import { peekExactTerms } from "../payments/exact-buyer.ts";
import type { CatalogEntry } from "./catalog.ts";

const TTL_MS = 60_000;
const TIMEOUT_MS = 2_500;

/// Whether a service is answering now. Agon calls it once, unpaid, with its own method, and
/// keeps the answer for a minute.
///
/// An outside service is up only when it asks for a payment Agon can make: a well-formed 402
/// with a plain USDC option on its network, paid to the address the catalogue shows, at no more
/// than the price the catalogue shows. A 404, 400, 401, a server error, a free 200, a 402 Agon
/// cannot pay and silence all count as not answering (owner decision 2026-11-11: before this
/// any answer below 500 passed, so a dead address that said 404 was offered).
///
/// An Agon listing is up when it answers below 500: Agon's own agents refuse an empty request
/// with 400 before asking for payment, and their addresses are checked when they are listed.
///
/// Not called, and taken as up: an address with an input in it (it is checked with the input
/// filled when the person asks for a quote), a free call (it could act without payment) and
/// an address that is not public.
export function createLiveness(opts: { fetchImpl?: typeof fetch; safe: (url: string) => Promise<boolean>; now?: () => number; ttlMs?: number; timeoutMs?: number }): (entry: CatalogEntry) => Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? TTL_MS;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const seen = new Map<string, { at: number; up: Promise<boolean> }>();

  async function call(entry: CatalogEntry): Promise<boolean> {
    if (entry.price === 0n || entry.url.includes("{") || !(await opts.safe(entry.url).catch(() => false))) return true;
    const post = entry.method === "POST";
    const init: RequestInit = { method: entry.method, ...(post ? { headers: { "content-type": "application/json" }, body: "{}" } : {}) };
    if (entry.source !== "agon") {
      const peek = await peekExactTerms({ url: entry.url, init, network: agonNetwork(entry.network), fetchImpl, timeoutMs }).catch(() => null);
      if (!peek || !peek.ok || !("option" in peek)) return false;
      if (entry.payTo && peek.option.payTo.toLowerCase() !== entry.payTo.toLowerCase()) return false;
      return peek.option.amount <= entry.price;
    }
    try {
      const res = await fetchImpl(entry.url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
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
