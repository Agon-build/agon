import assert from "node:assert/strict";
import test from "node:test";

import { agentCounts, boardFootnote, inputNames, isPaused, partBar } from "./agents-layout.ts";

const listing = (status: string, listingStatus = "Listed") => ({ status: listingStatus, verification: { status } });

test("the header counts come from the listings and the score rows", () => {
  const listings = [...Array.from({ length: 8 }, () => listing("Verified")), listing("Suspended")];
  assert.deepEqual(agentCounts(listings, 7), { listed: 9, verified: 8, paused: 1, scored: 7 });
});

test("a paused agent is one whose checks or listing are suspended", () => {
  assert.equal(isPaused(listing("Suspended")), true);
  assert.equal(isPaused(listing("Paused")), true);
  assert.equal(isPaused(listing("Verified", "Suspended")), true);
  assert.equal(isPaused(listing("Verified")), false);
  assert.equal(isPaused(listing("Pending")), false);
});

test("a score bar shows its value, or says there is not enough yet", () => {
  assert.deepEqual(partBar({ value: 80, status: "rated" }), { width: 80, label: "80" });
  assert.deepEqual(partBar({ value: 88.34, status: "rated" }), { width: 88.34, label: "88.3" });
  assert.deepEqual(partBar({ value: 140, status: "rated" }), { width: 100, label: "140" });
  assert.deepEqual(partBar({ value: null, status: "not_enough" }), { width: null, label: "Not enough yet" });
  assert.deepEqual(partBar({ value: null, status: "coming_next" }), { width: null, label: "Coming next" });
  assert.deepEqual(partBar({ value: null, status: "no_test" }), { width: null, label: "No test yet" });
});

test("the leaderboard note says whether any agent has three paid ratings", () => {
  const rated = { parts: { paid: { status: "rated" as const } } };
  const short = { parts: { paid: { status: "not_enough" as const } } };
  assert.equal(boardFootnote([short, short]), "Ratings from paid work count once an agent has three. No agent has three yet.");
  assert.equal(boardFootnote([short, rated]), "Ratings from paid work count once an agent has three.");
});

test("a card names what the agent takes from its published inputs", () => {
  const body = (properties: unknown) => ({ invocation: { requestSchema: { properties } } });
  assert.equal(inputNames(body({ market: {}, notes: {} })), "market, notes");
  assert.equal(inputNames(body({})), null);
  assert.equal(inputNames(undefined), null);
  assert.equal(inputNames({ invocation: {} }), null);
});
