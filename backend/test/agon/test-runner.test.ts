import assert from "node:assert/strict";
import test from "node:test";

import { runAgentTest } from "../../src/agon/tests/runner.ts";
import { buildTestCase } from "../../src/agon/tests/tasks.ts";

const ctx = { arcChainId: 5042002, arcBlock: 1_000_000n };
const reply = (output: unknown, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ protocol: "agon-playground/1", agent: { name: "A", version: "1", capabilities: ["x"] }, output, externalWrites: false, ...extra }), { status: 200, headers: { "content-type": "application/json" } });
const deps = (fetchImpl: typeof fetch) => ({ fetch: fetchImpl, assertPublic: async (u: string) => new URL(u) });

test("a good answer is scored by the task's scorer, and the call is the certification protocol", async () => {
  let sent: { url: string; init: RequestInit } | null = null;
  const out = await runAgentTest({ endpoint: "https://agent.example/test", categoryId: "1", variant: 0, ctx, deps: deps((async (url: string, init: RequestInit) => { sent = { url, init }; return reply({ chainId: 5042002, blockNumber: "1000010", source: "Arc RPC" }); }) as typeof fetch) });
  assert.ok(out);
  assert.equal(out.score, 100);
  assert.equal(out.passed, true);
  const body = JSON.parse(String(sent!.init.body));
  assert.equal(body.protocol, "agon-playground/1");
  assert.equal(body.task.id, "arc-live-fact");
  assert.equal(sent!.init.redirect, "error");
});

test("timeouts, errors, bad replies and claimed writes are failed runs scored 0", async () => {
  const cases: [string, typeof fetch][] = [
    ["throws", (async () => { throw new Error("timeout"); }) as typeof fetch],
    ["500", (async () => new Response("no", { status: 500 })) as typeof fetch],
    ["not json", (async () => new Response("hello", { status: 200 })) as typeof fetch],
    ["wrong protocol", (async () => reply({}, { protocol: "other" })) as typeof fetch],
    ["writes", (async () => reply({}, { externalWrites: true })) as typeof fetch],
  ];
  for (const [label, f] of cases) {
    const out = await runAgentTest({ endpoint: "https://agent.example/test", categoryId: "3", variant: 0, ctx, deps: deps(f) });
    assert.ok(out, label);
    assert.equal(out.score, 0, label);
    assert.equal(out.passed, false, label);
    assert.ok(out.error, label);
  }
});

test("a private address is never called, and untestable categories return null", async () => {
  let called = false;
  const out = await runAgentTest({ endpoint: "https://10.0.0.1/x", categoryId: "3", variant: 0, ctx, deps: { fetch: (async () => { called = true; return reply({}); }) as typeof fetch, assertPublic: async () => { throw new Error("private"); } } });
  assert.equal(out!.score, 0);
  assert.equal(called, false);
  assert.equal(await runAgentTest({ endpoint: "https://a.example", categoryId: "6", variant: 0, ctx, deps: deps(fetch) }), null);
  assert.ok(buildTestCase("3", 0, ctx));
});

test("a test family is sent as its own task with the market and its rules", async () => {
  let body: { task: { id: string }; input: { question: string; rules: string } } | null = null;
  const out = await runAgentTest({ endpoint: "https://agent.example/test", categoryId: "8", family: "market-rules", variant: 1, ctx, deps: deps((async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return reply({ risk: "high", traps: [] });
  }) as typeof fetch) });
  assert.ok(out);
  assert.equal(body!.task.id, "market-rules");
  assert.match(body!.input.question, /mineral/i);
  assert.equal(out.taskId, "market-rules");
});
