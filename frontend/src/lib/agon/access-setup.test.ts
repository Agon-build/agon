import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS_LEVELS, BUDGET_CATEGORY_OPTIONS, EXPIRY_DAYS, budgetLine, budgetRequest, listingStatusLabel, setupSnippets, tokenSnippets, type BudgetCategory } from "./access-setup.ts";

test("five access levels, the spending budget last, and three expiry choices", () => {
  assert.deepEqual(ACCESS_LEVELS.map((l) => [l.level, l.label]), [["read", "Read"], ["listing", "Listing"], ["hiring", "Hiring"], ["full", "Full access"], ["budget", "Spending budget"]]);
  assert.match(ACCESS_LEVELS[3]!.detail, /per-hire limit/);
  assert.match(ACCESS_LEVELS[2]!.detail, /per-hire limit/);
  assert.match(ACCESS_LEVELS[4]!.detail, /no code for each hire/);
  assert.deepEqual([...EXPIRY_DAYS], [7, 30, 90]);
});

// Standing budgets (2026-11-11): the form says why it cannot be sent before the server is asked.
test("a budget form is checked before it is sent, and every category ticked means any", () => {
  const all = BUDGET_CATEGORY_OPTIONS.map((c) => c.id) as BudgetCategory[];
  assert.deepEqual(budgetRequest({ perHire: "0.50", daily: "5", categories: all, allowOutside: false }), { ok: true, budget: { perHire: "0.50", daily: "5", categories: null, allowOutside: false } });
  assert.deepEqual(budgetRequest({ perHire: " 1 ", daily: "10", categories: ["prediction"], allowOutside: true }), { ok: true, budget: { perHire: "1", daily: "10", categories: ["prediction"], allowOutside: true } });
  const refused = (form: Parameters<typeof budgetRequest>[0]) => { const out = budgetRequest(form); return out.ok ? "sent" : out.message; };
  assert.match(refused({ perHire: "lots", daily: "5", categories: all, allowOutside: false }), /USDC amounts/);
  assert.match(refused({ perHire: "0", daily: "5", categories: all, allowOutside: false }), /USDC amounts/);
  assert.match(refused({ perHire: "2", daily: "1", categories: all, allowOutside: false }), /cannot be lower/);
  assert.match(refused({ perHire: "6", daily: "10", categories: all, allowOutside: false }), /at most 5 USDC a hire and 50 USDC a day/);
  assert.match(refused({ perHire: "1", daily: "51", categories: all, allowOutside: false }), /at most/);
  assert.match(refused({ perHire: "1", daily: "5", categories: [], allowOutside: false }), /at least one category/);
});

test("a budget token's row says what it may spend and what it has spent today", () => {
  const budget = { perHire: "0.50", daily: "5.00", categories: null, allowOutside: false };
  assert.equal(budgetLine({ budget, spentToday: "0.30" }), "0.50 a hire, 0.30 of 5.00 USDC today");
  assert.equal(budgetLine({ budget: { ...budget, allowOutside: true }, spentToday: null }), "0.50 a hire, 5.00 USDC a day, outside services allowed");
  assert.equal(budgetLine({ budget: null }), null);
  assert.equal(budgetLine({}), null);
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
