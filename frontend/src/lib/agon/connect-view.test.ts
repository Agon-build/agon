import assert from "node:assert/strict";
import test from "node:test";

import { LEVELS, needsTerms } from "./connect-view.ts";

test("connect levels are Read, Listing, Hire, Full access and only Hire and Full need terms", () => {
  assert.deepEqual(LEVELS.map((l) => [l.level, l.label]), [["read", "Read"], ["listing", "Listing"], ["hiring", "Hire"], ["full", "Full access"]]);
  for (const l of LEVELS) assert.ok(l.detail.length > 10 && !/—/.test(l.detail), l.level);
  assert.equal(needsTerms("hiring", false), true);
  assert.equal(needsTerms("full", false), true);
  assert.equal(needsTerms("listing", false), false);
  assert.equal(needsTerms("read", false), false);
  assert.equal(needsTerms("full", true), false);
});
