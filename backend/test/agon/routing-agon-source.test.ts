import assert from "node:assert/strict";
import test from "node:test";

import { createAgonSource, schemaFromRequired, type AgonListingLite } from "../../src/agon/routing/agon-source.ts";

const listing = (over: Partial<AgonListingLite>): AgonListingLite => ({
  reference: "5042002:0xreg:9", agentId: "9", name: "Scout", description: "A trade, watch or avoid verdict for any Polymarket market.",
  category: "3", endpoint: "https://api.agon.surf/agon/agents/specialists/scout", priceAtomic: 100_000n, latencyMs: 15_000,
  status: "Listed", verified: true, requestRequired: ["market"], ...over,
});
const q = (words: string[]) => ({ words, agonCategories: ["3"], circleCategories: [] });

function source(rows: AgonListingLite[], scores: Record<string, number> = {}) {
  return createAgonSource({ listListings: async () => rows, scoreFor: async (id) => scores[id] ?? null });
}

test("Verified scored, Verified unscored and Listed map to their tiers", async () => {
  const s = source([listing({ agentId: "1", reference: "r:1" }), listing({ agentId: "2", reference: "r:2" }), listing({ agentId: "3", reference: "r:3", verified: false })], { "1": 82 });
  const out = await s.search(q(["polymarket"]));
  assert.deepEqual(out.map((e) => [e.reference, e.rating.tier, e.rating.score]), [["r:1", "scored", 82], ["r:2", "verified", null], ["r:3", "listed", null]]);
  assert.deepEqual([out[0]!.network, out[0]!.method, out[0]!.payTo, out[0]!.source], ["arc-testnet", "POST", null, "agon"]);
});

test("paused listings, the Lead and house forecasters are never returned", async () => {
  const s = source([
    listing({ reference: "r:p", status: "Paused" }),
    listing({ reference: "r:lead", endpoint: "https://api.agon.surf/agon/agents/lead/forecast" }),
    listing({ reference: "r:house", endpoint: "https://api.agon.surf/agon/agents/house/vesper/forecast" }),
  ]);
  assert.deepEqual(await s.search(q(["polymarket"])), []);
});

test("only the asked categories and matching words come back", async () => {
  const s = source([listing({})]);
  assert.equal((await s.search({ words: ["polymarket"], agonCategories: ["1"], circleCategories: [] })).length, 0);
  assert.equal((await s.search(q(["weather"]))).length, 0);
});

test("a listing's required inputs become a typed schema", () => {
  assert.deepEqual(schemaFromRequired(["market"]), { type: "object", required: ["market"], properties: { market: { type: "string" } } });
  assert.equal(schemaFromRequired([]), null);
});
