import assert from "node:assert/strict";
import test from "node:test";
import type { MiddlewareHandler } from "hono";

import { createTestRoutes } from "../../src/agon/tests/routes.ts";
import { createTestService } from "../../src/agon/tests/service.ts";
import { createMemoryTestResultsStore } from "./test-results-memory-store.ts";

const RUNNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = new Date("2026-10-16T12:00:00Z");

function app(signedIn = true) {
  const store = createMemoryTestResultsStore();
  const service = createTestService({
    store,
    getListing: async (ref) => (ref === "5042002:0xreg:1" ? { agentId: "41", categoryId: "3", listed: true, listingReference: ref, manifestBody: { endpoint: "https://a.example/t" } } : null),
    run: async (input) => ({ taskId: "evidence-under-pressure", variant: input.variant, score: 85, passed: true, durationMs: 3, input: { secret: "in" }, output: { secret: "out" }, error: null, notes: [] }),
    chain: { chainId: async () => 5042002, blockNumber: async () => 1n },
    now: () => NOW,
    fetchDeps: { fetch: (async () => new Response("")) as typeof fetch, assertPublic: async (u: string) => new URL(u) },
  });
  const requireRun: MiddlewareHandler = async (c, next) => {
    if (!signedIn) return c.json({ error: "unauthorized" }, 401);
    c.set("address" as never, RUNNER as never);
    await next();
  };
  return { store, routes: createTestRoutes({ service, store, requireRun }) };
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("a signed-in person runs a public test; the feed and agent list never show input, output or a full address", async () => {
  const { routes } = app();
  const res = await routes.request("/", post({ listingReference: "5042002:0xreg:1" }));
  assert.equal(res.status, 201);
  const run = await res.json() as { id: string; runner: string; score: number };
  assert.equal(run.runner, "0xbbbb…bbbb");
  for (const path of ["/", "/?agentId=41"]) {
    const text = await (await routes.request(path)).text();
    assert.doesNotMatch(text, /secret|bbbbbbbbbbbbbbbb/, path);
    assert.match(text, new RegExp(run.id));
  }
  const one = await (await routes.request(`/${run.id}`)).json() as { input: unknown; output: unknown; runner: string };
  assert.deepEqual(one.input, { secret: "in" });
  assert.deepEqual(one.output, { secret: "out" });
  assert.equal(one.runner, "0xbbbb…bbbb");
  assert.deepEqual(await (await routes.request("/remaining/41")).json(), { agentId: "41", remainingToday: 19, perAgentDay: 20 });
});

test("limits answer 429 with plain messages", async () => {
  const { routes } = app();
  for (let i = 0; i < 5; i += 1) assert.equal((await routes.request("/", post({ listingReference: "5042002:0xreg:1" }))).status, 201);
  const res = await routes.request("/", post({ listingReference: "5042002:0xreg:1" }));
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "user_limit", message: "You have run 5 tests in the last hour. Try again later." });
});

test("bad input, unknown listings and signed-out callers are refused", async () => {
  const { routes } = app();
  assert.equal((await routes.request("/", post({}))).status, 400);
  assert.equal((await routes.request("/", post({ listingReference: "nope" }))).status, 404);
  assert.equal((await routes.request("/00000000-0000-0000-0000-000000000000")).status, 404);
  assert.equal((await app(false).routes.request("/", post({ listingReference: "5042002:0xreg:1" }))).status, 401);
});
