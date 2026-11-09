import type { Address } from "viem";

import type { ChannelStore } from "../channels/types.ts";
import { agonNetwork, type AgonNetwork, type AgonNetworkId } from "../network.ts";
import { formatUsdc } from "../payments/bargain.ts";
import { ownerRefFromWalletRef } from "../payments/budget-wallets.ts";
import { peekApproval } from "../payments/limits.ts";
import type { ApprovalAction, PaymentsStore } from "../payments/types.ts";
import { hashChatUser, parseOwnerRef } from "./settings.ts";

export type ApprovalView = {
  action: ApprovalAction; title: string; network: string; testnet: boolean; expiresAt: string; jobId: string | null;
  rows: { label: string; value: string }[]; owner: "web" | "telegram";
};
export type ApprovalGateDeps = {
  payments: PaymentsStore; channels: ChannelStore; chatIdPepper: string | null; network: AgonNetwork; now: () => Date;
  /** The chat an account connected for deliveries through the bot's /start code (Account, Connect Telegram). */
  deliveryChatOf?: (operator: string) => Promise<string | null>;
};

const TITLES: Record<ApprovalAction, string> = { over_limit_hire: "Approve a hire", withdraw: "Approve a withdrawal", unfreeze: "Unfreeze your wallet" };

export async function describeApproval(
  deps: ApprovalGateDeps,
  token: string,
): Promise<{ ok: true; view: ApprovalView; walletRef: string } | { ok: false; code: "unknown" | "used" | "expired" }> {
  const peek = await peekApproval(deps.payments, { token, now: deps.now() });
  if (!peek.ok) return peek;
  const a = peek.approval;
  const owner = parseOwnerRef(ownerRefFromWalletRef(a.walletRef) ?? "");
  const rows: { label: string; value: string }[] = [];
  let jobId: string | null = null;
  // Each approval names its own network: a withdraw or unfreeze records it, a hire's job carries it.
  const recorded = a.payload.network === "arc" || a.payload.network === "arc-testnet" ? (a.payload.network as AgonNetworkId) : null;
  let network: AgonNetwork = recorded ? agonNetwork(recorded) : deps.network;
  if (a.action === "over_limit_hire") {
    const job = await deps.payments.getJob(String(a.payload.jobId ?? ""));
    if (!job) return { ok: false, code: "unknown" };
    jobId = job.jobId;
    network = agonNetwork(job.network);
    rows.push({ label: "Service", value: job.providerLabel }, { label: "Price", value: `${formatUsdc(job.priceAtomic)} USDC` });
    const rawFee = (job.request as { fee?: unknown }).fee;
    const fee = typeof rawFee === "string" && /^\d+$/.test(rawFee) ? BigInt(rawFee) : 0n;
    if (fee > 0n) rows.push({ label: "Agon routing fee", value: `${formatUsdc(fee)} USDC` }, { label: "Total", value: `${formatUsdc(job.priceAtomic + fee)} USDC` });
    const question = (job.request as { body?: { question?: unknown } }).body?.question;
    if (typeof question === "string") rows.push({ label: "Question", value: question });
  } else if (a.action === "withdraw") {
    rows.push({ label: "Amount", value: `${formatUsdc(BigInt(String(a.payload.amount ?? "0")))} USDC` }, { label: "To", value: String(a.payload.to ?? "") });
  } else {
    rows.push({ label: "Effect", value: "Spending from your Agon wallet starts again" });
  }
  rows.push({ label: "Network", value: network.label });
  return {
    ok: true,
    walletRef: a.walletRef,
    view: {
      action: a.action, title: TITLES[a.action], network: network.label, testnet: network.id === "arc-testnet", expiresAt: a.expiresAt.toISOString(),
      jobId, rows, owner: owner?.kind === "telegram" ? "telegram" : "web",
    },
  };
}

/// Owner decision P3-4: a website sign-in approves for a chat identity. Audit B2
/// (2026-11-09): the link must already exist and must have been made from the
/// chat side (Account, Connect Telegram, then /start in the bot). Opening an
/// approval link never links anything.
export async function authorizeApprover(
  deps: ApprovalGateDeps,
  walletRef: string,
  operator: Address,
): Promise<{ ok: true } | { ok: false; code: "wrong_account" | "unknown_owner" | "chat_not_configured" | "telegram_not_linked" }> {
  const owner = parseOwnerRef(ownerRefFromWalletRef(walletRef) ?? "");
  if (!owner) return { ok: false, code: "unknown_owner" };
  const me = operator.toLowerCase() as Address;
  if (owner.kind === "operator") return owner.address === me ? { ok: true } : { ok: false, code: "wrong_account" };
  if (!deps.chatIdPepper) return { ok: false, code: "chat_not_configured" };
  const linkedTelegram = await deps.channels.operatorTelegramId(me);
  if (linkedTelegram) {
    // An account that linked a Telegram through the website login widget can only approve for that same Telegram.
    return hashChatUser(deps.chatIdPepper, "telegram", linkedTelegram) === owner.userHash ? { ok: true } : { ok: false, code: "wrong_account" };
  }
  const account = await deps.channels.getAccount("telegram", owner.userHash);
  if (account?.operatorAddress) return account.operatorAddress.toLowerCase() === me ? { ok: true } : { ok: false, code: "wrong_account" };
  // Connected for deliveries before approvals read the chat account: that link was
  // also made by the bot's /start code, and a private chat's id is the user's id.
  const chat = deps.deliveryChatOf ? await deps.deliveryChatOf(me) : null;
  if (chat && hashChatUser(deps.chatIdPepper, "telegram", chat) === owner.userHash) return { ok: true };
  return { ok: false, code: chat ? "wrong_account" : "telegram_not_linked" };
}
