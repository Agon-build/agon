import assert from "node:assert/strict";
import test from "node:test";

import { arenaTextByAgentId, cardFacts, sortForCards } from "./card-facts.ts";
import type { AgonListing } from "./types.ts";

const listing = (over: Partial<AgonListing> = {}, body: unknown = { service: { name: "Atlas", description: "Forecasts a Polymarket market and explains why.", logoUrl: "https://agon.surf/agents/atlas.png" }, pricing: { rail: "x402", amountUSDC: "0.22" } }): AgonListing => ({
  id: "5042002:0xf017:7", chainId: "5042002", serviceRegistry: "0xf017", listingId: "7", agentId: "41", serviceKey: "0x1", category: "3", version: "1",
  manifest: { hash: "0x2", uri: "https://x", body }, providerSnapshot: "0x3", status: "Listed",
  verification: { status: "Verified", scope: { agentId: "41", listingId: "7", version: "1", category: "3" } },
  risk: { unverified: false, warning: null, quarantineReason: null },
  endpointQa: { status: "passed", checkedAt: null, endpointStatus: 402, evidenceHash: null, reason: null, attempts: 1, passedAttempts: 1, successRate: 1 },
  payment: { rail: "X402", directX402: true, escrowEligible: false },
  provenance: { sourceBlockNumber: "1", sourceTxHash: "0x4", sourceLogIndex: 0 }, firstParty: false, ...over,
} as AgonListing);

test("a card shows the same facts every time, from the listing and the Arena only", () => {
  const facts = cardFacts(listing({ firstParty: true }), { agentId: "41", text: "#1 in Politics" });
  assert.deepEqual(facts, {
    name: "Atlas", line: "Forecasts a Polymarket market and explains why.", logoUrl: "https://agon.surf/agents/atlas.png", initials: "AT",
    badge: "Built by Agon", chips: ["Per call"], price: "From 0.22 USDC", arena: "#1 in Politics", activity: null,
  });
});

test("badges follow verification; escrow listings say Paid on delivery", () => {
  assert.equal(cardFacts(listing(), null).badge, "Verified");
  assert.equal(cardFacts(listing({ verification: { status: "Unverified", scope: { agentId: "41", listingId: "7", version: "1", category: "3" } } }), null).badge, "Listed");
  assert.deepEqual(cardFacts(listing({ payment: { rail: "Escrow", directX402: false, escrowEligible: true } }), null).chips, ["Paid on delivery"]);
  assert.equal(cardFacts(listing({ firstParty: undefined }), null).badge, "Verified");
});

test("a listing with no manifest details never gets an invented name or price", () => {
  const facts = cardFacts(listing({}, null), null);
  assert.equal(facts.name, "Agent #41 service");
  assert.equal(facts.initials, "A4");
  assert.equal(facts.price, null);
  assert.equal(facts.logoUrl, null);
  assert.equal(facts.arena, null);
  assert.equal(facts.activity, "New");
});

test("Arena text for another agent is never shown on this card", () => {
  assert.equal(cardFacts(listing(), { agentId: "99", text: "#1 in the Arena" }).arena, null);
});

test("Arena text is keyed by ERC-8004 id from the Season entries", () => {
  const cell = (n: number, ranked: boolean, rank: number | null) => ({ rating: 0.02, meanSkill: 0.02, forecastsResolved: n, ranked, rank });
  const empty = { sports: cell(0, false, null), crypto: cell(0, false, null), economics: cell(0, false, null), politics: cell(0, false, null), world: cell(0, false, null), culture: cell(0, false, null) };
  const map = arenaTextByAgentId(
    [
      { agentAddress: "0xa", erc8004AgentId: "41", displayName: "Atlas", house: true, forecastEndpoint: null, enteredRound: "0" },
      { agentAddress: "0xc", erc8004AgentId: "42", displayName: "Vesper", house: true, forecastEndpoint: null, enteredRound: "0" },
      { agentAddress: "0xd", erc8004AgentId: "43", displayName: "Kestrel", house: true, forecastEndpoint: null, enteredRound: "0" },
      { agentAddress: "0xb", erc8004AgentId: null, displayName: "X", house: false, forecastEndpoint: null, enteredRound: "0" },
    ],
    { seasonId: "1", updatedAt: "", categories: ["sports", "crypto", "economics", "politics", "world", "culture"], minRanked: { overall: 20, category: 10 },
      agents: [
        { agentAddress: "0xA", displayName: "Atlas", house: true, overall: cell(24, true, 2), categories: empty },
        { agentAddress: "0xC", displayName: "Vesper", house: true, overall: cell(7, false, null), categories: empty },
        { agentAddress: "0xD", displayName: "Kestrel", house: true, overall: cell(0, false, null), categories: empty },
      ] },
  );
  assert.deepEqual([...map.entries()], [["41", "#2 in the Arena"], ["42", "7 Arena forecasts scored"], ["43", "In the Arena"]]);
});

test("cards list Built by Agon first, then Verified, then Listed, keeping order within each", () => {
  const unverified = { status: "Unverified", scope: { agentId: "41", listingId: "7", version: "1", category: "3" } } as const;
  const rows = [listing({ id: "a", verification: unverified }), listing({ id: "b" }), listing({ id: "c", firstParty: true }), listing({ id: "d" })];
  assert.deepEqual(sortForCards(rows).map((l) => l.id), ["c", "b", "d", "a"]);
});

test("New shows only when the card has no measured activity to show", () => {
  assert.equal(cardFacts(listing(), null).activity, "New");
  assert.equal(cardFacts(listing(), { agentId: "41", text: "#2 in the Arena" }).activity, null);
});
