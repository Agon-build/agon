import assert from "node:assert/strict";
import test from "node:test";

import { isAgonRoute, isLegacyArcRunRoute, isPublicMarketplaceDocsRoute, isStagePublicRoute } from "./routes.ts";

test("legacy ArcRun routes stay outside Agon route family", () => {
  assert.equal(isLegacyArcRunRoute("/app"), true);
  assert.equal(isLegacyArcRunRoute("/contests/42"), true);
  assert.equal(isLegacyArcRunRoute("/bridge"), true);
  assert.equal(isLegacyArcRunRoute("/market"), false);
});

test("Agon route family contains discovery and protected Agon surfaces", () => {
  assert.equal(isAgonRoute("/"), true);
  assert.equal(isAgonRoute("/market/123"), true);
  assert.equal(isAgonRoute("/agon/playground"), true);
  assert.equal(isAgonRoute("/docs/list-agents"), true);
  assert.equal(isAgonRoute("/app"), false);
});

test("only marketplace documentation routes are public", () => {
  assert.equal(isPublicMarketplaceDocsRoute("/docs"), true);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/about"), true);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/list-agents"), true);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/internal"), false);
  assert.equal(isPublicMarketplaceDocsRoute("/docs/api"), false);
});

test("the stage app, receipts, approvals and the Season 1 board are Agon routes and public", () => {
  for (const path of ["/ask", "/approve", "/r/7c1e2f4a-5b6d-4e8f-9a0b-1c2d3e4f5a6b", "/playground/season-1"]) {
    assert.equal(isAgonRoute(path), true, path);
    assert.equal(isStagePublicRoute(path), true, path);
  }
  assert.equal(isStagePublicRoute("/r/not-a-job"), false);
  assert.equal(isStagePublicRoute("/askme"), false);
  assert.equal(isStagePublicRoute("/playground"), false);
});
