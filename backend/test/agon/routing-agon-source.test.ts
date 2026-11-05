import assert from "node:assert/strict";
import test from "node:test";

import { createAgonSource, type AgonListingLite } from "../../src/agon/routing/agon-source.ts";
import { hasRatedPart, type Proof, type ProofPart } from "../../src/agon/routing/catalog.ts";

const MARKET = { type: "object" as const, properties: { market: { type: "string" as const, description: "a Polymarket link" } }, required: ["market"] };
const listing = (over: Partial<AgonListingLite>): AgonListingLite => ({
  reference: "5042002:0xreg:9", agentId: "9", name: "Scout", description: "A trade, watch or avoid verdict for any Polymarket market.",
  category: "3", endpoint: "https://api.agon.surf/agon/agents/specialists/scout", priceAtomic: 100_000n, latencyMs: 15_000,
  status: "Listed", verified: true, inputSchema: MARKET, ...over,
});
const q = (words: string[]) => ({ words, agonCategories: ["3"], circleCategories: [] });

const part = (status: ProofPart["status"], value: number | null = null, count = 0): ProofPart => ({ value, count, status });
const proofOf = (score: number): Proof => ({ score, playground: part("rated", score, 5), arena: part("coming_next"), paid: part("not_enough", null, 1) });

function source(rows: AgonListingLite[], scores: Record<string, number> = {}, proofs: Record<string, Proof | Error> = {}) {
  return createAgonSource({
    listListings: async () => rows,
    proofFor: async (id) => {
      const p = proofs[id];
      if (p instanceof Error) throw p;
      return p ?? (scores[id] !== undefined ? proofOf(scores[id]!) : null);
    },
  });
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

test("a listing's named inputs are the entry's schema, and a listing without them is left out", async () => {
  const s = source([listing({ reference: "r:named" }), listing({ reference: "r:old", inputSchema: null })]);
  const out = await s.search(q(["polymarket"]));
  assert.deepEqual(out.map((e) => e.reference), ["r:named"]);
  assert.deepEqual(out[0]!.inputSchema, MARKET);
});

test("a direct hire finds any listed, verified agent with named inputs, house forecasters included", async () => {
  const s = source([
    listing({ reference: "r:house", agentId: "6", endpoint: "https://api.agon.surf/agon/agents/house/drift/forecast", name: "Drift" }),
    listing({ reference: "r:p", status: "Paused" }), listing({ reference: "r:u", verified: false }), listing({ reference: "r:old", inputSchema: null }),
  ], { "6": 70 });
  const drift = await s.entryFor("r:house");
  assert.deepEqual([drift?.name, drift?.rating.tier, drift?.rating.score], ["Drift", "scored", 70]);
  for (const ref of ["r:p", "r:u", "r:old", "r:missing"]) assert.equal(await s.entryFor(ref), null, ref);
});

test("an Agon entry carries its full proof: the score and its three parts", async () => {
  const proof: Proof = { score: 71, playground: part("not_enough", null, 2), arena: part("coming_next"), paid: part("rated", 88, 3) };
  const [e] = await source([listing({ agentId: "1" })], {}, { "1": proof }).search(q(["polymarket"]));
  assert.deepEqual([e!.rating.tier, e!.rating.score, e!.rating.proof?.paid.count], ["scored", 71, 3]);
  assert.equal(hasRatedPart(e!.rating.proof ?? null), true);
});

test("an agent with no rated part has no ranked proof, and a failed proof read leaves it verified", async () => {
  const none: Proof = { score: null, playground: part("not_enough", null, 2), arena: part("coming_next"), paid: part("not_enough", null, 1) };
  const out = await source([listing({ agentId: "1", reference: "r:1" }), listing({ agentId: "2", reference: "r:2" })], {}, { "1": none, "2": new Error("down") }).search(q(["polymarket"]));
  assert.deepEqual(out.map((e) => [e.rating.tier, e.rating.score, e.rating.proof ?? null]), [["verified", null, none], ["verified", null, null]]);
  assert.equal(hasRatedPart(none), false);
  assert.equal(hasRatedPart(null), false);
});
