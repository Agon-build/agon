import type { BudgetClaim, BudgetLedger } from "../access-tokens.ts";

/// A quote a budget token is asked to pay: what it costs in total, where the service comes
/// from and which Hire categories it belongs to.
export type BudgetQuote = { jobId: string; total: bigint; source: "agon" | "circle"; categories: readonly string[] };
export type BudgetRefusal = "token_not_usable" | "outside_not_allowed" | "category_not_allowed" | "over_token_per_hire" | "over_token_daily";

export const BUDGET_REFUSALS: Readonly<Record<BudgetRefusal, string>> = {
  token_not_usable: "This agent token was revoked or has expired. The account owner can create a new one in Account.",
  outside_not_allowed: "This agent token may only hire Agon's own agents. The account owner can allow outside services on a new token.",
  category_not_allowed: "This agent token is not allowed to hire in this category.",
  over_token_per_hire: "This costs more than the token's limit for one hire. Nothing was paid.",
  over_token_daily: "This would pass the token's limit for today. Nothing was paid.",
};

/// The failures after which money may have moved. The budget keeps counting these; after any
/// other failure nothing was charged (payments/hire.ts payJob), so the reservation is released.
const MAY_HAVE_CHARGED = new Set(["delivery_failed", "delivery_unknown", "payment_unknown", "already_processed"]);
export const mayHaveCharged = (code: string): boolean => MAY_HAVE_CHARGED.has(code);

/// Checks a quote against the token's rules and reserves its cost against today's cap, in that
/// order. The reservation is made before any payment, so two hires at once cannot both pass the
/// cap. Fixed rules: the same token and quote always get the same answer.
export async function reserveBudget(ledger: BudgetLedger, budget: BudgetClaim, quote: BudgetQuote, now: Date): Promise<{ ok: true } | { ok: false; code: BudgetRefusal }> {
  // Revoking a token stops it at once, even on a connection that was checked a moment ago.
  if (!(await ledger.usable(budget.tokenId, now))) return { ok: false, code: "token_not_usable" };
  if (quote.source !== "agon" && !budget.allowOutside) return { ok: false, code: "outside_not_allowed" };
  if (budget.categories && !quote.categories.some((c) => budget.categories!.includes(c))) return { ok: false, code: "category_not_allowed" };
  if (quote.total <= 0n || quote.total > budget.perHireCap) return { ok: false, code: "over_token_per_hire" };
  const reserved = await ledger.reserve({ tokenId: budget.tokenId, jobId: quote.jobId, amount: quote.total, dailyCap: budget.dailyCap, now });
  // The same quote is never paid twice from a budget.
  return reserved === "reserved" ? { ok: true } : { ok: false, code: "over_token_daily" };
}

/// One budget hire at a time per account: a quote and its payment are made together, so the
/// code that is confirmed is always the one just quoted.
export function createOwnerQueue(): <T>(owner: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T,>(owner: string, run: () => Promise<T>): Promise<T> => {
    const next = (tails.get(owner) ?? Promise.resolve()).then(run, run);
    const tail = next.catch(() => {});
    tails.set(owner, tail);
    void tail.then(() => { if (tails.get(owner) === tail) tails.delete(owner); });
    return next;
  };
}
