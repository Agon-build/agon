import type { ModelCaller } from "../playground/seasons/house-agents.ts";
import type { CatalogEntry } from "./catalog.ts";
import type { Intent } from "./intent.ts";

type Prop = { type?: string | string[]; description?: string; title?: string };
type Schema = { required?: string[]; properties?: Record<string, Prop> };

/// Converts one value to the schema's primitive type, or undefined if it cannot.
function coerce(value: unknown, prop: Prop): unknown {
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
    const v = coerce(proposed[key], prop);
    if (v !== undefined) input[key] = v;
  }
  // A schema with no required list still needs something: an empty fill asks about the first field.
  const required = schema.required && schema.required.length > 0 ? schema.required : Object.keys(input).length === 0 ? [Object.keys(props)[0]!] : [];
  const missing = required.filter((k) => input[k] === undefined);
  if (missing.length > 0) {
    const first = props[missing[0]!] ?? {};
    const hint = first.description ?? first.title;
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
