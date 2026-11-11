import { randomUUID } from "node:crypto";
import type { Address } from "viem";

import type { AgonNetwork } from "../network.ts";
import { budgetWalletRef } from "../payments/budget-wallets.ts";
import type { HireOutcome, HireQuote, HireRequest } from "../payments/hire.ts";
import type { BudgetWallet, PaymentsStore } from "../payments/types.ts";
import type { AskResult } from "../stage/services.ts";
import { wordsOf, type CatalogEntry, type RouteSource } from "./catalog.ts";
import type { DeliveryRecord } from "./delivery-record.ts";
import { cleanGiven, coinsFit, type fillInput } from "./fill-input.ts";
import { fillPath } from "./path-params.ts";
import { shortlist } from "./fit.ts";
import { eventLinkIn, marketInText, outcomeIn, outcomeQuestion, type EventMarkets } from "./live-market.ts";
import { ALL_AGON, ALL_CIRCLE, type Intent } from "./intent.ts";
import { groupCandidates, rankCandidates, type Groups, type Ranked } from "./rank.ts";
import { categoriesOf, categoryForKind, circleFits, HIRE_CATEGORIES, hireCategory, type HireCategoryId } from "./categories.ts";

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
  | { kind: "none"; sources: { id: string; status: "ok" | "unavailable" }[] }
  | { kind: "choices"; routeId: string; category: HireCategoryId; groups: Groups; sources: { id: string; status: "ok" | "unavailable" }[] };

export type RouteQuote =
  | {
      ok: true; step: "confirm_code" | "approval_link"; jobId: string; amount: bigint; fee: bigint; total: bigint; providerLabel: string;
      network: string; testnet: boolean; expiresAt: Date; code?: string; approvalUrl?: string; input: Record<string, unknown>;
      source: "agon" | "circle"; reason: string;
      /** The Hire categories the service belongs to; a budget token is held to them. */
      categories: HireCategoryId[];
    }
  | { ok: true; lead: AskResult }
  | { ok: false; code: "missing_input"; question: string; missing: string[] }
  | { ok: false; code: "insufficient_balance"; amount: bigint; depositAddress: Address; network: NetworkId }
  | { ok: false; code: string; detail?: string };

const ROUTE_TTL_MS = 15 * 60_000;
/// Room kept in the wallet for the gas that sends Agon's fee (a token transfer on Arc costs about 0.0013 USDC at the 20 Gwei floor).
export const FEE_GAS_RESERVE = 5_000n;
const DOWNRANK_MS = 24 * 60 * 60_000;
/// How long a service that did not answer stays off the choices before it is checked again.
const SILENT_MS = 5 * 60_000;
const ROUTES_PER_OWNER = 20;
const MAX_ROUTES = 5_000;
/// A category this small goes to the fit check whole; a larger one is narrowed by shared words first.
const CATEGORY_POOL_MAX = 16;
/// The input Agon's market agents take: one Polymarket market, or a list for a watch.
const MARKET_FIELDS = ["market", "markets"];
const MARKET_QUESTION = "Which Polymarket market? Paste its link, or name the event more exactly.";

/// The aggregator: reads the request once, searches every source, ranks by the
/// owner's rule, and quotes on the runtime of the chosen service's network.
/// Forecast questions keep going to the Lead agent.
export function createRouter(deps: {
  sources: RouteSource[];
  runtimes: { "arc-testnet": RouteRuntime; arc?: RouteRuntime };
  readIntent: (text: string) => Promise<Intent>;
  /** Which shortlisted services do the job, by reference; null leaves it to the word scores. */
  judge?: (text: string, list: CatalogEntry[]) => Promise<string[] | null>;
  fill: (entry: CatalogEntry, text: string, intent: Intent) => ReturnType<typeof fillInput>;
  feeBps: number;
  /** The smallest routing fee in USDC base units, shown on the pick as it will be charged. */
  feeMin?: bigint;
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
  /** The open Polymarket market a request is about, found on Polymarket itself; null when none matches. */
  findMarket?: (text: string) => Promise<{ ref: string; question: string } | null>;
  /** A Polymarket event by its slug, with its open markets; null when it cannot be read. */
  readEvent?: (slug: string) => Promise<EventMarkets | null>;
  /** Whether a service answers an unpaid call now. Unset means no check is made. */
  alive?: (entry: CatalogEntry) => Promise<boolean>;
  /** What Agon has seen each outside service do with paid hires. Unset means no record is kept. */
  deliveries?: () => Promise<Map<string, DeliveryRecord>>;
  /** The Lead as a choice in Prediction markets; choosing it runs leadAsk. */
  leadEntry?: () => Promise<CatalogEntry | null>;
  now?: () => Date;
  newId?: () => string;
}) {
  const now = deps.now ?? (() => new Date());
  // A direct route is one the person picked themselves; it carries no routing fee.
  const routes = new Map<string, { ownerRef: string; text: string; intent: Intent; entries: Ranked[]; expiresAt: number; direct?: boolean; lead?: string; browse?: boolean }>();
  const down = new Map<string, number>();
  const downranked = () => {
    const t = now().getTime();
    for (const [ref, until] of down) if (until <= t) down.delete(ref);
    return new Set(down.keys());
  };
  // Services whose live 402 offers no USDC payment on the network they are listed on.
  // Agon cannot pay them, so they leave the choices for a day.
  const unpayable = new Map<string, number>();
  const payable = (list: CatalogEntry[]) => {
    const t = now().getTime();
    for (const [ref, until] of unpayable) if (until <= t) unpayable.delete(ref);
    return unpayable.size === 0 ? list : list.filter((e) => !unpayable.has(e.reference));
  };

  // An outside service that took payment twice in a row without delivering rests for a day:
  // it is not offered at all. A record that cannot be read rests nothing.
  const recordsNow = async (): Promise<Map<string, DeliveryRecord>> => (deps.deliveries ? await deps.deliveries().catch(() => new Map<string, DeliveryRecord>()) : new Map<string, DeliveryRecord>());
  const offered = (list: CatalogEntry[], records: Map<string, DeliveryRecord>) => payable(list).filter((e) => !records.get(e.reference)?.restingUntil);

  // Services that did not answer: Agon's unpaid check before offering them, or a quote.
  // They leave the choices for a few minutes, then are checked again.
  const silent = new Map<string, number>();
  const answering = async (list: CatalogEntry[]): Promise<CatalogEntry[]> => {
    const t = now().getTime();
    for (const [ref, until] of silent) if (until <= t) silent.delete(ref);
    const known = list.filter((e) => !silent.has(e.reference));
    if (!deps.alive || known.length === 0) return known;
    const ups = await Promise.all(known.map((e) => deps.alive!(e).catch(() => true)));
    // Nothing answered at all: the fault is more likely Agon's own connection than every service at once.
    if (known.length > 1 && ups.every((up) => !up)) return known;
    known.forEach((e, i) => { if (!ups[i]) silent.set(e.reference, t + SILENT_MS); });
    return known.filter((_, i) => ups[i]);
  };

  // A link to a whole Polymarket event becomes the link to one of its markets: the only one, or
  // the one the person named. With several and none named, the person is asked which.
  const resolveEvent = async (text: string, answer = ""): Promise<{ text: string } | { ask: string }> => {
    const found = eventLinkIn(text);
    if (!found || !deps.readEvent) return { text };
    const event = await deps.readEvent(found.slug).catch(() => null);
    if (!event || event.markets.length === 0) return { text };
    const one = event.markets.length === 1 ? event.markets[0]! : outcomeIn(event, `${answer} ${text.replace(found.link, " ")}`);
    return one ? { text: text.replace(found.link, one.ref) } : { ask: outcomeQuestion(event) };
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
    /// choices is the web's Hire: three groups in one category for the person to choose
    /// from, the Lead included as a card, and nothing quoted until they choose.
    async route(ownerRef: string, text: string, opts: { quoteLead?: boolean; choices?: boolean; category?: HireCategoryId } = {}): Promise<RouteResult> {
      const intent = await deps.readIntent(text);
      if (opts.choices) {
        const first = opts.category ?? categoryForKind(intent.kind);
        let category = first;
        let found = await choicesIn(category);
        // The request's own category holds nothing that does it: research (a web search can look
        // most things up) is tried once before Agon says nothing fits. A category the person chose stays.
        const empty = (g: Groups) => g.ranked.length + g.fresh.length + g.outside.length === 0;
        if (empty(found.groups) && !opts.category && first !== "research") {
          const wider = await choicesIn("research");
          if (!empty(wider.groups)) { category = "research"; found = wider; }
        }
        const { groups, lead } = found;
        const routeId = (deps.newId ?? randomUUID)();
        keepRoom(ownerRef);
        routes.set(routeId, { ownerRef, text, intent, entries: [...groups.ranked, ...groups.fresh, ...groups.outside], expiresAt: now().getTime() + ROUTE_TTL_MS, ...(lead ? { lead: lead.reference } : {}) });
        return { kind: "choices", routeId, category, groups, sources: deps.sources.map((s) => ({ id: s.id, status: s.status() })) };
      }
      async function choicesIn(category: HireCategoryId): Promise<{ groups: Groups; lead: CatalogEntry | null }> {
        const cat = hireCategory(category);
        const query = { words: wordsOf(`${intent.query} ${text}`), agonCategories: [...cat.agonCategories], circleCategories: [...cat.circleCategories] };
        const found = await Promise.all(deps.sources.map((s) => s.search(query).catch(() => [] as CatalogEntry[])));
        const lead = category === "prediction" && deps.leadEntry ? await deps.leadEntry().catch(() => null) : null;
        // Every service held in a small category reaches the fit check, shared words or not:
        // a listing rarely uses the person's words (an image service never says "logo").
        const whole = (await Promise.all(deps.sources.map((s) => s.search({ ...query, whole: true }).catch(() => [] as CatalogEntry[])))).flat()
          .filter((e) => e.source === "agon" || circleFits(category, e));
        const pool = whole.length <= CATEGORY_POOL_MAX ? whole : whole.filter((e) => e.source === "agon");
        const seen = new Set<string>();
        // A service that takes one coin is left out of a request that names several.
        const candidates = [...found.flat(), ...pool].filter((e) => (seen.has(e.reference) ? false : (seen.add(e.reference), true)) && coinsFit(e, text));
        const records = await recordsNow();
        const listed = shortlist(offered(candidates, records), intent, text, new Set(pool.map((e) => e.reference)));
        // The fit check and the unpaid calls run side by side, so checking costs no extra wait.
        const [fitted, list] = await Promise.all([deps.judge ? deps.judge(text, listed).catch(() => null) : null, answering(listed)]);
        const groups = groupCandidates(lead ? [lead, ...list] : list, intent, {
          feeBps: deps.feeBps, feeMin: deps.feeMin, downranked: downranked(), feeBpsFor: (e) => (deps.feeAddress[e.network] ? deps.feeBps : 0), fitted, category, deliveries: records,
          // A forecast always offers the Lead; a market check always offers Agon's own market agents,
          // because the fit model can drop them for a market it was not shown.
          always: intent.kind === "forecast" ? (lead ? [lead.reference] : []) : intent.kind === "analysis" && category === "prediction" ? list.filter((e) => e.source === "agon").map((e) => e.reference) : [],
        });
        return { groups, lead };
      }
      if (intent.kind === "forecast") return opts.quoteLead === false ? { kind: "lead" } : { kind: "lead", ask: await deps.leadAsk(ownerRef, text) };
      // Every category is searched: a request read as research may be served by a finance service.
      const query = { words: wordsOf(`${intent.query} ${text}`), agonCategories: ALL_AGON, circleCategories: ALL_CIRCLE };
      const found = await Promise.all(deps.sources.map((s) => s.search(query).catch(() => [] as CatalogEntry[])));
      const sources = deps.sources.map((s) => ({ id: s.id, status: s.status() }));
      const listed = shortlist(offered(found.flat(), await recordsNow()).filter((e) => coinsFit(e, text)), intent, text);
      const [fitted, list] = await Promise.all([deps.judge ? deps.judge(text, listed).catch(() => null) : null, answering(listed)]);
      const ranked = rankCandidates(list, intent, { feeBps: deps.feeBps, feeMin: deps.feeMin, downranked: downranked(), feeBpsFor: (e) => (deps.feeAddress[e.network] ? deps.feeBps : 0), fitted });
      if (!ranked.pick) return { kind: "none", sources };
      const routeId = (deps.newId ?? randomUUID)();
      keepRoom(ownerRef);
      routes.set(routeId, { ownerRef, text, intent, entries: [ranked.pick, ...ranked.alternatives], expiresAt: now().getTime() + ROUTE_TTL_MS });
      return { kind: "pick", routeId, intent, pick: ranked.pick, alternatives: ranked.alternatives, sources };
    },

    /// Everything in one category, with no request typed: every Agon agent in it (the Lead
    /// in Prediction markets) and every outside service that belongs, in the three groups.
    async browse(ownerRef: string, category: HireCategoryId): Promise<Extract<RouteResult, { kind: "choices" }>> {
      const cat = hireCategory(category);
      const sources = deps.sources.map((s) => ({ id: s.id, status: s.status() }));
      const found = await Promise.all(deps.sources.map((s) => (s.all ? s.all().catch(() => [] as CatalogEntry[]) : Promise.resolve([] as CatalogEntry[]))));
      const lead = category === "prediction" && deps.leadEntry ? await deps.leadEntry().catch(() => null) : null;
      const records = await recordsNow();
      const inCategory = offered(found.flat(), records).filter((e) => e.source !== "agon" || (cat.agonCategories.includes(e.category) && !/\/agon\/agents\/lead\//.test(e.url)));
      const withProof = await Promise.all(inCategory.map(async (e) => (e.source === "agon" && deps.directEntry ? (await deps.directEntry(e.reference).catch(() => null)) ?? e : e)));
      const list = lead ? [lead, ...withProof] : withProof;
      const intent: Intent = { kind: "other", query: "", values: {} };
      const groups = groupCandidates(list, intent, {
        feeBps: deps.feeBps, feeMin: deps.feeMin, downranked: downranked(), feeBpsFor: (e) => (deps.feeAddress[e.network] ? deps.feeBps : 0), category, always: list.map((e) => e.reference), deliveries: records,
      });
      const routeId = (deps.newId ?? randomUUID)();
      keepRoom(ownerRef);
      routes.set(routeId, { ownerRef, text: cat.label, intent, entries: [...groups.ranked, ...groups.fresh, ...groups.outside], expiresAt: now().getTime() + ROUTE_TTL_MS, browse: true, ...(lead ? { lead: lead.reference } : {}) });
      return { kind: "choices", routeId, category, groups, sources };
    },

    /// How many services each Hire category holds now: Agon agents (the Lead counts in
    /// Prediction markets) and outside services. A source that is down counts as null.
    async categories(): Promise<{ id: HireCategoryId; label: string; agon: number | null; outside: number | null }[]> {
      const read = async (id: string) => {
        const s = deps.sources.find((x) => x.id === id);
        if (!s?.all || s.status() !== "ok") return null;
        return s.all().catch(() => null);
      };
      const [agon, outside] = await Promise.all([read("agon"), read("circle")]);
      return HIRE_CATEGORIES.map((c) => ({
        id: c.id, label: c.label,
        agon: agon ? agon.filter((e) => (c.id === "prediction" && /\/agon\/agents\/lead\//.test(e.url)) || (c.agonCategories.includes(e.category) && !/\/agon\/agents\/lead\//.test(e.url))).length : null,
        outside: outside ? outside.filter((e) => circleFits(c.id, e)).length : null,
      }));
    },

    /// The person chose this agent from its page: no reading, no ranking, no routing fee.
    async direct(ownerRef: string, reference: string, text: string): Promise<Extract<RouteResult, { kind: "pick" | "lead" }> | { kind: "not_hireable" }> {
      const entry = deps.directEntry ? await deps.directEntry(reference) : null;
      if (!entry) return { kind: "not_hireable" };
      // The Lead runs its own hire, with its data purchases and forecaster.
      if (/\/agon\/agents\/lead\//.test(entry.url)) {
        const resolved = await resolveEvent(text);
        if ("text" in resolved) return { kind: "lead", ask: await deps.leadAsk(ownerRef, resolved.text) };
        // An event link with several markets: the Lead waits as a pick, and its quote asks which market.
        const intent: Intent = { kind: "forecast", query: text, values: {} };
        const pick: Ranked = { ...entry, fee: 0n, total: entry.price, reason: "You chose this agent" };
        const routeId = (deps.newId ?? randomUUID)();
        keepRoom(ownerRef);
        routes.set(routeId, { ownerRef, text, intent, entries: [pick], expiresAt: now().getTime() + ROUTE_TTL_MS, direct: true, lead: entry.reference });
        return { kind: "pick", routeId, intent, pick, alternatives: [], sources: [{ id: "agon", status: "ok" }] };
      }
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
      // The Lead runs its own hire, with its data purchases and forecaster.
      if (route.lead === reference) {
        // Browsing typed no question, so the Lead asks for one first.
        const answer = typeof given?.question === "string" ? given.question.trim() : "";
        const question = route.browse ? answer : route.text;
        if (!question) return { ok: false, code: "missing_input", question: "What do you want forecast? Paste a Polymarket link or ask about an event.", missing: ["question"] };
        const resolved = await resolveEvent(question, route.browse ? "" : answer);
        if ("ask" in resolved) return { ok: false, code: "missing_input", question: resolved.ask, missing: ["question"] };
        return { ok: true, lead: await deps.leadAsk(ownerRef, resolved.text) };
      }
      const runtime = deps.runtimes[entry.network];
      if (!runtime) return { ok: false, code: "outside_off" };
      if (deps.safeDestination && !(await deps.safeDestination(entry.url).catch(() => false))) return { ok: false, code: "unavailable" };
      // Each new owner costs a Circle wallet, so new wallets pass the same global gate as Lead asks.
      if (deps.newWalletAllowed && !(await deps.store.getBudgetWallet(ownerRef, entry.network)) && !deps.newWalletAllowed()) return { ok: false, code: "busy" };
      let input: Record<string, unknown>;
      // The person's answers are laid over what was filled from the request.
      const filled = await deps.fill(entry, route.text, route.intent);
      const base = filled.ok ? filled.input : filled.partial;
      const own = cleanGiven(entry, given);
      input = { ...base, ...own };
      let missing = filled.ok ? [] : filled.missing;
      // Agon's market agents take a Polymarket market. Only one the person typed, or one Agon
      // found open on Polymarket for the request, is sent; a value the model proposed is not.
      const props = (entry.inputSchema as { properties?: Record<string, unknown> } | null)?.properties ?? {};
      const marketKey = entry.source === "agon" ? MARKET_FIELDS.find((k) => k in props) : undefined;
      const answered = marketKey && typeof own[marketKey] === "string" ? (own[marketKey] as string) : "";
      if (marketKey && !route.browse && eventLinkIn(route.text) && deps.readEvent && (!answered || !marketInText(answered))) {
        // The person pasted a whole event: its one market, or the one they named, or ask which.
        const resolved = await resolveEvent(route.text, answered);
        if ("ask" in resolved) return { ok: false, code: "missing_input", question: resolved.ask, missing: [marketKey] };
        const ref = marketInText(resolved.text);
        if (ref) { input[marketKey] = ref; missing = missing.filter((k) => k !== marketKey); }
      } else if (marketKey && own[marketKey] === undefined) {
        const typed = route.browse ? null : marketInText(route.text);
        const live = typed ?? (route.browse || !deps.findMarket ? null : (await deps.findMarket(route.text).catch(() => null))?.ref ?? null);
        if (live) {
          input[marketKey] = live;
          missing = missing.filter((k) => k !== marketKey);
        } else if (deps.findMarket) {
          delete input[marketKey];
          if (!missing.includes(marketKey)) missing = [marketKey, ...missing];
        }
      }
      const stillMissing = missing.filter((k) => input[k] === undefined || input[k] === "");
      if (stillMissing.length > 0) {
        const question = stillMissing[0] === marketKey ? MARKET_QUESTION : !filled.ok && stillMissing[0] === filled.missing[0] ? filled.question : `What should I use for ${stillMissing[0]}?`;
        return { ok: false, code: "missing_input", question, missing: stillMissing };
      }
      // An input that belongs in the service address goes there, never left as {name}.
      const path = fillPath(entry.url, input);
      if (!path.ok) return { ok: false, code: "missing_input", question: `What should I use for ${path.missing[0]}?`, missing: path.missing };
      const quoted = await runtime.quoteHire({
        ownerRef, providerUrl: path.url, providerRef: entry.reference, providerLabel: entry.name, body: path.rest, method: entry.method,
        feeBps: route.direct ? 0 : deps.feeBps, feeAddress: route.direct ? null : deps.feeAddress[entry.network] ?? null,
        // Checked before the quote is written, so a refused quote leaves no job or code behind.
        expect: { amount: entry.price, payTo: entry.payTo },
        ...(deps.balanceOf ? { balanceOf: (address: Address) => deps.balanceOf!(entry.network, address), reserve: FEE_GAS_RESERVE } : {}),
      });
      if (!quoted.ok) {
        if (quoted.code === "insufficient_balance" && quoted.amount !== undefined && quoted.depositAddress) return { ok: false, code: "insufficient_balance", amount: quoted.amount, depositAddress: quoted.depositAddress, network: entry.network };
        // The chosen service, not the Lead, failed before asking for payment: a 4xx means it turned the request down.
        // The service asked to be paid on another network or in another token: name the service, and stop offering it.
        if (quoted.code === "no_matching_option" && entry.source !== "agon") {
          unpayable.set(entry.reference, now().getTime() + DOWNRANK_MS);
          return { ok: false, code: "service_terms_mismatch" };
        }
        if (quoted.code === "provider_unreachable") {
          const refused = /^status 4\d\d$/.test(quoted.detail ?? "");
          if (!refused) silent.set(entry.reference, now().getTime() + SILENT_MS);
          return { ok: false, code: refused ? "service_refused" : "service_unreachable", ...(quoted.detail ? { detail: quoted.detail } : {}) };
        }
        return { ok: false, code: quoted.code, ...(quoted.detail ? { detail: quoted.detail } : {}) };
      }
      const q = quoted.quote;
      // The live terms must be the ones the person was shown, or cheaper; the quote shows the live price.
      if (q.amount > entry.price || (entry.payTo && q.payTo.toLowerCase() !== entry.payTo.toLowerCase())) return { ok: false, code: "terms_changed" };
      const wallet = await runtime.wallets.ensure(ownerRef);
      const balance = deps.balanceOf ? await deps.balanceOf(entry.network, wallet.address).catch(() => null) : null;
      const needed = q.total + (q.fee > 0n ? FEE_GAS_RESERVE : 0n);
      if (balance !== null && balance < needed) return { ok: false, code: "insufficient_balance", amount: needed, depositAddress: wallet.address, network: entry.network };
      return {
        ok: true, step: q.step, jobId: q.jobId, amount: q.amount, fee: q.fee, total: q.total, providerLabel: q.providerLabel,
        network: runtime.network.label, testnet: entry.network === "arc-testnet", expiresAt: q.expiresAt,
        ...(q.step === "confirm_code" ? { code: q.code } : { approvalUrl: deps.approvalUrl(q.token) }),
        input, source: entry.source, reason: entry.reason, categories: categoriesOf(entry),
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
