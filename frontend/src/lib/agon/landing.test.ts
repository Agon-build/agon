import assert from "node:assert/strict";
import test from "node:test";

import { introDestination, landingFacts, landingMotion } from "./landing.ts";
import type { Board } from "./scores-api.ts";
import type { HireCategory, SeasonInfo } from "./stage-types.ts";
import type { AgonListing } from "./types.ts";

const listing = (status: string) => ({ verification: { status } }) as unknown as AgonListing;
const part = (value: number | null) => ({ value, count: 10, atMinimum: true, status: value === null ? "not_enough" : "rated" });
const row = (agentId: string, rank: number, score: number, arena: number | null, playground: number | null) =>
  ({ agentId, listingReference: `5042002:0xabc:${agentId}`, rank, score, parts: { arena: part(arena), playground: part(playground), paid: part(null) } });
const board = { category: "3", window: "all", rows: [row("7", 2, 79.4, null, 79.4), row("4", 1, 83.5, 80, 88.3)] } as unknown as Board;
const season = { startsAt: "2026-10-22T00:00:00.000Z", endsAt: "2026-11-19T00:00:00.000Z", roundHours: 6, currentRound: "66" } as SeasonInfo;
const categories = [{ id: "prediction", outside: 10 }, { id: "market_data", outside: 114 }, { id: "social", outside: 0 }, { id: "business", outside: null }] as HireCategory[];

test("facts come only from live data: nothing loaded means nothing shown", () => {
  assert.deepEqual(landingFacts({ listings: null, board: null, categories: null, season: null, topName: null }),
    { listed: null, verified: null, outside: null, topAgent: null, round: null, seasonEnds: null });
});

test("counts come from the listings and the outside categories", () => {
  const f = landingFacts({ listings: [...Array(8)].map(() => listing("Verified")).concat(listing("Suspended")), board: null, categories, season: null, topName: null });
  assert.equal(f.listed, 9);
  assert.equal(f.verified, 8);
  assert.equal(f.outside, 124);
});

test("the top agent is the best ranked row, named from its listing", () => {
  assert.deepEqual(landingFacts({ listings: null, board, categories: null, season: null, topName: "Kestrel" }).topAgent,
    { name: "Kestrel", score: 83.5, rank: 1, of: 2, arena: 80, playground: 88.3 });
  assert.equal(landingFacts({ listings: null, board, categories: null, season: null, topName: null }).topAgent, null, "no name, no claim");
});

test("the season gives its round and end date", () => {
  const f = landingFacts({ listings: null, board: null, categories: null, season, topName: null });
  assert.equal(f.round, 66);
  assert.equal(f.seasonEnds, "19 Nov");
});

test("reduced motion gets the static story", () => {
  assert.equal(landingMotion(false), "static");
  assert.equal(landingMotion(true), "scroll");
});

test("Enter Agon opens the welcome story", () => assert.equal(introDestination(), "/welcome"));
