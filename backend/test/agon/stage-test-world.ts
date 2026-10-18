import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";

import * as wallets from "../../src/agon/payments/budget-wallets.ts";
import { completeApprovedHire, confirmHire, quoteHire, reconcileStuckHires, type HireDeps } from "../../src/agon/payments/hire.ts";
import { exactPayment, type X402Paid } from "../../src/agon/payments/exact-seller.ts";
import type { HireService } from "../../src/agon/payments/runtime.ts";
import type { LeaderboardRow } from "../../src/agon/playground/seasons/scoring.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import { createStageServices } from "../../src/agon/stage/services.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";
import { BUYER_KEY, circleSignJson, fakeSettler } from "./x402-test-helpers.ts";

export const LEAD = `0x${"c".repeat(40)}` as Address;
export const SITE = "https://agon.surf";
export const QUESTION = "What's the real chance BTC closes above $120k on Friday?";

export const ATLAS_ROW: LeaderboardRow = {
  agentAddress: `0x${"a".repeat(40)}` as Address, displayName: "Atlas (house)", house: true, slateResolved: 214, forecastsResolved: 214,
  meanSkill: 0.0312, meanBrier: 0.1802, rating: 0.0285, ranked: true, rank: 1,
};

/// A stage stack over the in-memory store: real hire engine, real budget
/// wallets and a lead agent endpoint that writes live events like the real one.
export function stageWorld(opts: { price?: bigint; newWalletAllowed?: () => boolean; fee?: { bps: number; address: Address } } = {}) {
  const store = new MemoryPaymentsStore();
  const settler = fakeSettler();
  const buyer = privateKeyToAccount(BUYER_KEY);
  const network = agonNetwork("arc-testnet");
  const state = { price: opts.price ?? 300_000n, fail: false, refund: false, balance: 5_000_000n as bigint | null, leaderboard: [ATLAS_ROW] };
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  app.post(
    "/agon/agents/lead/forecast",
    exactPayment({ network, payTo: LEAD, price: async () => state.price, settle: settler.settle, claimNonce: (n, p, nonce) => store.claimSellerNonce(n, p, nonce), description: "Lead" }),
    async (c) => {
      const jobId = c.req.header("x-agon-job")!;
      const startedAt = new Date().toISOString();
      const events = [
        { at: startedAt, text: "Reading the question and looking for the market", kind: "note" },
        { at: startedAt, text: "Bought market search from Agon test data seller: 0.0085 USDC", kind: "data" },
      ];
      await store.updateJob(jobId, { result: { live: true, startedAt, events, haggle: [] } });
      if (state.fail) return c.json({ error: "lead_agent_failed" }, 500);
      if (state.refund) {
        const body = { ok: false, jobId, code: "no_market", refunded: true, refundTx: `0x${"fe".repeat(32)}`, progress: [], events: [...events, { at: startedAt, text: "Refunded 0.30 USDC", kind: "refund" }] };
        await store.updateJob(jobId, { result: body });
        return c.json(body);
      }
      const haggle = [{ step: "request", detail: "asked Atlas (house) for a price; listed at 0.22 USDC" }, { step: "accept", detail: "agreed 0.17424 USDC (asked 0.22)" }];
      const body = {
        ok: true, jobId, probabilityBps: 3400, reasons: ["Spot is 6% below the line", "Three days left", "Funding is flat"], marketPriceBps: 4100,
        market: { conditionId: `0x${"ab".repeat(32)}`, question: "Will Bitcoin close above $120,000 on October 30?", slug: "btc-120k", endDate: "2026-10-30T16:00:00Z", yesPriceBps: 4100 },
        forecaster: { name: "Atlas (house)", reason: "Season 1 rank #1", asked: "0.22", agreed: "0.17424" },
        progress: [], haggle,
        events: [...events, { at: startedAt, text: "Hired Atlas (house) to forecast for 0.17424 USDC (it asked 0.22). Season 1 rank #1", kind: "hire" }],
      };
      await store.updateJob(jobId, { result: body });
      return c.json(body);
    },
  );
  const deps: HireDeps = {
    store, network, now: () => new Date(), off: { all: false, budget: false },
    fetchImpl: ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch,
    signJson: circleSignJson(buyer),
    ops: {
      // Every budget wallet "is" the local buyer key so signatures verify at the seller.
      createWallet: async () => ({ walletId: "w-budget", address: buyer.address.toLowerCase() as Address }),
      seedTestnet: async () => ({}),
      transfer: async () => ({ id: "t-1", state: "INITIATED" }),
    },
  };
  const walletDeps = { store, network, now: deps.now, ops: deps.ops };
  const hire: HireService = {
    leadProviderUrl: "http://api.test/agon/agents/lead/forecast",
    network,
    quoteHire: (r) => quoteHire(deps, r),
    confirmHire: (i) => confirmHire(deps, i),
    completeApprovedHire: (i) => completeApprovedHire(deps, i),
    reconcile: () => reconcileStuckHires(deps),
    wallets: {
      ensure: (o) => wallets.ensureBudgetWallet(walletDeps, o),
      lowerLimits: (o, l) => wallets.lowerLimits(walletDeps, o, l),
      freeze: (o) => wallets.freeze(walletDeps, o),
      requestUnfreeze: (o) => wallets.requestUnfreeze(walletDeps, o),
      completeUnfreeze: (t) => wallets.completeUnfreeze(walletDeps, t),
      requestWithdraw: (o, to, a) => wallets.requestWithdraw(walletDeps, o, to, a),
      completeWithdraw: (t) => wallets.completeWithdraw(walletDeps, t),
    },
  };
  const services = createStageServices({
    hire, store, network, siteUrl: SITE, now: () => new Date(),
    balanceOf: async () => state.balance,
    leaderboard: async (limit) => state.leaderboard.slice(0, limit),
    leadPrice: async () => state.price,
    ...(opts.newWalletAllowed ? { newWalletAllowed: opts.newWalletAllowed } : {}),
    ...(opts.fee ? { fee: opts.fee } : {}),
  });
  return { store, settler, state, network, hire, services, buyer };
}
