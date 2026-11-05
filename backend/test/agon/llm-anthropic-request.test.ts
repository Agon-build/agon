import assert from "node:assert/strict";
import test from "node:test";

import { anthropicRequest } from "../../src/runners/llm/anthropic-request.ts";

test("the Anthropic request never sends temperature (Claude 5.5 rejects it as deprecated)", () => {
  const body = anthropicRequest(
    { model: "claude-sonnet-5-5", systemPrompt: "sys", userPrompt: "hi", maxTokens: 300, temperature: 0.2 },
    "claude-sonnet-5-5",
  );
  assert.equal("temperature" in body, false);
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, 300);
  assert.equal(body.system, "sys");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.equal("tools" in body, false);
});

test("tools pass through when given", () => {
  const body = anthropicRequest(
    { model: "claude-haiku-5-5", systemPrompt: "s", userPrompt: "u", maxTokens: 10, temperature: 0, tools: [{ type: "web_search_20250305", name: "web_search" }] },
    "claude-haiku-5-5",
  );
  assert.equal(Array.isArray(body.tools), true);
});
