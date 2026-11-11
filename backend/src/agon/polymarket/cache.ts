export type Kept<T> = { value: T; at: number; ageMs: number };

/// A short memory in front of Polymarket. Inside `ttlMs` the kept copy is returned without a
/// call. After it, a fresh read replaces the copy; if that read fails and the copy is younger
/// than `maxStaleMs`, the copy is returned with its age, otherwise the failure is thrown.
/// Callers for the same key share one read in flight.
export function createCache(opts: { now?: () => number; maxEntries?: number } = {}) {
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 2_000;
  const kept = new Map<string, { value: unknown; at: number }>();
  const flying = new Map<string, Promise<Kept<unknown>>>();

  async function read<T>(key: string, ttlMs: number, maxStaleMs: number, load: () => Promise<T>): Promise<Kept<T>> {
    const have = kept.get(key);
    if (have && now() - have.at < ttlMs) return { value: have.value as T, at: have.at, ageMs: now() - have.at };
    const inFlight = flying.get(key);
    if (inFlight) return inFlight as Promise<Kept<T>>;
    const fresh = (async (): Promise<Kept<unknown>> => {
      try {
        const value = await load();
        const at = now();
        if (kept.size >= maxEntries) kept.delete(kept.keys().next().value as string);
        kept.delete(key);
        kept.set(key, { value, at });
        return { value, at, ageMs: 0 };
      } catch (error) {
        const old = kept.get(key);
        if (old && now() - old.at < maxStaleMs) return { value: old.value, at: old.at, ageMs: now() - old.at };
        throw error;
      } finally {
        flying.delete(key);
      }
    })();
    flying.set(key, fresh);
    return fresh as Promise<Kept<T>>;
  }

  return { read };
}
