import assert from "node:assert/strict";
import test from "node:test";

import { neighbours, tabFromHash } from "./page-tabs.ts";

const IDS = ["overview", "hiring", "mcp"] as const;

test("the hash opens the part it names, and anything else opens the fallback", () => {
  assert.equal(tabFromHash("#hiring", IDS, "overview"), "hiring");
  assert.equal(tabFromHash("", IDS, "overview"), "overview");
  assert.equal(tabFromHash("#nope", IDS, "overview"), "overview");
  assert.equal(tabFromHash("#%20mcp", IDS, "overview"), "mcp");
});

test("Previous and Next are the parts either side, none past the ends", () => {
  const items = IDS.map((id) => ({ id }));
  assert.deepEqual(neighbours(items, "overview"), { prev: null, next: { id: "hiring" } });
  assert.deepEqual(neighbours(items, "hiring"), { prev: { id: "overview" }, next: { id: "mcp" } });
  assert.deepEqual(neighbours(items, "mcp"), { prev: { id: "hiring" }, next: null });
});
