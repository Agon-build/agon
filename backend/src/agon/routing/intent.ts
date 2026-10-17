import { z } from "zod";

import type { ModelCaller } from "../playground/seasons/house-agents.ts";

export const INTENT_KINDS = ["forecast", "research", "market_data", "analysis", "social", "content", "infrastructure", "other"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
export type Intent = { kind: IntentKind; query: string; values: Record<string, string> };

const ALL_AGON = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const ALL_CIRCLE = ["WEB_SEARCH_RESEARCH", "DATA_ENRICHMENT", "FINANCIAL_ANALYSIS", "PREDICTION_MARKETS", "SOCIAL_INTELLIGENCE", "CREATIVE", "INFRASTRUCTURE"];

/// Which categories serve each kind of task, in Agon's ids and Circle's names.
export const KIND_SOURCES: Record<IntentKind, { agonCategories: string[]; circleCategories: string[] }> = {
  forecast: { agonCategories: ["3", "4"], circleCategories: ["PREDICTION_MARKETS"] },
  research: { agonCategories: ["1"], circleCategories: ["WEB_SEARCH_RESEARCH", "DATA_ENRICHMENT"] },
  market_data: { agonCategories: ["2"], circleCategories: ["FINANCIAL_ANALYSIS"] },
  analysis: { agonCategories: ["3"], circleCategories: ["FINANCIAL_ANALYSIS"] },
  social: { agonCategories: ["1"], circleCategories: ["SOCIAL_INTELLIGENCE"] },
  content: { agonCategories: ["6"], circleCategories: ["CREATIVE"] },
  infrastructure: { agonCategories: ["7"], circleCategories: ["INFRASTRUCTURE"] },
  other: { agonCategories: ALL_AGON, circleCategories: ALL_CIRCLE },
};

const answer = z.object({ kind: z.enum(INTENT_KINDS), query: z.string().min(1).max(300), values: z.record(z.string().max(200)).default({}) });

/// The only model call in routing besides input filling: it names the kind of
/// task, a short search query and any concrete values the person gave.
export async function readIntent(text: string, callModel: ModelCaller, model: string): Promise<Intent> {
  const fallback: Intent = { kind: "other", query: text, values: {} };
  try {
    const reply = await callModel({
      model,
      systemPrompt:
        "You route requests to paid agent services. Classify the request and extract search words and values. " +
        `kind is one of: ${INTENT_KINDS.join(", ")}. forecast means the probability of a future event, such as a Polymarket question. ` +
        'Answer with JSON only: {"kind": "...", "query": "<3 to 8 search words>", "values": {"<name>": "<value the person gave, such as a ticker, URL, address or date>"}}.',
      userPrompt: text.slice(0, 600),
      maxTokens: 300,
      temperature: 0,
    });
    const json = reply.text.slice(reply.text.indexOf("{"), reply.text.lastIndexOf("}") + 1);
    const parsed = answer.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
