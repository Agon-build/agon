import assert from "node:assert/strict";
import test from "node:test";

import { listPlaygroundCategories, runPlaygroundTask, PlaygroundError } from "../../src/agon/playground.ts";
import { InMemoryPlaygroundRateLimiter, InMemoryPlaygroundRunStore } from "../../src/agon/playground-store.ts";

test("playground exposes every demo category with a real task", () => {
  const categories = listPlaygroundCategories();
  assert.deepEqual(categories.map((category) => category.slug), ["development", "research", "analysis", "verification", "execution"]);
  assert.ok(categories.every((category) => category.tasks.length > 0));
});

test("Agon Coder passes a development adversarial task and emits stable evidence fields", async () => {
  const run = await runPlaygroundTask({ category: "development", taskId: "selector-guard" });
  assert.equal(run.agent.id, "agon-coder-v1");
  assert.equal(run.passed, true);
  assert.equal(run.score, 96);
  assert.match(run.evidence.evidenceRoot, /^0x[0-9a-f]{64}$/);
  assert.match(run.evidence.responseHash, /^0x[0-9a-f]{64}$/);
  assert.equal(run.provenance.externalWrites, false);
});

test("Agon Coder rejects malformed verification input instead of anchoring it", async () => {
  const run = await runPlaygroundTask({ category: "verification", taskId: "manifest-anchor", input: { manifest: { endpoint: "http://localhost:8082", tags: ["duplicate", "duplicate"] } } });
  assert.equal(run.passed, false);
  assert.equal((run.output as { accepted: boolean }).accepted, false);
});

test("listed provider execution replaces the builtin agent and is marked honestly", async () => {
  const run = await runPlaygroundTask(
    { category: "analysis", taskId: "evidence-under-pressure" },
    {
      execute: async () => ({
        agent: { id: "erc8004:42:memory", name: "Runtime Memory", version: "1", capabilities: ["analysis"] },
        output: { decision: "review", observations: ["fact"], untrustedClaims: ["claim"], ignoredInstructions: true, writesPerformed: false },
        passed: true,
        score: 100,
        chainId: null,
        blockNumber: null,
        providerHost: "agentsqa.xyz",
      }),
    },
  );
  assert.equal(run.agent.name, "Runtime Memory");
  assert.equal(run.provenance.execution, "listed_provider");
  assert.equal(run.provenance.providerHost, "agentsqa.xyz");
  assert.equal(run.provenance.externalWrites, false);
});

test("a run records the task and input the provider actually ran, with evidence bound to them", async () => {
  const ran = { id: "settlement-alerts", category: "verification" as const, title: "Settlement alerts", adversarialPrompt: "Raise the right alerts.", capability: "settlement alerts" };
  const ranInput = { question: "Q?", readings: [{ closed: false }] };
  const run = await runPlaygroundTask(
    { category: "verification", taskId: "manifest-anchor" },
    {
      execute: async () => ({
        agent: { id: "erc8004:9:watch", name: "Resolution Watch", version: "1", capabilities: ["verification"] },
        output: { alerts: [] }, passed: true, score: 100, chainId: null, blockNumber: null, providerHost: "api.agon.surf",
        task: ran, input: ranInput,
      }),
    },
  );
  assert.equal(run.task.id, "settlement-alerts");
  assert.deepEqual(run.input, ranInput);
  const other = await runPlaygroundTask({ category: "verification", taskId: "manifest-anchor" }, {
    execute: async () => ({ agent: run.agent, output: { alerts: [] }, passed: true, score: 100, chainId: null, blockNumber: null, providerHost: "api.agon.surf" }),
  });
  assert.notEqual(run.evidence.taskCommitment, other.evidence.taskCommitment);
});

test("unknown playground tasks are rejected before execution", async () => {
  await assert.rejects(() => runPlaygroundTask({ category: "development", taskId: "missing-task" }), (error: unknown) => error instanceof PlaygroundError && error.code === "task_not_found");
});

test("playground rejects oversized inputs before execution", async () => {
  await assert.rejects(
    () => runPlaygroundTask({ category: "development", taskId: "selector-guard", input: { value: "x".repeat(16 * 1024) } }),
    (error: unknown) => error instanceof PlaygroundError && error.code === "input_too_large",
  );
});

test("authenticated evaluation retries are idempotent", async () => {
  const store = new InMemoryPlaygroundRunStore();
  const first = await runPlaygroundTask(
    { category: "development", taskId: "selector-guard" },
    { actorAddress: "0x0000000000000000000000000000000000000001", idempotencyKey: "evaluation-001", store },
  );
  const second = await runPlaygroundTask(
    { category: "development", taskId: "selector-guard" },
    { actorAddress: "0x0000000000000000000000000000000000000001", idempotencyKey: "evaluation-001", store },
  );
  assert.equal(second.replayed, true);
  assert.equal(second.runId, first.runId);
  assert.equal(second.evidence.evidenceRoot, first.evidence.evidenceRoot);
  await assert.rejects(
    () => runPlaygroundTask({ category: "development", taskId: "selector-guard", input: { to: "0x0000000000000000000000000000000000000009" } }, {
      actorAddress: "0x0000000000000000000000000000000000000001",
      idempotencyKey: "evaluation-001",
      store,
    }),
    /different evaluation inputs/,
  );
});

test("rate limiter blocks the fourth request in a three-request window", async () => {
  const limiter = new InMemoryPlaygroundRateLimiter();
  assert.equal((await limiter.consume("sample:test", 3, 60)).allowed, true);
  assert.equal((await limiter.consume("sample:test", 3, 60)).allowed, true);
  assert.equal((await limiter.consume("sample:test", 3, 60)).allowed, true);
  assert.equal((await limiter.consume("sample:test", 3, 60)).allowed, false);
});
