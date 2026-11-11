import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import type { RoundDeps } from "../../src/agon/arena/round.ts";
import { ARENA_OWNER, arenaInput, createArenaHire, entrantsFrom, type ArenaPayments } from "../../src/agon/arena/runtime.ts";
import { arenaTick, arenaWorkerLoop } from "../../src/agon/arena/worker.ts";
import type { ArenaSeason, Entrant, TrackDef } from "../../src/agon/arena/types.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import type { HireOutcome, HireQuote, HireRequest } from "../../src/agon/payments/hire.ts";
import type { AgonListingLite } from "../../src/agon/routing/agon-source.ts";
import { MemoryArenaStore } from "./arena-memory-store.ts";

const schema = (properties: Record<string, Record<string, unknown>>, required: string[] = []): AgonListingLite["inputSchema"] => ({ type: "object", properties, required });
const listing = (over: Partial<AgonListingLite> = {}): AgonListingLite => ({
  reference: "5042002:0xabc:7", agentId: "70", name: "Compass", description: "Answers research questions", category: "1", endpoint: "https://agent.example/ask",
  priceAtomic: 50_000n, latencyMs: null, status: "Listed", verified: true, suspended: false, inputSchema: schema({ question: { type: "string" } }, ["question"]), ...over,
});
const entrant: Entrant = { agentId: "70", listingReference: "5042002:0xabc:7", name: "Compass", firstParty: true, price: 50_000n, status: "entered" };
const PAYEE = "0x2222222222222222222222222222222222222222" as Address;
const quote = (over: Partial<HireQuote> = {}): HireQuote => ({
  jobId: "job-1", amount: 50_000n, fee: 0n, total: 50_000n, payTo: PAYEE, providerLabel: "Compass", network: agonNetwork("arc-testnet"), expiresAt: new Date("2026-11-20T10:00:00Z"), step: "confirm_code", code: "123456", ...over,
} as HireQuote);

function payments(over: { quote?: Awaited<ReturnType<ArenaPayments["quoteHire"]>>; confirm?: HireOutcome } = {}) {
  const quotes: HireRequest[] = [];
  const confirms: { ownerRef: string; code: string }[] = [];
  const p: ArenaPayments = {
    quoteHire: async (req) => { quotes.push(req); return over.quote ?? { ok: true, quote: quote() }; },
    confirmHire: async (input) => { confirms.push(input); return over.confirm ?? { ok: true, jobId: "job-1", amount: 50_000n, txHash: `0x${"a".repeat(64)}` as Hex, result: { value: "7" } }; },
  };
  return { p, quotes, confirms };
}
function hireWith(pay: ReturnType<typeof payments>, over: { listing?: AgonListingLite | null; safe?: boolean; clock?: number[]; maxHire?: bigint } = {}) {
  const clock = [...(over.clock ?? [1_000, 1_900])];
  return createArenaHire({
    payments: pay.p, maxHire: over.maxHire ?? 500_000n, timeoutMs: 180_000,
    listing: async () => (over.listing === undefined ? listing() : over.listing),
    safe: async () => over.safe ?? true,
    now: () => clock.shift() ?? 999_999,
  });
}

test("a question goes to the listing's one text input", () => {
  assert.deepEqual(arenaInput(schema({ question: { type: "string" } }, ["question"]), "What?"), { question: "What?" });
  assert.deepEqual(arenaInput(schema({ query: {} }), "What?"), { query: "What?" });
  assert.deepEqual(arenaInput(schema({ q: { type: "string" }, depth: { type: "number" } }, ["q"]), "What?"), { q: "What?" });
  // Nothing else can take a plain question.
  assert.equal(arenaInput(null, "What?"), null);
  assert.equal(arenaInput(schema({ market: { type: "string" }, size: { type: "string" } }, ["market", "size"]), "What?"), null);
  assert.equal(arenaInput(schema({ a: { type: "string" }, b: { type: "string" } }), "What?"), null);
  assert.equal(arenaInput(schema({ count: { type: "number" } }, ["count"]), "What?"), null);
  assert.equal(arenaInput(schema({ mode: { type: "string", enum: ["fast", "deep"] } }, ["mode"]), "What?"), null);
});

test("every listed, verified agent in the category enters once", () => {
  const rows = [
    listing(),
    listing({ reference: "5042002:0xabc:3", name: "Compass (old)" }),
    listing({ reference: "5042002:0xabc:9", agentId: "71", name: "Ledger", priceAtomic: 30_000n }),
    listing({ reference: "5042002:0xabc:10", agentId: "72", name: "Odd inputs", inputSchema: schema({ a: {}, b: {} }, ["a", "b"]) }),
    listing({ reference: "5042002:0xabc:11", agentId: "73", name: "No inputs", inputSchema: null }),
    listing({ reference: "5042002:0xabc:12", agentId: "74", category: "3" }),
    listing({ reference: "5042002:0xabc:13", agentId: "75", status: "Paused" }),
    listing({ reference: "5042002:0xabc:14", agentId: "76", verified: false }),
    listing({ reference: "5042002:0xabc:15", agentId: "77", suspended: true }),
    listing({ reference: "5042002:0xabc:16", agentId: "not-a-number" }),
  ];
  assert.deepEqual(entrantsFrom(rows, "1", (id) => id === "70").map((e) => [e.agentId, e.listingReference, e.name, e.firstParty, e.price, e.status]), [
    ["70", "5042002:0xabc:3", "Compass (old)", true, 50_000n, "entered"],
    ["71", "5042002:0xabc:9", "Ledger", false, 30_000n, "entered"],
    ["72", "5042002:0xabc:10", "Odd inputs", false, 50_000n, "cannot_take"],
    ["73", "5042002:0xabc:11", "No inputs", false, 50_000n, "cannot_take"],
  ]);
  assert.deepEqual(entrantsFrom(rows, "5", () => false), []);
});

test("a delivered hire is paid from the Arena wallet with no fee, and timed", async () => {
  const pay = payments();
  const out = await hireWith(pay)(entrant, "How much gas did block 12 use?");
  assert.deepEqual(out, { ok: true, jobId: "job-1", amount: 50_000n, result: { value: "7" }, durationMs: 900 });
  assert.equal(pay.quotes.length, 1);
  const req = pay.quotes[0]!;
  assert.deepEqual([req.ownerRef, req.providerUrl, req.providerRef, req.providerLabel, req.method, req.feeBps, req.feeAddress], [ARENA_OWNER, "https://agent.example/ask", "5042002:0xabc:7", "Compass", "POST", 0, null]);
  assert.deepEqual(req.body, { question: "How much gas did block 12 use?" });
  assert.deepEqual(pay.confirms, [{ ownerRef: ARENA_OWNER, code: "123456" }]);
});

test("nothing is asked of a listing that is gone, unsafe or cannot take the question", async () => {
  for (const [over, kind] of [
    [{ listing: null }, "failed"],
    [{ safe: false }, "failed"],
    [{ listing: listing({ inputSchema: schema({ a: {}, b: {} }, ["a", "b"]) }) }, "cannot_take"],
  ] as const) {
    const pay = payments();
    assert.deepEqual(await hireWith(pay, over)(entrant, "What?"), { ok: false, kind });
    assert.equal(pay.quotes.length, 0);
  }
});

test("what a failed quote means for the agent", async () => {
  const cases: [string, string][] = [
    ["payments_off", "agon_fault"], ["frozen", "agon_fault"], ["insufficient_balance", "agon_fault"],
    ["provider_unreachable", "failed"], ["no_matching_option", "failed"], ["provider_free", "failed"], ["terms_changed", "failed"],
    ["market_not_found", "refused"], ["unsupported_question", "refused"], ["anything_else", "refused"],
  ];
  for (const [code, kind] of cases) {
    const pay = payments({ quote: { ok: false, code } });
    const out = await hireWith(pay)(entrant, "What?");
    assert.equal(out.ok, false);
    assert.equal(!out.ok && out.kind, kind, code);
    assert.equal(pay.confirms.length, 0);
  }
});

test("an agent over the ceiling, or over the wallet's own limit, is not paid", async () => {
  const dear = payments({ quote: { ok: true, quote: quote({ amount: 500_001n, total: 500_001n }) } });
  assert.deepEqual(await hireWith(dear)(entrant, "What?"), { ok: false, kind: "over_price", jobId: "job-1" });
  assert.equal(dear.confirms.length, 0);
  const atLimit = payments({ quote: { ok: true, quote: quote({ amount: 500_000n, total: 500_000n }) } });
  assert.equal((await hireWith(atLimit)(entrant, "What?")).ok, true);
  const link = payments({ quote: { ok: true, quote: { ...quote(), step: "approval_link", token: "t".repeat(24) } as HireQuote } });
  assert.deepEqual(await hireWith(link)(entrant, "What?"), { ok: false, kind: "over_price", jobId: "job-1" });
  assert.equal(link.confirms.length, 0);
});

test("what a failed paid call means for the agent, and what it cost", async () => {
  const cases: [string, string, bigint][] = [
    ["delivery_failed", "failed", 50_000n],
    ["provider_unreachable", "failed", 0n],
    ["payment_unknown", "agon_fault", 50_000n],
    ["already_processed", "agon_fault", 50_000n],
    ["delivery_unknown", "agon_fault", 50_000n],
    ["insufficient_balance", "agon_fault", 0n],
    ["payments_off", "agon_fault", 0n],
  ];
  for (const [code, kind, amount] of cases) {
    const out = await hireWith(payments({ confirm: { ok: false, code, jobId: "job-1" } }))(entrant, "What?");
    assert.equal(out.ok, false);
    if (out.ok) continue;
    assert.deepEqual([out.kind, out.amount, out.jobId], [kind, amount, "job-1"], code);
  }
  // A paid call that ran to the time limit is a timeout, not a failure.
  const slow = await hireWith(payments({ confirm: { ok: false, code: "delivery_failed", jobId: "job-1" } }), { clock: [1_000, 181_000] })(entrant, "What?");
  assert.deepEqual(slow, { ok: false, kind: "timeout", jobId: "job-1", amount: 50_000n, durationMs: 180_000 });
});

// The worker: one pass opens, sends and closes, and one broken step does not stop the others.
const season: ArenaSeason = {
  seasonId: 20001n, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
};
function workerWorld(over: Partial<RoundDeps> = {}) {
  const store = new MemoryArenaStore();
  const state = { now: new Date("2026-11-20T23:30:00Z") };
  const alerts: string[] = [];
  const logs: string[] = [];
  const track: TrackDef = {
    id: "research", categoryId: "1", label: "Research",
    buildTasks: async ({ round, count }) => Array.from({ length: count }, (_, i) => ({ taskId: `block-gas:${round * 10n + BigInt(i)}`, family: "block-gas", question: `Block ${round * 10n + BigInt(i)}?`, valueType: "integer" as const, truth: "7" })),
    score: () => 100,
    recheck: async () => "holds",
  };
  const deps: RoundDeps = {
    store, track, season,
    settings: { on: true, seasonId: 20001n, startsAt: season.startsAt, endsAt: season.endsAt, maxHire: 500_000n, maxDay: 5_000_000n, seed: "a-long-enough-test-seed" },
    listEntrants: async () => ["1", "2", "3"].map((id) => ({ ...entrant, agentId: id, listingReference: `ref-${id}` })),
    hire: async (e) => ({ ok: true, jobId: `job-${e.agentId}`, amount: e.price, result: { value: "7" }, durationMs: 10 }),
    committer: { commit: async () => ({ txHash: `0x${"b".repeat(64)}` as Hex, blockTime: new Date("2026-11-21T00:05:00Z"), circleTxId: "c" }) },
    now: () => state.now, shuffle: (items) => items, alert: (m) => alerts.push(m),
    ...over,
  };
  return { deps, store, state, alerts, logs };
}

test("one pass of the worker opens, sends and commits a round", async () => {
  const w = workerWorld();
  await arenaTick(w.deps, (m) => w.logs.push(m));
  const round = await w.store.getRound(20001n, 0n);
  assert.equal(round?.state, "committed");
  assert.equal(round?.count, 9);
  assert.deepEqual(w.logs, ["round opened", "round 0 committed"]);
  // The next pass has nothing to do.
  await arenaTick(w.deps, (m) => w.logs.push(m));
  assert.equal(w.logs.length, 2);
});

test("a commit that fails is logged and tried on the next pass, and today's round still opens", async () => {
  let fail = true;
  const w = workerWorld({ committer: { commit: async () => { if (fail) throw new Error("circle unavailable"); return { txHash: `0x${"b".repeat(64)}` as Hex, blockTime: new Date("2026-11-21T00:05:00Z"), circleTxId: "c" }; } } });
  await arenaTick(w.deps, (m) => w.logs.push(m));
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "committing");
  assert.ok(w.logs.some((m) => /close round 0 failed: circle unavailable/.test(m)));

  w.state.now = new Date("2026-11-21T23:30:00Z");
  await arenaTick(w.deps, (m) => w.logs.push(m));
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "committing");
  assert.equal((await w.store.getRound(20001n, 1n))?.state, "committing");

  fail = false;
  await arenaTick(w.deps, (m) => w.logs.push(m));
  assert.equal((await w.store.getRound(20001n, 0n))?.state, "committed");
  assert.equal((await w.store.getRound(20001n, 1n))?.state, "committed");
});

test("the loop raises the same alert once a day, and stops on its signal", async () => {
  const w = workerWorld();
  w.deps.settings = { ...w.deps.settings, maxDay: 1n };
  const stop = new AbortController();
  let ticks = 0;
  await arenaWorkerLoop(w.deps, { tickMs: 1, signal: stop.signal, sleep: async () => { ticks += 1; if (ticks === 3) w.state.now = new Date("2026-11-21T23:30:00Z"); if (ticks === 5) stop.abort(); } });
  assert.equal(ticks, 5);
  // Three passes on the first day and two on the second: one alert a day.
  assert.equal(w.alerts.length, 2);
  assert.equal(await w.store.getRound(20001n, 0n), null);
});
