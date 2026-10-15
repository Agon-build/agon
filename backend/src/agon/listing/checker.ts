import type { ProviderDraftInput } from "../mcp/contract.ts";
import { createRateLimiter } from "../stage/rate-limit.ts";
import type { ListingCheckStore } from "./check-store.ts";
import { normalizeEndpoint, priceAtomic, type ListingCheckResult } from "./endpoint-check.ts";

/// A passing check lets the builder publish that endpoint at that price for this long.
export const CHECK_PASS_TTL_MS = 30 * 60_000;

export type ListingChecker = {
  check(actor: string, draft: ProviderDraftInput): Promise<{ ok: true; result: ListingCheckResult } | { ok: false; code: "rate_limited" }>;
  hasRecentPass(actor: string, draft: Pick<ProviderDraftInput, "endpoint" | "priceUSDC">): Promise<boolean>;
};

export function createListingChecker(deps: {
  store: ListingCheckStore;
  run: (draft: ProviderDraftInput) => Promise<ListingCheckResult>;
  limit?: (actor: string) => boolean;
  now?: () => Date;
}): ListingChecker {
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
  return {
    async check(actor, draft) {
      const who = actor.toLowerCase();
      if (!limit(who)) return { ok: false, code: "rate_limited" };
      const result = await deps.run(draft);
      await deps.store.record({ actor: who, endpoint: normalizeEndpoint(draft.endpoint), priceAtomic: priceAtomic(draft.priceUSDC), result, at: now() });
      return { ok: true, result };
    },
    async hasRecentPass(actor, draft) {
      const since = new Date(now().getTime() - CHECK_PASS_TTL_MS);
      return (await deps.store.latestPass(actor.toLowerCase(), normalizeEndpoint(draft.endpoint), priceAtomic(draft.priceUSDC), since)) !== null;
    },
  };
}
