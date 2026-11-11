import type { CatalogEntry } from "./catalog.ts";
import type { IntentKind } from "./intent.ts";

/// The categories Hire opens on, and where each one looks: Agon's listing
/// categories and Circle's own category names. Circle's names are the ones its
/// live discovery catalog on Arc mainnet used on 2026-11-05 (2,187 services):
/// SOCIAL_INTELLIGENCE 985, WEB_SEARCH_RESEARCH 539, DATA_ENRICHMENT 223,
/// INFRASTRUCTURE 162, FINANCIAL_ANALYSIS 159, COMMUNICATION 66,
/// MAPS_WEATHER 36, INFERENCE 17. Where a Circle category is shared, words
/// decide which services belong (prediction markets sit inside finance).

export type HireCategoryId = "prediction" | "research" | "market_data" | "social" | "creative" | "developer" | "business";

export type HireCategory = {
  id: HireCategoryId;
  label: string;
  kinds: readonly IntentKind[];
  agonCategories: readonly string[];
  circleCategories: readonly string[];
  /** When set, a Circle service must also match these words to belong here. */
  circleWords: RegExp | null;
};

export const HIRE_CATEGORIES: readonly HireCategory[] = [
  { id: "prediction", label: "Prediction markets", kinds: ["forecast", "analysis"], agonCategories: ["3", "4", "8"], circleCategories: ["FINANCIAL_ANALYSIS"], circleWords: /polymarket|kalshi|prediction market|\bodds\b/i },
  { id: "research", label: "Research and web search", kinds: ["research"], agonCategories: ["1"], circleCategories: ["WEB_SEARCH_RESEARCH", "MAPS_WEATHER"], circleWords: null },
  { id: "market_data", label: "Market and crypto data", kinds: ["market_data"], agonCategories: ["2"], circleCategories: ["FINANCIAL_ANALYSIS"], circleWords: null },
  { id: "social", label: "News and social", kinds: ["social"], agonCategories: ["1"], circleCategories: ["SOCIAL_INTELLIGENCE"], circleWords: null },
  { id: "creative", label: "Images and creative", kinds: ["content"], agonCategories: ["6"], circleCategories: ["INFERENCE"], circleWords: /image|video|\bart\b|design|logo/i },
  { id: "developer", label: "Developer tools and infrastructure", kinds: ["infrastructure"], agonCategories: ["7"], circleCategories: ["INFRASTRUCTURE", "INFERENCE"], circleWords: null },
  { id: "business", label: "Business and office tools", kinds: ["business"], agonCategories: ["1"], circleCategories: ["DATA_ENRICHMENT", "COMMUNICATION"], circleWords: null },
];

const BY_ID = new Map(HIRE_CATEGORIES.map((c) => [c.id, c]));

export function hireCategory(id: HireCategoryId): HireCategory {
  return BY_ID.get(id)!;
}

/// The category a kind of request belongs to. A request Agon cannot place goes to research.
export function categoryForKind(kind: IntentKind): HireCategoryId {
  return HIRE_CATEGORIES.find((c) => c.kinds.includes(kind))?.id ?? "research";
}

/// Every Hire category a service belongs to. An Agon listing category can sit in several.
export function categoriesOf(e: CatalogEntry): HireCategoryId[] {
  return HIRE_CATEGORIES.filter((c) => (e.source === "agon" ? c.agonCategories.includes(e.category) : circleFits(c.id, e))).map((c) => c.id);
}

/// Whether an outside service belongs in a category: its Circle category is listed,
/// and, where the category is shared, its name or description matches the words.
export function circleFits(id: HireCategoryId, e: CatalogEntry): boolean {
  const c = hireCategory(id);
  if (!c.circleCategories.includes(e.category)) return false;
  return c.circleWords ? c.circleWords.test(`${e.name} ${e.description}`) : true;
}
