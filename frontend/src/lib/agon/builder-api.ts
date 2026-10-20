import type { DraftInput } from "./listing-flow.ts";
import { agonCall } from "./stage.ts";

/// The signed-in builder API (/agon/builder): listing drafts and Agent access tokens.
export type ListingCheckRow = { name: "secure_endpoint" | "asks_for_payment" | "price_matches" | "certification"; status: "passed" | "failed" | "skipped"; required: boolean; detail: string };
export type CheckResult = { draftId: string; checks: ListingCheckRow[]; requiredPassed: boolean; certificationScore: number | null; nextAction: string };
export type PublishingResult = {
  status: "fund_wallet" | "review_terms" | "pending" | "ready" | "published" | "needs_attention";
  nextAction: string; draftId: string; chainId: number; fundingAddress: string | null; balanceUSDC: string | null;
  termsDigest: string; custody: string; agentId: string | null; reference: string | null; txHash: string | null; feeUSDC?: string;
};
export type DraftSummary = { draftId: string; name: string; endpoint: string; priceUSDC: string; state: string; publishing: PublishingResult | null };
export type DraftDetail = { draftId: string; draft: DraftInput; state: string; publishing: PublishingResult | null; feeUSDC: string };
export type TokenRow = { id: string; name: string; level: "read" | "listing" | "hiring" | "full"; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null; active: boolean };

const base = "/agon/builder";
const id = (draftId: string) => encodeURIComponent(draftId);

export const createDraft = (input: DraftInput) => agonCall<{ draftId: string }>(`${base}/drafts`, { body: input });
export const listDrafts = () => agonCall<{ drafts: DraftSummary[] }>(`${base}/drafts`);
export const getDraft = (draftId: string) => agonCall<DraftDetail>(`${base}/drafts/${id(draftId)}`);
export const runChecks = (draftId: string) => agonCall<CheckResult>(`${base}/drafts/${id(draftId)}/check`, { body: {}, timeoutMs: 60_000 });
/// With a listing reference the draft becomes that listing's next version, from the same wallet and agent.
export const setupPublishing = (draftId: string, updates?: string) =>
  agonCall<PublishingResult>(`${base}/drafts/${id(draftId)}/setup`, { body: updates ? { updates } : {}, timeoutMs: 30_000 });
/// The details one of this account's listings was published with, to start an update from.
export const getListingDraft = (reference: string) => agonCall<{ draft: DraftInput }>(`${base}/listings/${encodeURIComponent(reference)}/draft`);
export const approvePublishing = (draftId: string, termsDigest: string) => agonCall<PublishingResult>(`${base}/drafts/${id(draftId)}/approve`, { body: { termsDigest } });
export const advancePublishing = (draftId: string) => agonCall<PublishingResult>(`${base}/drafts/${id(draftId)}/advance`, { body: {}, timeoutMs: 30_000 });

export const listTokens = () => agonCall<{ tokens: TokenRow[] }>(`${base}/tokens`);
export const createToken = (input: { name: string; level: TokenRow["level"]; days: 30 | 90 }) =>
  agonCall<{ token: string; record: Pick<TokenRow, "id" | "name" | "level" | "createdAt" | "expiresAt"> }>(`${base}/tokens`, { body: input });
export const revokeToken = (tokenId: string) => agonCall<{ ok: true }>(`${base}/tokens/${encodeURIComponent(tokenId)}/revoke`, { body: {} });
