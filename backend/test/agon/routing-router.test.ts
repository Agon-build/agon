import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { agonNetwork } from "../../src/agon/network.ts";
import { ensureBudgetWallet } from "../../src/agon/payments/budget-wallets.ts";
import { resolveOutsideSettings } from "../../src/agon/payments/settings.ts";
import type { CatalogEntry, RouteSource } from "../../src/agon/routing/catalog.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";
import { createRouter, type RouteRuntime } from "../../src/agon/routing/router.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const CIRCLE_PAY = `0x${"c1".repeat(20)}` as Address;
const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "agon", reference: "agon:scout", name: "Scout market check", provider: "Agon", category: "3", description: "Polymarket market check verdict",
  url: "https://api.agon.surf/agon/agents/specialists/scout", method: "POST", inputSchema: null, price: 100_000n, payTo: null, network: "arc-testnet",
  rating: { tier: "scored", score: 82 }, latencyMs: 15_000, tags: [], ...over,
});
const circle = entry({ source: "circle", reference: "circle:ratings", name: "Analyst ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS", description: "Analyst ratings and price targets", url: "https://analyst.example/ratings", method: "GET", price: 10_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });

function fakeRuntime(network: "arc-testnet" | "arc", calls: string[], opts: { amount?: bigint; payTo?: Address } = {}): RouteRuntime {
  return {
    network: agonNetwork(network),
    quoteHire: async (req) => {
      calls.push(`${network}:quote:${req.method}:${JSON.stringify(req.body)}:${req.feeBps}:${req.feeAddress}`);
      const amount = opts.amount ?? (network === "arc" ? 10_000n : 100_000n);
      return { ok: true, quote: { jobId: `job-${network}`, amount, fee: 150n, total: amount + 150n, payTo: opts.payTo ?? CIRCLE_PAY, providerLabel: req.providerLabel, network: agonNetwork(network), expiresAt: new Date(Date.now() + 300_000), step: "confirm_code", code: "1234" } };
    },
    confirmHire: async (i) => { calls.push(`${network}:confirm:${i.code}`); return { ok: true, jobId: `job-${network}`, amount: 1n, txHash: null, result: { ok: true } }; },
    wallets: { ensure: async () => ({ ownerRef: "op:x", network, walletId: "w", address: `0x${"aa".repeat(20)}` as Address, perHireCap: 500_000n, dailyCap: 2_000_000n, frozen: false, createdAt: new Date() }) },
  };
}

function setup(opts: { kind?: Intent["kind"]; outside?: boolean; entries?: CatalogEntry[]; circleStatus?: "ok" | "unavailable"; quoteAmount?: bigint } = {}) {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const src = (id: "agon" | "circle", rows: CatalogEntry[], status: "ok" | "unavailable" = "ok"): RouteSource => ({ id, status: () => status, search: async () => rows.filter((r) => r.source === id) });
  const rows = opts.entries ?? [entry({}), circle];
  const router = createRouter({
    sources: [src("agon", rows), src("circle", rows, opts.circleStatus)],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls), ...(opts.outside === false ? {} : { arc: fakeRuntime("arc", calls, { amount: opts.quoteAmount }) }) },
    readIntent: async (text) => ({ kind: opts.kind ?? "analysis", query: text, values: {} }),
    fill: async (e) => (e.source === "circle" ? { ok: true as const, input: { symbol: "AAPL" } } : { ok: true as const, input: { market: "arsenal" } }),
    feeBps: 150,
    feeAddress: { "arc-testnet": `0x${"fe".repeat(20)}` as Address, arc: `0x${"ef".repeat(20)}` as Address },
    leadAsk: async () => { calls.push("lead"); return { ok: false, code: "invalid_question" }; },
    store,
    balanceOf: async () => 10_000_000n,
    approvalUrl: (t) => `https://agon.surf/approve?t=${t}`,
  });
  return { router, calls, store };
}

test("a forecast request goes to the Lead", async () => {
  const { router, calls } = setup({ kind: "forecast" });
  const out = await router.route("op:x", "Will BTC close above 120k on Friday?");
  assert.equal(out.kind, "lead");
  assert.deepEqual(calls, ["lead"]);
});

test("a research request returns a pick, alternatives and each source's status", async () => {
  const { router } = setup({ circleStatus: "unavailable" });
  const out = await router.route("op:x", "polymarket market check for arsenal");
  assert.ok(out.kind === "pick");
  assert.equal(out.pick.reference, "agon:scout");
  assert.deepEqual(out.sources, [{ id: "agon", status: "ok" }, { id: "circle", status: "unavailable" }]);
});

test("quoting a Circle entry uses the mainnet runtime with its fee address, a testnet entry the testnet runtime", async () => {
  const { router, calls } = setup({ entries: [circle], kind: "market_data" });
  const out = await router.route("op:x", "analyst ratings AAPL");
  assert.ok(out.kind === "pick");
  const q = await router.quote("op:x", out.routeId, "circle:ratings");
  assert.ok(q.ok, JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.equal(q.testnet, false);
  assert.match(calls[0]!, new RegExp(`^arc:quote:GET:\\{"symbol":"AAPL"\\}:150:0x${"ef".repeat(20)}$`));
  const t = setup();
  const r2 = await t.router.route("op:x", "polymarket market check");
  assert.ok(r2.kind === "pick");
  const q2 = await t.router.quote("op:x", r2.routeId, "agon:scout");
  assert.ok(q2.ok && q2.testnet === true);
  assert.match(t.calls[0]!, /^arc-testnet:quote:POST:/);
});

test("confirming a mainnet job never touches the testnet runtime", async () => {
  const { router, calls, store } = setup({ entries: [circle], kind: "market_data" });
  const route = await router.route("op:x", "analyst ratings AAPL");
  assert.ok(route.kind === "pick");
  await router.quote("op:x", route.routeId, "circle:ratings");
  store.confirmations.push({ walletRef: "budget:op:x", jobId: "job-arc", codeHash: "h", amount: 10_150n, payee: CIRCLE_PAY, expiresAt: new Date(Date.now() + 60_000), usedAt: null, attempts: 0, createdAt: new Date() } as never);
  await store.insertJob({ jobId: "job-arc", parentId: null, rootId: "job-arc", depth: 0, buyerRef: "budget:op:x", providerRef: "circle:ratings", providerLabel: "Analyst ratings", network: "arc", priceAtomic: 10_000n, budgetAtomic: 0n, state: "quoted", traceId: "t", request: {}, result: null, createdAt: new Date(), updatedAt: new Date() });
  await router.confirm("op:x", "1234");
  assert.ok(calls.includes("arc:confirm:1234"));
  assert.ok(!calls.some((c) => c.startsWith("arc-testnet:confirm")));
});

test("with outside off, Circle entries are shown but quoting says outside_off; a changed live price is refused", async () => {
  const off = setup({ entries: [circle], kind: "market_data", outside: false });
  const r = await off.router.route("op:x", "analyst ratings AAPL");
  assert.ok(r.kind === "pick" && r.pick.source === "circle");
  assert.deepEqual(await off.router.quote("op:x", r.routeId, "circle:ratings"), { ok: false, code: "outside_off" });
  const changed = setup({ entries: [circle], kind: "market_data", quoteAmount: 20_000n });
  const r2 = await changed.router.route("op:x", "analyst ratings AAPL");
  assert.ok(r2.kind === "pick");
  assert.deepEqual(await changed.router.quote("op:x", r2.routeId, "circle:ratings"), { ok: false, code: "terms_changed" });
});

test("a request that fits nothing says so, and an unknown or foreign route is refused", async () => {
  const { router } = setup({ entries: [] });
  const none = await router.route("op:x", "bake me a cake");
  assert.equal(none.kind, "none");
  const t = setup();
  const r = await t.router.route("op:x", "polymarket market check");
  assert.ok(r.kind === "pick");
  assert.deepEqual(await t.router.quote("op:other", r.routeId, "agon:scout"), { ok: false, code: "route_expired" });
});

test("a new mainnet wallet starts at 0.25 per hire and 1.00 per day; outside settings stay off unless enabled", async () => {
  const store = new MemoryPaymentsStore();
  const ops = { createWallet: async () => ({ walletId: "w", address: `0x${"ab".repeat(20)}` as Address }), seedTestnet: async () => ({}), transfer: async () => ({ id: "t", state: "INITIATED" }) };
  const w = await ensureBudgetWallet({ store, ops, network: agonNetwork("arc"), now: () => new Date(), defaults: { perHireCap: 250_000n, dailyCap: 1_000_000n } }, "op:x");
  assert.deepEqual([w.perHireCap, w.dailyCap], [250_000n, 1_000_000n]);
  assert.deepEqual(resolveOutsideSettings({}), { enabled: false });
  const on = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: `0x${"E".repeat(40)}` });
  assert.ok(on.enabled && on.ok && on.settings.network.id === "arc" && on.settings.feeAddress === `0x${"e".repeat(40)}` && on.settings.routingFeeBps === 150);
  const bad = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: "nope" });
  assert.ok(bad.enabled && !bad.ok);
});

test("routing for discovery names the Lead without quoting it", async () => {
  const { router, calls } = setup({ kind: "forecast" });
  const out = await router.route("op:x", "Will BTC close above 120k on Friday?", { quoteLead: false });
  assert.deepEqual(out, { kind: "lead" });
  assert.deepEqual(calls, []);
});

test("an answer to the input question is merged with what was filled", async () => {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const router = createRouter({
    sources: [{ id: "circle", status: () => "ok", search: async () => [circle] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls), arc: fakeRuntime("arc", calls) },
    readIntent: async (text) => ({ kind: "market_data", query: text, values: {} }),
    fill: async () => ({ ok: false as const, missing: ["symbol"], question: "What should I use for symbol?", partial: { limit: 5 } }),
    feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" } as never), store, approvalUrl: (t) => t,
  });
  const r = await router.route("op:x", "analyst ratings please");
  assert.ok(r.kind === "pick");
  const first = await router.quote("op:x", r.routeId, "circle:ratings");
  assert.deepEqual(first, { ok: false, code: "missing_input", question: "What should I use for symbol?", missing: ["symbol"] });
  const second = await router.quote("op:x", r.routeId, "circle:ratings", { symbol: "AAPL" });
  assert.ok(second.ok);
  assert.match(calls.at(-1)!, /"limit":5,"symbol":"AAPL"/, "the filled values are kept and the answer added");
});

test("final C3: ranking uses Agon's reading of the request, not every word the person typed", async () => {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [entry({})] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async () => ({ kind: "other", query: "restaurant booking paris", values: {} }),
    fill: async () => ({ ok: true as const, input: {} }), feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" }),
    store, approvalUrl: (t) => t,
  });
  const out = await router.route("op:x", "book a polymarket market check table in paris");
  assert.equal(out.kind, "none", "words the reading dropped do not make Scout a fit");
});

test("final I6: a new owner's wallet passes the global new-wallet gate before any quote", async () => {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [entry({})] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: { market: "arsenal" } }), feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" }),
    store, approvalUrl: (t) => t, newWalletAllowed: () => false,
  });
  const routed = await router.route("op:new", "polymarket market check");
  assert.ok(routed.kind === "pick");
  const q = await router.quote("op:new", routed.routeId, routed.pick.reference);
  assert.deepEqual([q.ok, q.ok ? null : q.code], [false, "busy"]);
  assert.equal(calls.length, 0, "no quote and no wallet were made");
});

test("final I2: the balance check keeps room for the gas that sends Agon's fee", async () => {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [entry({})] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: { market: "arsenal" } }), feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" }),
    store, approvalUrl: (t) => t, balanceOf: async () => 100_150n,
  });
  const routed = await router.route("op:x", "polymarket market check");
  assert.ok(routed.kind === "pick");
  const q = await router.quote("op:x", routed.routeId, routed.pick.reference);
  assert.ok(!q.ok && q.code === "insufficient_balance", JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.equal((q as { amount: bigint }).amount, 100_150n + 5_000n, "the total and a 0.005 USDC gas reserve");
});

test("final I5: one owner's many routes push out only that owner's oldest, never another person's", async () => {
  const { router } = setup();
  const other = await router.route("op:other", "polymarket market check");
  assert.ok(other.kind === "pick");
  const mine: string[] = [];
  for (let i = 0; i < 25; i++) {
    const r = await router.route("op:busy", "polymarket market check");
    assert.ok(r.kind === "pick");
    mine.push(r.routeId);
  }
  const first = await router.quote("op:busy", mine[0]!, "agon:scout");
  assert.deepEqual([first.ok, first.ok ? null : first.code], [false, "route_expired"]);
  assert.equal((await router.quote("op:busy", mine[24]!, "agon:scout")).ok, true);
  assert.equal((await router.quote("op:other", other.routeId, "agon:scout")).ok, true);
});

test("final I1: a destination that resolves to a private network is refused before any quote", async () => {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [entry({})] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: { market: "arsenal" } }), feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" }),
    store, approvalUrl: (t) => t, safeDestination: async () => false,
  });
  const routed = await router.route("op:x", "polymarket market check");
  assert.ok(routed.kind === "pick");
  const q = await router.quote("op:x", routed.routeId, routed.pick.reference);
  assert.deepEqual([q.ok, q.ok ? null : q.code], [false, "unavailable"]);
  assert.equal(calls.length, 0);
});

test("minor: with no fee address for a network, the pick shows no fee for services on it", async () => {
  const calls: string[] = [];
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [entry({})] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: {} }), feeBps: 150, feeAddress: { "arc-testnet": null }, leadAsk: async () => ({ ok: false, code: "x" }),
    store: new MemoryPaymentsStore(), approvalUrl: (t) => t,
  });
  const out = await router.route("op:x", "polymarket market check");
  assert.ok(out.kind === "pick");
  assert.deepEqual([out.pick.fee, out.pick.total], [0n, 100_000n]);
});

test("minor: the person's answers keep only the service's own fields, typed by its schema", async () => {
  const calls: string[] = [];
  const typed = entry({ inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer" } } } });
  const router = createRouter({
    sources: [{ id: "agon", status: () => "ok", search: async () => [typed] }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls) },
    readIntent: async (text) => ({ kind: "analysis", query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: {} }), feeBps: 150, feeAddress: {}, leadAsk: async () => ({ ok: false, code: "x" }),
    store: new MemoryPaymentsStore(), approvalUrl: (t) => t,
  });
  const out = await router.route("op:x", "polymarket market check");
  assert.ok(out.kind === "pick");
  const q = await router.quote("op:x", out.routeId, out.pick.reference, { symbol: "AAPL", limit: "5", extra: "x".repeat(10_000) });
  assert.ok(q.ok);
  assert.deepEqual(q.input, { symbol: "AAPL", limit: 5 });
});
