import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { adminActorsFromEnv, createAgonAuthMiddleware, type AgonAdminAccess } from "../../src/agon/http/admin-auth.ts";

const ADMIN_TOKEN = "test-admin-token-with-enough-entropy";
const ACTOR = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function app(access: Partial<AgonAdminAccess> = {}) {
  const instance = new Hono<{ Variables: { address: string } }>();
  const fallback = (() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })) as Parameters<typeof createAgonAuthMiddleware>[1];
  const admin: AgonAdminAccess = { token: ADMIN_TOKEN, actors: [ACTOR], ...access };
  instance.get("/protected", createAgonAuthMiddleware(admin, fallback), (context) => context.json({ actor: context.get("address") }));
  return instance;
}

test("admin token binds an allowed actor without a user session", async () => {
  const response = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": ACTOR.toUpperCase().replace("0X", "0x") } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { actor: ACTOR });
});

test("admin token refuses a missing or malformed actor", async () => {
  const missing = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN } });
  assert.equal(missing.status, 400);
  const malformed = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": "not-an-address" } });
  assert.equal(malformed.status, 400);
});

test("wrong admin token cannot bypass normal authentication", async () => {
  const response = await app().request("/protected", { headers: { "x-admin-token": `${ADMIN_TOKEN}-wrong`, "x-agon-actor": ACTOR } });
  assert.equal(response.status, 401);
});

// Audit B6 (2026-11-09): one leaked token was every user's identity.
test("admin token cannot act as a wallet outside the allowlist", async () => {
  const response = await app().request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": OTHER } });
  assert.equal(response.status, 403);
});

test("with no allowlist the admin token acts as nobody", async () => {
  const response = await app({ actors: [] }).request("/protected", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": ACTOR } });
  assert.equal(response.status, 403);
});

test("every call made with the admin token is logged with actor and route", async () => {
  const lines: string[] = [];
  await app({ log: (line) => lines.push(line) }).request("/protected?x=1", { headers: { "x-admin-token": ADMIN_TOKEN, "x-agon-actor": ACTOR } });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /agon admin actor/);
  assert.match(lines[0]!, new RegExp(ACTOR));
  assert.match(lines[0]!, /GET \/protected/);
  assert.doesNotMatch(lines[0]!, /x=1/);
});

test("the allowlist reads comma separated addresses and drops anything else", () => {
  assert.deepEqual(adminActorsFromEnv(` ${ACTOR.toUpperCase().replace("0X", "0x")}, nope ,${OTHER},`), [ACTOR, OTHER]);
  assert.deepEqual(adminActorsFromEnv(undefined), []);
});
