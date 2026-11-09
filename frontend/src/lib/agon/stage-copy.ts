import type { StageEventKind } from "./stage-types.ts";

export const KIND_LABEL: Record<StageEventKind, string> = {
  note: "Step", data: "Data bought", haggle: "Haggle", hire: "Hired", refund: "Refund", fail: "Problem",
};

/// A market agent refused the request before asking for payment.
const MARKET_REFUSALS: Record<string, string> = {
  market_not_found: "That market was not found on Polymarket. Check the link, slug or condition id. Nothing was charged.",
  market_closed: "That market has already closed, so there is nothing left to do on it. Nothing was charged.",
  not_yes_no: "Only Yes or No markets are supported. Nothing was charged.",
  not_a_football_market: "This agent only works on football markets. Nothing was charged.",
  market_unavailable: "Polymarket did not answer. Try again in a minute. Nothing was charged.",
};

const ASK: Record<string, string> = {
  invalid_question: "Ask a full question, between 8 and 300 characters.",
  not_hireable: "This agent cannot be hired right now. Pick another on the Agents page.",
  payments_off: "Payments are paused right now. Try again shortly.",
  frozen: "Your wallet is frozen. Unfreeze it to hire again.",
  provider_unreachable: "The lead agent did not answer. Try again in a moment.",
  service_unreachable: "That service did not answer. Nothing was charged. Try again or pick another.",
  service_refused: "That service turned the request down. Nothing was charged. Pick another service.",
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
  route_expired: "These choices expired. Search again.",
  ...MARKET_REFUSALS,
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
  ...MARKET_REFUSALS,
};

export const confirmFailureText = (code: string) => CONFIRM[code] ?? "The payment did not go through. Nothing more will be charged.";

const FAILURE: Record<string, string> = {
  no_market: "Polymarket has no open market that matches this question.",
  market_started: "The market for this already started, so it can no longer be forecast.",
  no_forecaster: "No forecaster could deliver within the budget.",
  lead_error: "Something went wrong while the agents worked.",
  delivery_failed: "The lead agent was paid but did not deliver.",
  delivery_unknown: "The payment landed but the answer did not arrive.",
  payment_expired_unused: "The payment authorization expired unused. Nothing was charged.",
  never_signed: "The payment was never signed. Nothing was charged.",
  ...MARKET_REFUSALS,
};

export const failureText = (code: string | null) => (code ? FAILURE[code] : undefined) ?? "The agents could not finish this job.";

const APPROVAL: Record<string, string> = {
  wrong_account: "This approval belongs to a different Agon account. Sign in with the account linked to this chat.",
  unknown_owner: "This approval does not belong to an Agon wallet.",
  chat_not_configured: "Chat approvals are not set up on this server.",
  telegram_not_linked: "This chat is not connected to an Agon account yet. Open Account, tap Connect Telegram, then tap Start in the bot.",
  used: "This link was already used.",
  expired: "This link expired. Ask again from the chat or the app.",
  not_found: "This link is not valid.",
  unknown: "This link is not valid.",
  unauthorized: "Sign in to approve.",
  fee_owed: "Agon fees you owe come out of this balance first. Withdraw a little less, or try again once they are paid.",
};

export const approvalFailureText = (code: string) => APPROVAL[code] ?? CONFIRM[code] ?? "The approval did not go through.";

/// The first line after an approval. A hire reads as paid only once it is answered (audit F4).
export function approvalDoneText(action: string, phase: string | null | undefined): string {
  if (action === "withdraw") return "Withdrawal started. It lands on Arc in a few seconds.";
  if (action === "unfreeze") return "Your wallet is unfrozen.";
  if (phase === "answered") return "Approved and paid.";
  if (phase === "refunded") return "Approved, but the hire failed and your payment was refunded.";
  if (phase === "failed") return "Approved, but the hire did not finish. The receipt shows what was charged.";
  return "Approved. Paying.";
}

/// Shown on a Telegram approval. Only the account connected to the chat can approve (audit B2).
export const APPROVE_TELEGRAM_NOTE = "Only the Agon account connected to this Telegram chat can approve. To connect it, open Account and tap Connect Telegram.";

/// Said before anyone pays an outside service (audit H2). Matches the server's own note.
export const OUTSIDE_PAYMENT_NOTE = "Paid to an outside service up front. Agon cannot refund it if no answer comes, and takes its fee only if one does.";
/// On a service that recently took payment and sent no answer.
export const RECENTLY_FAILED_MARK = "Took payment with no answer in the last day";

const WALLET: Record<string, string> = {
  above_current: "Limits can only go up to the starting limits.",
  above_default: "That is above the starting limits for this wallet.",
  above_withdrawable: "Agon fees you owe stay in the wallet.",
  not_positive: "Limits must be above zero.",
  bad_amount: "Enter an amount above zero.",
  bad_address: "Enter a full 0x wallet address.",
  no_wallet: "Your agent wallet is not set up yet.",
};

/// A refused wallet change in plain words; a withdrawal over the limit names the most it can be.
export const walletRefusalText = (code: string | undefined, max?: string) =>
  code === "above_withdrawable" && max ? `You can withdraw up to ${max} USDC now. Agon fees you owe stay in the wallet.` : (code && WALLET[code]) || "That did not work. Try again.";

/// A question is the heading. A hire's raw input (links, slugs, one per line) is not a sentence:
/// it shows as a plain list under "Hire <agent>".
export function hireHeading(question: string | null, agentName: string | null): { title: string | null; lines: string[] | null } {
  if (!question) return { title: null, lines: null };
  const lines = question.split("\n").map((l) => l.trim()).filter(Boolean);
  const isInput = lines.length > 1 || (lines.length === 1 && !/\s/.test(lines[0]!) && lines[0]!.length > 24);
  return isInput ? { title: `Hire ${agentName ?? "this agent"}`, lines } : { title: question, lines: null };
}

/// "The payment is still confirming" is only true until the job settles one way or the other.
export function showConfirmError(code: string | null | undefined, phase: string | null | undefined): boolean {
  if (!code) return false;
  return !(code === "payment_unknown" && (phase === "failed" || phase === "answered" || phase === "refunded"));
}

/// The states of the Hire choices list.
export const CHOICES_COPY = {
  loading: "Finding agents for this.",
  empty: "No agents here yet.",
  listOne: "List an agent",
  circleDown: "Circle is not answering right now.",
  outsideNote: "Outside services are listed by price. Agon has no proof for them, so it does not rank them.",
  newNote: "Listed on Agon with no proof yet. You can hire them; they are not ranked.",
  categories: "Or browse by category",
  change: "Change category",
} as const;
