import type { RouteResponse, AskResponse, LeaderboardResponse, LiveView, RatingCell, RatingsResponse, SeasonEntry, SeasonInfo, SeasonRoundSummary, StageConfig, StageEvent, StageWallet, ApprovalView } from "./stage-types.ts";

/// Labelled preview data for design review (NEXT_PUBLIC_AGON_PREVIEW_FIXTURES=1).
/// Every object carries preview: true and the UI shows PREVIEW DATA; none of it
/// is ever shown as a live result.
export const PREVIEW_JOB_ID = "7c1e2f4a-5b6d-4e8f-9a0b-1c2d3e4f5a6b";
export const PREVIEW_RUN_MS = 9000;
const QUESTION = "What's the real chance BTC closes above $120k on Friday?";
const TX = (n: string) => `https://explorer.testnet.arc.io/tx/0x${n.repeat(64)}`;

const TIMELINE: { ms: number; text: string; kind: StageEvent["kind"] }[] = [
  { ms: 300, text: "Reading the question and looking for the market", kind: "note" },
  { ms: 1600, text: "Bought market search from BlockRun: 0.0085 USDC", kind: "data" },
  { ms: 2900, text: "Bought Bitcoin price from BlockRun: 0.002 USDC", kind: "data" },
  { ms: 3600, text: "Choosing a forecaster", kind: "note" },
  { ms: 6200, text: "Hired Atlas (house) to forecast for 0.17424 USDC (it asked 0.22). Season 1 rank #1, beats the market by 0.031 over 214 forecasts", kind: "hire" },
];
const HAGGLE = [
  { ms: 4200, step: "request" as const, detail: "asked Atlas (house) for a price; listed at 0.22 USDC" },
  { ms: 4700, step: "offer" as const, detail: "offered 0.132 USDC" },
  { ms: 5100, step: "counter" as const, detail: "Atlas (house) countered at 0.1848 USDC" },
  { ms: 5500, step: "offer" as const, detail: "offered 0.1584 USDC" },
  { ms: 5800, step: "counter" as const, detail: "Atlas (house) countered at 0.17424 USDC" },
  { ms: 6000, step: "accept" as const, detail: "agreed 0.17424 USDC (asked 0.22)" },
];

export const previewConfig: StageConfig = { network: "Arc Testnet", testnet: true, leadPrice: "0.30", leadPriceAtomic: "300000", siteUrl: "https://agon.surf", preview: true };
export const previewWallet: StageWallet = {
  networkId: "arc-testnet", network: "Arc Testnet", testnet: true, explorer: "https://explorer.testnet.arc.io", address: `0x${"8f2a41c9".repeat(5)}`,
  balance: "4.70", balanceAtomic: "4700000", perHire: "0.50", daily: "2.00", spentToday: "0.30", leftToday: "1.70", frozen: false, preview: true,
};

export function previewAsk(question: string): AskResponse {
  return {
    ok: true, step: "confirm_code", jobId: PREVIEW_JOB_ID, amount: "0.30", amountAtomic: "300000", providerLabel: "Agon Lead Agent",
    network: "Arc Testnet", testnet: true, expiresAt: new Date(Date.now() + 300_000).toISOString(), code: question.length > 0 ? "4821" : "0000",
  };
}

export function previewLive(jobId: string, startedMs: number | null, nowMs: number): LiveView {
  const elapsed = startedMs === null ? PREVIEW_RUN_MS + 1 : nowMs - startedMs;
  const base = startedMs ?? nowMs - PREVIEW_RUN_MS - 1;
  const at = (ms: number) => new Date(base + ms).toISOString();
  const done = elapsed > PREVIEW_RUN_MS;
  const events = TIMELINE.filter((e) => e.ms <= elapsed).map((e) => ({ at: at(e.ms), text: e.text, kind: e.kind }));
  const haggle = HAGGLE.filter((h) => h.ms <= elapsed).map((h) => ({ step: h.step, detail: h.detail }));
  const paid = (ms: number) => (elapsed >= ms ? "settled" : "pending");
  const tx = (ms: number, n: string) => (elapsed >= ms ? TX(n) : null);
  return {
    jobId, rootId: jobId, question: QUESTION, phase: done ? "answered" : elapsed < 300 ? "paying" : "working", state: done ? "delivered" : "paying",
    network: "Arc Testnet", startedAt: at(0), events, haggle, failure: null, refunded: false, receiptUrl: `https://agon.surf/r/${jobId}`, preview: true,
    answer: done
      ? {
          probabilityBps: 3400, marketPriceBps: 4100, marketQuestion: "Will Bitcoin close above $120,000 on October 30?", marketEndsAt: "2026-10-30T16:00:00Z", marketSlug: "bitcoin-above-120k-on-october-30",
          reasons: ["Spot is about 6% below the line with three days left", "Seven-day realised volatility does not cover a 6% move often", "The crowd price has drifted up on momentum, not news"],
          forecaster: { name: "Atlas (house)", reason: "Season 1 rank #1, beats the market by 0.031 over 214 forecasts", asked: "0.22", agreed: "0.17424" },
        }
      : null,
    receipt: {
      jobId, label: "Agon Lead Agent", source: "lead", buyer: "you", state: done ? "delivered" : "paying", price: "0.30", network: "Arc Testnet",
      payments: [
        { kind: "hire", amount: "0.30", payer: previewWallet.address, payee: `0x${"c".repeat(40)}`, status: paid(200), txUrl: tx(200, "1"), detail: "Agon Lead Agent" },
        ...(elapsed >= 1200 ? [{ kind: "data", amount: "0.0085", payer: `0x${"c".repeat(40)}`, payee: `0x${"6".repeat(40)}`, status: paid(1600), txUrl: tx(1600, "2"), detail: "market search from BlockRun" }] : []),
        ...(elapsed >= 2500 ? [{ kind: "data", amount: "0.002", payer: `0x${"c".repeat(40)}`, payee: `0x${"6".repeat(40)}`, status: paid(2900), txUrl: tx(2900, "3"), detail: "Bitcoin price from BlockRun" }] : []),
      ],
      children: elapsed >= 6000
        ? [{ jobId: "preview-atlas", label: "Atlas (house)", source: "agon", buyer: "agent:lead", state: done ? "delivered" : "paying", price: "0.17424", network: "Arc Testnet", children: [],
            payments: [{ kind: "hire", amount: "0.17424", payer: `0x${"c".repeat(40)}`, payee: `0x${"a".repeat(40)}`, status: paid(6200), txUrl: tx(6200, "4"), detail: "Atlas (house)" }] }]
        : [],
    },
  };
}

const ROWS = [
  ["Atlas (house)", true, 214, 0.0312, 0.1802, 0.0285, 1],
  ["Northwind", false, 188, 0.0241, 0.1877, 0.0218, 2],
  ["Kestrel (house)", true, 214, 0.0164, 0.1950, 0.0150, 3],
  ["Mirror (house, market copy)", true, 214, 0, 0.2114, 0, 4],
  ["Vesper (house)", true, 214, -0.0071, 0.2185, -0.0065, 5],
  ["Drift (house)", true, 214, -0.0123, 0.2237, -0.0112, 6],
] as const;
export const previewLeaderboard: LeaderboardResponse = {
  seasonId: "1", network: "Arc", commitsAddress: `0x${"5".repeat(40)}`, updatedAt: new Date().toISOString(), lastCommitAt: new Date(Date.now() - 42 * 60_000).toISOString(), preview: true,
  rows: ROWS.map(([displayName, house, n, meanSkill, meanBrier, rating, rank], i) => ({
    agentAddress: `0x${String(i + 1).repeat(40)}`, displayName, house, slateResolved: n, forecastsResolved: n, meanSkill, meanBrier, rating, ranked: true, rank,
  })),
};
const scaledCell = (n: number, rating: number, rank: number | null): RatingCell => ({ rating, meanSkill: rating, forecastsResolved: n, ranked: n >= 10 && rank !== null, rank: n >= 10 ? rank : null });
export const previewRatings: RatingsResponse = {
  seasonId: "1", updatedAt: new Date().toISOString(), categories: ["sports", "crypto", "economics", "politics", "world", "culture"],
  minRanked: { overall: 20, category: 10 }, preview: true,
  agents: previewLeaderboard.rows.map((r, i) => {
    const c = scaledCell(Math.floor(r.forecastsResolved / 4), r.rating, i + 1);
    return {
      agentAddress: r.agentAddress, displayName: r.displayName, house: r.house,
      overall: { rating: r.rating, meanSkill: r.meanSkill, forecastsResolved: r.forecastsResolved, ranked: r.ranked, rank: r.rank },
      categories: { sports: c, crypto: c, economics: c, politics: c, world: c, culture: c },
    };
  }),
};
export const previewSeason: SeasonInfo = {
  seasonId: "1", network: "Arc", commitsAddress: `0x${"5".repeat(40)}`, commitsUrl: `https://explorer.arc.io/address/0x${"5".repeat(40)}`,
  startsAt: "2026-10-20T00:00:00Z", endsAt: "2026-11-17T00:00:00Z", roundHours: 6, currentRound: "57",
};
export const previewEntries: SeasonEntry[] = previewLeaderboard.rows.map((r, i) => ({
  agentAddress: r.agentAddress, erc8004AgentId: String(40 + i), displayName: r.displayName, house: r.house, forecastEndpoint: null, enteredRound: "0",
}));
export const previewRounds: SeasonRoundSummary[] = [57, 56, 55].map((n, i) => ({
  round: String(n), state: i === 0 ? "open" : "committed", openedAt: new Date(Date.now() - i * 6 * 3_600_000).toISOString(), commitTx: i === 0 ? null : `0x${String(n).repeat(32)}`,
}));
export const previewApproval: ApprovalView = {
  action: "over_limit_hire", title: "Approve a hire", network: "Arc Testnet", testnet: true, expiresAt: new Date(Date.now() + 900_000).toISOString(), jobId: PREVIEW_JOB_ID,
  rows: [{ label: "Service", value: "Agon Lead Agent" }, { label: "Price", value: "0.60 USDC" }, { label: "Question", value: QUESTION }, { label: "Network", value: "Arc Testnet" }],
  owner: "telegram",
};

const PREVIEW_PICK = {
  source: "circle" as const, reference: "circle:https://analyst.lonestaroracle.xyz/ratings", name: "Analyst ratings and price target changes", provider: "LoneStarOracle",
  category: "FINANCIAL_ANALYSIS", description: "Analyst ratings and price target upgrades and downgrades", method: "GET" as const, network: "arc" as const,
  rating: { tier: "unrated" as const, score: null }, reason: "Not rated by Agon, from LoneStarOracle on Circle", price: "0.05", fee: "0.00075", total: "0.05075",
};
const PREVIEW_ALT = {
  source: "agon" as const, reference: "5042002:0xf017:9", name: "Scout", provider: "Agon", category: "3", description: "A trade, watch or avoid verdict for any Polymarket market",
  method: "POST" as const, network: "arc-testnet" as const, rating: { tier: "scored" as const, score: 82 }, reason: "Verified on Agon, score 82", price: "0.10", fee: "0.005", total: "0.105",
};

export function previewRoute(request: string): RouteResponse {
  if (/btc|bitcoin|chance|will /i.test(request)) return { kind: "lead", ...previewAsk(request) };
  return { kind: "pick", routeId: "preview-route", pick: PREVIEW_PICK, alternatives: [PREVIEW_ALT], sources: [{ id: "agon", status: "ok" }, { id: "circle", status: "ok" }] };
}

export function previewRouteQuote(reference: string): AskResponse {
  const p = reference === PREVIEW_ALT.reference ? PREVIEW_ALT : PREVIEW_PICK;
  return {
    ok: true, step: "confirm_code", jobId: PREVIEW_JOB_ID, amount: p.price, fee: p.fee, total: p.total, providerLabel: p.name,
    network: p.network === "arc" ? "Arc" : "Arc Testnet", testnet: p.network !== "arc", expiresAt: new Date(Date.now() + 300_000).toISOString(), code: "4821",
    input: p.source === "circle" ? { symbol: "AAPL" } : { market: "arsenal-epl" }, source: p.source, reason: p.reason,
  };
}
