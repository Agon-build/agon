import type { ModelCaller } from "../playground/seasons/house-agents.ts";
import { coinIdsForQuestion } from "../router/data-services.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { Intent } from "./intent.ts";

type Prop = { type?: string | string[]; description?: string; title?: string; enum?: unknown[]; default?: unknown };
type Schema = { required?: string[]; properties?: Record<string, Prop> };

/// A DefiLlama-style price service: it says in its listing that coins are named like coingecko:bitcoin.
const DEFILLAMA_IDS = /coingecko:[a-z]/i;
const COIN_FIELD = /^(coins?|ids?|tokens?)$/i;
const IDS = /^[a-z0-9-]+:[^,\s]+(,[a-z0-9-]+:[^,\s]+)*$/i;
const COINS_QUESTION = "Which coins? Name them, such as BTC, ETH or SOL, or give DefiLlama ids like coingecko:pepe.";

/// The coins field of a price service, filled by code: the coins the request names, in DefiLlama's
/// form. A value the model gave is kept only when it is already in that form. Null: not such a field.
function coinField(entry: CatalogEntry, key: string, request: string, proposed: unknown): { value: string | undefined } | null {
  if (!COIN_FIELD.test(key) || !DEFILLAMA_IDS.test(entry.description)) return null;
  const named = coinIdsForQuestion(request);
  if (named.length > 0) return { value: named.join(",") };
  const given = typeof proposed === "string" ? proposed.replace(/\s+/g, "") : "";
  return { value: IDS.test(given) ? given : undefined };
}

/// A field limited to a list of options: its default, else the first option. The
/// catalog price is read for that request, so a model never picks a dearer option.
function fixedChoice(prop: Prop): unknown {
  if (!Array.isArray(prop.enum) || prop.enum.length === 0) return undefined;
  return prop.default !== undefined && prop.enum.includes(prop.default) ? prop.default : prop.enum[0];
}

/// Converts one value to the schema's primitive type, or undefined if it cannot.
/// A field with options keeps only one of them.
function coerce(value: unknown, prop: Prop): unknown {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum.includes(value) ? value : undefined;
  const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (value === null || value === undefined || value === "") return undefined;
  if (type === "integer" || type === "number") {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(n) || (type === "integer" && !Number.isInteger(n))) return undefined;
    return n;
  }
  if (type === "boolean") return value === true || value === "true" ? true : value === false || value === "false" ? false : undefined;
  if (type === "string" || type === undefined) return typeof value === "string" ? value.slice(0, 2_000) : typeof value === "number" ? String(value) : undefined;
  return value;
}

/// Fills the chosen service's input from the request. The model proposes values;
/// code keeps only the schema's own fields, checks their types and turns any
/// missing required field into one plain question.
export async function fillInput(
  entry: CatalogEntry,
  request: string,
  intent: Intent,
  callModel: ModelCaller,
  model: string,
): Promise<{ ok: true; input: Record<string, unknown> } | { ok: false; missing: string[]; question: string; partial: Record<string, unknown> }> {
  const schema = entry.inputSchema as Schema | null;
  const props = schema?.properties ?? {};
  // An outside service that declares no inputs gets none; an Agon agent takes the request as its task.
  if (!schema || Object.keys(props).length === 0) return { ok: true, input: entry.source === "agon" ? (entry.method === "GET" ? { q: request } : { query: request }) : {} };
  let proposed: Record<string, unknown> = {};
  try {
    const reply = await callModel({
      model,
      systemPrompt: "Fill the JSON input for a paid API from the user's request. Use only the listed fields. Leave a field out if the request does not give it. Answer with one JSON object only.",
      userPrompt: [`Request: ${request.slice(0, 600)}`, `Known values: ${JSON.stringify(intent.values)}`, `Fields: ${JSON.stringify(props).slice(0, 3_000)}`].join("\n"),
      maxTokens: 400,
      temperature: 0,
    });
    const json = reply.text.slice(reply.text.indexOf("{"), reply.text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) proposed = parsed as Record<string, unknown>;
  } catch {
    proposed = {};
  }
  const input: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    // Some services reject a request without an option they list as optional (BlockRun's image model, 2026-11-06).
    const coins = coinField(entry, key, request, proposed[key]);
    const v = coins ? coins.value : fixedChoice(prop) ?? coerce(proposed[key], prop);
    if (v !== undefined) input[key] = v;
  }
  // A schema with no required list still needs something: an empty fill (options aside) asks about the first open field.
  const open = Object.keys(props).filter((k) => fixedChoice(props[k]!) === undefined);
  const required = schema.required && schema.required.length > 0
    ? schema.required
    : open.length > 0 && open.every((k) => input[k] === undefined) ? [open[0]!] : [];
  const missing = required.filter((k) => input[k] === undefined);
  if (missing.length > 0) {
    const first = props[missing[0]!] ?? {};
    const hint = first.description ?? first.title;
    if (coinField(entry, missing[0]!, request, undefined)) return { ok: false, missing, question: COINS_QUESTION, partial: input };
    return { ok: false, missing, question: `What should I use for ${missing[0]}${hint ? ` (${hint})` : ""}?`, partial: input };
  }
  return { ok: true, input };
}

/// The person's own answers: only the service's fields, typed by its schema.
/// With no schema, short plain values under simple names, at most ten.
export function cleanGiven(entry: CatalogEntry, given: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!given) return {};
  const props = (entry.inputSchema as Schema | null)?.properties ?? {};
  const out: Record<string, unknown> = {};
  if (Object.keys(props).length > 0) {
    for (const [key, prop] of Object.entries(props)) {
      const v = coerce(given[key], prop);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  for (const [key, v] of Object.entries(given).slice(0, 10)) {
    if (/^[A-Za-z_][\w-]{0,40}$/.test(key) && typeof v === "string" && v.length <= 2_000) out[key] = v;
  }
  return out;
}
