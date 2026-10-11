/// Prints the slate Season would pick right now from live Polymarket data,
/// with each market's category and the count per category.
/// Usage: node --experimental-strip-types scripts/season-slate-preview.ts
import { CATEGORY_LABELS, categoryFor, type MarketCategory } from "../src/agon/playground/seasons/categories.ts";
import { createGammaClient, selectSlate } from "../src/agon/playground/seasons/polymarket.ts";

const now = new Date();
const candidates = await createGammaClient().listCandidates(now);
const slate = selectSlate(candidates, now);
console.log(`candidates ${candidates.length}, slate ${slate.length}`);
const counts = new Map<MarketCategory, number>();
for (const m of slate) {
  const category = categoryFor(m.tags);
  counts.set(category, (counts.get(category) ?? 0) + 1);
  console.log(`${m.endAt.toISOString()}  ${(m.yesPriceBps / 100).toFixed(1)}%  liq ${Math.round(m.liquidity)}  [${CATEGORY_LABELS[category]}] ${m.question}`);
}
console.log([...counts].map(([c, n]) => `${CATEGORY_LABELS[c]} ${n}`).join(", "));
