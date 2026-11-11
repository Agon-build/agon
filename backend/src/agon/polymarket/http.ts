/// Polymarket did not answer in time, answered with an error, or sent a shape Agon does not know.
/// Callers show "unavailable"; nothing is ever guessed in its place.
export class PolymarketUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolymarketUnavailable";
  }
}

export const GAMMA = "https://gamma-api.polymarket.com";
export const CLOB = "https://clob.polymarket.com";
export const DATA = "https://data-api.polymarket.com";
export const DEFAULT_TIMEOUT_MS = 3_000;

export type Get = (base: string, path: string) => Promise<unknown>;

/// One keyless GET with a time limit. Any failure is `PolymarketUnavailable`.
export function createGet(opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Get {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (base, path) => {
    const where = `${new URL(base).hostname}${path.split("?")[0]}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new PolymarketUnavailable(`${where} did not answer in ${timeoutMs} ms`)); }, timeoutMs);
      });
      const res = await Promise.race([fetchImpl(`${base}${path}`, { headers: { accept: "application/json" }, signal: controller.signal }), late]);
      if (!res.ok) throw new PolymarketUnavailable(`${where} answered ${res.status}`);
      return await Promise.race([res.json() as Promise<unknown>, late]);
    } catch (error) {
      if (error instanceof PolymarketUnavailable) throw error;
      throw new PolymarketUnavailable(`${where} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
