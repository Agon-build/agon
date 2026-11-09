import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { isLegacyPath, legacyApiEnabled, legacyGate } from "../../src/http/legacy-surface.ts";

// Audit B4 (2026-11-09): the ArcRun API (missions, leaderboard, skins, mystery,
// contests, challenges, syndicates) still answered on api.agon.surf, sharing the
// process, database and Circle credentials with Agon's agent wallets.

test("the ArcRun routes are named as legacy, Agon's own routes are not", () => {
  for (const p of [
    "/missions", "/missions/12/join", "/leaderboard", "/contests/3", "/challenges", "/syndicates/1/join", "/syndicate-pool",
    "/mystery/claim", "/arcana/feed", "/entry/check", "/loadouts/contest/1/2", "/scout/swap-budget/4", "/tier-gates/contest/1",
    "/traits/pool", "/activity", "/custom-requests", "/feedback", "/agents/skins", "/agents/7/training/start", "/agents/7/skin/",
    "/events/contest/4/payout", "/events/challenge/9/arcana-pins", "/operators/0xabc/traits", "/operators/resolve", "/operators/identity-mode",
  ]) assert.equal(isLegacyPath(p), true, p);
  for (const p of [
    "/", "/health", "/auth/me", "/auth/email/session", "/agon/listings", "/agon/agents/specialists/pitch", "/agon/app/route",
    "/notifications", "/notifications/clear", "/wallet/execute", "/wallet/tx/1", "/events", "/admin/events", "/admin/agon/jobs",
    "/admin/overview", "/operators/0xabc", "/agentsx", "/agon/telegram/webhook",
  ]) assert.equal(isLegacyPath(p), false, p);
});

test("the legacy API is off unless ARCRUN_LEGACY_API is on", () => {
  assert.equal(legacyApiEnabled({}), false);
  assert.equal(legacyApiEnabled({ ARCRUN_LEGACY_API: "off" }), false);
  assert.equal(legacyApiEnabled({ ARCRUN_LEGACY_API: "true" }), false, "only the exact word turns it on");
  assert.equal(legacyApiEnabled({ ARCRUN_LEGACY_API: " ON " }), true);
});

function app(enabled: boolean) {
  const h = new Hono();
  h.use("*", legacyGate(enabled));
  h.get("/missions", (c) => c.json({ missions: [] }));
  h.get("/agon/listings", (c) => c.json({ items: [] }));
  return h;
}

test("with the switch off, a legacy route answers 410 before its handler runs; Agon routes are untouched", async () => {
  const off = app(false);
  const gone = await off.request("/missions");
  assert.equal(gone.status, 410);
  assert.deepEqual(await gone.json(), { error: "legacy_api_off" });
  assert.equal((await off.request("/agon/listings")).status, 200);
  assert.equal((await app(true).request("/missions")).status, 200, "the switch turns it back on");
});
