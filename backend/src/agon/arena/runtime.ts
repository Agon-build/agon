import type { Address } from "viem";

import type { AgonNetworkId } from "../network.ts";
import { HIRE_PAID_TIMEOUT_MS, type HireOutcome, type HireQuote, type HireRequest } from "../payments/hire.ts";
import type { RootCommitter } from "../playground/seasons/rounds.ts";
import type { AgonListingLite } from "../routing/agon-source.ts";
import { seededPick } from "./clock.ts";
import { arenaLeaderboard, trackPercentiles, type ArenaRow } from "./leaderboard.ts";
import type { ArenaHire, RoundDeps } from "./round.ts";
import { createArenaRoutes } from "./routes.ts";
import { readArenaSettings, type ArenaSettings } from "./settings.ts";
import type { ArenaStore } from "./store.ts";
import { createResearchTrack, type ChainReader, type MarketReader } from "./tracks/research/index.ts";
import type { ArenaRaw, ArenaSeason, Entrant, TrackDef } from "./types.ts";
import { arenaWorkerLoop } from "./worker.ts";

/// The owner ref of the wallet the Arena pays agents from.
export const ARENA_OWNER = "agon:arena";

/// What the Arena needs from the payments runtime: the same quote and confirm a buyer's hire uses.
export type ArenaPayments = {
  quoteHire(req: HireRequest): Promise<{ ok: true; quote: HireQuote } | { ok: false; code: string; detail?: string }>;
  confirmHire(input: { ownerRef: string; code: string }): Promise<HireOutcome>;
};

type Schema = NonNullable<AgonListingLite["inputSchema"]>;
const takesText = (prop: Record<string, unknown> | undefined) => prop !== undefined && (prop.type === undefined || prop.type === "string") && prop.enum === undefined;

/// An Arena task is one question, so it goes to a listing that takes one piece of text:
/// its only required input, or its only input. Null when the listing asks for anything else.
export function arenaInput(schema: Schema | null, question: string): Record<string, unknown> | null {
  if (!schema) return null;
  const names = Object.keys(schema.properties);
  const field = schema.required.length === 1 ? schema.required[0]! : schema.required.length === 0 && names.length === 1 ? names[0]! : null;
  return field && takesText(schema.properties[field]) ? { [field]: question } : null;
}

/// Every listed, verified agent in the track's category, once each. An agent with several
/// listings enters with the one whose reference sorts first.
export function entrantsFrom(listings: readonly AgonListingLite[], categoryId: string, firstParty: (agentId: string) => boolean): Entrant[] {
  const byAgent = new Map<string, AgonListingLite>();
  for (const l of listings) {
    if (l.category !== categoryId || l.status !== "Listed" || !l.verified || l.suspended || !/^\d{1,78}$/.test(l.agentId)) continue;
    const seen = byAgent.get(l.agentId);
    if (!seen || l.reference < seen.reference) byAgent.set(l.agentId, l);
  }
  return [...byAgent.values()].sort((a, b) => (a.agentId < b.agentId ? -1 : 1)).map((l) => ({
    agentId: l.agentId, listingReference: l.reference, name: l.name, firstParty: firstParty(l.agentId), price: l.priceAtomic,
    status: arenaInput(l.inputSchema, "x") ? "entered" : "cannot_take",
  }));
}

/// Codes after which Agon cannot say the agent failed: its own payment was off, short, or left in doubt.
const AGON_FAULT = new Set(["payments_off", "frozen", "insufficient_balance", "payment_unknown", "already_processed", "delivery_unknown", "job_not_found", "code_expired", "wrong_code"]);
/// Quote codes that mean the service did not offer something Agon could pay, as opposed to refusing the question.
const NOT_PAYABLE = new Set(["provider_free", "no_matching_option", "provider_unreachable", "terms_changed"]);
/// After these the agent may have been paid, so the amount counts against the day's ceiling.
const MAY_HAVE_CHARGED = new Set(["delivery_failed", "delivery_unknown", "payment_unknown", "already_processed"]);

/// Sends one question to one agent through the paid hire, as a buyer would, with no routing fee.
export function createArenaHire(deps: {
  payments: ArenaPayments;
  listing(reference: string): Promise<AgonListingLite | null>;
  /** True when the address resolves only to public networks. */
  safe(url: string): Promise<boolean>;
  maxHire: bigint;
  now?: () => number;
  timeoutMs?: number;
}): ArenaHire {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? HIRE_PAID_TIMEOUT_MS;
  return async (entrant, question) => {
    const listing = await deps.listing(entrant.listingReference);
    // The listing left the market after the round opened: nothing is asked and nothing is paid.
    if (!listing) return { ok: false, kind: "failed" };
    const body = arenaInput(listing.inputSchema, question);
    if (!body) return { ok: false, kind: "cannot_take" };
    if (!(await deps.safe(listing.endpoint).catch(() => false))) return { ok: false, kind: "failed" };

    const started = now();
    const quoted = await deps.payments.quoteHire({ ownerRef: ARENA_OWNER, providerUrl: listing.endpoint, providerRef: listing.reference, providerLabel: listing.name, body, method: "POST", feeBps: 0, feeAddress: null });
    if (!quoted.ok) {
      if (AGON_FAULT.has(quoted.code)) return { ok: false, kind: "agon_fault" };
      return { ok: false, kind: NOT_PAYABLE.has(quoted.code) ? "failed" : "refused", durationMs: now() - started };
    }
    const quote = quoted.quote;
    // Over the Arena's ceiling, or over the wallet's own per-hire limit: the agent is not hired.
    if (quote.step !== "confirm_code" || quote.total > deps.maxHire) return { ok: false, kind: "over_price", jobId: quote.jobId };

    const out = await deps.payments.confirmHire({ ownerRef: ARENA_OWNER, code: quote.code });
    const durationMs = now() - started;
    if (out.ok) return { ok: true, jobId: out.jobId, amount: out.amount, result: out.result, durationMs };
    const amount = MAY_HAVE_CHARGED.has(out.code) ? quote.total : 0n;
    if (AGON_FAULT.has(out.code)) return { ok: false, kind: "agon_fault", jobId: quote.jobId, amount };
    return { ok: false, kind: durationMs >= timeoutMs ? "timeout" : "failed", jobId: quote.jobId, amount, durationMs };
  };
}

export type ArenaRuntime = {
  routes: ReturnType<typeof createArenaRoutes>;
  /** The Arena part of the Agon score for a category; undefined when no running track covers it. */
  trackArena(categoryId: string, since: Date | null, until: Date | null): Promise<Map<string, { percentile: number; forecasts: number }> | null | undefined>;
  /** A track's leaderboard rows, or null for an unknown or closed track. */
  board(track: string, limit: number): Promise<ArenaRow[] | null>;
  settings: ArenaSettings | null;
};

const RAW_TTL_MS = 30_000;

/// Production wiring for the Arena's Research track. Never throws: a setting that is missing
/// or wrong logs why and leaves the track closed, so the service always starts.
export function startArena(deps: {
  env: Record<string, string | undefined>;
  store: ArenaStore;
  network: AgonNetworkId;
  commitsAddress: Address;
  committer: RootCommitter;
  payments: ArenaPayments;
  /** Creates the Arena's wallet when it does not exist yet, and returns its address. */
  buyerAddress(): Promise<Address>;
  listings(): Promise<AgonListingLite[]>;
  firstParty(agentId: string): boolean;
  chain: ChainReader;
  markets: MarketReader;
  safe(url: string): Promise<boolean>;
  alert(message: string): void;
  log(message: string): void;
  startLoop?: boolean;
  tickMs?: number;
}): ArenaRuntime {
  const { settings, problems } = readArenaSettings(deps.env);
  if (problems.length > 0) deps.log(`off: ${problems.join("; ")}`);

  const track: TrackDef = createResearchTrack({ chain: deps.chain, markets: deps.markets, pick: (key, n) => seededPick(settings?.seed ?? "closed", key, n) });
  const season: ArenaSeason | null = settings
    ? { seasonId: settings.seasonId, trackId: track.id, network: deps.network, commitsAddress: deps.commitsAddress, startsAt: settings.startsAt, endsAt: settings.endsAt, roundHours: 24 }
    : null;

  let cached: { at: number; raw: ArenaRaw | null } | null = null;
  const raw = async (): Promise<ArenaRaw | null> => {
    if (!season) return null;
    if (!cached || Date.now() - cached.at >= RAW_TTL_MS) cached = { at: Date.now(), raw: await deps.store.raw(season.seasonId) };
    return cached.raw;
  };

  // A round asks for the listings once per hire; one read serves them all.
  let listed: { at: number; rows: AgonListingLite[] } | null = null;
  const listings = async (): Promise<AgonListingLite[]> => {
    if (!listed || Date.now() - listed.at >= RAW_TTL_MS) listed = { at: Date.now(), rows: await deps.listings() };
    return listed.rows;
  };

  if (settings && season && deps.startLoop !== false) {
    const round: RoundDeps = {
      store: deps.store, track, settings, season, committer: deps.committer, alert: deps.alert,
      listEntrants: async () => entrantsFrom(await listings(), track.categoryId, deps.firstParty),
      hire: createArenaHire({ payments: deps.payments, safe: deps.safe, maxHire: settings.maxHire, listing: async (reference) => (await listings()).find((l) => l.reference === reference) ?? null }),
      now: () => new Date(),
      // The order entrants are asked in changes with every task and cannot be known ahead.
      shuffle: (items) => items.map((item) => ({ item, key: Math.random() })).sort((a, b) => a.key - b.key).map((x) => x.item),
    };
    void (async () => {
      await deps.store.ensureSeason(season);
      deps.log(`buyer ${await deps.buyerAddress()}; season ${season.seasonId} from ${season.startsAt.toISOString()} to ${season.endsAt.toISOString()}; at most ${settings.maxHire} a hire and ${settings.maxDay} a day (USDC base units)`);
      await arenaWorkerLoop(round, { tickMs: deps.tickMs ?? 60_000, log: deps.log });
    })().catch((error) => deps.log(`loop stopped: ${error instanceof Error ? error.message : String(error)}`));
  }

  return {
    settings,
    routes: createArenaRoutes({ tracks: [{ def: track, season, raw }] }),
    async trackArena(categoryId, since, until) {
      if (!season || categoryId !== track.categoryId) return undefined;
      const data = await raw();
      return data ? trackPercentiles(data, since, until) : null;
    },
    async board(id, limit) {
      if (id !== track.id) return null;
      const data = await raw();
      return data ? arenaLeaderboard(data).rows.slice(0, Math.max(1, Math.min(limit, 50))) : null;
    },
  };
}
