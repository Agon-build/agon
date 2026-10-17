import type { MarketSnapshot } from "./market-lookup.ts";

const FOOTBALL_TAGS = new Set([
  "soccer", "football", "epl", "premier-league", "ucl", "champions-league", "la-liga", "serie-a", "bundesliga",
  "ligue-1", "mls", "fifa-world-cup", "world-cup", "europa-league", "uefa",
]);
const OTHER_SPORT_TAGS = new Set(["nba", "nfl", "nhl", "mlb", "ufc", "tennis", "golf", "f1", "cricket"]);
const OTHER_SPORTS = /\b(nba|nfl|nhl|mlb|ufc|tennis|golf|f1|formula 1|cricket|super bowl)\b/i;
const FOOTBALL_WORDS = /\b(fc|cf|real madrid|barcelona|arsenal|chelsea|liverpool|juventus|bayern|psg|premier league|la liga|serie a|bundesliga|ligue 1|champions league|world cup|europa league)\b/i;

/// Football (soccer) only: event tags first, then the question's wording.
export function isFootballMarket(m: Pick<MarketSnapshot, "question" | "tags">): boolean {
  if (m.tags.some((t) => FOOTBALL_TAGS.has(t))) return true;
  if (m.tags.some((t) => OTHER_SPORT_TAGS.has(t)) || OTHER_SPORTS.test(m.question)) return false;
  return FOOTBALL_WORDS.test(m.question);
}

/// Pitch's reasoning step. The market numbers are fetched, not guessed; the
/// model only weighs football specifics against the crowd price.
export function pitchPrompt(m: MarketSnapshot, now: Date): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt:
      "You are Pitch, a football (soccer) forecasting agent. Estimate the probability that the market resolves Yes. " +
      "Reason like a football analyst: in a single match a draw is common (often 25 to 30 percent), so a team to win needs more than being the better side; " +
      "weigh home advantage, recent form, injuries and suspensions you know of, fixture congestion and, for season-long markets, the points gap and games left. " +
      "Start from the crowd price and move away only for a concrete football reason. " +
      'Answer with JSON only: {"probability": <number between 0 and 1>, "reasons": [<three short reasons>]}.',
    userPrompt: [
      `Question: ${m.question}`,
      `Market closes: ${m.endAt.toISOString()}`,
      `Current time: ${now.toISOString()}`,
      `Crowd price for Yes: ${(m.yesBps / 100).toFixed(1)}%`,
      `Move over the last week: ${(m.weekChange * 100).toFixed(1)} points`,
      `Rules: ${m.description.slice(0, 600)}`,
    ].join("\n"),
  };
}
