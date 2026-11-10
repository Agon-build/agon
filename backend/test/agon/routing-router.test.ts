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

function fakeRuntime(network: "arc-testnet" | "arc", calls: string[], opts: { amount?: bigint; payTo?: Address; fail?: string; code?: string } = {}): RouteRuntime {
  return {
    network: agonNetwork(network),
    quoteHire: async (req) => {
      calls.push(`${network}:quote:${req.method}:${JSON.stringify(req.body)}:${req.feeBps}:${req.feeAddress}`);
      if (opts.code) return { ok: false, code: opts.code, detail: "no plain USDC exact option on this network" };
      if (opts.fail) return { ok: false, code: "provider_unreachable", detail: opts.fail };
      const amount = opts.amount ?? (network === "arc" ? 10_000n : 100_000n);
      return { ok: true, quote: { jobId: `job-${network}`, amount, fee: 150n, total: amount + 150n, payTo: opts.payTo ?? CIRCLE_PAY, providerLabel: req.providerLabel, network: agonNetwork(network), expiresAt: new Date(Date.now() + 300_000), step: "confirm_code", code: "1234" } };
    },
    confirmHire: async (i) => { calls.push(`${network}:confirm:${i.code}`); return { ok: true, jobId: `job-${network}`, amount: 1n, txHash: null, result: { ok: true } }; },
    wallets: { ensure: async () => ({ ownerRef: "op:x", network, walletId: "w", address: `0x${"aa".repeat(20)}` as Address, perHireCap: 500_000n, dailyCap: 2_000_000n, frozen: false, createdAt: new Date() }) },
  };
}

function setup(opts: { fill?: Parameters<typeof createRouter>[0]["fill"]; findMarket?: (text: string) => Promise<{ ref: string; question: string } | null>; judge?: (text: string, list: CatalogEntry[]) => Promise<string[] | null>; kind?: Intent["kind"]; outside?: boolean; entries?: CatalogEntry[]; circleStatus?: "ok" | "unavailable"; quoteAmount?: bigint; quoteFail?: string; quoteCode?: string; alive?: (e: CatalogEntry) => Promise<boolean> } = {}) {
  const calls: string[] = [];
  const store = new MemoryPaymentsStore();
  const src = (id: "agon" | "circle", rows: CatalogEntry[], status: "ok" | "unavailable" = "ok"): RouteSource => ({ id, status: () => status, search: async () => rows.filter((r) => r.source === id), all: async () => rows.filter((r) => r.source === id) });
  const rows = opts.entries ?? [entry({}), circle];
  const router = createRouter({
    sources: [src("agon", rows), src("circle", rows, opts.circleStatus)],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", calls), ...(opts.outside === false ? {} : { arc: fakeRuntime("arc", calls, { amount: opts.quoteAmount, fail: opts.quoteFail, code: opts.quoteCode }) }) },
    readIntent: async (text) => ({ kind: opts.kind ?? "analysis", query: text, values: {} }),
    ...(opts.judge ? { judge: opts.judge } : {}),
    fill: opts.fill ?? (async (e) => (e.source === "circle" ? { ok: true as const, input: { symbol: "AAPL" } } : { ok: true as const, input: { market: "arsenal" } })),
    ...(opts.findMarket ? { findMarket: opts.findMarket } : {}),
    ...(opts.alive ? { alive: opts.alive } : {}),
    feeBps: 150,
    feeAddress: { "arc-testnet": `0x${"fe".repeat(20)}` as Address, arc: `0x${"ef".repeat(20)}` as Address },
    leadAsk: async () => { calls.push("lead"); return { ok: false, code: "invalid_question" }; },
    store,
    balanceOf: async () => 10_000_000n,
    approvalUrl: (t) => `https://agon.surf/approve?t=${t}`,
    directEntry: async (ref) => (ref === "agon:drift" ? DRIFT : ref === "agon:lead" ? entry({ reference: "agon:lead", name: "Agon Lead Agent", url: "https://api.agon.surf/agon/agents/lead/forecast" }) : null),
  });
  return { router, calls, store };
}

const DRIFT = entry({ reference: "agon:drift", name: "Drift", url: "https://api.agon.surf/agon/agents/house/drift/forecast", price: 100_000n });

test("a person who picks an agent gets it with no routing fee, and the quote charges none", async () => {
  const { router, calls } = setup();
  const out = await router.direct("op:x", "agon:drift", "Forecast https://polymarket.com/event/fed-cut-december");
  assert.ok(out.kind === "pick");
  assert.deepEqual([out.pick.reference, out.pick.fee, out.pick.total, out.pick.reason, out.alternatives.length], ["agon:drift", 0n, 100_000n, "You chose this agent", 0]);
  const q = await router.quote("op:x", out.routeId, "agon:drift");
  assert.ok(q.ok);
  assert.match(calls[0]!, /^arc-testnet:quote:POST:\{"market":"arsenal"\}:0:/, "no routing fee on a direct hire");
});

test("picking the Lead asks the Lead; an agent that cannot be hired says so", async () => {
  const { router, calls } = setup();
  assert.equal((await router.direct("op:x", "agon:lead", "Will the Fed cut in December?")).kind, "lead");
  assert.deepEqual(calls, ["lead"]);
  assert.equal((await router.direct("op:x", "agon:paused", "anything at all")).kind, "not_hireable");
});

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
  // A live price below the one shown is fine: the quote carries the live price.
  const cheaper = setup({ entries: [circle], kind: "market_data", quoteAmount: 9_999n });
  const r3 = await cheaper.router.route("op:x", "analyst ratings AAPL");
  assert.ok(r3.kind === "pick");
  const q3 = await cheaper.router.quote("op:x", r3.routeId, "circle:ratings");
  assert.ok(q3.ok && "amount" in q3 && q3.amount === 9_999n, JSON.stringify(q3, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
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
  const live = { CIRCLE_LIVE_API_KEY: "LIVE_API_KEY:a:b", CIRCLE_LIVE_ENTITY_SECRET: "s", CIRCLE_LIVE_WALLET_SET_ID: "ws" };
  const on = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: `0x${"E".repeat(40)}`, ...live });
  assert.ok(on.enabled && on.ok && on.settings.network.id === "arc" && on.settings.feeAddress === `0x${"e".repeat(40)}` && on.settings.routingFeeBps === 500);
  const bad = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: "nope", ...live });
  assert.ok(bad.enabled && !bad.ok);
  // Circle refuses a TEST_API key on mainnet (seen 2026-10-26, code 156006), so mainnet needs its own live keys.
  const noLive = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: `0x${"E".repeat(40)}` });
  assert.ok(noLive.enabled && !noLive.ok && noLive.problems.some((p) => /CIRCLE_LIVE_API_KEY/.test(p)));
  const testKey = resolveOutsideSettings({ AGON_OUTSIDE_ENABLED: "true", AGON_OUTSIDE_FEE_ADDRESS: `0x${"E".repeat(40)}`, ...live, CIRCLE_LIVE_API_KEY: "TEST_API_KEY:a:b" });
  assert.ok(testKey.enabled && !testKey.ok && testKey.problems.some((p) => /LIVE_API_KEY/.test(p)));
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

test("the model's fit decides across categories, and its none means none", async () => {
  const images = entry({ source: "circle", reference: "circle:images", name: "Images", provider: "BlockRun.AI", category: "CREATIVE", description: "Generate images from a text prompt", url: "https://arc.blockrun.ai/api/v1/images/generations", price: 22_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });
  const queries: string[][] = [];
  const build = (fits: string[] | null) => createRouter({
    sources: [{ id: "circle", status: () => "ok", search: async (q) => { queries.push(q.circleCategories); return [circle, images]; } }],
    runtimes: { "arc-testnet": fakeRuntime("arc-testnet", []), arc: fakeRuntime("arc", []) },
    readIntent: async (text) => ({ kind: "research", query: text, values: {} }),
    judge: async () => fits,
    fill: async () => ({ ok: true as const, input: {} }),
    feeBps: 150,
    feeAddress: { "arc-testnet": null, arc: null },
    leadAsk: async () => ({ ok: false, code: "invalid_question" }),
    store: new MemoryPaymentsStore(),
    balanceOf: async () => 10_000_000n,
    approvalUrl: (t) => t,
  });
  const picked = await build(["circle:ratings"]).route("op:x", "Give me analyst ratings for AAPL");
  assert.ok(picked.kind === "pick");
  assert.equal(picked.pick.reference, "circle:ratings", "a FINANCIAL_ANALYSIS service answers a request read as research");
  assert.ok(queries[0]!.includes("INFERENCE") && queries[0]!.includes("FINANCIAL_ANALYSIS"), "sources are searched across every category");
  assert.equal((await build([]).route("op:x", "Give me analyst ratings for AAPL")).kind, "none");
  const fallback = await build(null).route("op:x", "Give me analyst ratings for AAPL");
  assert.ok(fallback.kind === "pick" && fallback.pick.reference === "circle:ratings", "without the model the word scores still find it");
});

test("an outside service that fails before asking for payment is named as the service, not the Lead", async () => {
  for (const [fail, code] of [["status 400", "service_refused"], ["fetch failed", "service_unreachable"], ["status 503", "service_unreachable"]] as const) {
    const { router } = setup({ entries: [circle], kind: "market_data", quoteFail: fail });
    const r = await router.route("op:x", "analyst ratings AAPL");
    assert.ok(r.kind === "pick");
    assert.deepEqual(await router.quote("op:x", r.routeId, "circle:ratings"), { ok: false, code, detail: fail });
  }
});

// 2026-11-09: a Circle listing on "arc" whose 402 asked for another network read
// "The lead agent's payment terms do not match this network" and stayed on the list.
test("a service whose payment terms do not fit Arc is named, then left off the choices for a day", async () => {
  const { router } = setup({ entries: [circle], kind: "market_data", quoteCode: "no_matching_option" });
  const first = await router.route("op:x", "analyst ratings AAPL");
  assert.ok(first.kind === "pick");
  assert.deepEqual(await router.quote("op:x", first.routeId, "circle:ratings"), { ok: false, code: "service_terms_mismatch" });
  assert.equal((await router.route("op:x", "analyst ratings AAPL")).kind, "none", "the unpayable service is not offered again");
  const choices = await router.route("op:x", "analyst ratings AAPL", { choices: true, category: "market_data" });
  assert.ok(choices.kind === "choices");
  assert.equal(choices.groups.outside.length, 0);
  const browsed = await router.browse("op:x", "market_data");
  assert.ok(!browsed.groups.outside.some((c) => c.reference === "circle:ratings"));
});

// 2026-11-09 production: "Check the Polymarket market on a Fed rate cut in December" listed nothing,
// because the fit model dropped Scout and Pitch, and Resolution Watch (Verification, category 8)
// was never searched in Prediction markets.
test("a market check always lists Agon's own market agents, whatever the fit model says", async () => {
  const pitch = entry({ reference: "agon:pitch", name: "Pitch", description: "Polymarket market pitch" });
  const watch = entry({ reference: "agon:watch", name: "Resolution Watch", category: "8", description: "Watches Polymarket markets for settlement disputes" });
  const { router } = setup({ entries: [entry({}), pitch, watch], judge: async () => [] });
  const out = await router.route("op:x", "Check the Polymarket market on a Fed rate cut in December", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "prediction");
  const shown = [...out.groups.ranked, ...out.groups.fresh].map((c) => c.reference).sort();
  assert.deepEqual(shown, ["agon:pitch", "agon:scout", "agon:watch"]);
});

test("outside a market check, the fit model still decides which Agon agents show", async () => {
  const { router } = setup({ kind: "research", entries: [entry({ category: "1", description: "Polymarket market research" })], judge: async () => [] });
  const out = await router.route("op:x", "Research Polymarket market news", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.groups.ranked.length + out.groups.fresh.length, 0);
});

// 2026-11-10 rehearsal: "I need a logo for my coffee shop" found nothing although an image service was listed,
// because a service was only considered when its description shared a word with the request.
const IMAGES = entry({ source: "circle", reference: "circle:images", name: "Generate images with GPT Image 1", provider: "BlockRun", category: "INFERENCE", description: "Generate images with GPT Image 1, Nano Banana and more.", url: "https://img.example/generate", price: 22_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });
const CHAT = entry({ source: "circle", reference: "circle:chat", name: "Chat completions", provider: "BlockRun", category: "INFERENCE", description: "Chat with large language models.", url: "https://chat.example/v1", price: 1_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });

test("every service in a small category reaches the fit check, so a logo request finds the image service", async () => {
  const seen: string[][] = [];
  const { router } = setup({ kind: "content", entries: [IMAGES, CHAT], judge: async (_t, list) => { seen.push(list.map((e) => e.reference)); return ["circle:images"]; } });
  const out = await router.route("op:x", "I need a logo for my coffee shop", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "creative");
  assert.ok(seen[0]!.includes("circle:images"), "the image service was put to the fit check");
  assert.deepEqual(out.groups.outside.map((c) => c.reference), ["circle:images"]);
});

const MARKET_SCHEMA = { type: "object", properties: { market: { type: "string", description: "a Polymarket market link, slug or condition id" } }, required: ["market"] };
const scout = entry({ inputSchema: MARKET_SCHEMA });
const LIVE = "https://polymarket.com/event/fed-decision-in-december/will-the-fed-cut-rates-in-december";

// 2026-11-10 rehearsal: Agon's market agents asked for a link, or were sent a market the model made up.
test("a market agent gets the live market Agon found, never one the model made up", async () => {
  const asked: string[] = [];
  const { router, calls } = setup({
    entries: [scout],
    fill: async () => ({ ok: true as const, input: { market: "fed-rate-cut-december-2026" } }),
    findMarket: async (text) => { asked.push(text); return { ref: LIVE, question: "Will the Fed cut rates in December?" }; },
  });
  const r = await router.route("op:x", "Check the Polymarket market on a Fed rate cut in December", { choices: true });
  assert.ok(r.kind === "choices");
  const q = await router.quote("op:x", r.routeId, "agon:scout");
  assert.ok(q.ok && "input" in q, JSON.stringify(q, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  assert.deepEqual(q.input, { market: LIVE });
  assert.deepEqual(asked, ["Check the Polymarket market on a Fed rate cut in December"]);
  assert.match(calls[0]!, new RegExp(`"market":"${LIVE.replace(/[/.]/g, "\\$&")}"`));
});

test("a market link the person typed or answered with is used as it is; no live match asks for the market", async () => {
  const none = async () => null;
  const typed = setup({ entries: [scout], fill: async () => ({ ok: true as const, input: { market: "made-up" } }), findMarket: async () => { throw new Error("not searched"); } });
  const r1 = await typed.router.route("op:x", "Is https://polymarket.com/event/btc/will-bitcoin-reach-150k worth trading?", { choices: true });
  assert.ok(r1.kind === "choices");
  const q1 = await typed.router.quote("op:x", r1.routeId, "agon:scout");
  assert.ok(q1.ok && "input" in q1);
  assert.deepEqual(q1.input, { market: "https://polymarket.com/event/btc/will-bitcoin-reach-150k" });

  const missing = setup({ entries: [scout], fill: async () => ({ ok: true as const, input: { market: "made-up" } }), findMarket: none });
  const r2 = await missing.router.route("op:x", "Check the market on the thing nobody lists", { choices: true });
  assert.ok(r2.kind === "choices");
  const q2 = await missing.router.quote("op:x", r2.routeId, "agon:scout");
  assert.ok(!q2.ok && q2.code === "missing_input" && "missing" in q2);
  assert.deepEqual(q2.missing, ["market"]);
  assert.equal(missing.calls.length, 0, "nothing was quoted");
  const q3 = await missing.router.quote("op:x", r2.routeId, "agon:scout", { market: "will-bitcoin-reach-150k" });
  assert.ok(q3.ok && "input" in q3);
  assert.deepEqual(q3.input, { market: "will-bitcoin-reach-150k" });
});

// 2026-11-10: Agon offered services without knowing whether they were up. It now calls each
// one unpaid before listing it, and offers only those that answered.
test("a service that does not answer Agon's check is left out of the choices", async () => {
  const { router } = setup({ kind: "content", entries: [IMAGES, CHAT], judge: async () => ["circle:images", "circle:chat"], alive: async (e) => e.reference !== "circle:images" });
  const out = await router.route("op:x", "generate images and chat", { choices: true, category: "developer" });
  assert.ok(out.kind === "choices");
  assert.deepEqual(out.groups.outside.map((c) => c.reference), ["circle:chat"]);
});

test("when nothing answers the check, the fault is taken to be Agon's own and every service stays", async () => {
  const { router } = setup({ kind: "content", entries: [IMAGES, CHAT], judge: async () => ["circle:images", "circle:chat"], alive: async () => false });
  const out = await router.route("op:x", "generate images and chat", { choices: true, category: "developer" });
  assert.ok(out.kind === "choices");
  assert.deepEqual(out.groups.outside.map((c) => c.reference).sort(), ["circle:chat", "circle:images"]);
});

test("a service that could not be reached for a quote is left out of the next choices", async () => {
  const { router } = setup({ kind: "content", entries: [IMAGES, CHAT], judge: async () => ["circle:images", "circle:chat"], quoteFail: "fetch failed" });
  const first = await router.route("op:x", "generate images and chat", { choices: true, category: "developer" });
  assert.ok(first.kind === "choices");
  assert.equal((await router.quote("op:x", first.routeId, "circle:images") as { code?: string }).code, "service_unreachable");
  const next = await router.route("op:x", "generate images and chat", { choices: true, category: "developer" });
  assert.ok(next.kind === "choices");
  assert.deepEqual(next.groups.outside.map((c) => c.reference), ["circle:chat"]);
});

// 2026-11-10 rehearsal: "Look up the company Stripe" found nothing. No company data service is
// payable on Arc, but a web search is, and it sat in another category.
const SEARCH = entry({ source: "circle", reference: "circle:search", name: "Search the web with Exa", provider: "Exa", category: "WEB_SEARCH_RESEARCH", description: "Search the web with Exa and return ranked results.", url: "https://search.example/search", price: 7_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });
const PHONE = entry({ source: "circle", reference: "circle:phone", name: "Phone carrier lookup", provider: "BlockRun", category: "COMMUNICATION", description: "Carrier and line type for a phone number.", url: "https://phone.example/lookup", price: 11_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });

test("a request its own category cannot serve is tried in research before Agon says nothing fits", async () => {
  const { router } = setup({ kind: "business", entries: [SEARCH, PHONE], judge: async (_t, list) => list.filter((e) => e.reference === "circle:search").map((e) => e.reference) });
  const out = await router.route("op:x", "Tell me about Stripe, the payments firm", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "research");
  assert.deepEqual(out.groups.outside.map((c) => c.reference), ["circle:search"]);
});

test("a category the person chose themselves is not swapped for another", async () => {
  const { router } = setup({ kind: "business", entries: [SEARCH, PHONE], judge: async (_t, list) => list.filter((e) => e.reference === "circle:search").map((e) => e.reference) });
  const out = await router.route("op:x", "Tell me about Stripe, the payments firm", { choices: true, category: "business" });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "business");
  assert.deepEqual(out.groups.outside, []);
});

// 2026-11-10 production: the cheaper one-symbol price service became Agon's pick for "ETH and SOL".
test("a price service that takes one coin is left out when the request names several", async () => {
  const props = { symbol: { type: "string", description: "Token symbol like 'ETH', 'BTC', 'SOL', 'USDC'." }, chain: { type: "string" } };
  const one = entry({ source: "circle", reference: "circle:one", name: "Price of a token", provider: "anchor-x402", category: "FINANCIAL_ANALYSIS", description: "Look up the current US dollar price of a token", url: "https://one.example/price", method: "POST", inputSchema: { type: "object", properties: props }, price: 1_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });
  const list = entry({ source: "circle", reference: "circle:list", name: "Token price lookup", provider: "BlockRun.AI", category: "FINANCIAL_ANALYSIS", description: "Token price lookup. Pass coin identifiers as coingecko:bitcoin. Supports comma-separated lists.", url: "https://list.example/prices/{coins}", method: "GET", inputSchema: { type: "object", required: ["coins"], properties: { coins: { type: "string" } } }, price: 2_000n, payTo: CIRCLE_PAY, network: "arc", rating: { tier: "unrated", score: null } });
  const judge = async (_t: string, l: CatalogEntry[]) => l.map((e) => e.reference);
  const both = await setup({ kind: "market_data", entries: [one, list], judge }).router.route("op:x", "Price of ETH and SOL right now", { choices: true });
  assert.ok(both.kind === "choices");
  assert.deepEqual(both.groups.outside.map((c) => c.reference), ["circle:list"]);
  const single = await setup({ kind: "market_data", entries: [one, list], judge }).router.route("op:x", "Price of ETH right now", { choices: true });
  assert.ok(single.kind === "choices");
  assert.deepEqual(single.groups.outside.map((c) => c.reference), ["circle:one", "circle:list"]);
});
