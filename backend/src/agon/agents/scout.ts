import type { MarketSnapshot } from "./market-lookup.ts";

export type ScoutFlag = {
  code: "thin_liquidity" | "wide_spread" | "low_activity" | "closing_soon" | "extreme_price" | "vague_rules";
  detail: string;
};
export type ScoutReport = {
  verdict: "tradeable" | "watch" | "avoid";
  flags: ScoutFlag[];
  metrics: { yesPct: number; spreadCents: number; liquidityUsd: number; volume24hUsd: number; weekMovePts: number; hoursLeft: number };
};

const VAGUE = /(sole discretion|at the discretion|subjective|in the event of uncertainty)/i;
const CONSENSUS = /consensus of credible/i;
const OFFICIAL = /(primary resolution source|official (information|results|announcement|data)|according to the official)/i;

/// Vague when a judgment call decides it, or credible reporting is the only source named.
function vagueRules(description: string): boolean {
  if (description.trim().length < 40 || VAGUE.test(description)) return true;
  return CONSENSUS.test(description) && !OFFICIAL.test(description);
}
const round2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/// Scout's check is fixed rules over Polymarket's own numbers, so the same
/// market always gets the same verdict. Flags come in a stable order.
export function scoutReport(m: MarketSnapshot, now: Date): ScoutReport {
  const hoursLeft = round2((m.endAt.getTime() - now.getTime()) / 3_600_000);
  const metrics = {
    yesPct: m.yesBps / 100,
    spreadCents: round2(m.spread * 100),
    liquidityUsd: Math.round(m.liquidity),
    volume24hUsd: Math.round(m.volume24h),
    weekMovePts: round2(m.weekChange * 100),
    hoursLeft,
  };
  const flags: ScoutFlag[] = [];
  if (m.liquidity < 10_000) flags.push({ code: "thin_liquidity", detail: `Only ${usd(m.liquidity)} of liquidity; larger orders will move the price.` });
  if (m.spread > 0.03) flags.push({ code: "wide_spread", detail: `The spread is ${metrics.spreadCents} cents, so entering and leaving costs that much.` });
  if (m.volume24h < 500) flags.push({ code: "low_activity", detail: `Only ${usd(m.volume24h)} traded in the last 24 hours.` });
  if (hoursLeft < 24) flags.push({ code: "closing_soon", detail: `Closes in ${Math.max(0, Math.round(hoursLeft))} hours.` });
  if (m.yesBps < 300 || m.yesBps > 9_700) flags.push({ code: "extreme_price", detail: `Yes is at ${metrics.yesPct}%, close to settled either way; little upside left.` });
  if (vagueRules(m.description)) flags.push({ code: "vague_rules", detail: "The resolution rules leave room for judgment; read them before trading." });
  const thinAndWide = flags.some((f) => f.code === "thin_liquidity") && flags.some((f) => f.code === "wide_spread");
  const verdict = flags.length >= 3 || thinAndWide ? "avoid" : flags.length > 0 ? "watch" : "tradeable";
  return { verdict, flags, metrics };
}

export function scoutRulesPrompt(m: MarketSnapshot): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: "You read prediction market rules. In one plain sentence under 30 words, say what source decides this market and the main way it could resolve unexpectedly. No preamble.",
    userPrompt: `Question: ${m.question}\nRules: ${m.description.slice(0, 1_500)}`,
  };
}
