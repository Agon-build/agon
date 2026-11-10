import assert from "node:assert/strict";
import test from "node:test";

import { bestChoice, categoryCountText, groupHeading, networkWords, proofLines } from "./choice-view.ts";
import type { ProofPart, RoutePick } from "./stage-types.ts";

const part = (status: ProofPart["status"], value: number | null = null, count = 0): ProofPart => ({ value, count, status });
const pick = (over: Partial<RoutePick>): RoutePick => ({
  source: "agon", reference: "r", name: "Scout", provider: "Agon", category: "3", description: "d", method: "POST", network: "arc-testnet",
  rating: { tier: "scored", score: 71, proof: { score: 71.4, playground: part("rated", 90, 10), arena: part("rated", 60, 40), paid: part("rated", 92, 3) } },
  reason: "", price: "0.10", fee: "0.01", total: "0.11", group: "ranked", ...over,
});

test("a ranked agent shows its score and each part that counts, out of 100", () => {
  assert.deepEqual(proofLines(pick({})), ["Agon score 71 of 100", "Paid work 92 of 100, 3 jobs", "Playground 90 of 100, 10 runs", "Arena 60 of 100"]);
});

test("a part without enough results says so plainly, never as zero", () => {
  const p = pick({ rating: { tier: "scored", score: 64, proof: { score: 64, playground: part("rated", 64, 1), arena: part("coming_next"), paid: part("not_enough", null, 1) } } });
  assert.deepEqual(proofLines(p), ["Agon score 64 of 100", "No paid ratings yet", "Playground 64 of 100, 1 run"]);
});

test("new agents and outside services carry no proof lines", () => {
  assert.deepEqual(proofLines(pick({ group: "new" })), []);
  assert.deepEqual(proofLines(pick({ source: "circle", group: "outside", network: "arc" })), []);
});

test("the network is said in words, with real or test money", () => {
  assert.equal(networkWords(pick({ source: "circle", network: "arc" })), "Circle, real USDC on Arc mainnet");
  assert.equal(networkWords(pick({})), "Agon, test USDC on Arc Testnet");
});

test("group headings and category counts read plainly", () => {
  assert.deepEqual((["ranked", "new", "outside"] as const).map(groupHeading), ["Ranked on Agon", "New on Agon, not yet proven", "Outside market"]);
  const c = { id: "business" as const, label: "Business and office tools" };
  assert.equal(categoryCountText({ ...c, agon: 3, outside: 223 }), "3 Agon agents, 223 outside");
  assert.equal(categoryCountText({ ...c, agon: 0, outside: 223 }), "223 outside");
  assert.equal(categoryCountText({ ...c, agon: 1, outside: null }), "1 Agon agent");
  assert.equal(categoryCountText({ ...c, agon: 0, outside: 0 }), "No agents yet");
  assert.equal(categoryCountText({ ...c, agon: null, outside: null }), "");
});

// 2026-11-10: Agon's promise is the best agent for the job, so the choices name one.
test("Agon names its pick: the top ranked agent, else the top new one, else the best-fitting outside service", () => {
  const ranked = pick({ reference: "a", group: "ranked" });
  const fresh = pick({ reference: "b", group: "new" });
  const outside = pick({ reference: "c", group: "outside", source: "circle" });
  assert.deepEqual(bestChoice({ ranked: [ranked], fresh: [fresh], outside: [outside] }), { reference: "a", why: "Highest Agon score among the agents that fit" });
  assert.deepEqual(bestChoice({ ranked: [], fresh: [fresh], outside: [outside] }), { reference: "b", why: "Verified on Agon, no score yet" });
  assert.deepEqual(bestChoice({ ranked: [], fresh: [], outside: [outside] }), { reference: "c", why: "Lowest price among the services that fit. Agon has not tested it" });
  assert.equal(bestChoice({ ranked: [], fresh: [], outside: [] }), null);
  const failed = pick({ reference: "d", group: "ranked", recentlyFailed: true });
  assert.equal(bestChoice({ ranked: [failed], fresh: [], outside: [outside] })!.reference, "c", "a service that just failed is never the pick");
});
