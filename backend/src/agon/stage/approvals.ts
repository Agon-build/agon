import type { Address } from "viem";

import type { ChannelStore } from "../channels/types.ts";
import type { AgonNetwork } from "../network.ts";
import { formatUsdc } from "../payments/bargain.ts";
import { ownerRefFromWalletRef } from "../payments/budget-wallets.ts";
import { peekApproval } from "../payments/limits.ts";
import type { ApprovalAction, PaymentsStore } from "../payments/types.ts";
import { hashChatUser, parseOwnerRef } from "./settings.ts";

export type ApprovalView = {
  action: ApprovalAction; title: string; network: string; testnet: boolean; expiresAt: string; jobId: string | null;
  rows: { label: string; value: string }[]; owner: "web" | "telegram";
};
export type ApprovalGateDeps = { payments: PaymentsStore; channels: ChannelStore; chatIdPepper: string | null; network: AgonNetwork; now: () => Date };

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
  if (a.action === "over_limit_hire") {
    const job = await deps.payments.getJob(String(a.payload.jobId ?? ""));
    if (!job) return { ok: false, code: "unknown" };
    jobId = job.jobId;
    rows.push({ label: "Service", value: job.providerLabel }, { label: "Price", value: `${formatUsdc(job.priceAtomic)} USDC` });
    const question = (job.request as { body?: { question?: unknown } }).body?.question;
    if (typeof question === "string") rows.push({ label: "Question", value: question });
  } else if (a.action === "withdraw") {
    rows.push({ label: "Amount", value: `${formatUsdc(BigInt(String(a.payload.amount ?? "0")))} USDC` }, { label: "To", value: String(a.payload.to ?? "") });
  } else {
    rows.push({ label: "Effect", value: "Spending from your Agon wallet starts again" });
  }
  rows.push({ label: "Network", value: deps.network.label });
  return {
    ok: true,
    walletRef: a.walletRef,
    view: {
      action: a.action, title: TITLES[a.action], network: deps.network.label, testnet: deps.network.id === "arc-testnet", expiresAt: a.expiresAt.toISOString(),
      jobId, rows, owner: owner?.kind === "telegram" ? "telegram" : "web",
    },
  };
}

/// Owner decision P3-4: a website sign-in, linked once to the chat identity.
export async function authorizeApprover(
  deps: ApprovalGateDeps,
  walletRef: string,
  operator: Address,
): Promise<{ ok: true } | { ok: false; code: "wrong_account" | "unknown_owner" | "chat_not_configured" }> {
  const owner = parseOwnerRef(ownerRefFromWalletRef(walletRef) ?? "");
  if (!owner) return { ok: false, code: "unknown_owner" };
  const me = operator.toLowerCase() as Address;
  if (owner.kind === "operator") return owner.address === me ? { ok: true } : { ok: false, code: "wrong_account" };
  if (!deps.chatIdPepper) return { ok: false, code: "chat_not_configured" };
  const linkedTelegram = await deps.channels.operatorTelegramId(me);
  if (linkedTelegram) {
    // An account that already linked a Telegram on the website can only approve for that same Telegram.
    return hashChatUser(deps.chatIdPepper, "telegram", linkedTelegram) === owner.userHash ? { ok: true } : { ok: false, code: "wrong_account" };
  }
  const link = await deps.channels.linkOperator("telegram", owner.userHash, me);
  if (link === "linked" || link === "already_same") return { ok: true };
  return { ok: false, code: link === "no_account" ? "unknown_owner" : "wrong_account" };
}
