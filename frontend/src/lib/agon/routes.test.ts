import assert from "node:assert/strict";
import test from "node:test";

import { isAgonPublicRoute, isAgonRoute, isLegacyArcRunRoute } from "./routes.ts";

test("legacy ArcRun routes stay outside Agon route family", () => {
  assert.equal(isLegacyArcRunRoute("/app"), true);
  assert.equal(isLegacyArcRunRoute("/contests/42"), true);
  assert.equal(isLegacyArcRunRoute("/bridge"), true);
  assert.equal(isLegacyArcRunRoute("/market"), false);
});

test("readable without an account: hire, agents, arena, list, docs, receipts and approvals", () => {
  for (const p of ["/", "/agents", "/agents/42", "/arena", "/arena/season-1", "/list", "/playground", "/list/version", "/docs", "/approve", "/r/0b9e0b4c-3c2f-4b0e-9d1a-2f5a6b7c8d9e", "/login"]) {
    assert.equal(isAgonPublicRoute(p), true, p);
  }
  for (const p of ["/account", "/cli/authorize", "/connect", "/r/not-a-job"]) assert.equal(isAgonPublicRoute(p), false, p);
});

test("Agon route family covers the new sections", () => {
  for (const p of ["/", "/agents", "/arena/season-1", "/list", "/account", "/docs", "/connect", "/operators/0xabc"]) assert.equal(isAgonRoute(p), true, p);
  assert.equal(isAgonRoute("/app"), false);
});

test("a watch page is an Agon page anyone with its id can read", () => {
  assert.equal(isAgonRoute("/watch/a82c59416dfd1e1d9f7e433685d3b30d"), true);
  assert.equal(isAgonPublicRoute("/watch/a82c59416dfd1e1d9f7e433685d3b30d"), true);
  assert.equal(isAgonPublicRoute("/watch/not-an-id"), false);
});

test("the privacy page is an Agon page anyone can read", () => {
  assert.equal(isAgonRoute("/privacy"), true);
  assert.equal(isAgonPublicRoute("/privacy"), true);
});
