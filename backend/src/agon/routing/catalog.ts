import type { Address } from "viem";

/// One hireable service, from any source, in the shape the router ranks.
export type CatalogEntry = {
  source: "agon" | "circle";
  reference: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  url: string;
  method: "GET" | "POST";
  inputSchema: Record<string, unknown> | null;
  price: bigint;
  /** Known from the catalog for outside services; for Agon listings it comes from the live 402 at quote time. */
  payTo: Address | null;
  network: "arc-testnet" | "arc";
  rating: { tier: "scored" | "verified" | "listed" | "unrated"; score: number | null };
  latencyMs: number | null;
  tags: string[];
};

/// What the router asks a source for: words from the request and the
/// categories that fit the task, in each source's own category names.
export type RouteQuery = { words: string[]; agonCategories: string[]; circleCategories: string[] };

export interface RouteSource {
  id: "agon" | "circle";
  search(q: RouteQuery): Promise<CatalogEntry[]>;
  status(): "ok" | "unavailable";
}

/// Words that say nothing about what a service does.
const FILLER = new Set([
  "the", "and", "for", "you", "your", "are", "can", "could", "would", "will", "what", "when", "where", "which", "who", "why", "how", "with", "this",
  "that", "these", "those", "from", "about", "into", "onto", "any", "some", "all", "get", "give", "need", "want", "please", "tell", "show", "find",
  "help", "there", "here", "hey", "hello", "thanks", "thank", "our", "out", "has", "have", "had", "was", "were", "been", "being", "its", "not",
  "but", "use", "using", "just", "like", "now", "today", "latest", "new", "two", "one", "also", "very", "more", "most", "much", "many", "than",
  "then", "them", "they", "their", "she", "him", "her", "his", "who", "whom", "does", "did", "doing", "done", "able", "via", "per", "agent", "agents", "team",
]);

/// Lower-case words of three or more letters that carry meaning, for matching.
export function wordsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !FILLER.has(w)))];
}

/// Short names and plain words people use for what a service calls something else.
const ALIASES: Record<string, string> = {
  eth: "ethereum", btc: "bitcoin", sol: "solana", picture: "image", pictures: "image", photo: "image", photos: "image",
  headline: "news", headlines: "news", tweet: "twitter", tweets: "twitter", stocks: "stock", shares: "stock",
};
const SUFFIXES = ["ations", "ation", "ings", "ing", "ies", "es", "ed", "er", "s", "e"];

/// One word reduced to a shared root, so "images" meets "image" and "generation" meets "generate".
export function stem(word: string): string {
  const w = ALIASES[word] ?? word;
  for (const suffix of SUFFIXES) if (w.endsWith(suffix) && w.length - suffix.length >= 3) return w.slice(0, -suffix.length);
  return w;
}

/// Two roots meet when they are equal, or when one starts the other and both are long enough to mean the same thing.
const meets = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));

/// How many of the query words appear in the entry's text or its address, in any word form.
export function matchCount(entry: Pick<CatalogEntry, "name" | "description" | "provider" | "tags"> & { url?: string }, words: string[]): number {
  const path = entry.url ? entry.url.replace(/^https?:\/\/[^/]+/, "") : "";
  const hay = wordsOf(`${entry.name} ${entry.description} ${entry.provider} ${entry.tags.join(" ")} ${path}`).map(stem);
  return words.map(stem).filter((w) => hay.some((h) => meets(h, w))).length;
}
