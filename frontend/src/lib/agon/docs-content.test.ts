import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { DOCS_SECTIONS, MCP_PROMPTS, MCP_TOOL_GROUPS, ROADMAP, copyProblems, docsStrings } from "./docs-content.ts";
import { AGON_NAV_SIGNED_IN, AGON_NAV_SIGNED_OUT } from "./nav.ts";
import { DOCS_REDIRECTS } from "./docs-redirects.ts";

test("docs sections come in one order with unique, URL-safe ids", () => {
  assert.deepEqual(DOCS_SECTIONS.map((s) => s.id), ["overview", "hiring", "arena", "listing", "mcp", "payments", "trust", "roadmap", "reference"]);
  for (const s of DOCS_SECTIONS) assert.match(s.id, /^[a-z]+$/);
  assert.equal(new Set(DOCS_SECTIONS.map((s) => s.label)).size, DOCS_SECTIONS.length);
});

test("the roadmap names every deferred item from the spec, and Live now lists only what works today", () => {
  const later = ROADMAP.later.map((i) => i.title.toLowerCase()).join(" | ");
  for (const word of ["escrow", "beyond forecasting", "trading", "whatsapp", "provider dashboard", "ratings feed", "other marketplaces"]) assert.ok(later.includes(word), word);
  const next = ROADMAP.next.map((i) => i.title.toLowerCase()).join(" | ");
  for (const word of ["matched by category rating", "season 1 on arc mainnet", "hires on arc mainnet"]) assert.ok(next.includes(word), word);
  assert.deepEqual(ROADMAP.live.map((i) => i.title), [
    "Hire the Lead agent on the web and in Telegram",
    "Season 1 dry run across six categories",
    "Agon MCP for coding agents",
    "Sandbox tests for listed agents",
  ]);
});

test("the MCP section carries the connection, the tool groups and five starting requests", () => {
  assert.deepEqual(MCP_TOOL_GROUPS.map((g) => g.title), ["Find and hire", "Arena", "Listing"]);
  assert.ok(MCP_TOOL_GROUPS[0]!.tools.includes("hire_service"));
  assert.ok(MCP_TOOL_GROUPS[1]!.tools.includes("submit_forecasts"));
  assert.equal(MCP_PROMPTS.length, 5);
});

test("copy rules catch em dashes, plus used as a word and retired names", () => {
  assert.deepEqual(copyProblems("Fine copy, with 0.50 USDC per hire."), []);
  assert.ok(copyProblems("one — two").length > 0);
  assert.ok(copyProblems("Research + analysis").length > 0);
  assert.ok(copyProblems("Open the Playground").length > 0);
  assert.ok(copyProblems("Read the MCP guide").length > 0);
  assert.ok(copyProblems("Provider listed").length > 0);
});

test("every docs string follows the copy rules", () => {
  const problems = docsStrings().flatMap((s) => copyProblems(s).map((p) => `${p}: ${s.slice(0, 60)}`));
  assert.deepEqual(problems, []);
});

test("the Agon header has one Docs item and no separate guide, learn or roadmap items", () => {
  for (const nav of [AGON_NAV_SIGNED_IN, AGON_NAV_SIGNED_OUT]) {
    assert.deepEqual(nav.filter((i) => i.href.startsWith("/docs")).map((i) => [i.href, i.label]), [["/docs", "DOCS"]]);
    for (const banned of ["MCP GUIDE", "LEARN", "ROADMAP"]) assert.ok(!nav.some((i) => i.label === banned), banned);
    assert.ok(!nav.some((i) => i.href === "/market/new"));
  }
});

test("old docs paths send people to the matching Docs section", () => {
  assert.deepEqual(DOCS_REDIRECTS, { "/docs/about": "/docs#roadmap", "/docs/list-agents": "/docs#mcp", "/market/new": "/docs#mcp" });
  const ids = new Set<string>(DOCS_SECTIONS.map((s) => s.id));
  for (const target of Object.values(DOCS_REDIRECTS)) assert.ok(ids.has(target.split("#")[1]!), target);
});

test("no Agon surface links to the retired docs pages or uses their names", () => {
  const files = [
    "src/components/redesign/TopNav.tsx", "src/components/AgonLandingPage.tsx", "src/components/redesign/Footer.tsx",
    "src/components/agon/AgonHomeSurface.tsx", "src/components/agon/AgonAccountSurface.tsx", "src/app/market/page.tsx", "src/lib/agon/market-empty.ts",
  ];
  for (const f of files) {
    const src = readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");
    assert.ok(!/["'`]\/(docs\/about|docs\/list-agents|market\/new)/.test(src), `${f} links to a retired page`);
    assert.ok(!/MCP (LISTING )?GUIDE|>Learn<|"LEARN"|"ROADMAP"|>Roadmap<|USE AGON WITH AN AGENT/i.test(src), `${f} uses a retired name`);
  }
});

test("outside the roadmap, docs only describe what exists today", async () => {
  const { OVERVIEW, TRUST_STATES, PAYMENT_OPTIONS, LISTING_STEPS, ARENA_FACTS } = await import("./docs-content.ts");
  assert.ok(!/other marketplaces/i.test(OVERVIEW.lead), "cross-marketplace search is a Later item");
  const today = [...OVERVIEW.facts, ...TRUST_STATES].map((s) => s.title);
  assert.ok(!today.includes("Discovered"), "the Discovered state arrives with the Agents page");
  const free = PAYMENT_OPTIONS.find((o) => o.title === "No subscriptions")!.body;
  assert.match(free, /network fee/i, "publishing a listing costs gas");
  const sandbox = LISTING_STEPS.find((s) => s.title === "Sandbox")!.body;
  assert.match(sandbox, /asks for payment correctly/);
  const verify = LISTING_STEPS.find((s) => s.title === "Verify")!.body;
  assert.ok(!/payout wallet/i.test(verify), "no payout-ownership check exists");
  assert.match(ARENA_FACTS[0]!.body, /up to two from each/);
});
