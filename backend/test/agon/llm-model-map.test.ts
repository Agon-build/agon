import assert from "node:assert/strict";
import test from "node:test";

import { parseModelMap, remapModel } from "../../src/runners/llm/model-map.ts";
import { modelFamily } from "../../src/runners/llm/bedrock.ts";

test("LLM_MODEL_MAP moves Bedrock ids to the Anthropic API, one step only", () => {
  const { map, problem } = parseModelMap(JSON.stringify({
    "global.anthropic.claude-sonnet-5-5": "claude-sonnet-5-5",
    "global.anthropic.claude-haiku-5-5": "claude-haiku-5-5",
    "claude-haiku-5-5": "global.anthropic.claude-haiku-5-5",
  }));
  assert.equal(problem, null);
  assert.equal(remapModel(map, "global.anthropic.claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(modelFamily(remapModel(map, "global.anthropic.claude-sonnet-5-5")), "anthropic");
  // A mapped id is not mapped again, so a cycle in the map cannot loop.
  assert.equal(remapModel(map, "global.anthropic.claude-haiku-5-5"), "claude-haiku-5-5");
  assert.equal(remapModel(map, "global.xai.grok-4.7"), "global.xai.grok-4.7");
});

test("an empty or malformed LLM_MODEL_MAP leaves every id as it is", () => {
  assert.equal(parseModelMap(undefined).map.size, 0);
  assert.equal(parseModelMap("  ").problem, null);
  assert.match(parseModelMap("{not json").problem!, /must be JSON/);
  assert.match(parseModelMap("[1]").problem!, /JSON object/);
  assert.match(parseModelMap('{"a":""}').problem!, /must map to a model id/);
  assert.equal(parseModelMap('{"a":""}').map.size, 0);
});
