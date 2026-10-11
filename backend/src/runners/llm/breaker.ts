/// Fast-fail circuit breakers keyed by string. callModel keeps one per
/// provider family and one per Bedrock model, so a model that keeps failing
/// stops dragging every call through retries without blocking its neighbours.
/// After `fails` consecutive failures a key opens for `cooldownMs`; the first
/// call after the cooldown is a probe, and any success resets the key.
export function createBreakerSet(options: { fails: number; cooldownMs: number; now?: () => number; log?: (m: string) => void }) {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((m: string) => console.warn(m));
  const state = new Map<string, { fails: number; openUntil: number }>();
  const get = (key: string) => {
    let s = state.get(key);
    if (!s) state.set(key, (s = { fails: 0, openUntil: 0 }));
    return s;
  };
  return {
    open(key: string): boolean {
      return get(key).openUntil > now();
    },
    record(key: string, ok: boolean): void {
      const s = get(key);
      if (ok) {
        s.fails = 0;
        s.openUntil = 0;
        return;
      }
      s.fails += 1;
      if (s.fails >= options.fails) {
        s.openUntil = now() + options.cooldownMs;
        s.fails = 0;
        log(`llm: ${key} breaker OPEN for ${Math.round(options.cooldownMs / 1000)}s after ${options.fails} consecutive failures; calls fast-fail to fallbacks until it recovers`);
      }
    },
  };
}
