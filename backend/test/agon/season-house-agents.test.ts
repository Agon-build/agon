import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import {
  DEFAULT_HOUSE_AGENTS, FORECAST_MAX_TOKENS, forecastPrompt, forecastSlate, houseAgentsFromEnv, parseProbability, type ModelCaller,
} from "../../src/agon/playground/seasons/house-agents.ts";
import type { RoundMarket } from "../../src/agon/playground/seasons/types.ts";
import { modelFamily } from "../../src/runners/llm/bedrock.ts";

const market = (n: number, baselineBps = 4100): RoundMarket => ({
  seasonId: 1n,
  round: 2n,
  marketId: `0x${n.toString(16).padStart(64, "0")}` as Hex,
  question: "Will Bitcoin reach $84,000 October 12-18?",
  slug: "btc-84k",
  endAt: new Date("2026-10-19T04:00:00Z"),
  baselineBps,
});

test("five house agents, all labelled house, one market-copy benchmark, models on Bedrock", () => {
  assert.deepEqual(DEFAULT_HOUSE_AGENTS.map((a) => a.key), ["atlas", "vesper", "kestrel", "drift", "mirror"]);
  assert.ok(DEFAULT_HOUSE_AGENTS.every((a) => a.displayName.includes("(house")));
  assert.deepEqual(DEFAULT_HOUSE_AGENTS.filter((a) => a.kind === "market-copy").map((a) => a.key), ["mirror"]);
  const models = DEFAULT_HOUSE_AGENTS.filter((a) => a.kind === "model").map((a) => a.model!);
  assert.deepEqual(models, ["global.anthropic.claude-sonnet-5-5", "global.anthropic.claude-haiku-5-5", "global.xai.grok-4.7", "global.moonshotai.kimi-k3"]);
  assert.ok(models.every((m) => modelFamily(m) === "bedrock"));
});

test("env can override models by key without touching names", () => {
  const agents = houseAgentsFromEnv('{"atlas":"global.anthropic.claude-opus-5-5"}');
  assert.equal(agents.find((a) => a.key === "atlas")!.model, "global.anthropic.claude-opus-5-5");
  assert.equal(agents.find((a) => a.key === "vesper")!.model, "global.anthropic.claude-haiku-5-5");
  assert.deepEqual(houseAgentsFromEnv(undefined), DEFAULT_HOUSE_AGENTS);
  assert.throws(() => houseAgentsFromEnv("not json"), /AGON_SEASON_HOUSE_MODELS/);
});

test("prompt states the question, end time and the crowd price, and asks for JSON only", () => {
  const { systemPrompt, userPrompt } = forecastPrompt(DEFAULT_HOUSE_AGENTS[0]!, market(1), new Date("2026-10-13T06:00:00Z"));
  assert.match(systemPrompt, /JSON/);
  assert.match(userPrompt, /Will Bitcoin reach \$84,000 October 12-18\?/);
  assert.match(userPrompt, /2026-10-19T04:00:00\.000Z/);
  assert.match(userPrompt, /41\.0%/);
});

test("probability parsing accepts clean JSON, fenced JSON and rejects garbage", () => {
  assert.deepEqual(parseProbability('{"probability": 0.34, "reasons": ["a","b","c"]}'), { probabilityBps: 3400, reasons: ["a", "b", "c"] });
  assert.deepEqual(parseProbability('```json\n{"probability":0.5,"reasons":["x"]}\n```'), { probabilityBps: 5000, reasons: ["x"] });
  assert.equal(parseProbability('{"probability": 1.2, "reasons": []}'), null);
  assert.equal(parseProbability('{"probability": "high"}'), null);
  assert.equal(parseProbability("I think about 40%"), null);
  assert.equal(parseProbability('{"probability": 0.123456, "reasons": ["r"]}')!.probabilityBps, 1235);
});

test("market copy returns the baseline without calling a model", async () => {
  let calls = 0;
  const caller: ModelCaller = async () => {
    calls += 1;
    return { text: "" };
  };
  const out = await forecastSlate(caller, DEFAULT_HOUSE_AGENTS[4]!, [market(1, 4100), market(2, 7300)], new Date());
  assert.equal(calls, 0);
  assert.deepEqual(out.map((o) => o.probabilityBps), [4100, 7300]);
});

test("model agents skip a market whose answer cannot be parsed or whose call fails", async () => {
  const replies = ['{"probability":0.3,"reasons":["r1","r2","r3"]}', "no idea"];
  const caller: ModelCaller = async (p) => {
    assert.equal(p.model, "global.anthropic.claude-sonnet-5-5");
    const next = replies.shift();
    if (next === undefined) throw new Error("provider down");
    return { text: next };
  };
  const logs: string[] = [];
  const out = await forecastSlate(caller, DEFAULT_HOUSE_AGENTS[0]!, [market(1), market(2), market(3)], new Date(), (m) => logs.push(m));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.probabilityBps, 3000);
  assert.equal(logs.length, 2);
});

test("prompt notes are appended when given and absent otherwise", () => {
  const withNotes = forecastPrompt(DEFAULT_HOUSE_AGENTS[0]!, market(1), new Date("2026-10-13T06:00:00Z"), ["BTC spot price: $82,953"]);
  assert.match(withNotes.userPrompt, /Notes:\n- BTC spot price: \$82,953/);
  assert.doesNotMatch(forecastPrompt(DEFAULT_HOUSE_AGENTS[0]!, market(1), new Date()).userPrompt, /Notes:/);
});

test("forecast calls leave room for a full answer (Claude 5.5 truncated at 400 tokens, seen live 12 Oct)", async () => {
  const seen: number[] = [];
  const caller: ModelCaller = async (p) => {
    seen.push(p.maxTokens);
    return { text: '{"probability":0.3,"reasons":["r1","r2","r3"]}' };
  };
  await forecastSlate(caller, DEFAULT_HOUSE_AGENTS[0]!, [market(1)], new Date("2026-10-13T06:00:00Z"));
  assert.deepEqual(seen, [FORECAST_MAX_TOKENS]);
  assert.ok(FORECAST_MAX_TOKENS >= 1000);
});
