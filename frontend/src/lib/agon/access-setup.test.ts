import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS_LEVELS, EXPIRY_DAYS, listingStatusLabel, setupSnippets } from "./access-setup.ts";

test("three access levels and two expiry choices", () => {
  assert.deepEqual(ACCESS_LEVELS.map((l) => [l.level, l.label]), [["read", "Read"], ["listing", "Listing"], ["hiring", "Hiring"]]);
  assert.match(ACCESS_LEVELS[2]!.detail, /per-hire limit/);
  assert.deepEqual([...EXPIRY_DAYS], [30, 90]);
});

test("setup snippets read the token from an environment variable and never hold a token", () => {
  const snippets = setupSnippets("https://api.agon.surf/agon/mcp");
  assert.deepEqual(snippets.map((s) => s.label), ["Claude Code", "Cursor", "Any MCP client"]);
  assert.match(snippets[0]!.code, /"Authorization": "Bearer \$\{AGON_TOKEN\}"/);
  assert.match(snippets[1]!.code, /"Authorization": "Bearer \$\{env:AGON_TOKEN\}"/);
  for (const s of snippets) {
    assert.match(s.code, /AGON_TOKEN/);
    assert.match(s.code, /https:\/\/api\.agon\.surf\/agon\/mcp/);
    assert.doesNotMatch(s.code, /agon_pat_/);
  }
});

test("my listings say where each listing stands in plain words", () => {
  assert.equal(listingStatusLabel(null), "Draft");
  assert.equal(listingStatusLabel({ status: "review_terms", reference: null }), "Ready to publish");
  assert.equal(listingStatusLabel({ status: "fund_wallet", reference: null }), "Needs the network fee");
  assert.equal(listingStatusLabel({ status: "pending", reference: null }), "Publishing");
  assert.equal(listingStatusLabel({ status: "needs_attention", reference: null }), "Needs attention");
  assert.equal(listingStatusLabel({ status: "published", reference: "r" }), "Listed");
});
