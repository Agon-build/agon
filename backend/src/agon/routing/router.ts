import { randomUUID } from "node:crypto";
import type { Address } from "viem";

import type { AgonNetwork } from "../network.ts";
import { budgetWalletRef } from "../payments/budget-wallets.ts";
import type { HireOutcome, HireQuote, HireRequest } from "../payments/hire.ts";
import type { BudgetWallet, PaymentsStore } from "../payments/types.ts";
import type { AskResult } from "../stage/services.ts";
import { wordsOf, type CatalogEntry, type RouteSource } from "./catalog.ts";
import { cleanGiven, type fillInput } from "./fill-input.ts";
import { KIND_SOURCES, type Intent } from "./intent.ts";
import { rankCandidates, type Ranked } from "./rank.ts";

type NetworkId = "arc-testnet" | "arc";

/// What the router needs from one payments runtime (one network).
export type RouteRuntime = {
  network: AgonNetwork;
  quoteHire(req: HireRequest): Promise<{ ok: true; quote: HireQuote } | { ok: false; code: string; detail?: string; amount?: bigint; depositAddress?: Address }>;
  confirmHire(input: { ownerRef: string; code: string }): Promise<HireOutcome>;
  wallets: { ensure(ownerRef: string): Promise<BudgetWallet> };
};

export type RouteResult =
  | { kind: "lead"; ask?: AskResult }
  | { kind: "pick"; routeId: string; intent: Intent; pick: Ranked; alternatives: Ranked[]; sources: { id: string; status: "ok" | "unavailable" }[] }
  | { kind: "none"; sources: { id: string; status: "ok" | "unavailable" }[] };

export type RouteQuote =
  | {
      ok: true; step: "confirm_code" | "approval_link"; jobId: string; amount: bigint; fee: bigint; total: bigint; providerLabel: string;
      network: string; testnet: boolean; expiresAt: Date; code?: string; approvalUrl?: string; input: Record<string, unknown>;
      source: "agon" | "circle"; reason: string;
    }
  | { ok: false; code: "missing_input"; question: string; missing: string[] }
  | { ok: false; code: "insufficient_balance"; amount: bigint; depositAddress: Address; network: NetworkId }
  | { ok: false; code: string; detail?: string };

const ROUTE_TTL_MS = 15 * 60_000;
/// Room kept in the wallet for the gas that sends Agon's fee (a token transfer on Arc costs about 0.0013 USDC at the 20 Gwei floor).
export const FEE_GAS_RESERVE = 5_000n;
const DOWNRANK_MS = 24 * 60 * 60_000;
const ROUTES_PER_OWNER = 20;
const MAX_ROUTES = 5_000;

/// The aggregator: reads the request once, searches every source, ranks by the
/// owner's rule, and quotes on the runtime of the chosen service's network.
/// Forecast questions keep going to the Lead agent.
export function createRouter(deps: {
  sources: RouteSource[];
  runtimes: { "arc-testnet": RouteRuntime; arc?: RouteRuntime };
  readIntent: (text: string) => Promise<Intent>;
  fill: (entry: CatalogEntry, text: string, intent: Intent) => ReturnType<typeof fillInput>;
  feeBps: number;
  feeAddress: Partial<Record<NetworkId, Address | null>>;
  leadAsk: (ownerRef: string, question: string) => Promise<AskResult>;
  store: Pick<PaymentsStore, "latestConfirmation" | "getJob" | "getBudgetWallet">;
  /** Gate for creating a new budget wallet (each is a Circle wallet); unset means always allowed. */
  newWalletAllowed?: () => boolean;
  /** True when a service address resolves only to public networks; checked before Agon calls it. */
  safeDestination?: (url: string) => Promise<boolean>;
  balanceOf?: (network: NetworkId, address: Address) => Promise<bigint | null>;
  approvalUrl: (token: string) => string;
  /** One Agon listing a person chose themselves (listed, verified, with named inputs), or null. */
  directEntry?: (reference: string) => Promise<CatalogEntry | null>;
  now?: () => Date;
  newId?: () => string;
}) {
  const now = deps.now ?? (() => new Date());
  // A direct route is one the person picked themselves; it carries no routing fee.
  const routes = new Map<string, { ownerRef: string; text: string; intent: Intent; entries: Ranked[]; expiresAt: number; direct?: boolean }>();
  const down = new Map<string, number>();
  const downranked = () => {
    const t = now().getTime();
    for (const [ref, until] of down) if (until <= t) down.delete(ref);
    return new Set(down.keys());
  };

  // Each owner keeps their newest routes; expired ones go first, and a full map
  // drops its oldest entries rather than everyone's.
  const keepRoom = (ownerRef: string) => {
    const t = now().getTime();
    const own = [...routes].filter(([, r]) => r.ownerRef === ownerRef);
    for (const [id] of own.slice(0, Math.max(0, own.length - (ROUTES_PER_OWNER - 1)))) routes.delete(id);
    if (routes.size < MAX_ROUTES) return;
    for (const [id, r] of routes) if (r.expiresAt <= t) routes.delete(id);
    for (const id of routes.keys()) { if (routes.size < MAX_ROUTES) break; routes.delete(id); }
  };

  return {
    /// quoteLead false is for discovery: a forecast names the Lead without creating a quote.
    async route(ownerRef: string, text: string, opts: { quoteLead?: boolean } = {}): Promise<RouteResult> {
      const intent = await deps.readIntent(text);
      if (intent.kind === "forecast") return opts.quoteLead === false ? { kind: "lead" } : { kind: "lead", ask: await deps.leadAsk(ownerRef, text) };
      const fits = KIND_SOURCES[intent.kind];
      const query = { words: wordsOf(`${intent.query} ${text}`), agonCategories: fits.agonCategories, circleCategories: fits.circleCategories };
      const found = await Promise.all(deps.sources.map((s) => s.search(query).catch(() => [] as CatalogEntry[])));
      const sources = deps.sources.map((s) => ({ id: s.id, status: s.status() }));
      // Sources search wide; ranking keeps only what fits Agon's reading of the request.
      const ranked = rankCandidates(found.flat(), intent, { feeBps: deps.feeBps, downranked: downranked(), feeBpsFor: (e) => (deps.feeAddress[e.network] ? deps.feeBps : 0) });
      if (!ranked.pick) return { kind: "none", sources };
      const routeId = (deps.newId ?? randomUUID)();
      keepRoom(ownerRef);
      routes.set(routeId, { ownerRef, text, intent, entries: [ranked.pick, ...ranked.alternatives], expiresAt: now().getTime() + ROUTE_TTL_MS });
      return { kind: "pick", routeId, intent, pick: ranked.pick, alternatives: ranked.alternatives, sources };
    },

    /// The person chose this agent from its page: no reading, no ranking, no routing fee.
    async direct(ownerRef: string, reference: string, text: string): Promise<Exclude<RouteResult, { kind: "none" }> | { kind: "not_hireable" }> {
      const entry = deps.directEntry ? await deps.directEntry(reference) : null;
      if (!entry) return { kind: "not_hireable" };
      // The Lead runs its own hire, with its data purchases and forecaster.
      if (/\/agon\/agents\/lead\//.test(entry.url)) return { kind: "lead", ask: await deps.leadAsk(ownerRef, text) };
      const intent: Intent = { kind: "other", query: text, values: {} };
      const pick: Ranked = { ...entry, fee: 0n, total: entry.price, reason: "You chose this agent" };
      const routeId = (deps.newId ?? randomUUID)();
      keepRoom(ownerRef);
      routes.set(routeId, { ownerRef, text, intent, entries: [pick], expiresAt: now().getTime() + ROUTE_TTL_MS, direct: true });
      return { kind: "pick", routeId, intent, pick, alternatives: [], sources: [{ id: "agon", status: "ok" }] };
    },

    async quote(ownerRef: string, routeId: string, reference: string, given?: Record<string, unknown>): Promise<RouteQuote> {
      const route = routes.get(routeId);
      if (!route || route.ownerRef !== ownerRef || route.expiresAt <= now().getTime()) return { ok: false, code: "route_expired" };
      const entry = route.entries.find((e) => e.reference === reference);
      if (!entry) return { ok: false, code: "route_expired" };
      const runtime = deps.runtimes[entry.network];
      if (!runtime) return { ok: false, code: "outside_off" };
      if (deps.safeDestination && !(await deps.safeDestination(entry.url).catch(() => false))) return { ok: false, code: "unavailable" };
      // Each new owner costs a Circle wallet, so new wallets pass the same global gate as Lead asks.
      if (deps.newWalletAllowed && !(await deps.store.getBudgetWallet(ownerRef, entry.network)) && !deps.newWalletAllowed()) return { ok: false, code: "busy" };
      let input: Record<string, unknown>;
      // The person's answers are laid over what was filled from the request.
      const filled = await deps.fill(entry, route.text, route.intent);
      const base = filled.ok ? filled.input : filled.partial;
      input = { ...base, ...cleanGiven(entry, given) };
      if (!filled.ok) {
        const stillMissing = filled.missing.filter((k) => input[k] === undefined || input[k] === "");
        if (stillMissing.length > 0) return { ok: false, code: "missing_input", question: stillMissing[0] === filled.missing[0] ? filled.question : `What should I use for ${stillMissing[0]}?`, missing: stillMissing };
      }
      const quoted = await runtime.quoteHire({
        ownerRef, providerUrl: entry.url, providerRef: entry.reference, providerLabel: entry.name, body: input, method: entry.method,
        feeBps: route.direct ? 0 : deps.feeBps, feeAddress: route.direct ? null : deps.feeAddress[entry.network] ?? null,
        // Checked before the quote is written, so a refused quote leaves no job or code behind.
        expect: { amount: entry.price, payTo: entry.payTo },
        ...(deps.balanceOf ? { balanceOf: (address: Address) => deps.balanceOf!(entry.network, address), reserve: FEE_GAS_RESERVE } : {}),
      });
      if (!quoted.ok) {
        if (quoted.code === "insufficient_balance" && quoted.amount !== undefined && quoted.depositAddress) return { ok: false, code: "insufficient_balance", amount: quoted.amount, depositAddress: quoted.depositAddress, network: entry.network };
        return { ok: false, code: quoted.code, ...(quoted.detail ? { detail: quoted.detail } : {}) };
      }
      const q = quoted.quote;
      // The live terms must be the ones the person was shown.
      if (q.amount !== entry.price || (entry.payTo && q.payTo.toLowerCase() !== entry.payTo.toLowerCase())) return { ok: false, code: "terms_changed" };
      const wallet = await runtime.wallets.ensure(ownerRef);
      const balance = deps.balanceOf ? await deps.balanceOf(entry.network, wallet.address).catch(() => null) : null;
      const needed = q.total + (q.fee > 0n ? FEE_GAS_RESERVE : 0n);
      if (balance !== null && balance < needed) return { ok: false, code: "insufficient_balance", amount: needed, depositAddress: wallet.address, network: entry.network };
      return {
        ok: true, step: q.step, jobId: q.jobId, amount: q.amount, fee: q.fee, total: q.total, providerLabel: q.providerLabel,
        network: runtime.network.label, testnet: entry.network === "arc-testnet", expiresAt: q.expiresAt,
        ...(q.step === "confirm_code" ? { code: q.code } : { approvalUrl: deps.approvalUrl(q.token) }),
        input, source: entry.source, reason: entry.reason,
      };
    },

    /// Confirms on the runtime of the pending job's network, never another.
    async confirm(ownerRef: string, code: string): Promise<HireOutcome> {
      const latest = await deps.store.latestConfirmation(budgetWalletRef(ownerRef));
      const job = latest ? await deps.store.getJob(latest.jobId) : null;
      const network = (job?.network ?? "arc-testnet") as NetworkId;
      const runtime = deps.runtimes[network];
      if (!runtime) return { ok: false, code: "outside_off" };
      const out = await runtime.confirmHire({ ownerRef, code });
      if (!out.ok && (out.code === "delivery_failed" || out.code === "delivery_unknown") && job && job.providerRef.startsWith("circle:")) {
        down.set(job.providerRef, now().getTime() + DOWNRANK_MS);
      }
      return out;
    },
  };
}

export type Router = ReturnType<typeof createRouter>;
