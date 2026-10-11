/// Sliding-window limiter kept in memory. One process serves the stage, so a
/// per-process window is enough to stop a stuck client from looping.
export function createRateLimiter(input: { limit: number; windowMs: number }): (key: string, nowMs?: number) => boolean {
  const hits = new Map<string, number[]>();
  return (key, nowMs = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < input.windowMs);
    if (recent.length >= input.limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    hits.set(key, recent);
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.every((t) => nowMs - t >= input.windowMs)) hits.delete(k);
    return true;
  };
}
