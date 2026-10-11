/// Prints the slate Season would pick right now from live Polymarket data.
/// Usage: node --experimental-strip-types scripts/season-slate-preview.ts
import { createGammaClient, selectSlate } from "../src/agon/playground/seasons/polymarket.ts";

const now = new Date();
const candidates = await createGammaClient().listCandidates(now);
const slate = selectSlate(candidates, now);
console.log(`candidates ${candidates.length}, slate ${slate.length}`);
for (const m of slate) {
  const crypto = m.tags.includes("crypto") || m.tags.includes("crypto-prices") ? "[crypto] " : "";
  console.log(`${m.endAt.toISOString()}  ${(m.yesPriceBps / 100).toFixed(1)}%  liq ${Math.round(m.liquidity)}  ${crypto}${m.question}`);
}
