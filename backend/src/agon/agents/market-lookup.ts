import { createMarketResolver } from "../polymarket/gamma.ts";
import { GAMMA, createGet } from "../polymarket/http.ts";
import type { Market, MarketChoice, ResolveResult } from "../polymarket/types.ts";

export { marketRefFrom, marketRefParts, type MarketRef } from "../polymarket/refs.ts";
export type { MarketChoice };

/// One Polymarket market as the specialist agents read it: two named outcomes with their
/// prices and tokens. `yesBps` is the first outcome's price, which is the Yes price on a Yes or
/// No market. An agent that needs Yes or No checks `yesNo` itself and refuses the rest.
/// The reading itself lives in the Polymarket data module; this is the agents' door to it.
export type MarketSnapshot = Market;
export type LookupResult = ResolveResult;
export type MarketLookup = (ref: string) => Promise<LookupResult>;

/// Gamma answers a market in about a second; several reads run one after another for one lookup.
const LOOKUP_TIMEOUT_MS = 6_000;

export function createMarketLookup(options: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): MarketLookup {
  const get = createGet({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), timeoutMs: LOOKUP_TIMEOUT_MS });
  return createMarketResolver({ get, base: options.baseUrl ?? GAMMA });
}
