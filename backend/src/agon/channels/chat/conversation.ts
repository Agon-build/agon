import type { ChannelStore, ChatChannel } from "../types.ts";
import { formatUsdc } from "../../payments/bargain.ts";
import type { ReceiptNode } from "../../payments/jobs.ts";
import type { LiveView, StageServices, WalletView } from "../../stage/services.ts";
import { hashChatUser } from "../../stage/settings.ts";
import { parseCodeIntent, type ChatIntent } from "./intents.ts";
import type { ChatInbound, ChatReply } from "./types.ts";

export const CHAT_TERMS_VERSION = "chat-2026-10-11";

export type ConversationDeps = {
  services: StageServices;
  channels: ChannelStore;
  channel: ChatChannel;
  ownerRefOf: (userHash: string) => string;
  pepper: string;
  classify: (text: string) => Promise<ChatIntent>;
  reply: { send(r: ChatReply): Promise<number | null>; edit(messageId: number, r: ChatReply): Promise<boolean> };
  off: () => boolean;
  now: () => Date;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Per-user message limit; true while under it. */
  limit?: (userHash: string) => boolean;
};

const EXAMPLE = "What's the real chance BTC closes above $120k on Friday?";
const FAILURE: Record<string, string> = {
  no_market: "Polymarket has no open market that matches this question",
  no_forecaster: "no forecaster could deliver within the budget",
  lead_error: "something went wrong while the agents worked",
  delivery_failed: "the lead agent was paid but did not deliver",
  delivery_unknown: "the payment landed but the answer did not arrive",
};
const CONFIRM_FAILURE: Record<string, string> = {
  wrong_code: "That code did not match your quote. Check it and reply YES with the 4 digits.",
  expired: "That quote expired. Ask again for a fresh price.",
  no_pending: "There is no quote waiting. Ask a question first.",
  already_used: "That quote is closed: it was paid or cancelled. Ask again for a new one.",
  already_processed: "That quote is closed: it was paid or cancelled. Ask again for a new one.",
  too_many_attempts: "Too many tries for that quote. Ask again.",
  over_daily: "That would pass your daily limit. It resets at midnight UTC.",
  frozen: "Your wallet is frozen. Reply unfreeze to get an approval link.",
  payments_off: "Payments are paused right now. Nothing was charged.",
  payment_unknown: "The payment is still confirming on Arc. Your receipt will update when it lands.",
};

function countPayments(node: ReceiptNode | null): number {
  if (!node) return 0;
  return node.payments.length + node.children.reduce((n, c) => n + countPayments(c), 0);
}

/// Testnet wallets start empty; Circle's faucet is where test USDC comes from.
const FAUCET_URL = "https://faucet.circle.com";
const FAUCET_LINE = `Get test USDC at ${FAUCET_URL} (choose Arc Testnet).`;
const faucetButtons = (testnet: boolean): ChatReply["buttons"] => (testnet ? [[{ label: "Get test USDC", url: FAUCET_URL }]] : undefined);

const networkLine = (s: StageServices) => `${s.network.label}, ${s.network.id === "arc-testnet" ? "test USDC" : "real USDC"}`;

function terms(): ChatReply {
  return {
    text: [
      "Welcome to Agon. Agents here forecast market questions and pay each other in USDC on Arc.",
      "",
      "Before you start:",
      "- Agon holds a small USDC balance for you in a wallet it runs on your behalf. It only pays what you confirm, within limits (0.50 per hire, 2.00 per day) that you can lower.",
      "- You confirm every payment with a code. Withdrawals and larger payments are approved in your browser.",
      "- You can withdraw your balance at any time.",
    ].join("\n"),
    buttons: [[{ label: "I agree", data: "terms:accept" }]],
  };
}

function welcome(w: WalletView): ChatReply {
  return {
    text: [
      `You're in. Your Agon wallet: ${w.address}`,
      `Balance: ${w.balance === null ? "unavailable right now" : `${formatUsdc(w.balance)} USDC`} on ${w.network}.`,
      w.testnet ? FAUCET_LINE : "Send USDC on Arc to that address to add funds.",
      "Commands: /balance /deposit /history /leaderboard /limits /freeze /withdraw /help",
      "",
      `Ask me a question, for example: ${EXAMPLE}`,
    ].join("\n"),
    buttons: faucetButtons(w.testnet),
  };
}

function help(siteUrl: string): ChatReply {
  return {
    text: [
      "I can forecast market questions and manage your Agon wallet.",
      `Ask a question, for example: ${EXAMPLE}`,
      "",
      "Wallet: balance, deposit, limits, history, freeze, unfreeze, withdraw",
      "Season 1: leaderboard",
      `Web: ${siteUrl}/ask`,
    ].join("\n"),
  };
}

function progressReply(live: LiveView, amount: string, network: string): ChatReply {
  const head = live.phase === "paying" || live.phase === "quoted" ? `Paying ${amount} USDC on ${network}...` : "Paid. Working on it...";
  const lines = live.events.filter((e) => e.kind === "data" || e.kind === "hire" || e.kind === "fail" || e.kind === "refund").map((e) => `- ${e.text}`);
  return { text: [head, ...lines].join("\n") };
}

function finalReply(live: LiveView | null): ChatReply {
  if (!live) return { text: "Paid. The answer will appear on your receipt." };
  const receipt = { label: "Open receipt", url: live.receiptUrl };
  if (live.answer) {
    const a = live.answer;
    const agon = Math.round(a.probabilityBps / 100);
    const market = a.marketPriceBps === null ? null : Math.round(a.marketPriceBps / 100);
    return {
      text: [
        `Forecast: ${agon}% chance.${market === null ? "" : ` Polymarket says ${market}%.`}`,
        "Why:",
        ...a.reasons.map((r, i) => `${i + 1}. ${r}`),
        `Forecast by ${a.forecaster.name}, ${a.forecaster.reason}.`,
        countPayments(live.receipt) === 1 ? `Receipt for 1 payment: ${live.receiptUrl}` : `Receipts for all ${countPayments(live.receipt)} payments: ${live.receiptUrl}`,
      ].join("\n"),
      buttons: [[receipt]],
    };
  }
  const why = FAILURE[live.failure ?? ""] ?? "the agents could not finish this job";
  if (live.phase === "refunded") return { text: `No forecast this time: ${why}. Your payment was refunded.\nReceipt: ${live.receiptUrl}`, buttons: [[receipt]] };
  return { text: `The job did not finish: ${why}.\nReceipt: ${live.receiptUrl}`, buttons: [[receipt]] };
}

async function confirmAndWatch(deps: ConversationDeps, ownerRef: string, code: string): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const jobId = await deps.services.pendingJob(ownerRef);
  let finished = false;
  const done = deps.services.confirm(ownerRef, code).finally(() => { finished = true; });
  let messageId: number | null = null;
  let shown = "";
  const network = deps.services.network.label;
  const amountOf = (live: LiveView) => live.receipt?.price ?? "";
  while (!finished && jobId) {
    await sleep(deps.pollMs ?? 1500);
    const live = await deps.services.live(jobId).catch(() => null);
    if (!live || live.phase === "quoted") continue;
    const reply = progressReply(live, amountOf(live), network);
    if (messageId === null) {
      messageId = await deps.reply.send(reply);
      shown = reply.text;
    } else if (reply.text !== shown) {
      await deps.reply.edit(messageId, reply);
      shown = reply.text;
    }
  }
  const out = await done;
  if (!out.ok) {
    const text = CONFIRM_FAILURE[out.code] ?? "The payment did not go through.";
    if (messageId !== null) await deps.reply.edit(messageId, { text });
    else await deps.reply.send({ text });
    return;
  }
  const live = await deps.services.live(out.jobId).catch(() => null);
  if (live) {
    const reply = progressReply(live, amountOf(live), network);
    if (messageId === null) await deps.reply.send(reply);
    else if (reply.text !== shown) await deps.reply.edit(messageId, reply);
  }
  await deps.reply.send(finalReply(live));
}

async function act(deps: ConversationDeps, ownerRef: string, intent: ChatIntent): Promise<void> {
  const s = deps.services;
  switch (intent.kind) {
    case "forecast": {
      const quote = await s.ask(ownerRef, { question: intent.question, ...(intent.maxPrice !== null ? { maxPrice: intent.maxPrice } : {}) });
      if (quote.ok && quote.step === "confirm_code") {
        const price = formatUsdc(quote.amount);
        await deps.reply.send({
          text: `${quote.providerLabel} will forecast this for ${price} USDC (${networkLine(s)}).\nQuestion: ${intent.question}\nReply YES ${quote.code} to pay. Expires in 5 min.`,
          buttons: [[{ label: `Pay ${price} USDC`, data: `yes:${quote.code}` }, { label: "Cancel", data: "cancel" }]],
        });
        return;
      }
      if (quote.ok) {
        const wallet = await s.wallet(ownerRef);
        await deps.reply.send({
          text: `This costs ${formatUsdc(quote.amount)} USDC, over your per-hire limit of ${formatUsdc(wallet.perHireCap)}. Approve it in your browser; the link works once, for 15 minutes.`,
          buttons: [[{ label: "Approve in browser", url: quote.approvalUrl }]],
        });
        return;
      }
      if (quote.code === "insufficient_balance") {
        const testnet = s.network.id === "arc-testnet";
        await deps.reply.send({
          text: `You need ${formatUsdc(quote.amount ?? 0n)} USDC in your Agon wallet first.\nSend USDC on ${s.network.label} to:\n${quote.depositAddress}${testnet ? `\n${FAUCET_LINE}` : ""}\nThen ask again.`,
          buttons: faucetButtons(testnet),
        });
        return;
      }
      const reasons: Record<string, string> = {
        over_your_max: `The lead agent charges ${formatUsdc(quote.amount ?? 0n)} USDC, more than the maximum you gave.`,
        invalid_question: "Ask a full question, between 8 and 300 characters.",
        frozen: "Your wallet is frozen. Reply unfreeze to get an approval link.",
        payments_off: "Payments are paused right now. Try again shortly.",
        busy: "Agon is busy setting up new wallets right now. Try again in a few minutes.",
      };
      await deps.reply.send({ text: reasons[quote.code] ?? "The lead agent is not available right now. Try again in a moment." });
      return;
    }
    case "confirm":
      await confirmAndWatch(deps, ownerRef, intent.code);
      return;
    case "cancel":
      await s.cancel(ownerRef);
      await deps.reply.send({ text: "Cancelled. Nothing was paid." });
      return;
    case "balance": {
      const w = await s.wallet(ownerRef);
      await deps.reply.send({ text: `Balance: ${w.balance === null ? "unavailable right now" : `${formatUsdc(w.balance)} USDC`} on ${w.network}. Left today: ${formatUsdc(w.leftToday)} of ${formatUsdc(w.dailyCap)}. Up to ${formatUsdc(w.perHireCap)} per hire.${w.frozen ? " Frozen." : ""}` });
      return;
    }
    case "deposit": {
      const w = await s.wallet(ownerRef);
      await deps.reply.send({ text: `Send USDC on ${w.network} to:\n${w.address}\nIt stays yours; you can withdraw any time.${w.testnet ? `\n${FAUCET_LINE}` : ""}`, buttons: faucetButtons(w.testnet) });
      return;
    }
    case "limits": {
      if (intent.perHire === null && intent.daily === null) {
        const w = await s.wallet(ownerRef);
        await deps.reply.send({ text: `Up to ${formatUsdc(w.perHireCap)} per hire and ${formatUsdc(w.dailyCap)} per day. To lower them, reply for example: limits 0.20 per hire 1 per day` });
        return;
      }
      const out = await s.lowerLimits(ownerRef, { ...(intent.perHire !== null ? { perHireCap: intent.perHire } : {}), ...(intent.daily !== null ? { dailyCap: intent.daily } : {}) });
      if (!out.ok) {
        await deps.reply.send({ text: out.code === "above_default" ? "Limits can only be lowered here, up to 0.50 per hire and 2.00 per day." : "Those limits did not work. Try: limits 0.20 per hire" });
        return;
      }
      const w = await s.wallet(ownerRef);
      await deps.reply.send({ text: `Done. Up to ${formatUsdc(w.perHireCap)} per hire and ${formatUsdc(w.dailyCap)} per day.` });
      return;
    }
    case "history": {
      const items = await s.history(ownerRef, 5);
      await deps.reply.send({ text: items.length === 0 ? "No asks yet." : ["Your recent asks:", ...items.map((i) => `- ${i.question ?? "Agent job"} (${i.state}, ${i.price} USDC) ${i.receiptUrl}`)].join("\n") });
      return;
    }
    case "leaderboard": {
      const rows = await s.leaderboard(5);
      if (!rows || rows.length === 0) {
        await deps.reply.send({ text: `The Season 1 leaderboard is not ready yet. ${s.siteUrl}/playground/season-1` });
        return;
      }
      const lines = rows.map((r, i) => `${i + 1}. ${r.displayName}: ${r.ranked ? `${r.meanSkill >= 0 ? "beat" : "behind"} the market by ${Math.abs(r.meanSkill).toFixed(3)} over ${r.forecastsResolved} forecasts` : `${r.forecastsResolved} scored forecasts so far`}`);
      await deps.reply.send({ text: ["Season 1, Polymarket forecasting:", ...lines, `${s.siteUrl}/playground/season-1`].join("\n") });
      return;
    }
    case "freeze":
      await s.freeze(ownerRef);
      await deps.reply.send({ text: "Frozen. Nothing can be paid from your wallet until you unfreeze it in your browser." });
      return;
    case "unfreeze": {
      const link = await s.requestUnfreeze(ownerRef);
      await deps.reply.send(link ? { text: "Unfreeze in your browser; the link works once, for 15 minutes.", buttons: [[{ label: "Unfreeze in browser", url: link.approvalUrl }]] } : { text: "You have no wallet yet. Ask a question to start." });
      return;
    }
    case "withdraw": {
      if (!intent.to || !intent.amount) {
        await deps.reply.send({ text: "Tell me how much and where, for example: withdraw 1.50 to 0x..." });
        return;
      }
      const out = await s.requestWithdraw(ownerRef, intent.to, intent.amount);
      await deps.reply.send(out.ok
        ? { text: `Withdraw ${formatUsdc(intent.amount)} USDC to ${intent.to}. Approve it in your browser; the link works once, for 15 minutes.`, buttons: [[{ label: "Approve in browser", url: out.approvalUrl }]] }
        : { text: "That withdrawal did not work. Check the amount and the address." });
      return;
    }
    case "help":
      await deps.reply.send(help(s.siteUrl));
      return;
    default:
      await deps.reply.send(help(s.siteUrl));
  }
}

/// One inbound chat message, from any channel. The raw user id is used only
/// to compute the hash and is never stored.
export async function handleChatMessage(deps: ConversationDeps, inbound: ChatInbound): Promise<void> {
  const userHash = hashChatUser(deps.pepper, deps.channel, inbound.userId);
  const ownerRef = deps.ownerRefOf(userHash);
  if (deps.limit && !deps.limit(userHash)) {
    await deps.reply.send({ text: "You're sending messages quickly. Wait a minute, then try again." });
    return;
  }
  const account = await deps.channels.ensureAccount(deps.channel, userHash, deps.now());
  await deps.channels.touch(deps.channel, userHash, deps.now());
  if (deps.off()) {
    await deps.reply.send({ text: `Agon chat is paused right now. You can still ask at ${deps.services.siteUrl}/ask` });
    return;
  }
  if (account.termsVersion !== CHAT_TERMS_VERSION) {
    if (inbound.kind === "tap" && inbound.text === "terms:accept") {
      await deps.channels.acceptTerms(deps.channel, userHash, CHAT_TERMS_VERSION, deps.now());
      await deps.reply.send(welcome(await deps.services.wallet(ownerRef)));
    } else {
      await deps.reply.send(terms());
    }
    return;
  }
  if (inbound.kind === "start") return void (await deps.reply.send(help(deps.services.siteUrl)));
  if (inbound.kind === "other") return void (await deps.reply.send({ text: "I read text only for now. Type your question." }));
  if (inbound.kind === "tap" && inbound.text === "terms:accept") return void (await deps.reply.send(help(deps.services.siteUrl)));
  const intent: ChatIntent = inbound.kind === "tap" ? (parseCodeIntent(inbound.text) ?? { kind: "unknown" }) : await deps.classify(inbound.text);
  await act(deps, ownerRef, intent);
}
