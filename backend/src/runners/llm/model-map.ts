/// LLM_MODEL_MAP renames model ids before a call goes out, so a provider outage is
/// one env change, not a code change. Example while AWS Bedrock is unavailable:
/// {"global.anthropic.claude-sonnet-5-5":"claude-sonnet-5-5","global.anthropic.claude-haiku-5-5":"claude-haiku-5-5"}
/// A bare claude-* id goes to the Anthropic API, a vendor/model slug to OpenRouter.

export type ModelMap = ReadonlyMap<string, string>;

/// Never throws: a malformed value is reported and ignored, so calls keep their own ids.
export function parseModelMap(raw: string | undefined): { map: ModelMap; problem: string | null } {
  if (!raw?.trim()) return { map: new Map(), problem: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { map: new Map(), problem: "LLM_MODEL_MAP must be JSON" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { map: new Map(), problem: "LLM_MODEL_MAP must be a JSON object of model id to model id" };
  const map = new Map<string, string>();
  for (const [from, to] of Object.entries(json as Record<string, unknown>)) {
    if (typeof to !== "string" || !to.trim() || !from.trim()) return { map: new Map(), problem: `LLM_MODEL_MAP entry ${from} must map to a model id` };
    map.set(from.trim(), to.trim());
  }
  return { map, problem: null };
}

/// One step only: a mapped id is never mapped again, so the map cannot loop.
export function remapModel(map: ModelMap, model: string): string {
  return map.get(model) ?? model;
}

let cached: ModelMap | null = null;
/// The process's map, read once from LLM_MODEL_MAP.
export function envModelMap(): ModelMap {
  if (cached) return cached;
  const { map, problem } = parseModelMap(process.env.LLM_MODEL_MAP);
  if (problem) console.warn(`llm: ${problem}; model ids are used as they are`);
  else if (map.size > 0) console.log(`llm: LLM_MODEL_MAP renames ${map.size} model ids`);
  cached = map;
  return map;
}
