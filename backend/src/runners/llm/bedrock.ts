import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";

import type { CallParams, CallResult } from "./client.js";

/// Amazon Bedrock provider for callModel. Model ids are inference profile ids
/// such as global.anthropic.claude-sonnet-5-5: they contain dots and never a
/// slash, which is how callModel tells them from OpenRouter slugs. Credentials
/// come from the default AWS chain; on the production server that is the EC2
/// instance role agon-host-bedrock, so no keys live in the env.

export type ModelFamily = "bedrock" | "openrouter" | "anthropic";

const PROFILE = /^(global|us|eu|apac|ca|jp|au)\.[a-z0-9-]+\.[a-z0-9][a-z0-9.:-]*$/;

export function modelFamily(model: string): ModelFamily {
  if (PROFILE.test(model)) return "bedrock";
  if (model.includes("/")) return "openrouter";
  return "anthropic";
}

/// Grok 4.7 and Kimi K3 reason before they answer and bill the reasoning as
/// output. With a small cap they spend it all thinking and return no text
/// (seen in the 11 Oct 2026 test calls), so they get at least this many tokens
/// and no temperature.
export const REASONING_MIN_TOKENS = 2000;
const REASONING = [/\.xai\.grok-/, /\.moonshotai\.kimi-/];
export const isReasoningModel = (model: string): boolean => REASONING.some((r) => r.test(model));

/// USD per million tokens, AWS price list for global profiles on 11 Oct 2026.
const RATES: Record<string, { input: number; output: number }> = {
  "anthropic.claude-sonnet-5-5": { input: 2, output: 10 },
  "anthropic.claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "xai.grok-4.7": { input: 2, output: 6 },
  "moonshotai.kimi-k3": { input: 3, output: 15 },
};
/// An unknown model is priced high so the usage log never shows it as free.
const UNKNOWN_RATE = { input: 3, output: 15 };

export function bedrockCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const r = RATES[model.slice(model.indexOf(".") + 1)] ?? UNKNOWN_RATE;
  return (inputTokens * r.input + outputTokens * r.output) / 1_000_000;
}

export type BedrockSend = (input: ConverseCommandInput, signal: AbortSignal) => Promise<ConverseCommandOutput>;

export function bedrockSender(region: string): BedrockSend {
  let client: BedrockRuntimeClient | null = null;
  return (input, signal) => {
    client ??= new BedrockRuntimeClient({ region, maxAttempts: 3, retryMode: "adaptive" });
    return client.send(new ConverseCommand(input), { abortSignal: signal });
  };
}

export async function callBedrock(
  params: CallParams,
  send: BedrockSend,
  options: { timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<CallResult> {
  if (params.tools && params.tools.length > 0) throw new Error(`bedrock ${params.model}: server tools are not supported on this path`);
  const log = options.log ?? ((m: string) => console.log(m));
  const timeoutMs = options.timeoutMs ?? 60_000;
  const reasoning = isReasoningModel(params.model);
  const maxTokens = reasoning ? Math.max(params.maxTokens, REASONING_MIN_TOKENS) : params.maxTokens;
  const input: ConverseCommandInput = {
    modelId: params.model,
    system: [{ text: params.systemPrompt }],
    messages: [{ role: "user", content: [{ text: params.userPrompt }] }],
    inferenceConfig: reasoning ? { maxTokens } : { maxTokens, temperature: params.temperature },
  };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject first: aborting can settle the request synchronously, and the
      // caller must see the timeout, not a bare abort.
      reject(new Error(`bedrock ${params.model}: timed out after ${timeoutMs} ms`));
      controller.abort();
    }, timeoutMs);
  });
  const t0 = Date.now();
  let out: ConverseCommandOutput;
  try {
    out = await Promise.race([send(input, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - t0;
  const text = (out.output?.message?.content ?? []).map((b) => b.text ?? "").join("").trim();
  const inputTokens = out.usage?.inputTokens ?? 0;
  const outputTokens = out.usage?.outputTokens ?? 0;
  const costUsd = bedrockCostUsd(params.model, inputTokens, outputTokens);
  log(`[llm] bedrock ${params.model} in=${inputTokens} out=${outputTokens} ${latencyMs}ms $${costUsd.toFixed(5)}`);
  if (!text) throw new Error(`bedrock ${params.model}: no answer text (stop ${out.stopReason ?? "unknown"})`);
  return { text, inputTokens, outputTokens, costUsd, latencyMs, model: params.model };
}
