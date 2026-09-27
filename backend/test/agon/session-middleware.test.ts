import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { canUseAgonScope, canUseBrowserSessionRoute } from "../../src/auth/scope-policy.ts";
import { createSessionMiddleware, type SessionClaims } from "../../src/auth/session-middleware.ts";

const tokens: Record<string, SessionClaims> = {
  browser: { address: "0x1111111111111111111111111111111111111111", client: null, scopes: [] },
  cliRead: { address: "0x2222222222222222222222222222222222222222", client: "agon-cli", scopes: ["agon:read"] },
  cliWallet: { address: "0x3333333333333333333333333333333333333333", client: "agon-cli", scopes: ["wallet:execute"] },
  unknownClient: { address: "0x4444444444444444444444444444444444444444", client: "partner-bot", scopes: ["wallet:execute"] },
};

const { requireAuth, requireAgonScope } = createSessionMiddleware(async (token) => tokens[token] ?? null);

const app = new Hono<{ Variables: { address: string } }>();
app.post("/auth/cli/device/approve", requireAuth, (c) => c.json({ as: c.get("address") }));
app.post("/wallet/bridge", requireAuth, (c) => c.json({ as: c.get("address") }));
app.get("/auth/me", requireAgonScope("agon:read"), (c) => c.json({ as: c.get("address") }));
app.post("/wallet/execute", requireAgonScope("wallet:execute"), (c) => c.json({ as: c.get("address") }));

function call(method: string, path: string, token?: string) {
  return app.request(path, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
}

test("a read-only CLI token cannot approve another device or bridge funds", async () => {
  const approve = await call("POST", "/auth/cli/device/approve", "cliRead");
  assert.equal(approve.status, 403);
  assert.equal((await approve.json()).error, "browser_session_required");
  assert.equal((await call("POST", "/wallet/bridge", "cliRead")).status, 403);
});

test("even a wallet-scoped CLI token cannot use browser-only money routes", async () => {
  assert.equal((await call("POST", "/wallet/bridge", "cliWallet")).status, 403);
});

test("browser sessions keep access to browser-only routes", async () => {
  const res = await call("POST", "/wallet/bridge", "browser");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).as, tokens.browser.address);
});

test("scoped routes accept a CLI token with the exact scope and refuse others", async () => {
  assert.equal((await call("GET", "/auth/me", "cliRead")).status, 200);
  assert.equal((await call("POST", "/wallet/execute", "cliRead")).status, 403);
  assert.equal((await call("POST", "/wallet/execute", "cliWallet")).status, 200);
});

test("tokens from an unknown client type are refused everywhere", async () => {
  assert.equal((await call("POST", "/wallet/execute", "unknownClient")).status, 403);
  assert.equal((await call("POST", "/wallet/bridge", "unknownClient")).status, 403);
});

test("a missing or invalid token is unauthorized", async () => {
  assert.equal((await call("POST", "/wallet/bridge")).status, 401);
  assert.equal((await call("GET", "/auth/me", "forged")).status, 401);
});

test("scope policy: browser sessions only for browser routes; unknown clients get nothing", () => {
  assert.equal(canUseBrowserSessionRoute({ client: null, scopes: [] }), true);
  assert.equal(canUseBrowserSessionRoute({ client: "agon-cli", scopes: ["wallet:execute"] }), false);
  assert.equal(canUseAgonScope({ client: "partner-bot", scopes: ["wallet:execute"] }, "wallet:execute"), false);
});
