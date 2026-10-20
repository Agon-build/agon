import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { AGON_REDIRECTS } from "./redirects.mjs";
import { LEGACY_ARCRUN_ROUTE_PREFIXES } from "./routes.ts";
import { copyProblems } from "./docs-content.ts";

const to = (source: string) => AGON_REDIRECTS.find((r) => r.source === source)?.destination;

test("old Agon paths go to their new homes", () => {
  assert.equal(to("/ask"), "/");
  assert.equal(to("/market"), "/agents");
  assert.equal(to("/market/:id"), "/agents/:id");
  assert.equal(to("/market/new"), "/docs#mcp");
  assert.equal(to("/market/version"), "/list/version");
  assert.equal(to("/market/provider"), "/account");
  assert.equal(to("/market/activity"), "/account");
  assert.equal(to("/market/compare"), "/agents");
  assert.equal(to("/playground/season-1"), "/arena/season-1");
  assert.equal(to("/agon/playground"), "/playground");
  assert.equal(to("/list/sandbox"), "/playground");
  assert.equal(to("/agon"), "/agents");
});

test("every legacy ArcRun route goes home, with and without sub-paths", () => {
  for (const prefix of LEGACY_ARCRUN_ROUTE_PREFIXES) {
    assert.equal(to(prefix), "/", prefix);
    assert.equal(to(`${prefix}/:path*`), "/", `${prefix}/:path*`);
  }
});

test("specific market paths come before the catch-all, and no destination is itself a source", () => {
  const index = (s: string) => AGON_REDIRECTS.findIndex((r) => r.source === s);
  for (const s of ["/market/new", "/market/version", "/market/provider", "/market/activity", "/market/compare"]) assert.ok(index(s) < index("/market/:id"), s);
  const sources = new Set(AGON_REDIRECTS.map((r) => r.source));
  for (const r of AGON_REDIRECTS) assert.ok(!sources.has(r.destination.split(/[?#]/)[0]!), `${r.source} -> ${r.destination} chains`);
  assert.ok(AGON_REDIRECTS.every((r) => r.permanent === false));
});

test("the home page is the intro over Hire and every stage page uses the shared header", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  assert.match(read("app/page.tsx"), /<IntroGate>[\s\S]*<HireClient \/>[\s\S]*<\/IntroGate>/);
  const gate = read("components/agon/IntroGate.tsx");
  assert.match(gate, /AgonIntro/);
  assert.doesNotMatch(gate, /sessionStorage/, "the intro opens every visit, not once per session");
  assert.doesNotMatch(read("components/agon/AgonIntro.tsx"), /SKIP INTRO|agon-startup-skip/, "Enter is the only way out");
  assert.match(gate, /intro"\) === "1"/);
  assert.match(read("components/stage/StageShell.tsx"), /<TopNav/);
  assert.doesNotMatch(read("components/stage/StageShell.tsx"), /const NAV =/);
  assert.match(read("components/redesign/TopNav.tsx"), /AGON_NAV/);
  assert.doesNotMatch(read("components/redesign/TopNav.tsx"), /\/market\/(activity|provider)/);
});

test("no Agon page links to the old market paths", () => {
  const files = ["components/redesign/TopNav.tsx", "components/stage/StageShell.tsx", "app/agents/page.tsx", "app/agents/[id]/page.tsx", "hooks/useAgonNetwork.ts", "lib/agon/market-empty.ts"];
  for (const f of files) {
    let src = "";
    try { src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"); } catch { continue; }
    assert.ok(!/["'`]\/market(["'`/?#])/.test(src), `${f} links to /market`);
    assert.ok(!/["'`]\/playground\/season-1/.test(src), `${f} links to the old Season page`);
  }
});

test("the List page is the web listing flow and the Playground has its own page", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  assert.match(read("app/list/page.tsx"), /<ListFlow \/>/);
  assert.match(read("app/playground/page.tsx"), /AgonPlayground/);
  const playground = read("components/agon/AgonPlayground.tsx");
  assert.doesNotMatch(playground, />[^<]*\bSandbox\b[^<]*</i, "visible Sandbox text in the Playground");
  assert.doesNotMatch(playground, /"[^"]*\bSandbox\b[^"]*"/, "Sandbox in a quoted UI string");
  assert.doesNotMatch(read("components/agon/AgonOperatorProfile.tsx"), /href="\/app"/);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const child = `${dir}/${name}`;
    return statSync(child).isDirectory() ? walk(child) : /\.tsx$/.test(name) ? [child] : [];
  });
}

test("no retired name appears as visible text on any Agon page or stage component", () => {
  const src = fileURLToPath(new URL("../../", import.meta.url));
  const roots = ["app/agents", "app/arena", "app/list", "app/account", "app/docs", "app/r", "app/approve", "app/operators", "components/stage", "components/agon"];
  const problems: string[] = [];
  for (const root of roots) {
    for (const file of walk(`${src}${root}`)) {
      const text = readFileSync(file, "utf8");
      // Visible text runs between tags or braces, plus string fallbacks rendered with ?? "...".
      const looksLikeCode = (run: string) => /[;=]|&&|\|\||=>|\/\/\//.test(run);
      // Sentence-like string literals (UI messages) and lone dash placeholders count as copy too.
      const sentences = [...text.matchAll(/"([A-Z][^"\n]{11,})"/g)].map((m) => m[1]!).filter((run) => run.includes(" ") && !/[{}<>]|^[A-Z_]+$/.test(run));
      const dashes = [...text.matchAll(/"(—)"/g)].map((m) => m[1]!);
      const runs = [...[...text.matchAll(/[>}]([^<>{}]+)[<{]/g), ...text.matchAll(/\?\? "([^"]+)"/g)].map((m) => m[1]!).filter((run) => !looksLikeCode(run)), ...sentences, ...dashes];
      for (const run of runs) for (const p of copyProblems(run)) problems.push(`${file.split("/src/")[1]}: ${p}: ${run.trim().slice(0, 50)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the admin console hides ArcRun tabs on the Agon deployment", () => {
  const src = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(src, /ARCRUN_TABS/);
});

test("page titles leave the product name to the layout template", () => {
  for (const f of ["app/page.tsx", "app/arena/page.tsx", "app/arena/season-1/page.tsx", "app/list/page.tsx", "app/account/page.tsx"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /title: "[^"]*Agon[^"]*"/, `${f} repeats Agon in its title`);
  }
});

import { agonRedirects } from "./redirects.mjs";
import { categoryHref } from "./stage-view.ts";

test("server redirects apply to Agon builds only", () => {
  assert.deepEqual(agonRedirects("arcrun"), []);
  assert.deepEqual(agonRedirects(" ArcRun "), []);
  assert.equal(agonRedirects(undefined), AGON_REDIRECTS);
  assert.equal(agonRedirects("agon"), AGON_REDIRECTS);
});

test("Arena category tabs keep stage mode and the network in the address", () => {
  assert.equal(categoryHref("?stage=1&network=arc-testnet", "politics"), "/arena/season-1?stage=1&network=arc-testnet&category=politics");
  assert.equal(categoryHref("?stage=1&category=world", "overall"), "/arena/season-1?stage=1");
  assert.equal(categoryHref("", "overall"), "/arena/season-1");
});

test("switching Arena tabs clears the old board and shows a failed load", () => {
  const src = readFileSync(new URL("../../app/arena/season-1/SeasonClient.tsx", import.meta.url), "utf8");
  assert.match(src, /setBoard\(null\)/);
  assert.doesNotMatch(src, /error && !board/);
});

test("the access gate sends people to sign in with a way back", () => {
  const src = readFileSync(new URL("../../components/AgonAccessGate.tsx", import.meta.url), "utf8");
  assert.match(src, /loginHref\(/);
});

test("the notification panel speaks Agon on the Agon deployment", () => {
  const src = readFileSync(new URL("../../components/redesign/NotificationBell.tsx", import.meta.url), "utf8");
  assert.match(src, /Hires, deliveries and payments land here\./);
  assert.match(src, /IS_AGON_DEPLOYMENT/);
});

test("listing lives in Account, not in the header", () => {
  const nav = readFileSync(new URL("../../components/redesign/TopNav.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(nav, /AGON_LIST_CTA|LIST YOUR AGENT/);
  const account = readFileSync(new URL("../../app/account/AccountClient.tsx", import.meta.url), "utf8");
  assert.match(account, /href="\/list"/);
  assert.match(account, /List your agent/);
});

test("the wallet hires are paid from is called the agent wallet everywhere", () => {
  for (const f of ["components/stage/WalletStrip.tsx", "components/stage/AddFunds.tsx", "app/account/AccountClient.tsx", "app/account/page.tsx"]) {
    const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /Agon wallet|"Your wallet"/, f);
  }
  assert.match(readFileSync(new URL("../../components/stage/WalletStrip.tsx", import.meta.url), "utf8"), />Agent wallet</);
});

test("the Hire page says once, in plain words, what works today", () => {
  const composer = readFileSync(new URL("../../components/stage/Composer.tsx", import.meta.url), "utf8");
  const hire = readFileSync(new URL("../../components/stage/HireClient.tsx", import.meta.url), "utf8");
  const docs = readFileSync(new URL("./docs-content.ts", import.meta.url), "utf8");
  // 2026-10-18: the page said "Describe it", then "What do you need done?" twice more.
  assert.match(hire, /Ask about any Polymarket market/);
  assert.doesNotMatch(hire + composer, /What do you need done|"Describe it"/);
  assert.match(composer, /className="sr-only"/, "the question box keeps an accessible label without repeating the heading");
  assert.match(composer, /HIRE_TODAY_NOTE/);
  // Ratings and Circle are not working yet (capabilities.md), so the page must not promise them.
  const note = /HIRE_TODAY_NOTE = "([^"]+)"/.exec(docs)![1]!;
  const how = hire.slice(hire.indexOf("How it works"), hire.indexOf("</ol>", hire.indexOf("How it works")));
  for (const text of [note, how]) assert.doesNotMatch(text, /rated|Circle/, text);
});

test("a lapsed sign-in asks to sign in again and retries the question once signed in", () => {
  const hire = readFileSync(new URL("../../components/stage/HireClient.tsx", import.meta.url), "utf8");
  assert.match(hire, /code === "unauthorized"\) void refresh\(\)/, "a 401 refreshes the session so the page shows signed out");
  assert.match(hire, /mode\.code === "unauthorized" && me/, "signing in again retries the same question");
  assert.match(hire, /<LoginButton \/>/, "the refusal offers the sign-in button, not only text");
});

test("the haggle reads as one aligned list, not two staggered columns", () => {
  const tape = readFileSync(new URL("../../components/stage/HaggleTape.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(tape, /justify-end|justify-start/);
  assert.match(tape, /haggleRows\(steps, seller\)/);
});

test("the header and root layout render the same markup on the server and on first load", () => {
  const nav = readFileSync(new URL("../../components/redesign/TopNav.tsx", import.meta.url), "utf8");
  assert.match(nav, /useHydrated\(\)/, "auth-dependent header items wait for hydration");
  assert.match(nav, /const isSignedIn = hydrated && /);
  assert.match(nav, /const settling = !hydrated \|\| /);
  const hook = readFileSync(new URL("../../hooks/useHydrated.ts", import.meta.url), "utf8");
  assert.match(hook, /useSyncExternalStore/);
  assert.match(readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8"), /<html[^>]*suppressHydrationWarning/);
});

test("the Docs page title leaves the product name to the layout template", () => {
  const src = readFileSync(new URL("../../app/docs/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /title: "[^"]*Agon[^"]*"/);
});

test("the page root clips sideways overflow without breaking the sticky header", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const blocks = [...css.matchAll(/html,\s*body\s*\{([^}]*)\}/g)].map((m) => m[1]!);
  assert.ok(blocks.some((b) => /overflow-x:\s*clip/.test(b)));
  for (const b of blocks) if (/overflow-x:\s*hidden/.test(b)) assert.match(b, /overflow-x:\s*hidden;[\s\S]*overflow-x:\s*clip/, "hidden on html/body breaks position: sticky unless clip overrides it");
});

test("the Arena page opens on per-category leaderboards with time windows, and keeps Seasons as a tab", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const page = read("app/arena/page.tsx");
  assert.match(page, /ArenaTabs/);
  const tabs = read("app/arena/ArenaTabs.tsx");
  assert.match(tabs, /Leaderboard/);
  assert.match(tabs, /Seasons/);
  assert.match(tabs, /CategoryLeaderboard/);
  const board = read("components/agon/CategoryLeaderboard.tsx");
  assert.match(board, /WINDOW_CHOICES/);
  assert.match(board, /AGON_CATEGORIES/);
  assert.match(board, /useState\("3"\)/, "opens on Analysis");
  assert.doesNotMatch(board, /All categories|ALL CATEGORIES/, "boards are per category only");
  assert.match(board, /Not enough results in this window/);
  assert.match(board, /Rated from Playground tests, Arena seasons and paid work/);
});

test("the Playground offers a public test of any listed agent and a feed of recent tests, and keeps the builder check", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const playground = read("components/agon/AgonPlayground.tsx");
  assert.match(playground, /PublicTestPanel/);
  assert.match(playground, /CHOOSE A SERVICE/, "the builder check stays");
  const panel = read("components/agon/PublicTestPanel.tsx");
  assert.match(panel, /runTest/);
  assert.match(panel, /Remaining today/);
  assert.match(panel, /TestRunList/);
});

test("Account shows one List your agent button, and hires are paged while the Hire page shows only 3", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  assert.doesNotMatch(read("components/agon/MyListings.tsx"), /List your agent/, "the section header already has the button");
  const account = read("app/account/AccountClient.tsx");
  assert.equal(account.match(/List your agent/g)?.length, 1);
  assert.match(account, /getHistory\(page/);
  assert.match(account, /Older/);
  assert.match(account, /Newer/);
  const hire = read("components/stage/HireClient.tsx");
  assert.match(hire, /getHistory\(1, 3\)/);
  assert.doesNotMatch(hire, /slice\(0, 6\)/);
});

test("the network shows once, in the header selector, not again under it", () => {
  const shell = readFileSync(new URL("../../components/stage/StageShell.tsx", import.meta.url), "utf8");
  const bar = shell.slice(shell.indexOf("<TopNav />"), shell.indexOf("<main"));
  assert.doesNotMatch(bar, /\{network\}/, "no second network chip under the header");
  assert.match(bar, /Preview data/);
});

test("audit: the app opens on the product, and pages show each thing once", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const agents = read("app/agents/page.tsx");
  assert.doesNotMatch(agents, /A SIMPLE WAY TO START|HeroStat|"Choose", "Compare", "Test", "Use"|LIST YOUR AGENT| loaded<\/span>|01 \/ CHOOSE A CATEGORY/, "Agents page drops the stats, the step strip, the list button and the loaded counter");
  assert.match(agents, /Verified only/, "one plain verified toggle instead of a second ALL");
  const hire = read("components/stage/HireClient.tsx");
  assert.match(hire, /mode\.kind === "run" \? <div className="mt-6"><PhaseRail/, "the progress rail appears once you pay, not before");
  assert.doesNotMatch(hire, /MoneyFlow/, "no empty money panel before a payment exists");
  assert.match(hire, /<TopUpPanel/, "a short wallet is topped up in the action panel");
  const detail = read("app/agents/[id]/page.tsx");
  assert.doesNotMatch(detail, /PROTECTED PROJECT/);
  assert.doesNotMatch(detail, /<h2 className="mt-2 max-w-\[22ch\] font-stencil/, "the name is shown once, in the page header");
  assert.match(detail, /visibleTags/, "numeric and category-only tags are hidden");
  const nav = read("components/redesign/TopNav.tsx");
  assert.doesNotMatch(nav, /Wallet and hires/);
  assert.match(nav, />Account</);
  assert.match(nav, /Sign out/);
  const help = read("components/agon/AgonHelpButton.tsx");
  assert.match(help, / hidden [^"]*sm:inline-flex/, "the floating help button does not cover forms on phones");
  const account = read("app/account/AccountClient.tsx");
  assert.doesNotMatch(account, /WALLET AND HIRES/);
  assert.match(account, /Sign-in wallet/, "email users see the wallet that pays listing fees");
  const list = read("components/agon/list/ListFlow.tsx");
  assert.match(list, /autoChecked/, "checks start by themselves after saving");
  assert.match(list, /from your sign-in wallet/);
  const playground = read("components/agon/AgonPlayground.tsx");
  assert.match(playground, /<details/, "the builder sample is folded away below the public test");
});

test("audit: a test run shows how it was scored and a fingerprint anyone can recompute", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const runs = read("components/agon/TestRunList.tsx");
  assert.match(runs, /How it was scored/);
  assert.match(runs, /evidenceHash/);
  assert.match(runs, /Download this run/);
  assert.match(runs, /names\?/, "the feed shows agent names when it has them");
});

test("owner review 2026-10-20: one-line Agents intro, paged test runs, a plain hire panel, a roadmap that leads with what works", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  const agents = read("app/agents/page.tsx");
  assert.match(agents, /Compare price and test scores, then hire\./);
  assert.doesNotMatch(agents, /price, rating and test results/, "no ratings from paid work exist yet");
  const runs = read("components/agon/TestRunList.tsx");
  assert.match(runs, /pageSlice\(runs, page, RUNS_PER_PAGE\)/);
  assert.match(runs, /Newer/);
  assert.match(runs, /Older/);
  const panel = read("components/agon/X402CallIntentPanel.tsx");
  assert.doesNotMatch(panel, /<select/, "the request method comes from the service file");
  assert.match(panel, /manifestMethod/);
  assert.match(panel, /MOST YOU'LL PAY/);
  assert.doesNotMatch(panel, /TASK DETAILS \(JSON\)/);
  const detail = read("app/agents/[id]/page.tsx");
  assert.doesNotMatch(detail, /Service record \{listing\.listingId\}/);
  assert.match(detail, /Test USDC on/);
  const docs = read("app/docs/page.tsx");
  assert.match(docs, /<RoadmapLater items=\{ROADMAP\.later\} \/>/, "Later shows titles only");
});

test("the Lead quote does not claim a best-rated forecaster while no forecaster is rated", () => {
  const card = readFileSync(new URL("../../components/stage/QuoteCard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(card, /best-rated/i);
});
