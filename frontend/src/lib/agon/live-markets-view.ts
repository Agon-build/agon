import type { LiveMarket } from "./stage-types.ts";

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`);

/// One market trading on Polymarket now, in the words Hire shows.
export function liveMarketRow(m: LiveMarket): { question: string; yes: string; traded: string } {
  return { question: m.question, yes: `${Math.round(m.yesBps / 100)}%`, traded: `${money(m.volume24h)} traded in 24 hours` };
}

/// What Hire asks when a live market is pressed: the exact market, by its link.
export function checkRequest(m: LiveMarket): string {
  return `Is this market worth trading? ${m.url}`;
}

export function liveReadLine(readAt: string): string | null {
  const d = new Date(readAt);
  return Number.isNaN(d.getTime()) ? null : `Read from Polymarket at ${d.toISOString().slice(11, 19)} UTC`;
}
