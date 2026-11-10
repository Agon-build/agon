import { z } from "zod";

import type { ModelCaller } from "../playground/seasons/house-agents.ts";
import { HIRE_CATEGORIES } from "./categories.ts";

export const INTENT_KINDS = ["forecast", "research", "market_data", "analysis", "social", "content", "infrastructure", "business", "other"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
export type Intent = { kind: IntentKind; query: string; values: Record<string, string> };

export const ALL_AGON = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const ALL_CIRCLE = [...new Set(HIRE_CATEGORIES.flatMap((c) => c.circleCategories))];

/// Which categories serve each kind of task, in Agon's ids and Circle's names,
/// taken from the Hire categories that kind belongs to. "other" searches everything.
export const KIND_SOURCES: Record<IntentKind, { agonCategories: string[]; circleCategories: string[] }> = Object.fromEntries(
  INTENT_KINDS.map((kind) => {
    if (kind === "other") return [kind, { agonCategories: ALL_AGON, circleCategories: ALL_CIRCLE }];
    const cats = HIRE_CATEGORIES.filter((c) => c.kinds.includes(kind));
    return [kind, { agonCategories: [...new Set(cats.flatMap((c) => c.agonCategories))], circleCategories: [...new Set(cats.flatMap((c) => c.circleCategories))] }];
  }),
) as Record<IntentKind, { agonCategories: string[]; circleCategories: string[] }>;

// A question about how likely something is. It wins over market-check words, so a
// forecast never leaves the Lead because it also mentions rules or volume.
const CHANCE = /\b(chances?|probability|probable|odds|likely|likelihood|forecast|predict(ion)?)\b|^\s*(do you think\s+)?will\b/i;
// A question about a market itself: whether to trade it, how it trades, how it resolves.
const MARKET_CHECK = /\b(worth (trading|it|betting|a bet)|trad(e|ing) it|tradeable|tradable|liquidity|liquid|spreads?|volume|order ?book|resolution|resolves?|rules?|avoid|red flags?|safe to (trade|bet)|check (the |this |a |my )?(polymarket |kalshi )?markets?|settle(ment|d)?|disputes?|challenged?|(watch|monitor)\w* .*\bmarkets?)\b/i;

/// What a request needs made, in the words service listings use for it. A listing for an
/// image service never says "logo", so the person's own words would not find it.
const CAPABILITIES: { pattern: RegExp; words: string; kind: IntentKind }[] = [
  { pattern: /\b(video|clip|animation|reel|trailer)s?\b/i, words: "video generate", kind: "content" },
  { pattern: /\b(logo|poster|banner|flyer|illustration|icon|artwork|drawing|thumbnail|wallpaper|avatar|mascot|sticker|picture|image|photo)s?\b/i, words: "image generate", kind: "content" },
];

export function capabilityOf(text: string): { kind: IntentKind; words: string } | null {
  const hit = CAPABILITIES.find((c) => c.pattern.test(text));
  return hit ? { kind: hit.kind, words: hit.words } : null;
}

/// Code reads the clear cases so they never depend on a model's answer.
export function kindFromWords(text: string): "forecast" | "analysis" | null {
  if (CHANCE.test(text)) return "forecast";
  if (MARKET_CHECK.test(text)) return "analysis";
  return null;
}

const answer = z.object({ kind: z.enum(INTENT_KINDS), query: z.string().min(1).max(300), values: z.record(z.string().max(200)).default({}) });

/// The only model call in routing besides input filling: it names the kind of
/// task, a short search query and any concrete values the person gave.
export async function readIntent(text: string, callModel: ModelCaller, model: string): Promise<Intent> {
  const read = await readWithModel(text, callModel, model);
  const kind = kindFromWords(text);
  if (kind) return { ...read, kind };
  // The capability joins the search words, so the service is found whatever words the model chose.
  const made = capabilityOf(text);
  return made ? { ...read, kind: made.kind, query: `${read.query} ${made.words}` } : read;
}

async function readWithModel(text: string, callModel: ModelCaller, model: string): Promise<Intent> {
  const fallback: Intent = { kind: "other", query: text, values: {} };
  try {
    const reply = await callModel({
      model,
      systemPrompt:
        "You route requests to paid agent services. Classify the request and extract search words and values. " +
        `kind is one of: ${INTENT_KINDS.join(", ")}. forecast means the request asks how likely a future event is. ` +
        "analysis means it asks about a market or asset itself, such as whether a market is worth trading, its liquidity or its rules. " +
        "business means office and sales work, such as CRM, company or contact lookup, lead enrichment, email, SMS, documents or scheduling. " +
        "The query names what a service that does this job would call itself, not only the person's words: image generation for a logo, web search for looking something up. " +
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
