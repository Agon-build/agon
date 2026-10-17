import { assertPublicHttpsDestination } from "../manifest-inspector.ts";
import type { Address } from "viem";

import { approvalHash } from "../payments/limits.ts";
import type { HireService } from "../payments/runtime.ts";
import type { PaymentsStore } from "../payments/types.ts";
import type { ModelCaller } from "../playground/seasons/house-agents.ts";
import { parseUsdc } from "../stage/money.ts";
import type { AskResult } from "../stage/services.ts";
import { createAgonSource, type AgonListingLite } from "./agon-source.ts";
import { createCircleSource } from "./circle-source.ts";
import { fillInput } from "./fill-input.ts";
import { readIntent } from "./intent.ts";
import { createRouter, type Router } from "./router.ts";

export type ListingView = {
  id?: unknown; agentId?: unknown; category?: unknown; status?: unknown; verification?: { status?: unknown };
  manifest?: { body?: unknown };
};
type ManifestBody = {
  service?: { name?: unknown; description?: unknown };
  invocation?: { endpoint?: unknown; requestSchema?: { required?: unknown }; timeoutMs?: unknown };
  pricing?: { amountUSDC?: unknown };
};

/// An indexed Agon listing, with its hosted service record, as a route entry.
export function listingLiteFrom(view: ListingView): AgonListingLite | null {
  const body = view.manifest?.body as ManifestBody | null | undefined;
  if (!body || typeof view.id !== "string" || typeof view.agentId !== "string" || typeof view.category !== "string") return null;
  const name = body.service?.name;
  const endpoint = body.invocation?.endpoint;
  const price = typeof body.pricing?.amountUSDC === "string" ? parseUsdc(body.pricing.amountUSDC) : null;
  if (typeof name !== "string" || typeof endpoint !== "string" || price === null) return null;
  const required = Array.isArray(body.invocation?.requestSchema?.required) ? (body.invocation!.requestSchema!.required as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    reference: view.id, agentId: view.agentId, name, description: typeof body.service?.description === "string" ? body.service.description : "",
    category: view.category, endpoint, priceAtomic: price, latencyMs: typeof body.invocation?.timeoutMs === "number" ? body.invocation.timeoutMs : null,
    status: typeof view.status === "string" ? view.status : "Unknown", verified: view.verification?.status === "Verified", requestRequired: required,
  };
}

/// Builds the aggregator from the live services: Agon's indexed listings with
/// their Agon scores, Circle's catalog refreshed hourly, and one payments
/// runtime per network.
export function startRouting(deps: {
  listListingViews: () => Promise<ListingView[]>;
  scoreFor: (agentId: string) => Promise<number | null>;
  testnet: HireService;
  testnetBalanceOf: (address: Address) => Promise<bigint | null>;
  testnetFeeAddress: Address | null;
  outside: { hire: HireService; balanceOf(address: Address): Promise<bigint | null>; feeAddress: Address | null } | null;
  feeBps: number;
  callModel: ModelCaller;
  model: string;
  store: Pick<PaymentsStore, "latestConfirmation" | "getJob" | "getBudgetWallet">;
  approvalUrl: (token: string) => string;
  newWalletAllowed?: () => boolean;
  leadAsk: (ownerRef: string, question: string) => Promise<AskResult>;
  startLoops?: boolean;
}): Router {
  let cache: { at: number; rows: AgonListingLite[] } | null = null;
  const agon = createAgonSource({
    listListings: async () => {
      if (cache && Date.now() - cache.at < 60_000) return cache.rows;
      const rows = (await deps.listListingViews()).map(listingLiteFrom).filter((r): r is AgonListingLite => r !== null);
      cache = { at: Date.now(), rows };
      return rows;
    },
    scoreFor: deps.scoreFor,
  });
  const circle = createCircleSource();
  if (deps.startLoops !== false) {
    void circle.refresh();
    setInterval(() => { void circle.refresh(); }, 60 * 60_000).unref();
  }
  return createRouter({
    sources: [agon, circle],
    runtimes: { "arc-testnet": deps.testnet, ...(deps.outside ? { arc: deps.outside.hire } : {}) },
    readIntent: (text) => readIntent(text, deps.callModel, deps.model),
    fill: (entry, text, intent) => fillInput(entry, text, intent, deps.callModel, deps.model),
    feeBps: deps.feeBps,
    feeAddress: { "arc-testnet": deps.testnetFeeAddress, arc: deps.outside?.feeAddress ?? null },
    leadAsk: deps.leadAsk,
    store: deps.store,
    balanceOf: (network, address) => (network === "arc" ? (deps.outside?.balanceOf(address) ?? Promise.resolve(null)) : deps.testnetBalanceOf(address)),
    approvalUrl: deps.approvalUrl,
    newWalletAllowed: deps.newWalletAllowed,
    safeDestination: (url) => assertPublicHttpsDestination(url).then(() => true, () => false),
  });
}

/// One hire service for approval links that finishes each link on the runtime
/// of the network it was made for (withdraw and unfreeze record their network;
/// an over-limit hire is found through its job). The link is only read here,
/// so it is still unused when the right runtime redeems it.
export function approvalsByNetwork(testnet: HireService, outside: HireService | null, store: Pick<PaymentsStore, "getApproval" | "getJob">): HireService {
  const pick = async (token: string): Promise<HireService | null> => {
    const approval = /^[A-Za-z0-9_-]{20,128}$/.test(token) ? await store.getApproval(approvalHash(token)) : null;
    let network = typeof approval?.payload.network === "string" ? approval.payload.network : null;
    if (!network && approval && typeof approval.payload.jobId === "string") network = (await store.getJob(approval.payload.jobId))?.network ?? null;
    return network === "arc" ? outside : testnet;
  };
  return {
    ...testnet,
    completeApprovedHire: async (i) => (await pick(i.token))?.completeApprovedHire(i) ?? { ok: false, code: "outside_off" },
    wallets: {
      ...testnet.wallets,
      completeUnfreeze: async (token) => (await pick(token))?.wallets.completeUnfreeze(token) ?? { ok: false, code: "outside_off" },
      completeWithdraw: async (token) => (await pick(token))?.wallets.completeWithdraw(token) ?? { ok: false, code: "outside_off" },
    },
  };
}
