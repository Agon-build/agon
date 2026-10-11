import assert from "node:assert/strict";
import test from "node:test";
import type { ConverseCommandInput, ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import {
  bedrockCostUsd, callBedrock, isReasoningModel, modelFamily, REASONING_MIN_TOKENS, type BedrockSend,
} from "../../src/runners/llm/bedrock.ts";
import { createBreakerSet } from "../../src/runners/llm/breaker.ts";

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
const quiet = () => {};
const params = { model: "global.anthropic.claude-sonnet-5-5", systemPrompt: "sys", userPrompt: "user", maxTokens: 400, temperature: 0.2 };

function stub(reply: Record<string, unknown>) {
  const sent: ConverseCommandInput[] = [];
  const send: BedrockSend = async (input) => {
    sent.push(input);
    return { $metadata: {}, stopReason: "end_turn", metrics: { latencyMs: 1 }, usage: { inputTokens: 1500, outputTokens: 400, totalTokens: 1900 }, ...reply } as unknown as ConverseCommandOutput;
  };
  return { sent, send };
}

test("model ids route by shape: Bedrock profiles, OpenRouter slugs, bare Claude ids", () => {
  for (const id of ["global.anthropic.claude-sonnet-5-5", "global.anthropic.claude-haiku-5-5", "global.xai.grok-4.7", "us.moonshotai.kimi-k3", "us.anthropic.claude-haiku-4-5-20251001-v1:0"]) {
    assert.equal(modelFamily(id), "bedrock", id);
  }
  assert.equal(modelFamily("anthropic/claude-sonnet-5.5"), "openrouter");
  assert.equal(modelFamily("meta-llama/llama-3.3-70b-instruct"), "openrouter");
  assert.equal(modelFamily("claude-haiku-4-5-20251001"), "anthropic");
});

test("a Claude call sends the profile id, system and user text, explicit maxTokens and temperature", async () => {
  const { sent, send } = stub({ output: { message: { role: "assistant", content: [{ text: ' {"probability": 0.4} ' }] } } });
  const r = await callBedrock(params, send, { log: quiet });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.modelId, "global.anthropic.claude-sonnet-5-5");
  assert.deepEqual(sent[0]!.system, [{ text: "sys" }]);
  assert.deepEqual(sent[0]!.messages, [{ role: "user", content: [{ text: "user" }] }]);
  assert.deepEqual(sent[0]!.inferenceConfig, { maxTokens: 400, temperature: 0.2 });
  assert.equal(r.text, '{"probability": 0.4}');
  assert.equal(r.inputTokens, 1500);
  assert.equal(r.outputTokens, 400);
  assert.equal(r.model, "global.anthropic.claude-sonnet-5-5");
  near(r.costUsd, (1500 * 2 + 400 * 10) / 1_000_000);
});

test("reasoning models get at least REASONING_MIN_TOKENS, no temperature, and only text blocks are returned", async () => {
  const { sent, send } = stub({ output: { message: { role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "thinking" } } }, { text: "5" }] } } });
  const r = await callBedrock({ ...params, model: "global.moonshotai.kimi-k3" }, send, { log: quiet });
  assert.deepEqual(sent[0]!.inferenceConfig, { maxTokens: REASONING_MIN_TOKENS });
  assert.equal(r.text, "5");
  const { sent: big, send: sendBig } = stub({ output: { message: { role: "assistant", content: [{ text: "5" }] } } });
  await callBedrock({ ...params, model: "global.xai.grok-4.7", maxTokens: 4000 }, sendBig, { log: quiet });
  assert.deepEqual(big[0]!.inferenceConfig, { maxTokens: 4000 });
  assert.ok(isReasoningModel("global.xai.grok-4.7"));
  assert.ok(!isReasoningModel("global.anthropic.claude-haiku-5-5"));
});

test("an answer with no text throws so callModel can fall back, and usage is still logged", async () => {
  const lines: string[] = [];
  const { send } = stub({ stopReason: "max_tokens", output: { message: { role: "assistant", content: [{ reasoningContent: { reasoningText: { text: "..." } } }] } } });
  await assert.rejects(callBedrock({ ...params, model: "global.xai.grok-4.7" }, send, { log: (m) => lines.push(m) }), /no answer text \(stop max_tokens\)/);
  assert.match(lines[0]!, /^\[llm\] bedrock global\.xai\.grok-4\.7 in=1500 out=400 \d+ms \$0\.00540$/);
});

test("server tools are refused and unknown models are never priced as free", async () => {
  const { send, sent } = stub({});
  await assert.rejects(callBedrock({ ...params, tools: [{ type: "web_search", name: "web_search" }] }, send, { log: quiet }), /server tools/);
  assert.equal(sent.length, 0);
  near(bedrockCostUsd("global.someone.new-model", 1_000_000, 0), 3);
  near(bedrockCostUsd("global.anthropic.claude-haiku-5-5", 1_000_000, 1_000_000), 0.6);
  near(bedrockCostUsd("global.moonshotai.kimi-k3", 1_000_000, 1_000_000), 18);
});

test("a call that never answers times out", async () => {
  const send: BedrockSend = (_input, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(callBedrock(params, send, { timeoutMs: 20, log: quiet }), /timed out after 20 ms/);
});

test("breaker keys are independent and reopen only after the cooldown", () => {
  let t = 0;
  const b = createBreakerSet({ fails: 3, cooldownMs: 1000, now: () => t, log: quiet });
  for (let i = 0; i < 3; i++) b.record("bedrock:global.moonshotai.kimi-k3", false);
  assert.equal(b.open("bedrock:global.moonshotai.kimi-k3"), true);
  assert.equal(b.open("bedrock:global.xai.grok-4.7"), false);
  t = 1001;
  assert.equal(b.open("bedrock:global.moonshotai.kimi-k3"), false);
  b.record("bedrock:global.moonshotai.kimi-k3", true);
  b.record("bedrock:global.moonshotai.kimi-k3", false);
  assert.equal(b.open("bedrock:global.moonshotai.kimi-k3"), false, "one failure after a success does not reopen");
});
