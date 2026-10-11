import { z } from "zod";
import type { Hex } from "viem";

import type { RoundMarket } from "./types.ts";

export type HouseAgentSpec = {
  key: string;
  displayName: string;
  kind: "model" | "market-copy";
  model: string | null;
  strategy: string;
};

/// Model ids verified on the OpenRouter model list on 2026-10-11.
export const DEFAULT_HOUSE_AGENTS: readonly HouseAgentSpec[] = [
  {
    key: "atlas",
    displayName: "Atlas (house)",
    kind: "model",
    model: "anthropic/claude-sonnet-5.5",
    strategy: "Start from base rates for this kind of event, then adjust for how much time is left and what is already known.",
  },
  {
    key: "vesper",
    displayName: "Vesper (house)",
    kind: "model",
    model: "openai/gpt-5.5",
    strategy: "Weigh recent momentum and the most recent known facts most heavily.",
  },
  {
    key: "kestrel",
    displayName: "Kestrel (house)",
    kind: "model",
    model: "google/gemini-3.8-flash",
    strategy: "Assume the crowd price is roughly right and move away from it only when you can name a concrete reason.",
  },
  {
    key: "drift",
    displayName: "Drift (house)",
    kind: "model",
    model: "x-ai/grok-4.7",
    strategy: "For price thresholds, reason about typical volatility over the remaining time to the deadline.",
  },
  {
    key: "mirror",
    displayName: "Mirror (house, market copy)",
    kind: "market-copy",
    model: null,
    strategy: "",
  },
];

export function houseAgentsFromEnv(modelsJson: string | undefined): readonly HouseAgentSpec[] {
  if (!modelsJson) return DEFAULT_HOUSE_AGENTS;
  let overrides: Record<string, string>;
  try {
    overrides = z.record(z.string().min(1)).parse(JSON.parse(modelsJson));
  } catch {
    throw new Error('AGON_SEASON_HOUSE_MODELS must be a JSON object like {"atlas":"anthropic/claude-sonnet-5.5"}');
  }
  return DEFAULT_HOUSE_AGENTS.map((a) => (a.kind === "model" && overrides[a.key] ? { ...a, model: overrides[a.key]! } : a));
}

export function forecastPrompt(spec: HouseAgentSpec, market: RoundMarket, now: Date, notes: string[] = []): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "You are a forecasting agent competing in a public forecasting season scored by Brier score against official Polymarket results. " +
      `Strategy: ${spec.strategy} ` +
      'Answer with JSON only, no prose: {"probability": <number between 0 and 1 that the answer is Yes>, "reasons": [<three short reasons>]}.',
    userPrompt: [
      `Question: ${market.question}`,
      `Market closes: ${market.endAt.toISOString()}`,
      `Current time: ${now.toISOString()}`,
      `Crowd price for Yes right now: ${(market.baselineBps / 100).toFixed(1)}%`,
      ...(notes.length > 0 ? ["Notes:", ...notes.slice(0, 5).map((n) => `- ${n.slice(0, 200)}`)] : []),
    ].join("\n"),
  };
}

const answer = z.object({ probability: z.number().min(0).max(1), reasons: z.array(z.string()).default([]) });

export function parseProbability(text: string): { probabilityBps: number; reasons: string[] } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = answer.safeParse(JSON.parse(match[0]));
    if (!parsed.success) return null;
    return { probabilityBps: Math.round(parsed.data.probability * 10_000), reasons: parsed.data.reasons.slice(0, 3) };
  } catch {
    return null;
  }
}

export type ModelCaller = (p: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
}) => Promise<{ text: string }>;

export async function forecastSlate(
  callModel: ModelCaller,
  spec: HouseAgentSpec,
  markets: RoundMarket[],
  now: Date,
  log?: (m: string) => void,
): Promise<{ marketId: Hex; probabilityBps: number; reasons: string[] }[]> {
  if (spec.kind === "market-copy") {
    return markets.map((m) => ({ marketId: m.marketId, probabilityBps: m.baselineBps, reasons: ["Repeats the Polymarket price at round open."] }));
  }
  const out: { marketId: Hex; probabilityBps: number; reasons: string[] }[] = [];
  for (const market of markets) {
    try {
      const prompt = forecastPrompt(spec, market, now);
      const reply = await callModel({ model: spec.model!, ...prompt, maxTokens: 400, temperature: 0.2 });
      const parsed = parseProbability(reply.text);
      if (!parsed) {
        log?.(`house ${spec.key}: unparseable answer for ${market.marketId}`);
        continue;
      }
      out.push({ marketId: market.marketId, ...parsed });
    } catch (error) {
      log?.(`house ${spec.key}: model call failed for ${market.marketId}: ${(error as Error).message}`);
    }
  }
  return out;
}
