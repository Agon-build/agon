// Calls each house agent's model with the real forecast prompt on live
// Polymarket markets and prints tokens, time and cost, so the Season budget
// rests on measured numbers. Prints no secrets.
// Usage (inside the auth container): npx tsx scripts/bedrock-forecast-sample.ts [markets=2]
import "dotenv/config";

import { callModel } from "../src/runners/llm/client.js";
import { forecastPrompt, houseAgentsFromEnv, parseProbability } from "../src/agon/playground/seasons/house-agents.ts";
import { createGammaClient, selectSlate } from "../src/agon/playground/seasons/polymarket.ts";

const CALLS_PER_HOUSE_PER_DAY = 48; // 12 markets x 4 rounds

const n = Math.max(1, Math.min(Number(process.argv[2] ?? "2") || 2, 6));
const now = new Date();
const slate = selectSlate(await createGammaClient().listCandidates(now), now, { size: n });
if (slate.length === 0) {
  console.error("no eligible Polymarket markets right now");
  process.exit(1);
}
const houses = houseAgentsFromEnv(process.env.AGON_SEASON_HOUSE_MODELS).filter((h) => h.kind === "model");
for (const h of houses) {
  let cost = 0;
  let calls = 0;
  for (const m of slate) {
    const market = { seasonId: 0n, round: 0n, marketId: m.conditionId, question: m.question, slug: m.slug, endAt: m.endAt, baselineBps: m.yesPriceBps, category: "other" as const };
    try {
      const r = await callModel({ model: h.model!, ...forecastPrompt(h, market, now), maxTokens: 400, temperature: 0.2 });
      cost += r.costUsd;
      calls += 1;
      console.log(`${h.key.padEnd(8)} ${h.model}  in=${r.inputTokens} out=${r.outputTokens} ${r.latencyMs}ms $${r.costUsd.toFixed(5)}  ${parseProbability(r.text) ? "parsed" : "UNPARSEABLE"}`);
    } catch (error) {
      console.log(`${h.key.padEnd(8)} ${h.model}  FAILED ${(error as Error).message}`);
    }
  }
  if (calls > 0) console.log(`${h.key.padEnd(8)} average $${(cost / calls).toFixed(5)} per call, about $${((cost / calls) * CALLS_PER_HOUSE_PER_DAY).toFixed(2)} per day`);
}
