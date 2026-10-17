import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS_LEVELS, EXPIRY_DAYS, listingStatusLabel, setupSnippets, tokenSnippets } from "./access-setup.ts";

test("four access levels, full access last, and two expiry choices", () => {
  assert.deepEqual(ACCESS_LEVELS.map((l) => [l.level, l.label]), [["read", "Read"], ["listing", "Listing"], ["hiring", "Hiring"], ["full", "Full access"]]);
  assert.match(ACCESS_LEVELS[3]!.detail, /per-hire limit/);
  assert.match(ACCESS_LEVELS[2]!.detail, /per-hire limit/);
  assert.deepEqual([...EXPIRY_DAYS], [30, 90]);
});

test("setup snippets are one line per client and hold no token", () => {
  // Codex: `codex mcp add <name> --url <url>` then `codex mcp login <name>` (developers.openai.com docs/extend/mcp, read 17 Oct 2026).
  const snippets = setupSnippets("https://api.agon.surf/agon/mcp");
  assert.deepEqual(snippets.map((s) => s.label), ["Claude Code", "Codex", "Cursor", "Any MCP client"]);
  assert.equal(snippets[0]!.code, "claude mcp add --transport http agon https://api.agon.surf/agon/mcp");
  assert.equal(snippets[1]!.code, ["codex mcp add agon --url https://api.agon.surf/agon/mcp", "codex mcp login agon"].join(String.fromCharCode(10)));
  for (const s of snippets) {
    assert.match(s.code, /https:\/\/api\.agon\.surf\/agon\/mcp/);
    assert.doesNotMatch(s.code, /AGON_TOKEN|Authorization|agon_pat_/);
  }
});

test("token setup for agents without a browser reads the token from an environment variable", () => {
  const snippets = tokenSnippets("https://api.agon.surf/agon/mcp");
  assert.match(snippets[0]!.code, /"Authorization": "Bearer \$\{AGON_TOKEN\}"/);
  for (const s of snippets) {
    assert.match(s.code, /AGON_TOKEN/);
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
