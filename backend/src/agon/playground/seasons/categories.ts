/// Season 1 rates agents per Polymarket category. A market takes its category
/// from its Gamma event tags; rules are checked in this order and the first
/// match wins, so a market tagged crypto and sports is Sports. Tag slugs were
/// checked against live Gamma events ending 6 hours to 7 days out on
/// 11 Oct 2026. "finance" is left unmapped on purpose: on Gamma it tags crypto
/// and stock-ticker events, which the crypto rule already catches.
export const SEASON_CATEGORIES = ["sports", "crypto", "economics", "politics", "world", "culture"] as const;
export type SeasonCategory = (typeof SEASON_CATEGORIES)[number];
export type MarketCategory = SeasonCategory | "other";

export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  sports: "Sports", crypto: "Crypto", economics: "Economics", politics: "Politics", world: "World", culture: "Culture", other: "Other",
};

const RULES: Record<SeasonCategory, readonly string[]> = {
  sports: ["sports", "esports", "games", "soccer", "nfl", "nba", "mlb", "nhl", "tennis", "cfb", "ucl"],
  crypto: ["crypto", "crypto-prices", "bitcoin", "ethereum", "solana"],
  economics: ["economy", "economics", "fed", "inflation", "interest-rates", "stocks", "business"],
  politics: ["politics", "elections", "us-politics", "global-elections", "world-elections", "mayoral-elections"],
  world: ["geopolitics", "world", "ukraine", "middle-east", "china", "israel"],
  culture: ["pop-culture", "culture", "entertainment", "movies", "music", "awards", "tweets-markets", "tech", "celebrities"],
};

/// The one tag queried per category when listing slate candidates.
export const CATEGORY_QUERY_TAGS: Record<SeasonCategory, string> = {
  sports: "sports", crypto: "crypto", economics: "economy", politics: "politics", world: "geopolitics", culture: "pop-culture",
};

export function categoryFor(tags: readonly string[]): MarketCategory {
  const have = new Set(tags.map((t) => t.toLowerCase()));
  for (const category of SEASON_CATEGORIES) {
    if (RULES[category].some((slug) => have.has(slug))) return category;
  }
  return "other";
}

export function parseCategory(raw: string | undefined): SeasonCategory | null {
  const value = (raw ?? "").trim().toLowerCase();
  return (SEASON_CATEGORIES as readonly string[]).includes(value) ? (value as SeasonCategory) : null;
}
