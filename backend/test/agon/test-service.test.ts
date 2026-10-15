import assert from "node:assert/strict";
import test from "node:test";

import { createTestService, shortAddress, type TestableListing } from "../../src/agon/tests/service.ts";
import { pickVariant } from "../../src/agon/tests/tasks.ts";
import type { runAgentTest } from "../../src/agon/tests/runner.ts";
import { createMemoryTestResultsStore } from "./test-results-memory-store.ts";

const RUNNER = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = new Date("2026-10-16T12:00:00Z");
const manifest = { certification: { endpoint: "https://agent.example/test" } };
const listings: Record<string, TestableListing> = {
  "5042002:0xreg:1": { agentId: "41", categoryId: "3", listed: true, listingReference: "5042002:0xreg:1", manifestBody: manifest },
  "5042002:0xreg:2": { agentId: "42", categoryId: "6", listed: true, listingReference: "5042002:0xreg:2", manifestBody: manifest },
  "5042002:0xreg:3": { agentId: "43", categoryId: "3", listed: false, listingReference: "5042002:0xreg:3", manifestBody: manifest },
  "5042002:0xreg:4": { agentId: "44", categoryId: "3", listed: true, listingReference: "5042002:0xreg:4", manifestBody: null },
  "5042002:0xreg:5": { agentId: "45", categoryId: "3", listed: true, listingReference: "5042002:0xreg:5", manifestBody: { service: { name: "No endpoint" } } },
};

function setup(score = 90) {
  const store = createMemoryTestResultsStore();
  const calls: Parameters<typeof runAgentTest>[0][] = [];
  const run: typeof runAgentTest = async (input) => {
    calls.push(input);
    return { taskId: "evidence-under-pressure", variant: input.variant, score, passed: score >= 80, durationMs: 5, input: { q: 1 }, output: { a: 1 }, error: null, notes: [] };
  };
  const service = createTestService({
    store,
    getListing: async (ref) => listings[ref] ?? null,
    run,
    chain: { chainId: async () => 5042002, blockNumber: async () => 1000n },
    now: () => NOW,
    fetchDeps: { fetch: (async () => new Response("")) as typeof fetch, assertPublic: async (u: string) => new URL(u) },
  });
  return { store, calls, service };
}

test("a public run is recorded as public, shown with a shortened runner, and uses the day's variant", async () => {
  const { store, calls, service } = setup();
  const out = await service.runPublic(RUNNER, "5042002:0xreg:1");
  assert.ok(out.ok);
  assert.equal(out.result.source, "public");
  assert.equal(out.result.runner, "0xaaaa…aaaa");
  assert.equal(out.result.score, 90);
  assert.equal(store.rows[0]!.runner, RUNNER.toLowerCase(), "stored in full");
  assert.equal(calls[0]!.endpoint, "https://agent.example/test");
  assert.equal(calls[0]!.variant, pickVariant(`${RUNNER.toLowerCase()}|5042002:0xreg:1|2026-10-16`));
  assert.equal(calls[0]!.ctx.arcBlock, 1000n);
  assert.equal("input" in out.result, false, "the list view hides input and output");
});

test("missing, unlisted and untestable listings are refused without running anything", async () => {
  const { calls, service } = setup();
  assert.deepEqual(await service.runPublic(RUNNER, "nope"), { ok: false, code: "not_found" });
  assert.deepEqual(await service.runPublic(RUNNER, "5042002:0xreg:3"), { ok: false, code: "not_listed" });
  assert.deepEqual(await service.runPublic(RUNNER, "5042002:0xreg:2"), { ok: false, code: "no_test_for_category" });
  assert.equal(calls.length, 0);
});

test("a service file Agon could not read records nothing; one that declares no endpoint is a failed run scored 0", async () => {
  const { store, calls, service } = setup();
  assert.deepEqual(await service.runPublic(RUNNER, "5042002:0xreg:4"), { ok: false, code: "unavailable" });
  assert.equal(store.rows.length, 0, "Agon's own read failure is not the agent's fault");
  const out = await service.runPublic(RUNNER, "5042002:0xreg:5");
  assert.ok(out.ok);
  assert.equal(out.result.score, 0);
  assert.equal(out.result.error, "manifest_endpoint_missing");
  assert.equal(calls.length, 0);
});

test("past a person's hourly limit the agent is not called at all", async () => {
  const { calls, service } = setup();
  for (let i = 0; i < 5; i += 1) assert.ok((await service.runPublic(RUNNER, "5042002:0xreg:1")).ok);
  assert.deepEqual(await service.runPublic(RUNNER, "5042002:0xreg:1"), { ok: false, code: "user_limit" });
  assert.equal(calls.length, 5);
});

test("a burst of parallel tests by one person reaches the agent once at a time", async () => {
  const store = createMemoryTestResultsStore();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const service = createTestService({
    store,
    getListing: async (ref) => listings[ref] ?? null,
    run: async (input) => { calls += 1; await gate; return { taskId: "t", variant: input.variant, score: 90, passed: true, durationMs: 1, input: {}, output: {}, error: null, notes: [] }; },
    chain: { chainId: async () => 5042002, blockNumber: async () => 1000n },
    now: () => NOW,
    fetchDeps: { fetch: (async () => new Response("")) as typeof fetch, assertPublic: async (u: string) => new URL(u) },
  });
  const burst = Array.from({ length: 20 }, () => service.runPublic(RUNNER, "5042002:0xreg:1"));
  await new Promise((r) => setTimeout(r, 20));
  release();
  const out = await Promise.all(burst);
  assert.equal(calls, 1);
  assert.equal(out.filter((o) => o.ok).length, 1);
  assert.ok(out.filter((o) => !o.ok).every((o) => !o.ok && o.code === "in_progress"));
});

test("the limits refuse the 6th run by a person in an hour", async () => {
  const { service } = setup();
  for (let i = 0; i < 5; i += 1) assert.ok((await service.runPublic(RUNNER, "5042002:0xreg:1")).ok);
  assert.deepEqual(await service.runPublic(RUNNER, "5042002:0xreg:1"), { ok: false, code: "user_limit" });
});

test("an Agon check is recorded as agon_check with no runner and does not use up the public limits", async () => {
  const { store, service } = setup(40);
  const out = await service.runAgonCheck("5042002:0xreg:1");
  assert.ok(out.ok);
  assert.equal(out.result.source, "agon_check");
  assert.equal(out.result.runner, null);
  assert.equal(await store.remainingToday("41", NOW, 20), 20);
});

test("short addresses keep the first and last four hex digits", () => {
  assert.equal(shortAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
  assert.equal(shortAddress(null), null);
});
