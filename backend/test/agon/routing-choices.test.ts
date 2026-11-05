import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { agonNetwork } from "../../src/agon/network.ts";
import type { CatalogEntry, Proof, ProofPart, RouteSource } from "../../src/agon/routing/catalog.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";
import { createRouter, type RouteRuntime } from "../../src/agon/routing/router.ts";
import { MemoryPaymentsStore } from "./payments-memory-store.ts";

const part = (status: ProofPart["status"], value: number | null = null, count = 0): ProofPart => ({ value, count, status });
const proven: Proof = { score: 74, playground: part("rated", 74, 6), arena: part("coming_next"), paid: part("rated", 90, 3) };
const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "agon", reference: "agon:scout", name: "Scout market check", provider: "Agon", category: "3", description: "Polymarket market check verdict",
  url: "https://api.agon.surf/agon/agents/specialists/scout", method: "POST", inputSchema: null, price: 100_000n, payTo: null, network: "arc-testnet",
  rating: { tier: "scored", score: 74, proof: proven }, latencyMs: 15_000, tags: [], ...over,
});
const LEAD = entry({ reference: "agon:lead", name: "Agon Lead Agent", description: "Forecasts a Polymarket market", url: "https://api.agon.surf/agon/agents/lead/forecast", price: 300_000n });
const SMS = entry({ source: "circle", reference: "circle:sms", name: "Send SMS", provider: "P", category: "COMMUNICATION", description: "Send a text message to a phone", url: "https://sms.example/send", method: "POST", price: 10_000n, payTo: `0x${"c1".repeat(20)}` as Address, network: "arc", rating: { tier: "unrated", score: null } });

const runtime = (network: "arc-testnet" | "arc"): RouteRuntime => ({
  network: agonNetwork(network),
  quoteHire: async () => ({ ok: false, code: "not_used" }),
  confirmHire: async () => ({ ok: false, code: "not_used" }),
  wallets: { ensure: async () => { throw new Error("not used"); } },
});

function setup(opts: { kind: Intent["kind"]; rows: CatalogEntry[]; circleStatus?: "ok" | "unavailable" }) {
  const calls: string[] = [];
  const src = (id: "agon" | "circle", status: "ok" | "unavailable" = "ok"): RouteSource => ({
    id, status: () => status,
    search: async () => opts.rows.filter((r) => r.source === id && r !== LEAD),
    all: async () => opts.rows.filter((r) => r.source === id),
  });
  const router = createRouter({
    sources: [src("agon"), src("circle", opts.circleStatus)],
    runtimes: { "arc-testnet": runtime("arc-testnet"), arc: runtime("arc") },
    readIntent: async (text) => ({ kind: opts.kind, query: text, values: {} }),
    fill: async () => ({ ok: true as const, input: {} }),
    feeBps: 500, feeMin: 10_000n,
    feeAddress: { "arc-testnet": `0x${"fe".repeat(20)}` as Address, arc: `0x${"ef".repeat(20)}` as Address },
    leadAsk: async () => { calls.push("lead"); return { ok: false, code: "invalid_question" }; },
    store: new MemoryPaymentsStore(),
    approvalUrl: (t) => t,
    leadEntry: async () => LEAD,
    newId: () => "route-1",
  });
  return { router, calls };
}

test("a forecast on the web lists the Lead as a choice and quotes nothing until it is chosen", async () => {
  const { router, calls } = setup({ kind: "forecast", rows: [LEAD, entry({})] });
  const out = await router.route("op:x", "What is the chance BTC closes above 120k on Friday?", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "prediction");
  assert.ok([...out.groups.ranked, ...out.groups.fresh].some((c) => c.reference === "agon:lead"));
  assert.deepEqual(calls, []);
  const q = await router.quote("op:x", out.routeId, "agon:lead");
  assert.ok(q.ok && "lead" in q);
  assert.deepEqual(calls, ["lead"]);
});

test("without choices a forecast still goes straight to the Lead (MCP and Telegram)", async () => {
  const { router } = setup({ kind: "forecast", rows: [entry({})] });
  assert.equal((await router.route("op:x", "Will BTC close above 120k Friday?", { quoteLead: false })).kind, "lead");
});

test("a chosen category is searched, and an outside service in it is listed as outside", async () => {
  const { router } = setup({ kind: "research", rows: [SMS] });
  const out = await router.route("op:x", "send a text message to my phone", { choices: true, category: "business" });
  assert.ok(out.kind === "choices");
  assert.equal(out.category, "business");
  assert.deepEqual(out.groups.outside.map((c) => [c.reference, c.group]), [["circle:sms", "outside"]]);
});

test("with Circle down the Agon groups still come back and the status says so; nothing fitting is three empty groups", async () => {
  const { router } = setup({ kind: "analysis", rows: [entry({})], circleStatus: "unavailable" });
  const out = await router.route("op:x", "is this polymarket market worth trading", { choices: true });
  assert.ok(out.kind === "choices");
  assert.equal(out.groups.ranked[0]?.reference, "agon:scout");
  assert.deepEqual(out.sources.find((s) => s.id === "circle"), { id: "circle", status: "unavailable" });
  const none = await router.route("op:x", "weather in lisbon tomorrow morning", { choices: true, category: "social" });
  assert.ok(none.kind === "choices");
  assert.deepEqual([none.groups.ranked.length, none.groups.fresh.length, none.groups.outside.length], [0, 0, 0]);
});

test("category counts hold Agon agents and outside services, the Lead in Prediction markets, and null for a source that is down", async () => {
  const up = setup({ kind: "other", rows: [LEAD, entry({}), SMS] });
  const counts = Object.fromEntries((await up.router.categories()).map((c) => [c.id, [c.agon, c.outside]]));
  assert.deepEqual(counts.prediction, [2, 0]);
  assert.deepEqual(counts.business, [0, 1]);
  assert.equal((await up.router.categories()).length, 7);
  const down = setup({ kind: "other", rows: [entry({})], circleStatus: "unavailable" });
  assert.equal((await down.router.categories())[0]!.outside, null);
});

test("browsing a category lists everything in it, and the Lead asks for a question before it quotes", async () => {
  const { router, calls } = setup({ kind: "other", rows: [LEAD, entry({}), SMS] });
  const out = await router.browse("op:x", "prediction");
  assert.deepEqual([...out.groups.ranked, ...out.groups.fresh].map((c) => c.reference).sort(), ["agon:lead", "agon:scout"]);
  assert.deepEqual(out.groups.outside, []);
  const ask = await router.quote("op:x", out.routeId, "agon:lead");
  assert.ok(!ask.ok && ask.code === "missing_input" && "missing" in ask && ask.missing[0] === "question");
  assert.deepEqual(calls, []);
  const q = await router.quote("op:x", out.routeId, "agon:lead", { question: "Will BTC close above 120k Friday?" });
  assert.ok(q.ok && "lead" in q);
  assert.deepEqual(calls, ["lead"]);
  const business = await router.browse("op:x", "business");
  assert.deepEqual(business.groups.outside.map((c) => c.reference), ["circle:sms"]);
});
