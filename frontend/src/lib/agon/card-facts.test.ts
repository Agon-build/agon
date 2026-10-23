import assert from "node:assert/strict";
import test from "node:test";

import { cardFacts, sortForCards } from "./card-facts.ts";
import type { AgonListing } from "./types.ts";

const listing = (over: Partial<AgonListing> = {}, body: unknown = { service: { name: "Atlas", description: "Forecasts a Polymarket market and explains why.", logoUrl: "https://agon.surf/agents/atlas.svg" }, pricing: { rail: "x402", amountUSDC: "0.22" } }): AgonListing => ({
  id: "5042002:0xf017:7", chainId: "5042002", serviceRegistry: "0xf017", listingId: "7", agentId: "41", serviceKey: "0x1", category: "3", version: "1",
  manifest: { hash: "0x2", uri: "https://x", body }, providerSnapshot: "0x3", status: "Listed",
  verification: { status: "Verified", scope: { agentId: "41", listingId: "7", version: "1", category: "3" } },
  risk: { unverified: false, warning: null, quarantineReason: null },
  endpointQa: { status: "passed", checkedAt: null, endpointStatus: 402, evidenceHash: null, reason: null, attempts: 1, passedAttempts: 1, successRate: 1 },
  payment: { rail: "X402", directX402: true, escrowEligible: false },
  provenance: { sourceBlockNumber: "1", sourceTxHash: "0x4", sourceLogIndex: 0 }, firstParty: false, ...over,
} as AgonListing);
const unverified = { status: "Unverified", scope: { agentId: "41", listingId: "7", version: "1", category: "3" } } as const;

test("a card shows the same facts every time, from the listing, the Agon score and delivered jobs only", () => {
  const facts = cardFacts(listing({ firstParty: true }), { agentId: "41", text: "Agon score 78 · Analysis #1" }, { jobsCompleted: 128, earnedUSDC: "28.16" });
  assert.deepEqual(facts, {
    name: "Atlas", line: "Forecasts a Polymarket market and explains why.", logoUrl: "https://agon.surf/agents/atlas.svg", initials: "AT",
    badges: ["Built by Agon", "Verified"], chips: ["Per call"], price: "0.22 USDC", rating: "Agon score 78 · Analysis #1",
    activity: "128 jobs done · 28.16 USDC earned",
  });
});

test("one delivered job reads in the singular", () => {
  assert.equal(cardFacts(listing(), null, { jobsCompleted: 1, earnedUSDC: "0.30" }).activity, "1 job done · 0.30 USDC earned");
});

test("without delivered jobs the card shows the measured endpoint state, never a made-up number", () => {
  assert.equal(cardFacts(listing(), null).activity, "Online");
  assert.equal(cardFacts(listing({ endpointQa: { ...listing().endpointQa, status: "failed" } }), null).activity, "Offline");
  assert.equal(cardFacts(listing({ endpointQa: { ...listing().endpointQa, status: "not_checked" } }), null).activity, null);
  assert.equal(cardFacts(listing(), null, { jobsCompleted: 0, earnedUSDC: "0.00" }).activity, "Online");
});

test("Agon's own listings keep their verification badge next to Built by Agon", () => {
  assert.deepEqual(cardFacts(listing({ firstParty: true, verification: unverified }), null).badges, ["Built by Agon", "Listed"]);
  assert.deepEqual(cardFacts(listing(), null).badges, ["Verified"]);
  assert.deepEqual(cardFacts(listing({ verification: unverified }), null).badges, ["Listed"]);
  assert.deepEqual(cardFacts(listing({ firstParty: undefined }), null).badges, ["Verified"]);
});

test("escrow listings say Paid on delivery", () => {
  assert.deepEqual(cardFacts(listing({ payment: { rail: "Escrow", directX402: false, escrowEligible: true } }), null).chips, ["Paid on delivery"]);
});

test("a listing with no manifest details never gets an invented name or price", () => {
  const facts = cardFacts(listing({}, null), null);
  assert.equal(facts.name, "Agent #41 service");
  assert.equal(facts.initials, "A4");
  assert.equal(facts.price, null);
  assert.equal(facts.logoUrl, null);
  assert.equal(facts.rating, null);
});

test("a score line for another agent is never shown on this card", () => {
  assert.equal(cardFacts(listing(), { agentId: "99", text: "Agon score 90 · Analysis #1" }).rating, null);
});

test("cards list verified Agon agents, then verified, then other Agon listings, then the rest", () => {
  const rows = [listing({ id: "a", verification: unverified }), listing({ id: "b" }), listing({ id: "c", firstParty: true }), listing({ id: "d", firstParty: true, verification: unverified }), listing({ id: "e" })];
  assert.deepEqual(sortForCards(rows).map((l) => l.id), ["c", "b", "e", "d", "a"]);
});

test("job totals and score lines attach only on their own network, and job totals only to Agon's listings", async () => {
  const { cardExtras } = await import("./card-facts.ts");
  const activity = { network: "arc-testnet", agents: { "41": { jobsCompleted: 3, earnedUSDC: "0.90" } } };
  const scores = { network: "arc-testnet", byAgentId: new Map([["41", "Agon score 70 · Analysis #2"]]) };
  const own = listing({ firstParty: true });
  assert.deepEqual(cardExtras(own, "arc-testnet", activity, scores), { activity: { jobsCompleted: 3, earnedUSDC: "0.90" }, rating: { agentId: "41", text: "Agon score 70 · Analysis #2" } });
  assert.deepEqual(cardExtras(own, "arc", activity, scores), { activity: null, rating: null }, "same id on another network is another agent");
  assert.deepEqual(cardExtras(listing({ firstParty: false }), "arc-testnet", activity, scores), { activity: null, rating: { agentId: "41", text: "Agon score 70 · Analysis #2" } }, "a transferred id keeps its score but not Agon's receipts");
  assert.deepEqual(cardExtras(own, "arc-testnet", null, null), { activity: null, rating: null });
});

test("totals read as paid, the spec's wording", () => {
  assert.equal(cardFacts(listing(), null, { jobsCompleted: 2, earnedUSDC: "0.60" }).activity, "2 jobs done · 0.60 USDC earned");
});

test("card earnings read to the cent", () => {
  assert.equal(cardFacts(listing(), null, { jobsCompleted: 3, earnedUSDC: "0.52272" }).activity, "3 jobs done · 0.52 USDC earned");
});
