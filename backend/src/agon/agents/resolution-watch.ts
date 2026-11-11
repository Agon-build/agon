import { marketRefFrom } from "./market-lookup.ts";

/// Where a watched market stands in Polymarket's settlement, read from Gamma.
/// Checked 2026-10-22 (docs.polymarket.com/developers/resolution/UMA and a Gamma
/// probe): a proposal opens a 2-hour challenge window; a dispute moves it to a
/// second proposal and then a vote taking days; ended markets carry
/// umaResolutionStatus ("proposed", "disputed", "resolved"). Gamma does not say
/// which outcome was proposed, so alerts give the price, never a proposal value.
export type WatchStatus = "open" | "proposed" | "disputed" | "settled";
/// `outcome` and `yesBps` speak of the market's first outcome: "yes" means the first outcome won.
/// `labels` names the two outcomes when they are not Yes and No (teams, Over and Under).
export type WatchState = { status: WatchStatus; outcome: "yes" | "no" | "split" | null; yesBps: number | null; rules: string; labels?: [string, string] };
export type WatchAlertKind = "settlement_started" | "challenged" | "settled" | "rules_changed";
export type WatchAlert = { kind: WatchAlertKind; title: string; body: string };

export const MAX_WATCH_MARKETS = 10;
const RULES_CHARS = 8_000;

function prices(raw: unknown): number[] | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(Number) : null;
  } catch {
    return null;
  }
}

/// The two outcome names of a Gamma record, or null when it does not carry exactly two.
function names(raw: unknown): [string, string] | null {
  try {
    const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every((x) => typeof x === "string" && x.trim()) ? [String(parsed[0]).trim(), String(parsed[1]).trim()] : null;
  } catch {
    return null;
  }
}

export function stateFromGamma(m: Record<string, unknown>): WatchState {
  const p = prices(m.outcomePrices);
  const yesBps = p && Number.isFinite(p[0]) ? Math.round(p[0]! * 10_000) : null;
  const uma = typeof m.umaResolutionStatus === "string" ? m.umaResolutionStatus : "";
  const rules = (typeof m.description === "string" ? m.description : "").slice(0, RULES_CHARS);
  const named = names(m.outcomes);
  const labels = named && !(named[0] === "Yes" && named[1] === "No") ? { labels: named } : {};
  if (m.closed === true && uma === "resolved" && p) {
    const outcome = p[0] === 1 && p[1] === 0 ? "yes" : p[0] === 0 && p[1] === 1 ? "no" : p[0] === 0.5 && p[1] === 0.5 ? "split" : null;
    if (outcome) return { status: "settled", outcome, yesBps, rules, ...labels };
  }
  const status: WatchStatus = uma === "disputed" ? "disputed" : uma === "proposed" ? "proposed" : "open";
  return { status, outcome: null, yesBps, rules, ...labels };
}

const pct = (bps: number | null) => (bps === null ? "unknown" : `${(bps / 100).toFixed(1)}%`);
const OUTCOME = { yes: "Yes", no: "No", split: "50-50 (each share pays half)" } as const;

/// The alerts a change from one reading to the next raises. The first reading
/// of a watch is its baseline and raises nothing.
export function alertsBetween(question: string, prev: WatchState | null, next: WatchState): WatchAlert[] {
  if (!prev) return [];
  const [first, second] = next.labels ?? [OUTCOME.yes, OUTCOME.no];
  const out: WatchAlert[] = [];
  if (next.rules !== prev.rules && next.rules) {
    const added = next.rules.startsWith(prev.rules) ? next.rules.slice(prev.rules.length).trim() : "";
    out.push({
      kind: "rules_changed", title: `Rules changed: ${question}`,
      body: added ? `Added to the rules: "${added.slice(0, 600)}"` : `The rules text was rewritten. Read the new rules before settlement: "${next.rules.slice(0, 600)}"`,
    });
  }
  if (next.status !== prev.status) {
    if (next.status === "proposed") {
      out.push({
        kind: "settlement_started", title: `Settlement started: ${question}`,
        body: `${prev.status === "disputed" ? "A new proposal is in after a dispute." : "An outcome has been proposed."} Anyone can challenge it for about 2 hours after the proposal; with no challenge it becomes final. ${first} is trading at ${pct(next.yesBps)}.`,
      });
    } else if (next.status === "disputed") {
      out.push({
        kind: "challenged", title: `Settlement challenged: ${question}`,
        body: "The proposed outcome was disputed. A second proposal follows; if that is disputed too, the outcome goes to a vote and settlement takes 4 to 6 days.",
      });
    } else if (next.status === "settled" && next.outcome) {
      const result = next.outcome === "yes" ? first : next.outcome === "no" ? second : OUTCOME.split;
      out.push({ kind: "settled", title: `Settled ${result}: ${question}`, body: `The market settled ${result}. This watch has ended for this market.` });
    }
  }
  return out;
}

/// Up to 10 market references from one text field, one per line or comma separated.
export function parseMarketRefs(input: string): string[] | null {
  const parts = input.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const refs: string[] = [];
  for (const part of parts) {
    const ref = marketRefFrom(part);
    if (!ref) return null;
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs.length <= MAX_WATCH_MARKETS ? refs : null;
}
