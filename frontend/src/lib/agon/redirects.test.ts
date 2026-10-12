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
  assert.equal(to("/agon/playground"), "/list/sandbox");
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
  assert.match(gate, /sessionStorage/);
  assert.match(gate, /intro"\) === "1"/);
  assert.match(read("components/stage/StageShell.tsx"), /<TopNav/);
  assert.doesNotMatch(read("components/stage/StageShell.tsx"), /const NAV =/);
  assert.match(read("components/redesign/TopNav.tsx"), /AGON_NAV/);
  assert.doesNotMatch(read("components/redesign/TopNav.tsx"), /\/market\/(activity|provider)/);
});

test("no Agon page links to the old market paths", () => {
  const files = ["components/redesign/TopNav.tsx", "components/stage/StageShell.tsx", "components/stage/ArenaRating.tsx", "app/agents/page.tsx", "app/agents/[id]/page.tsx", "hooks/useAgonNetwork.ts", "lib/agon/market-empty.ts"];
  for (const f of files) {
    let src = "";
    try { src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8"); } catch { continue; }
    assert.ok(!/["'`]\/market(["'`/?#])/.test(src), `${f} links to /market`);
    assert.ok(!/["'`]\/playground\/season-1/.test(src), `${f} links to the old Season page`);
  }
});

test("the List guide has five steps and the sandbox speaks of Sandbox", () => {
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  assert.match(read("app/list/page.tsx"), /LISTING_STEPS/);
  assert.match(read("app/list/sandbox/page.tsx"), /AgonPlayground/);
  const sandbox = read("components/agon/AgonPlayground.tsx");
  assert.doesNotMatch(sandbox, />[^<]*\bPlayground\b[^<]*</, "visible Playground text in the sandbox");
  assert.doesNotMatch(sandbox, /"[^"]*\bPlayground\b[^"]*"/, "Playground in a quoted UI string");
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
