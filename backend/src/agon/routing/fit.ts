import type { ModelCaller } from "../playground/seasons/house-agents.ts";
import { matchCount, wordsOf, type CatalogEntry } from "./catalog.ts";
import { formatUsdc } from "../payments/bargain.ts";
import { KIND_SOURCES, type Intent } from "./intent.ts";

const SHORTLIST = 20;

/// The services worth showing the model: every source and category, scored by
/// the words they share with the request. A category that fits Agon's reading
/// of the request counts for half a word, so it orders equals but never blocks.
export function shortlist(entries: CatalogEntry[], intent: Intent, text: string): CatalogEntry[] {
  const words = wordsOf(`${intent.query} ${text}`);
  const fits = KIND_SOURCES[intent.kind];
  return entries
    .map((e, i) => {
      const hits = matchCount(e, words);
      const inKind = (e.source === "agon" ? fits.agonCategories : fits.circleCategories).includes(e.category) ? 0.5 : 0;
      return { e, i, hits, score: hits + inKind };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, SHORTLIST)
    .map((x) => x.e);
}

/// The model reads the request and the shortlist and names the services that
/// can do the job, best first. Code keeps only numbers on the list. Null means
/// the answer could not be read, so the word scores decide instead.
export async function judgeFit(text: string, list: CatalogEntry[], callModel: ModelCaller, model: string): Promise<string[] | null> {
  if (list.length === 0) return [];
  const lines = list.map((e, i) => `${i + 1}. ${e.provider}: ${e.description.replace(/\s+/g, " ").slice(0, 220)} (${formatUsdc(e.price)} USDC, ${e.method} ${e.url.replace(/^https:\/\//, "").slice(0, 80)})`);
  try {
    const reply = await callModel({
      model,
      systemPrompt:
        "You match a person's request to paid services. A service fits only if calling it once directly does what the person asked, " +
        "not if it is merely about the same topic. Answer with JSON only: {\"fits\": [<numbers of the services that fit, best first>]}. " +
        "Answer {\"fits\": []} when none of them does the job.",
      userPrompt: `Request: ${text.slice(0, 600)}\n\nServices:\n${lines.join("\n")}`,
      // Room to answer: the classifier model can spend over 100 tokens before the JSON.
      maxTokens: 600,
      temperature: 0,
    });
    const json = reply.text.slice(reply.text.indexOf("{"), reply.text.lastIndexOf("}") + 1);
    const fits = (JSON.parse(json) as { fits?: unknown }).fits;
    if (!Array.isArray(fits)) return null;
    const picked: string[] = [];
    for (const n of fits) {
      const e = Number.isInteger(n) ? list[(n as number) - 1] : undefined;
      if (e && !picked.includes(e.reference)) picked.push(e.reference);
    }
    return picked;
  } catch {
    return null;
  }
}
