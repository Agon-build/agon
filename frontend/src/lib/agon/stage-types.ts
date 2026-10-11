export type StageEventKind = "note" | "data" | "haggle" | "hire" | "refund" | "fail";
export type StageEvent = { at: string; text: string; kind: StageEventKind };
export type BargainStep = { step: "request" | "offer" | "counter" | "accept" | "walk" | "pay"; detail: string };
export type ReceiptPayment = { kind: string; amount: string; payer: string; payee: string; status: string; txUrl: string | null; detail: string | null };
export type ReceiptNode = { jobId: string; label: string; buyer: string; state: string; price: string; network: string; payments: ReceiptPayment[]; children: ReceiptNode[] };
export type StageAnswer = {
  probabilityBps: number; marketPriceBps: number | null; reasons: string[]; marketQuestion: string; marketEndsAt: string | null; marketSlug: string | null;
  forecaster: { name: string; reason: string; asked: string; agreed: string };
};
export type LivePhase = "quoted" | "paying" | "working" | "answered" | "refunded" | "failed";
export type LiveView = {
  jobId: string; rootId: string; question: string | null; phase: LivePhase; state: string; network: string; startedAt: string | null;
  events: StageEvent[]; haggle: BargainStep[]; answer: StageAnswer | null; failure: string | null; refunded: boolean; receipt: ReceiptNode | null; receiptUrl: string;
  preview?: boolean;
};
export type StageConfig = { network: string; testnet: boolean; leadPrice: string | null; leadPriceAtomic: string | null; siteUrl: string; preview?: boolean };
export type StageWallet = {
  networkId: string; network: string; testnet: boolean; explorer: string; address: string; balance: string | null; balanceAtomic: string | null;
  perHire: string; daily: string; spentToday: string; leftToday: string; frozen: boolean; preview?: boolean;
};
export type AskResponse =
  | { ok: true; step: "confirm_code"; jobId: string; amount: string; amountAtomic: string; providerLabel: string; network: string; testnet: boolean; expiresAt: string; code: string }
  | { ok: true; step: "approval_link"; jobId: string; amount: string; amountAtomic: string; providerLabel: string; network: string; testnet: boolean; expiresAt: string; approvalUrl: string }
  | { ok: false; code: string; detail?: string; amount?: string; depositAddress?: string };
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
export type LeaderboardResponse = { seasonId: string; network: string; commitsAddress: string; updatedAt: string; lastCommitAt: string | null; rows: LeaderboardRow[]; preview?: boolean };
export type SeasonInfo = { seasonId: string; network: string; commitsAddress: string; commitsUrl: string; startsAt: string; endsAt: string; roundHours: number; currentRound: string | null };
export type SeasonEntry = { agentAddress: string; erc8004AgentId: string | null; displayName: string; house: boolean; forecastEndpoint: string | null; enteredRound: string };
export type SeasonRoundSummary = { round: string; state: "open" | "committing" | "committed" | "skipped"; openedAt: string; commitTx: string | null };
