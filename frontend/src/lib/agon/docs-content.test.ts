import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { ARENA_STATUS, DOCS_SECTIONS, FAQS, HIRE_STEPS, MCP_PROMPTS, MCP_TOOL_GROUPS, PAYMENT_OPTIONS, ROADMAP, copyProblems, docsStrings } from "./docs-content.ts";
import { AGON_NAV } from "./nav.ts";
import { DOCS_REDIRECTS } from "./docs-redirects.ts";

test("docs sections come in one order with unique, URL-safe ids", () => {
  assert.deepEqual(DOCS_SECTIONS.map((s) => s.id), ["overview", "ratings", "hiring", "arena", "listing", "mcp", "payments", "trust", "roadmap", "faq", "reference"]);
  for (const s of DOCS_SECTIONS) assert.match(s.id, /^[a-z]+$/);
  assert.equal(new Set(DOCS_SECTIONS.map((s) => s.label)).size, DOCS_SECTIONS.length);
});

test("the roadmap leads with what works, keeps Next to three and Later to short titles", () => {
  const later = ROADMAP.later.map((i) => i.title.toLowerCase()).join(" | ");
  for (const word of ["escrow", "trading", "whatsapp", "provider dashboard", "other marketplaces", "arc mainnet", "circle"]) assert.ok(later.includes(word), word);
  assert.ok(ROADMAP.later.length <= 6, "Later stays a short list");
  // Circle waits for Agon's mainnet launch (owner decision 2026-10-19).
  assert.deepEqual(ROADMAP.next.map((i) => i.title), ["Hire the best agent for any request", "Arena seasons that score", "Scores from paid work"]);
  // Live now holds only capabilities proven on production (agon-build capabilities.md, 2026-10-19).
  assert.deepEqual(ROADMAP.live.map((i) => i.title), [
    "Ask about any Polymarket market",
    "Playground tests for listed agents",
    "Agon score and category leaderboards",
    "Agon MCP for coding agents",
  ]);
  for (const i of ROADMAP.live) assert.ok(!/arena|circle|mainnet|telegram/i.test(`${i.title} ${i.body}`), `Live now claims what is not live: ${i.title}`);
});

test("the MCP section carries the connection, the tool groups and five starting requests", () => {
  assert.deepEqual(MCP_TOOL_GROUPS.map((g) => g.title), ["Find and hire", "Arena", "Ratings", "Listing"]);
  assert.deepEqual([...MCP_TOOL_GROUPS[2]!.tools], ["get_agent_scores", "get_agent_tests"]);
  assert.ok(MCP_TOOL_GROUPS[0]!.tools.includes("hire_service"));
  assert.ok(MCP_TOOL_GROUPS[1]!.tools.includes("submit_forecasts"));
  assert.equal(MCP_PROMPTS.length, 5);
});

test("copy rules catch em dashes, plus used as a word and retired names", () => {
  assert.deepEqual(copyProblems("Fine copy, with 0.50 USDC per hire."), []);
  assert.ok(copyProblems("one — two").length > 0);
  assert.ok(copyProblems("Research + analysis").length > 0);
  assert.ok(copyProblems("Open the Sandbox").length > 0, "Sandbox is retired; it is the Playground");
  assert.deepEqual(copyProblems("Open the Playground"), []);
  assert.ok(copyProblems("Read the MCP guide").length > 0);
  assert.ok(copyProblems("Provider listed").length > 0);
  for (const retired of ["Find services", "Test services", "Live sandbox", "Use Agon with an agent", "Agon market", "Learn", "Browse services", "Browse the market", "reviewed in the market"]) assert.ok(copyProblems(retired).length > 0, retired);
  assert.deepEqual(copyProblems("Learn how the Arena scores agents"), [], "Learn is retired only as a whole label");
});

test("every docs string follows the copy rules", () => {
  const problems = docsStrings().flatMap((s) => copyProblems(s).map((p) => `${p}: ${s.slice(0, 60)}`));
  assert.deepEqual(problems, []);
});

test("the Agon header is Hire, Agents, Arena, Docs", () => {
  assert.deepEqual(AGON_NAV.map((i) => [i.label, i.href]), [["HIRE", "/"], ["AGENTS", "/agents"], ["ARENA", "/arena"], ["DOCS", "/docs"]]);
});

test("old docs paths send people to the matching Docs section", () => {
  assert.deepEqual(DOCS_REDIRECTS, { "/docs/about": "/docs#roadmap", "/docs/list-agents": "/docs#mcp", "/market/new": "/docs#mcp" });
  const ids = new Set<string>(DOCS_SECTIONS.map((s) => s.id));
  for (const target of Object.values(DOCS_REDIRECTS)) assert.ok(ids.has(target.split("#")[1]!), target);
});

test("no Agon surface links to the retired docs pages or uses their names", () => {
  const files = [
    "src/components/redesign/TopNav.tsx", "src/components/redesign/Footer.tsx",
    "src/app/agents/page.tsx", "src/lib/agon/market-empty.ts",
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
  const check = LISTING_STEPS.find((s) => s.title === "Check")!.body;
  assert.match(check, /without paying/);
  assert.ok(!LISTING_STEPS.some((s) => /payout wallet/i.test(s.body)), "no payout-ownership check exists");
  assert.match(ARENA_FACTS[0]!.body, /up to two from each/);
});

test("the listing steps match the web flow and the endpoint protocols are documented exactly", async () => {
  const { LISTING_STEPS, LISTING_NOTE, CONNECT_STEPS, ENDPOINT_PROTOCOLS, MCP_TOOL_GROUPS, MCP_ACCESS } = await import("./docs-content.ts");
  assert.deepEqual(LISTING_STEPS.map((s) => s.title), ["Describe", "Check", "Approve and pay", "Live"]);
  assert.doesNotMatch(LISTING_NOTE, /roadmap/i, "the web flow ships now");
  assert.match(MCP_ACCESS, /sign in/i, "MCP connects by signing in, not by pasting a token");
  assert.match(MCP_ACCESS, /no browser/i, "agents without a browser are pointed to tokens");
  assert.deepEqual(CONNECT_STEPS.map((s) => s.title), ["Add Agon", "Confirm", "Ask"]);
  assert.ok(CONNECT_STEPS.every((s) => !/AGON_TOKEN|Authorization/.test(s.body)), "the main path never handles a token");
  assert.match(LISTING_NOTE, /connected coding agent/);
  assert.ok(CONNECT_STEPS.every((s) => !/agon_pat_[A-Za-z0-9]/.test(s.body)));
  assert.deepEqual(ENDPOINT_PROTOCOLS.map((p) => p.title), ["Unpaid test call", "Certification call"]);
  assert.match(ENDPOINT_PROTOCOLS[0]!.request, /agon-x402-preflight\/1/);
  assert.match(ENDPOINT_PROTOCOLS[0]!.response, /402/);
  assert.match(ENDPOINT_PROTOCOLS[1]!.request, /agon-playground\/1/);
  assert.match(ENDPOINT_PROTOCOLS[1]!.request, /evidence-under-pressure/);
  assert.match(ENDPOINT_PROTOCOLS[1]!.response, /"externalWrites": false/);
  assert.match(ENDPOINT_PROTOCOLS[1]!.body, /Analysis/);
  const listing = MCP_TOOL_GROUPS.find((g) => g.title === "Listing")!;
  for (const t of ["setup_managed_publisher", "get_managed_listing", "approve_managed_listing", "continue_managed_listing"]) assert.ok(listing.tools.includes(t), t);
});

test("the Docs page shows how to make an endpoint listable and how to connect a coding agent", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../app/docs/page.tsx", import.meta.url), "utf8");
  assert.match(page, /ENDPOINT_PROTOCOLS/);
  assert.match(page, /CONNECT_STEPS/);
});

test("Docs say what Agon is: it routes to the best agent and proves it with ratings from real tests", async () => {
  const { OVERVIEW, RATING_SOURCES, LEADERBOARD_NOTE, HIRE_STEPS } = await import("./docs-content.ts");
  assert.match(OVERVIEW.lead, /routes/i);
  assert.match(OVERVIEW.lead, /real tests/i);
  assert.doesNotMatch(OVERVIEW.lead, /a market for AI agents/i);
  assert.deepEqual(RATING_SOURCES.map((r) => [r.title, r.status]), [
    ["Playground tests", "Live"],
    ["Arena seasons", "Coming next"],
    ["Scores from paid work", "Coming next"],
  ]);
  assert.match(RATING_SOURCES[0]!.body, /rate limited/i);
  assert.match(RATING_SOURCES[0]!.body, /published/i);
  assert.match(LEADERBOARD_NOTE, /24 hours, 7 days and 30 days/);
  assert.match(HIRE_STEPS.find((s) => s.title === "Confirm")!.body, /agent wallet/);
});

test("Docs state the exact rating method, each public test with an example, and what comes later", async () => {
  const { RATING_METHOD, TEST_TASKS_DOCS, RATING_SOURCES, LEADERBOARD_NOTE, ROADMAP } = await import("./docs-content.ts");
  const method = RATING_METHOD.join(" ");
  for (const fact of ["50%", "30%", "20%", "5 runs", "3 scores", "percentile", "All time", "30 days", "7 days", "24 hours", "per category", "5 tests per person per hour", "20 public tests per agent per day", "80"]) assert.ok(method.includes(fact), fact);
  assert.deepEqual(TEST_TASKS_DOCS.map((t) => t.category), ["Research", "Analysis", "Execution", "Development", "Verification"]);
  for (const t of TEST_TASKS_DOCS) assert.ok(t.example.length > 10 && t.scoring.length > 10, t.category);
  assert.match(method, /with 5 runs the category average still carries half the weight/, "the pull is described as the code does it");
  assert.doesNotMatch(method, /Until a part has enough results/);
  assert.doesNotMatch(RATING_SOURCES[0]!.body, /will count/);
  assert.match(RATING_SOURCES[0]!.body, /counts toward/);
  assert.doesNotMatch(LEADERBOARD_NOTE, /come next/);
  assert.equal(ROADMAP.next.some((i) => /Leaderboard over 24 hours|Every Playground result counts/.test(i.title)), false, "shipped items leave Next");
});

test("Docs say how anyone can check a test result for themselves", async () => {
  const { RATING_METHOD } = await import("./docs-content.ts");
  const method = RATING_METHOD.join(" ");
  assert.match(method, /How it was scored/);
  assert.match(method, /sha256/);
  assert.match(method, /recompute/);
});

test("docs match the 17 October changes: wallet terms, top-up, automatic refunds, custody, MCP sign-in, escrow not live", async () => {
  const { HIRE_STEPS, PAYMENT_OPTIONS, PAYMENT_SAFETY, ROADMAP, API_REFERENCE, MCP_TOOL_GROUPS } = await import("./docs-content.ts");
  const hire = HIRE_STEPS.map((s) => s.body).join(" ");
  assert.match(hire, /wallet terms/);
  assert.match(hire, /add USDC/);
  assert.match(hire, /answer does not arrive/);
  assert.match(PAYMENT_SAFETY, /Agon holds/);
  assert.match(PAYMENT_SAFETY, /withdraw/);
  const escrow = PAYMENT_OPTIONS.find((p) => /escrow/i.test(p.body))!;
  assert.match(escrow.title, /coming/i, "escrow is not switched on yet");
  assert.ok(ROADMAP.live.some((i) => /sign in/i.test(i.body) && /Claude Code/.test(i.body)));
  assert.ok(!ROADMAP.next.some((i) => i.title === "A clearer app"), "shipped items leave Next");
  assert.ok(API_REFERENCE.some((g) => g.lines.some((l) => l.includes("/.well-known/oauth-protected-resource/agon/mcp"))));
  assert.ok(!MCP_TOOL_GROUPS.some((g) => g.tools.includes("run_agent_test")), "no access level can run tests over MCP yet");
});

test("how it works has three steps with an icon, a line and three points each", async () => {
  const { HOW_IT_WORKS } = await import("./docs-content.ts");
  assert.deepEqual(HOW_IT_WORKS.steps.map((s) => [s.icon, s.title]), [["search", "Find a rated agent"], ["hire", "Hire it in one step"], ["proof", "Check the proof"]]);
  for (const s of HOW_IT_WORKS.steps) assert.equal(s.points.length, 3, s.title);
});

test("the FAQ answers the questions people ask, in plain words, with no secret handling", async () => {
  const { FAQS, docsStrings, copyProblems } = await import("./docs-content.ts");
  assert.ok(FAQS.length >= 8);
  const qs = FAQS.map((f) => f.q).join(" ");
  for (const topic of [/hold my money/i, /refund/i, /Verified/, /coding agent/i, /list my agent/i, /fee/i, /mainnet/i, /disconnect/i]) assert.match(qs, topic);
  for (const f of FAQS) assert.ok(f.a.length > 40 && f.a.length < 600, f.q);
  const all = docsStrings();
  assert.ok(all.includes(FAQS[0]!.a), "FAQ copy is covered by the copy rules");
  for (const t of all) assert.deepEqual(copyProblems(t), [], t);
});

test("docs present only Live capabilities as working: Circle, mainnet and the Arena read as coming next", () => {
  const fees = PAYMENT_OPTIONS.map((o) => o.body).join(" ");
  assert.match(fees, /1\.5% routing fee/);
  assert.match(fees, /only when the answer arrives/);
  const outsideRoadmap = docsStrings().filter((t) => !ROADMAP.next.some((i) => i.title === t || i.body === t) && !ROADMAP.later.some((i) => i.title === t || i.body === t));
  for (const t of outsideRoadmap) {
    if (!t.trim().endsWith("?") && /Circle('s)? Agent Marketplace|Circle services?\b/.test(t)) assert.match(t, /move to Arc mainnet/i, `presents Circle services as working: ${t}`);
    assert.doesNotMatch(t, /20 October|late October/, `stale date: ${t}`);
  }
  assert.match(ARENA_STATUS, /scored as the markets resolve/);
  assert.doesNotMatch(ARENA_STATUS, /not scoring/i);
  assert.match(FAQS.find((f) => /Circle/.test(f.q))!.a, /^Not yet/);
  assert.match(HIRE_STEPS.map((h) => h.body).join(" "), /swap/i);
});

test("the hire steps give the test wallet's default limits and no mainnet wallet yet", () => {
  const confirm = HIRE_STEPS.find((h) => h.title === "Confirm")!.body;
  assert.match(confirm, /0\.50 USDC per hire and 2\.00 per day/);
  assert.doesNotMatch(confirm, /mainnet/);
});
