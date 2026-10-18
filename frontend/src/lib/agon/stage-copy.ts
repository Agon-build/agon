import type { StageEventKind } from "./stage-types.ts";

export const KIND_LABEL: Record<StageEventKind, string> = {
  note: "Step", data: "Data bought", haggle: "Haggle", hire: "Hired", refund: "Refund", fail: "Problem",
};

const ASK: Record<string, string> = {
  invalid_question: "Ask a full question, between 8 and 300 characters.",
  payments_off: "Payments are paused right now. Try again shortly.",
  frozen: "Your wallet is frozen. Unfreeze it to hire again.",
  provider_unreachable: "The lead agent did not answer. Try again in a moment.",
  no_matching_option: "The lead agent's payment terms do not match this network.",
  provider_free: "The lead agent answered without asking for payment. Try again in a moment.",
  rate_limited: "That was a lot of requests. Wait a minute, then ask again.",
  web_off: "Asking from the web is paused right now.",
  unauthorized: "Your sign-in ended. Sign in again and Agon will ask your question.",
  network_unavailable: "Agon could not be reached. Check your connection.",
  busy: "Agon is busy setting up new wallets right now. Try again in a few minutes.",
  terms_required: "Accept the agent wallet terms to continue.",
  no_match: "Nothing on Agon or Circle fits this yet. Try describing it differently.",
  outside_off: "That service is on Circle and outside hires are switched off right now.",
  terms_changed: "That service changed its price or payee just now. Nothing was charged; ask again.",
  route_expired: "That choice expired. Ask again for a fresh pick.",
};

export function askRefusalText(code: string, amount?: string): string {
  if (code === "insufficient_balance") return `Your agent wallet needs ${amount ?? "more"} USDC for this hire.`;
  if (code === "over_your_max") return `This costs ${amount ?? "more"} USDC in total, more than the maximum you set.`;
  return ASK[code] ?? "Agon could not prepare this request. Try again in a moment.";
}

const CONFIRM: Record<string, string> = {
  wrong_code: "That code did not match this quote.",
  expired: "This quote expired. Ask again for a fresh price.",
  no_pending: "There is no quote waiting. Ask again.",
  already_used: "This quote was already paid.",
  already_processed: "This quote was already paid.",
  too_many_attempts: "Too many tries for this quote. Ask again.",
  over_daily: "This would pass your daily limit. It resets at midnight UTC.",
  over_per_payment: "This is over your per-hire limit.",
  frozen: "Your wallet is frozen. Unfreeze it to hire again.",
  payments_off: "Payments are paused right now. Nothing was charged.",
  delivery_failed: "The lead agent was paid but did not deliver. The receipt shows the payment.",
  payment_unknown: "The payment is still confirming on Arc. This page updates when it lands.",
  signing_refused: "Your wallet refused to sign because the terms changed. Nothing was charged.",
  price_over_limit: "The price changed after the quote. Nothing was charged; ask again.",
  payee_mismatch: "The payee changed after the quote. Nothing was charged; ask again.",
  network_unavailable: "Agon could not be reached. Check your connection; the receipt shows whether you paid.",
};

export const confirmFailureText = (code: string) => CONFIRM[code] ?? "The payment did not go through. Nothing more will be charged.";

const FAILURE: Record<string, string> = {
  no_market: "Polymarket has no open market that matches this question.",
  no_forecaster: "No forecaster could deliver within the budget.",
  lead_error: "Something went wrong while the agents worked.",
  delivery_failed: "The lead agent was paid but did not deliver.",
  delivery_unknown: "The payment landed but the answer did not arrive.",
  payment_expired_unused: "The payment authorization expired unused. Nothing was charged.",
  never_signed: "The payment was never signed. Nothing was charged.",
};

export const failureText = (code: string | null) => (code ? FAILURE[code] : undefined) ?? "The agents could not finish this job.";

const APPROVAL: Record<string, string> = {
  wrong_account: "This approval belongs to a different Agon account. Sign in with the account linked to this chat.",
  unknown_owner: "This approval does not belong to an Agon wallet.",
  chat_not_configured: "Chat approvals are not set up on this server.",
  used: "This link was already used.",
  expired: "This link expired. Ask again from the chat or the app.",
  not_found: "This link is not valid.",
  unknown: "This link is not valid.",
  unauthorized: "Sign in to approve.",
};

export const approvalFailureText = (code: string) => APPROVAL[code] ?? CONFIRM[code] ?? "The approval did not go through.";
