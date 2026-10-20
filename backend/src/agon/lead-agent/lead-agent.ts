import type { ClientEvmSigner } from "@x402/evm";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { formatUsdc, negotiate, type BargainStep, type SellerReply } from "../payments/bargain.ts";
import { buyExact, peekExactTerms, type ExactPurchase } from "../payments/exact-buyer.ts";
import { checkSubHire, newJob, spentUnder } from "../payments/jobs.ts";
import { LEAD_LIMITS } from "../payments/limits.ts";
import type { Job, JobPayment, PaymentsStore } from "../payments/types.ts";
import { coinIdsForQuestion, type DataServices } from "../router/data-services.ts";
import type { ForecasterCandidate } from "../router/forecasters.ts";
import { fallbackQueryFor, findMarkets, matchMarket, priceFromPayload, searchQueryFor, type MarketCandidate } from "./market-parse.ts";

export const LEAD_PROVIDER_REF = "agent:lead";
const LEAD_WALLET_REF = "agent:lead";
const COIN_NAMES: Record<string, string> = { "coingecko:bitcoin": "Bitcoin", "coingecko:ethereum": "Ethereum", "coingecko:solana": "Solana", "coingecko:ripple": "XRP" };

export type LeadDeps = {
  store: PaymentsStore;
  network: AgonNetwork;
  leadAddress: Address;
  signerFor: (payTo: Address, maxValue: bigint, onSigned?: (message: Record<string, unknown>) => void | Promise<void>) => ClientEvmSigner;
  data: DataServices;
  forecasters: () => Promise<ForecasterCandidate[]>;
  refund: (to: Address, amount: bigint, idempotencyKey: string) => Promise<Hex | null>;
  leadPrice: bigint;
  subHireBudget: bigint;
  now: () => Date;
  fetchImpl?: typeof fetch;
  authorizationUsed?: (authorizer: Address, nonce: Hex) => Promise<boolean>;
  log?: (message: string) => void;
};

export type LeadAnswer =
  | {
      ok: true;
      jobId: string;
      probabilityBps: number;
      reasons: string[];
      marketPriceBps: number | null;
      market: MarketCandidate;
      forecaster: { name: string; reason: string; asked: string; agreed: string };
      progress: string[];
      haggle: BargainStep[];
      events?: LiveEvent[];
    }
  | { ok: false; jobId: string; code: "no_market" | "market_started" | "no_forecaster" | "lead_error"; refunded: boolean; refundTx: Hex | null; progress: string[]; events?: LiveEvent[] };

const forecastResult = z.object({ probabilityBps: z.number().int().min(0).max(10_000), reasons: z.array(z.string()).max(5) });
const quoteReply = z.object({ kind: z.enum(["accept", "counter", "walk"]), amount: z.string().regex(/^\d+$/).optional(), quoteId: z.string().optional() });

export type LiveEventKind = "note" | "data" | "haggle" | "hire" | "refund" | "fail";
export type LiveEvent = { at: string; text: string; kind: LiveEventKind };

type SignedAuthorization = { nonce: Hex; validBefore: Date };

/// The lead agent's job for one forecast request: buy the market and a spot
/// price, ask Season 1 who forecasts best, haggle, hire, and answer. Every
/// purchase goes through the lead wallet's own limits and is linked to the
/// user's job, so the receipt shows the whole chain. If nothing can be
/// delivered, a buyer who paid is refunded once.
export async function runLeadForecast(
  deps: LeadDeps,
  input: { parentJobId: string | null; payer: Address; question: string; payment?: { txHash: Hex; amount: bigint } },
): Promise<LeadAnswer> {
  const progress: string[] = [];
  const now = deps.now;
  let job: Job | null = input.parentJobId ? await deps.store.getJob(input.parentJobId) : null;
  // Linked: the user's job came from the hire engine, which owns its state and payment record.
  const linked = Boolean(job && job.providerRef === LEAD_PROVIDER_REF);
  const paid = linked || Boolean(input.payment);
  if (!job || !linked) {
    job = newJob({
      parent: null, buyerRef: `agent:${input.payer.toLowerCase()}`, providerRef: LEAD_PROVIDER_REF, providerLabel: "Agon Lead Agent",
      network: deps.network.id, price: deps.leadPrice, budget: deps.subHireBudget, request: { question: input.question }, now: now(),
    });
    job.state = "paid";
    await deps.store.insertJob(job);
  } else if (job.budgetAtomic !== deps.subHireBudget) {
    await deps.store.updateJob(job.jobId, { budgetAtomic: deps.subHireBudget });
    job = { ...job, budgetAtomic: deps.subHireBudget };
  }
  const root = job;

  // Progress is written onto the user's job as it happens, so every channel
  // can show the run live by reading the job.
  const startedAt = now().toISOString();
  const events: LiveEvent[] = [];
  let liveHaggle: BargainStep[] = [];
  async function persist(): Promise<void> {
    await deps.store.updateJob(root.jobId, { result: { live: true, startedAt, events, haggle: liveHaggle } });
  }
  async function say(text: string, kind: LiveEventKind): Promise<void> {
    progress.push(text);
    events.push({ at: now().toISOString(), text, kind });
    await persist();
  }

  const recordPayment = (p: Omit<JobPayment, "createdAt" | "updatedAt" | "network" | "authNonce" | "authValidBefore">, signed: SignedAuthorization | null = null) =>
    deps.store.upsertJobPayment({
      ...p, network: deps.network.id, authNonce: signed?.nonce ?? null, authValidBefore: signed?.validBefore ?? null, createdAt: now(), updatedAt: now(),
    });

  if (!linked && input.payment) {
    await recordPayment({
      idempotencyKey: `hire:${root.jobId}`, jobId: root.jobId, kind: "hire", payer: input.payer.toLowerCase() as Address, payee: deps.leadAddress,
      amount: input.payment.amount, status: "settled", txHash: input.payment.txHash, detail: "Agon Lead Agent",
    });
  }

  /// A signed payment that left this process with no settlement proof may
  /// still settle. Ask the chain; "unknown" is treated as spent, never as free.
  async function outcomeOf(out: ExactPurchase, signed: SignedAuthorization | null): Promise<"settled" | "failed" | "unknown"> {
    if (out.ok || (out.code === "paid_request_failed" && out.txHash)) return "settled";
    if (!out.sent) return "failed";
    if (signed && deps.authorizationUsed) {
      const used = await deps.authorizationUsed(deps.leadAddress, signed.nonce).catch(() => null);
      if (used === true) return "settled";
    }
    return "unknown";
  }

  const signerWithRecord = (payTo: Address, maxValue: bigint, holder: { signed: SignedAuthorization | null }) =>
    deps.signerFor(payTo, maxValue, (message) => {
      holder.signed = { nonce: message.nonce as Hex, validBefore: new Date(Number(message.validBefore) * 1000) };
    });

  let dataCount = 0;
  async function buyData(url: string, label: string, what: string): Promise<unknown | null> {
    dataCount += 1;
    const key = `data:${root.jobId}:${dataCount}`;
    // Peek first so the reservation is the real price, not the per-purchase cap.
    const peek = await peekExactTerms({ url, network: deps.network, fetchImpl: deps.fetchImpl });
    if (!peek.ok) {
      await say(`Could not buy ${what} from ${label} (${peek.code})`, "fail");
      return null;
    }
    if (!("option" in peek)) return peek.data;
    if (peek.option.amount > LEAD_LIMITS.perData) {
      await say(`Skipped ${what}: ${formatUsdc(peek.option.amount)} USDC is over the lead agent limit`, "note");
      return null;
    }
    const reserved = await deps.store.reserveSpend({
      walletRef: LEAD_WALLET_REF, idempotencyKey: key, network: deps.network.id, amount: peek.option.amount, payee: peek.option.payTo, jobId: root.jobId,
      perPaymentCap: LEAD_LIMITS.perData, dailyCap: LEAD_LIMITS.daily, now: now(),
    });
    if (reserved !== "reserved") {
      await say(`Skipped ${what}: lead agent limit reached`, "note");
      return null;
    }
    const holder: { signed: SignedAuthorization | null } = { signed: null };
    const out = await buyExact({
      url, network: deps.network, maxAmount: peek.option.amount, expectedPayTo: peek.option.payTo,
      signerFor: (opt) => signerWithRecord(opt.payTo, opt.amount, holder), fetchImpl: deps.fetchImpl,
    });
    const outcome = await outcomeOf(out, holder.signed);
    const amount = out.ok && out.amount > 0n ? out.amount : peek.option.amount;
    const txHash = out.ok ? out.txHash : (out.txHash ?? null);
    if (outcome === "failed" || (out.ok && out.amount === 0n)) {
      await deps.store.finishSpend(LEAD_WALLET_REF, key, { state: "failed" });
    } else {
      // An unknown outcome keeps its reservation, so the daily limit still counts it.
      if (outcome === "settled") await deps.store.finishSpend(LEAD_WALLET_REF, key, { state: "settled", txHash });
      await recordPayment(
        {
          idempotencyKey: key, jobId: root.jobId, kind: "data", payer: deps.leadAddress, payee: peek.option.payTo, amount,
          status: outcome === "settled" ? "settled" : "pending", txHash, detail: `${what} from ${label}${outcome === "unknown" ? " (payment outcome unknown)" : ""}`,
        },
        holder.signed,
      );
    }
    if (out.ok) {
      if (out.amount > 0n) await say(`Bought ${what} from ${label}: ${formatUsdc(out.amount)} USDC`, "data");
      return out.data;
    }
    await say(`Could not buy ${what} from ${label} (${out.code})`, "fail");
    return null;
  }

  async function refundOnce(code: "no_market" | "market_started" | "no_forecaster" | "lead_error"): Promise<LeadAnswer> {
    if (!paid) {
      await deps.store.updateJob(root.jobId, { state: "failed", result: { error: code, events, haggle: liveHaggle } });
      return { ok: false, jobId: root.jobId, code, refunded: false, refundTx: null, progress, events };
    }
    const key = `refund:${root.jobId}`;
    const existing = (await deps.store.listJobPayments(root.rootId)).find((p) => p.idempotencyKey === key && p.status === "settled");
    if (existing) return { ok: false, jobId: root.jobId, code, refunded: true, refundTx: existing.txHash, progress, events };
    let refundTx: Hex | null = null;
    try {
      refundTx = await deps.refund(input.payer, deps.leadPrice, key);
    } catch (error) {
      deps.log?.(`lead agent refund failed for ${root.jobId}: ${(error as Error).message}`);
    }
    const reason = { no_market: "no matching market", market_started: "the market already started", no_forecaster: "no forecaster could deliver", lead_error: "the lead agent hit an error" }[code];
    await recordPayment({
      idempotencyKey: key, jobId: root.jobId, kind: "refund", payer: deps.leadAddress, payee: input.payer, amount: deps.leadPrice,
      status: refundTx ? "settled" : "failed", txHash: refundTx, detail: reason,
    });
    // The refund line is saved first, so the final state write keeps it.
    await say(refundTx ? `Refunded ${formatUsdc(deps.leadPrice)} USDC` : "Refund failed; an operator has been alerted", refundTx ? "refund" : "fail");
    if (refundTx) await deps.store.updateJob(root.jobId, { state: "refunded", result: { error: code, events, haggle: liveHaggle } });
    return { ok: false, jobId: root.jobId, code, refunded: Boolean(refundTx), refundTx, progress, events };
  }

  async function sellerQuote(quoteUrl: string, offer: bigint, round: number, lastCounter: bigint | null): Promise<SellerReply> {
    try {
      const res = await (deps.fetchImpl ?? fetch)(quoteUrl, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ buyer: deps.leadAddress, offer: offer.toString(), round, ...(lastCounter !== null ? { lastCounter: lastCounter.toString() } : {}) }),
      });
      const reply = quoteReply.safeParse(await res.json().catch(() => null));
      if (!res.ok || !reply.success) return { kind: "walk" };
      if (reply.data.kind === "accept" && reply.data.amount && reply.data.quoteId) return { kind: "accept", amount: BigInt(reply.data.amount), quoteId: reply.data.quoteId };
      if (reply.data.kind === "counter" && reply.data.amount) return { kind: "counter", amount: BigInt(reply.data.amount) };
      return { kind: "walk" };
    } catch {
      // An unreachable seller is treated as walking away.
      return { kind: "walk" };
    }
  }

  async function run(): Promise<LeadAnswer> {
    await say("Reading the question and looking for the market", "note");
    // 1. Find the market.
    const search = await buyData(deps.data.marketSearch(searchQueryFor(input.question)), deps.data.searchLabel, "market search");
    let candidates = findMarkets(search);
    let found = matchMarket(candidates, input.question, now());
    // Polymarket search is narrow: one wider search on the first name, only when the first one answered.
    const wider = fallbackQueryFor(input.question);
    if (search !== null && !found.market && !found.started && wider) {
      candidates = [...candidates, ...findMarkets(await buyData(deps.data.marketSearch(wider), deps.data.searchLabel, "a wider market search"))];
      found = matchMarket(candidates, input.question, now());
    }
    if (found.started) {
      const when = new Date(found.started.endDate);
      const at = Number.isNaN(when.getTime()) ? "" : ` at ${when.toISOString().slice(11, 16)} UTC on ${when.toISOString().slice(0, 10)}`;
      await say(`Found ${found.started.eventTitle || found.started.question}, but it already started${at}, so it cannot be forecast`, "note");
      return refundOnce("market_started");
    }
    const market = found.market;
    if (!market) return refundOnce("no_market");

    // 2. Spot price, when the question names a coin.
    const notes: string[] = [];
    const coins = coinIdsForQuestion(input.question);
    if (coins.length > 0) {
      const priceData = await buyData(deps.data.price(coins), deps.data.priceLabel, `${coins.map((c) => COIN_NAMES[c] ?? c).join(" and ")} price`);
      for (const coin of coins) {
        const price = priceFromPayload(priceData, coin);
        if (price !== null) notes.push(`${COIN_NAMES[coin] ?? coin} spot price: $${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
      }
    }
    if (market.yesPriceBps !== null) notes.push(`Polymarket crowd price for Yes: ${(market.yesPriceBps / 100).toFixed(1)}%`);

    // 3. Hire the best forecaster that will meet the budget.
    const body = { marketId: market.conditionId, question: market.question, endDate: market.endDate, crowdBps: market.yesPriceBps ?? undefined, notes };
    const init = (headers: Record<string, string>): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    await say("Choosing a forecaster", "note");
    for (const cand of (await deps.forecasters()).slice(0, 3)) {
      const tree = await deps.store.listJobTree(root.rootId);
      const payments = await deps.store.listJobPayments(root.rootId);
      const remaining = root.budgetAtomic - spentUnder(root.jobId, tree, payments);
      const peek = await peekExactTerms({ url: cand.forecastUrl, init: init({}), network: deps.network, fetchImpl: deps.fetchImpl });
      if (!peek.ok || !("option" in peek)) {
        await say(`${cand.displayName} is not selling forecasts right now`, "note");
        continue;
      }
      const ask = peek.option.amount;
      let amount = ask;
      let quoteId: string | null = null;
      let haggle: BargainStep[] = [];
      if (cand.quoteUrl) {
        const quoteUrl = cand.quoteUrl;
        const deal = await negotiate({
          sellerLabel: cand.displayName, ask, ceiling: remaining,
          quote: (offer, round, lastCounter) => sellerQuote(quoteUrl, offer, round, lastCounter),
        });
        haggle = deal.transcript;
        liveHaggle = deal.transcript;
        await persist();
        if (!deal.deal) {
          await say(`${cand.displayName} would not meet the budget`, "haggle");
          continue;
        }
        amount = deal.deal.amount;
        quoteId = deal.deal.quoteId;
      } else if (ask > remaining) {
        await say(`${cand.displayName} would not meet the budget`, "haggle");
        continue;
      }
      const check = checkSubHire({ tree, payments, parentJobId: root.jobId, hirerRef: LEAD_PROVIDER_REF, providerRef: cand.providerRef, amount });
      if (!check.ok) {
        await say(`Skipped ${cand.displayName} (${check.code})`, "note");
        continue;
      }
      const child = newJob({
        parent: root, buyerRef: LEAD_PROVIDER_REF, providerRef: cand.providerRef, providerLabel: cand.displayName, network: deps.network.id,
        price: amount, request: { url: cand.forecastUrl, quoteId }, now: now(),
      });
      await deps.store.insertJob(child);
      const key = `hire:${child.jobId}`;
      const reserved = await deps.store.reserveSpend({
        walletRef: LEAD_WALLET_REF, idempotencyKey: key, network: deps.network.id, amount, payee: peek.option.payTo, jobId: child.jobId,
        perPaymentCap: deps.subHireBudget, dailyCap: LEAD_LIMITS.daily, now: now(),
      });
      if (reserved !== "reserved") {
        await deps.store.updateJob(child.jobId, { state: "failed", result: { error: reserved } });
        await say(`Skipped ${cand.displayName}: lead agent limit reached`, "note");
        continue;
      }
      await deps.store.updateJob(child.jobId, { state: "paying" });
      const holder: { signed: SignedAuthorization | null } = { signed: null };
      const out = await buyExact({
        url: cand.forecastUrl, init: init({ ...(quoteId ? { "x-agon-quote": quoteId } : {}), "x-agon-job": child.jobId }), network: deps.network,
        maxAmount: amount, expectedPayTo: peek.option.payTo, signerFor: (opt) => signerWithRecord(opt.payTo, amount, holder), fetchImpl: deps.fetchImpl,
      });
      const result = out.ok ? forecastResult.safeParse(out.data) : null;
      const txHash = out.ok ? out.txHash : (out.txHash ?? null);
      const outcome = await outcomeOf(out, holder.signed);
      if (outcome !== "unknown") await deps.store.finishSpend(LEAD_WALLET_REF, key, outcome === "settled" ? { state: "settled", txHash } : { state: "failed" });
      await recordPayment(
        {
          idempotencyKey: key, jobId: child.jobId, kind: "hire", payer: deps.leadAddress, payee: peek.option.payTo, amount,
          status: outcome === "settled" ? "settled" : outcome === "failed" ? "failed" : "pending", txHash, detail: cand.displayName,
        },
        holder.signed,
      );
      if (result?.success) {
        await deps.store.updateJob(child.jobId, { state: "delivered", result: result.data });
        await say(`Hired ${cand.displayName} to forecast for ${formatUsdc(amount)} USDC (it asked ${formatUsdc(ask)}). ${cand.reason}`, "hire");
        const answer: LeadAnswer = {
          ok: true,
          jobId: root.jobId,
          probabilityBps: result.data.probabilityBps,
          reasons: result.data.reasons,
          marketPriceBps: market.yesPriceBps,
          market,
          forecaster: { name: cand.displayName, reason: cand.reason, asked: formatUsdc(ask), agreed: formatUsdc(amount) },
          progress,
          haggle,
          events,
        };
        // Stored even when the hire engine owns the job's state, so a buyer
        // that timed out still gets the answer once reconciliation runs.
        await deps.store.updateJob(root.jobId, linked ? { result: answer } : { state: "delivered", result: answer });
        return answer;
      }
      if (outcome === "unknown") {
        // Left "paying" with its nonce recorded: reconciliation settles or releases it.
        await say(`Payment to ${cand.displayName} has not confirmed; it still counts against the budget`, "note");
        continue;
      }
      await deps.store.updateJob(child.jobId, { state: "failed", result: { error: out.ok ? "invalid_forecast" : out.code } });
      await say(outcome === "settled" ? `${cand.displayName} was paid but did not deliver; trying the next forecaster` : `Could not pay ${cand.displayName} (${out.ok ? "invalid_forecast" : out.code})`, "fail");
    }
    return refundOnce("no_forecaster");
  }

  try {
    return await run();
  } catch (error) {
    deps.log?.(`lead agent failed for ${root.jobId}: ${(error as Error).message}`);
    return refundOnce("lead_error");
  }
}
