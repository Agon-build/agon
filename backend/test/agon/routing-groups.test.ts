import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogEntry, Proof, ProofPart } from "../../src/agon/routing/catalog.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";
import { groupCandidates } from "../../src/agon/routing/rank.ts";

const part = (status: ProofPart["status"], value: number | null = null, count = 0): ProofPart => ({ value, count, status });
const proven = (score: number): Proof => ({ score, playground: part("rated", score, 5), arena: part("coming_next"), paid: part("not_enough", null, 1) });
const unproven: Proof = { score: null, playground: part("not_enough", null, 2), arena: part("coming_next"), paid: part("not_enough") };

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "agon", reference: "r", name: "Market check", provider: "Agon", category: "3", description: "Polymarket market check", url: "https://x.example/a",
  method: "POST", inputSchema: null, price: 100_000n, payTo: null, network: "arc-testnet", rating: { tier: "verified", score: null, proof: null }, latencyMs: 10_000, tags: [], ...over,
});
const agon = (reference: string, score: number | null, price = 100_000n): CatalogEntry =>
  entry({ reference, price, rating: score === null ? { tier: "verified", score: null, proof: unproven } : { tier: "scored", score, proof: proven(score) } });
const circle = (reference: string, over: Partial<CatalogEntry> = {}): CatalogEntry =>
  entry({ reference, source: "circle", category: "FINANCIAL_ANALYSIS", name: "Polymarket odds", description: "Polymarket market check", network: "arc", rating: { tier: "unrated", score: null }, price: 10_000n, ...over });
const intent: Intent = { kind: "analysis", query: "polymarket market check", values: {} };
const opts = { feeBps: 500, feeMin: 10_000n, downranked: new Set<string>(), category: "prediction" as const };

test("a better proven agent ranks first even at a higher price", () => {
  const g = groupCandidates([agon("cheap", 60, 50_000n), agon("strong", 80, 200_000n)], intent, opts);
  assert.deepEqual(g.ranked.map((c) => c.reference), ["strong", "cheap"]);
  assert.ok(g.ranked.every((c) => c.group === "ranked"));
});

test("scores within 2 points rank the lower total first", () => {
  const g = groupCandidates([agon("a", 80, 200_000n), agon("b", 79, 50_000n)], intent, opts);
  assert.deepEqual(g.ranked.map((c) => c.reference), ["b", "a"]);
});

test("an agent without a rated part is new on Agon, never ranked, and new agents sort by total", () => {
  const g = groupCandidates([agon("n1", null, 300_000n), agon("n2", null, 100_000n), agon("p", 50)], intent, opts);
  assert.deepEqual(g.ranked.map((c) => c.reference), ["p"]);
  assert.deepEqual(g.fresh.map((c) => [c.reference, c.group]), [["n2", "new"], ["n1", "new"]]);
});

test("an outside service is never ranked, whatever it claims, and says so", () => {
  const g = groupCandidates([circle("c1", { rating: { tier: "scored", score: 99 } }), agon("p", 40)], intent, opts);
  assert.deepEqual(g.ranked.map((c) => c.reference), ["p"]);
  assert.deepEqual(g.outside.map((c) => [c.reference, c.group, c.reason]), [["c1", "outside", "Outside market, not ranked by Agon"]]);
});

test("an outside service must belong to the category, and each group stops at 12", () => {
  const priceOnly = circle("eth", { name: "ETH price", description: "Spot price check for any market" });
  const many = Array.from({ length: 15 }, (_, i) => circle(`c${i}`, { price: BigInt(10_000 + i) }));
  const g = groupCandidates([priceOnly, ...many], intent, opts);
  assert.equal(g.outside.length, 12);
  assert.ok(!g.outside.some((c) => c.reference === "eth"));
  assert.equal(g.outside[0]!.reference, "c0");
});

test("a service that failed after payment goes last in its group, and nothing that does not fit is shown", () => {
  const g = groupCandidates([agon("a", 90), agon("b", 50), entry({ reference: "off", name: "Weather", description: "Rain tomorrow" })], intent, { ...opts, downranked: new Set(["a"]) });
  assert.deepEqual(g.ranked.map((c) => c.reference), ["b", "a"]);
  assert.equal([...g.ranked, ...g.fresh, ...g.outside].some((c) => c.reference === "off"), false);
});

test("the model's fit judgement decides what is shown when given", () => {
  const g = groupCandidates([agon("a", 90), agon("b", 50)], intent, { ...opts, fitted: ["b"] });
  assert.deepEqual(g.ranked.map((c) => c.reference), ["b"]);
});
