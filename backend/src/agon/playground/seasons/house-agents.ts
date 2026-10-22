import { z } from "zod";
import type { Hex } from "viem";

import { blindPrompt, combineWithMarket, parseBlind, type EvidenceSearch } from "./evidence.ts";
import type { RoundMarket } from "./types.ts";

export type HouseAgentSpec = {
  key: string;
  displayName: string;
  /** evidence: forecasts blind from sourced news, then code moves part way from the price (evidence.ts). */
  kind: "model" | "market-copy" | "evidence";
  model: string | null;
  strategy: string;
};

/// Bedrock inference profile ids, verified from the production server's instance role on 2026-10-11 (owner's model mix).
export const DEFAULT_HOUSE_AGENTS: readonly HouseAgentSpec[] = [
  {
    key: "atlas",
    displayName: "Atlas (house)",
    kind: "model",
    model: "global.anthropic.claude-sonnet-5-5",
    strategy: "Start from base rates for this kind of event, then adjust for how much time is left and what is already known.",
  },
  {
    key: "vesper",
    displayName: "Vesper (house)",
    kind: "model",
    model: "global.anthropic.claude-haiku-5-5",
    strategy: "Weigh recent momentum and the most recent known facts most heavily.",
  },
  {
    key: "kestrel",
    displayName: "Kestrel (house)",
    kind: "model",
    model: "global.xai.grok-4.7",
    strategy: "Assume the crowd price is roughly right and move away from it only when you can name a concrete reason.",
  },
  {
    key: "drift",
    displayName: "Drift (house)",
    kind: "model",
    model: "global.moonshotai.kimi-k3",
    strategy: "For price thresholds, reason about typical volatility over the remaining time to the deadline.",
  },
  {
    key: "mirror",
    displayName: "Mirror (house, market copy)",
    kind: "market-copy",
    model: null,
    strategy: "",
  },
  {
    key: "beacon",
    displayName: "Beacon (house, evidence first)",
    kind: "evidence",
    model: "global.anthropic.claude-sonnet-5-5",
    strategy: "",
  },
];

export function houseAgentsFromEnv(modelsJson: string | undefined): readonly HouseAgentSpec[] {
  if (!modelsJson) return DEFAULT_HOUSE_AGENTS;
  let overrides: Record<string, string>;
  try {
    overrides = z.record(z.string().min(1)).parse(JSON.parse(modelsJson));
  } catch {
    throw new Error('AGON_SEASON_HOUSE_MODELS must be a JSON object like {"atlas":"global.anthropic.claude-sonnet-5-5"}');
  }
  return DEFAULT_HOUSE_AGENTS.map((a) => (a.kind !== "market-copy" && overrides[a.key] ? { ...a, model: overrides[a.key]! } : a));
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

/// Output room for one forecast. Claude 5.5 writes fuller reasons than older
/// models and its JSON was cut off at 400 tokens (seen live on 12 Oct 2026).
export const FORECAST_MAX_TOKENS = 1200;

export async function forecastSlate(
  callModel: ModelCaller,
  spec: HouseAgentSpec,
  markets: RoundMarket[],
  now: Date,
  log?: (m: string) => void,
  searchEvidence?: EvidenceSearch,
): Promise<{ marketId: Hex; probabilityBps: number; reasons: string[] }[]> {
  if (spec.kind === "market-copy") {
    return markets.map((m) => ({ marketId: m.marketId, probabilityBps: m.baselineBps, reasons: ["Repeats the Polymarket price at round open."] }));
  }
  if (spec.kind === "evidence") return evidenceSlate(callModel, spec, markets, now, log, searchEvidence);
  const out: { marketId: Hex; probabilityBps: number; reasons: string[] }[] = [];
  for (const market of markets) {
    try {
      const prompt = forecastPrompt(spec, market, now);
      const reply = await callModel({ model: spec.model!, ...prompt, maxTokens: FORECAST_MAX_TOKENS, temperature: 0.2 });
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

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/// Evidence first, price last: search, forecast without the price, then move
/// half way from the price in code. No evidence (or no search) repeats the price.
async function evidenceSlate(
  callModel: ModelCaller,
  spec: HouseAgentSpec,
  markets: RoundMarket[],
  now: Date,
  log?: (m: string) => void,
  searchEvidence?: EvidenceSearch,
): Promise<{ marketId: Hex; probabilityBps: number; reasons: string[] }[]> {
  const out: { marketId: Hex; probabilityBps: number; reasons: string[] }[] = [];
  for (const market of markets) {
    const evidence = searchEvidence ? await searchEvidence(market.question, now) : [];
    if (evidence.length === 0) {
      out.push({ marketId: market.marketId, probabilityBps: market.baselineBps, reasons: ["No recent evidence found, so no edge: repeats the Polymarket price."] });
      continue;
    }
    try {
      const reply = await callModel({ model: spec.model!, ...blindPrompt(market, now, evidence), maxTokens: FORECAST_MAX_TOKENS, temperature: 0.2 });
      const blind = parseBlind(reply.text, evidence.length);
      if (!blind) {
        log?.(`house ${spec.key}: unparseable answer for ${market.marketId}`);
        continue;
      }
      const final = combineWithMarket(blind.probabilityBps, market.baselineBps, evidence.length);
      out.push({
        marketId: market.marketId,
        probabilityBps: final,
        reasons: [`Without the price: ${pct(blind.probabilityBps)} from ${evidence.length} sources. Polymarket: ${pct(market.baselineBps)}. Moved half way: ${pct(final)}.`, ...blind.reasons].slice(0, 3),
      });
    } catch (error) {
      log?.(`house ${spec.key}: model call failed for ${market.marketId}: ${(error as Error).message}`);
    }
  }
  return out;
}
