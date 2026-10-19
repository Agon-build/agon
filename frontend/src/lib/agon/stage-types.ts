export type StageEventKind = "note" | "data" | "haggle" | "hire" | "refund" | "fail";
export type StageEvent = { at: string; text: string; kind: StageEventKind };
export type BargainStep = { step: "request" | "offer" | "counter" | "accept" | "walk" | "pay"; detail: string };
export type ReceiptPayment = { kind: string; amount: string; payer: string; payee: string; status: string; txUrl: string | null; detail: string | null };
/** `source` is optional so an API without the field still renders (as the Lead). */
export type ReceiptNode = { jobId: string; label: string; source?: "lead" | "agon" | "circle"; buyer: string; state: string; price: string; network: string; payments: ReceiptPayment[]; children: ReceiptNode[] };
export type StageAnswer = {
  probabilityBps: number; marketPriceBps: number | null; reasons: string[]; marketQuestion: string; marketEndsAt: string | null; marketSlug: string | null;
  forecaster: { name: string; reason: string; asked: string; agreed: string };
};
export type LivePhase = "quoted" | "paying" | "working" | "answered" | "refunded" | "failed";
export type LiveView = {
  jobId: string; rootId: string; question: string | null; phase: LivePhase; state: string; network: string; startedAt: string | null;
  events: StageEvent[]; haggle: BargainStep[]; answer: StageAnswer | null; failure: string | null; refunded: boolean; receipt: ReceiptNode | null; receiptUrl: string;
  preview?: boolean;
  /** What a routed service returned, for hires of anything other than the Lead agent. */
  result?: unknown;
};
export type StageConfig = { network: string; testnet: boolean; leadPrice: string | null; leadPriceAtomic: string | null; siteUrl: string; preview?: boolean };
export type StageWallet = {
  networkId: string; network: string; testnet: boolean; explorer: string; address: string; balance: string | null; balanceAtomic: string | null;
  perHire: string; daily: string; spentToday: string; leftToday: string; frozen: boolean; preview?: boolean;
};
/// Fields every quote can carry: the routing fee and total, and for a routed
/// hire the exact input sent and why Agon picked it.
type QuoteExtras = { fee?: string; total?: string; input?: Record<string, unknown>; source?: "agon" | "circle"; reason?: string };
export type AskResponse =
  | ({ ok: true; step: "confirm_code"; jobId: string; amount: string; amountAtomic?: string; providerLabel: string; network: string; testnet: boolean; expiresAt: string; code: string } & QuoteExtras)
  | ({ ok: true; step: "approval_link"; jobId: string; amount: string; amountAtomic?: string; providerLabel: string; network: string; testnet: boolean; expiresAt: string; approvalUrl: string } & QuoteExtras)
  | { ok: false; code: string; detail?: string; amount?: string; depositAddress?: string; question?: string; missing?: string[]; network?: "arc-testnet" | "arc" };
export type RoutePick = {
  source: "agon" | "circle"; reference: string; name: string; provider: string; category: string; description: string; method: "GET" | "POST";
  network: "arc-testnet" | "arc"; rating: { tier: "scored" | "verified" | "listed" | "unrated"; score: number | null }; reason: string;
  price: string; fee: string; total: string;
};
export type RouteSourceStatus = { id: string; status: "ok" | "unavailable" };
export type RouteResponse =
  | ({ kind: "lead" } & Partial<AskResponse>)
  | { kind: "pick"; routeId: string; pick: RoutePick; alternatives: RoutePick[]; sources: RouteSourceStatus[] }
  | { kind: "none"; sources: RouteSourceStatus[] }
  | { kind?: undefined; ok: false; code: string };
export type ConfirmResponse = { ok: true; jobId: string; amount: string; txHash: string | null } | { ok: false; code: string; jobId?: string; detail?: string };
export type HistoryItem = { jobId: string; question: string | null; state: string; price: string; createdAt: string; receiptUrl: string };
export type ApprovalView = {
  action: "over_limit_hire" | "withdraw" | "unfreeze"; title: string; network: string; testnet: boolean; expiresAt: string; jobId: string | null;
  rows: { label: string; value: string }[]; owner: "web" | "telegram";
};
export type ApprovalResult = { action: ApprovalView["action"]; ok: boolean; jobId?: string; transferId?: string; code?: string };
export type LeaderboardRow = {
  agentAddress: string; displayName: string; house: boolean; slateResolved: number; forecastsResolved: number; meanSkill: number; meanBrier: number | null;
  rating: number; ranked: boolean; rank: number | null;
};
export type LeaderboardResponse = { seasonId: string; network: string; commitsAddress: string; updatedAt: string; lastCommitAt: string | null; rows: LeaderboardRow[]; category?: string; minRanked?: number; preview?: boolean };
export type SeasonInfo = { seasonId: string; network: string; commitsAddress: string; commitsUrl: string; startsAt: string; endsAt: string; roundHours: number; currentRound: string | null };
export type SeasonEntry = { agentAddress: string; erc8004AgentId: string | null; displayName: string; house: boolean; forecastEndpoint: string | null; enteredRound: string };
export type SeasonRoundSummary = { round: string; state: "open" | "committing" | "committed" | "skipped"; openedAt: string; commitTx: string | null };
export type RatingCell = { rating: number; meanSkill: number; forecastsResolved: number; ranked: boolean; rank: number | null };
export type SeasonCategoryKey = "sports" | "crypto" | "economics" | "politics" | "world" | "culture";
export type RatingsResponse = {
  seasonId: string; updatedAt: string; categories: SeasonCategoryKey[]; minRanked: { overall: number; category: number };
  agents: { agentAddress: string; displayName: string; house: boolean; overall: RatingCell; categories: Record<SeasonCategoryKey, RatingCell> }[];
  preview?: boolean;
};
export const SEASON_CATEGORY_TABS: readonly { key: "overall" | SeasonCategoryKey; label: string }[] = [
  { key: "overall", label: "Overall" }, { key: "crypto", label: "Crypto" }, { key: "politics", label: "Politics" }, { key: "sports", label: "Sports" },
  { key: "economics", label: "Economics" }, { key: "world", label: "World" }, { key: "culture", label: "Culture" },
];
