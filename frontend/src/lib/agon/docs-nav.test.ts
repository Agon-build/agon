import assert from "node:assert/strict";
import test from "node:test";

import { DOCS_SECTIONS, copyProblems } from "./docs-content.ts";
import { DOCS_GROUPS, PART_ACTIONS, PART_HEADINGS, PART_LEADS, docsParts, partPosition } from "./docs-nav.ts";

test("the sidebar groups every part once, in reading order", () => {
  assert.deepEqual(DOCS_GROUPS.map((g) => [g.title, g.ids]), [
    ["Start", ["overview", "ratings"]],
    ["Use", ["hiring", "arena", "payments", "trust"]],
    ["Build", ["listing", "mcp", "reference"]],
    ["More", ["roadmap", "faq"]],
  ]);
  const ids = DOCS_GROUPS.flatMap((g) => g.ids);
  assert.equal(ids.length, DOCS_SECTIONS.length);
  assert.deepEqual([...ids].sort(), DOCS_SECTIONS.map((s) => s.id).sort());
});

test("a part knows its number and its neighbours in the sidebar order", () => {
  assert.deepEqual(partPosition("hiring"), { index: 3, total: 11, prev: "ratings", next: "arena" });
  assert.equal(partPosition("overview").prev, null);
  assert.deepEqual(partPosition("faq"), { index: 11, total: 11, prev: "roadmap", next: null });
  assert.deepEqual(partPosition("listing"), { index: 7, total: 11, prev: "trust", next: "mcp" });
  assert.deepEqual(docsParts().map((p) => p.id).slice(0, 3), ["overview", "ratings", "hiring"]);
  assert.equal(docsParts()[2]!.label, "Hiring");
});

test("every part has a lead, and its headings and actions follow the copy rules", () => {
  for (const s of DOCS_SECTIONS) assert.ok(PART_LEADS[s.id].length > 20, `${s.id} has a lead`);
  assert.equal(PART_LEADS.hiring, "Say what you need. Agon finds the agents that fit, shows the price first, and pays from your agent wallet only when you confirm.");
  assert.deepEqual(PART_HEADINGS.hiring.map((h) => h.label), ["Steps", "Which money each hire uses", "From a coding agent"]);
  assert.deepEqual(PART_HEADINGS.roadmap.map((h) => h.label), ["Live", "Next", "Later"]);
  const headingIds = Object.values(PART_HEADINGS).flat().map((h) => h.id);
  assert.equal(new Set(headingIds).size, headingIds.length, "heading ids are unique");
  for (const id of headingIds) assert.match(id, /^[a-z]+-[a-z-]+$/);
  assert.equal(PART_ACTIONS.hiring?.href, "/");
  const copy = [...Object.values(PART_LEADS), ...Object.values(PART_HEADINGS).flat().map((h) => h.label), ...Object.values(PART_ACTIONS).flatMap((a) => (a ? [a.title, a.body, a.label] : [] as string[]))];
  for (const text of copy) assert.deepEqual(copyProblems(text), [], text);
});
