import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";
import { rankCandidates } from "../../src/agon/routing/rank.ts";

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "agon", reference: "r", name: "Market check", provider: "Agon", category: "3", description: "Polymarket market check", url: "https://x.example/a",
  method: "POST", inputSchema: null, price: 100_000n, payTo: null, network: "arc-testnet", rating: { tier: "verified", score: null }, latencyMs: 10_000, tags: [], ...over,
});
const intent: Intent = { kind: "analysis", query: "polymarket market check", values: {} };
const opts = { feeBps: 150, downranked: new Set<string>() };

test("a scored Agon agent beats a cheaper unrated Circle service", () => {
  const out = rankCandidates([
    entry({ reference: "circle:a", source: "circle", category: "FINANCIAL_ANALYSIS", price: 10_000n, rating: { tier: "unrated", score: null }, network: "arc" }),
    entry({ reference: "agon:s", rating: { tier: "scored", score: 82 } }),
  ], intent, opts);
  assert.equal(out.pick!.reference, "agon:s");
  assert.match(out.pick!.reason, /Verified on Agon, score 82/);
  assert.deepEqual([out.pick!.fee, out.pick!.total], [1_500n, 101_500n]);
  assert.equal(out.alternatives[0]!.reference, "circle:a");
  assert.match(out.alternatives[0]!.reason, /Not rated by Agon/);
});

test("within a tier the lower total wins, then the faster one", () => {
  const out = rankCandidates([
    entry({ reference: "a", price: 200_000n }), entry({ reference: "b", price: 100_000n, latencyMs: 30_000 }), entry({ reference: "c", price: 100_000n, latencyMs: 5_000 }),
  ], intent, opts);
  assert.deepEqual([out.pick!.reference, ...out.alternatives.map((a) => a.reference)], ["c", "b", "a"]);
});

test("Circle is picked when nothing on Agon fits, with reason Not rated by Agon", () => {
  const out = rankCandidates([entry({ reference: "circle:a", source: "circle", category: "FINANCIAL_ANALYSIS", rating: { tier: "unrated", score: null }, network: "arc" })], intent, opts);
  assert.equal(out.pick!.reference, "circle:a");
  assert.match(out.pick!.reason, /Not rated by Agon/);
});

test("a request that fits nothing returns no pick", () => {
  assert.deepEqual(rankCandidates([], intent, opts), { pick: null, alternatives: [] });
  const offTopic = rankCandidates([entry({ name: "Weather", description: "Rain forecast for a city" })], { kind: "analysis", query: "polymarket odds", values: {} }, opts);
  assert.equal(offTopic.pick, null);
});

test("a down-ranked service drops to last and at most three alternatives come back", () => {
  const rows = ["a", "b", "c", "d", "e"].map((r, i) => entry({ reference: r, price: BigInt(100_000 + i) }));
  const out = rankCandidates(rows, intent, { feeBps: 150, downranked: new Set(["a"]) });
  assert.equal(out.pick!.reference, "b");
  assert.equal(out.alternatives.length, 3);
  assert.ok(!out.alternatives.some((x) => x.reference === "a"));
});

test("final C3: filler words never make a fit, and a longer request needs two real words in common", () => {
  const helper = entry({ reference: "agon:h", name: "Helper", description: "An agent for you and the team that can help with what you need", rating: { tier: "scored", score: 90 } });
  for (const query of ["book a table for two in paris", "hi there how are you", "can you help me with what I need"]) {
    const out = rankCandidates([helper], { kind: "other", query, values: {} }, opts);
    assert.equal(out.pick, null, query);
  }
  const ratings = entry({ reference: "circle:r", source: "circle", category: "FINANCIAL_ANALYSIS", name: "Analyst ratings", description: "Analyst ratings and price target changes", rating: { tier: "unrated", score: null }, network: "arc" });
  assert.equal(rankCandidates([ratings], { kind: "analysis", query: "apple analyst ratings", values: {} }, opts).pick?.reference, "circle:r");
  assert.equal(rankCandidates([ratings], { kind: "analysis", query: "apple stock news today", values: {} }, opts).pick, null, "one shared word in a longer request is not a fit");
  assert.equal(rankCandidates([ratings], { kind: "analysis", query: "ratings", values: {} }, opts).pick?.reference, "circle:r", "a one-word request needs one");
});
