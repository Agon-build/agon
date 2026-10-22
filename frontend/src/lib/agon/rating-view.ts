import { AGON_CATEGORIES } from "./catalog.ts";
import type { ScorePart, ScoreWindow } from "./scores-api.ts";

export const WINDOW_CHOICES: readonly { id: ScoreWindow; label: string }[] = [
  { id: "all", label: "All time" },
  { id: "30d", label: "30 days" },
  { id: "7d", label: "7 days" },
  { id: "24h", label: "24 hours" },
];

export function categoryLabel(categoryId: string): string {
  return AGON_CATEGORIES.find((c) => c.id === categoryId)?.label ?? "General";
}

/// "Agon score 78 · Analysis #3", or "Not rated yet".
export function scoreLine(s: { score: number | null; rank: number | null; categoryLabel: string } | null): string {
  if (!s || s.score === null) return "Not rated yet";
  return `Agon score ${Math.round(s.score)} · ${s.categoryLabel}${s.rank ? ` #${s.rank}` : ""}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/// What a score rests on: "12 tests · 40 forecasts · 5 paid jobs", leaving out empty parts.
export function evidenceLine(counts: { tests: number; forecasts: number; paid: number }): string {
  const parts = [
    counts.tests > 0 ? plural(counts.tests, "test", "tests") : null,
    counts.forecasts > 0 ? plural(counts.forecasts, "forecast", "forecasts") : null,
    counts.paid > 0 ? plural(counts.paid, "paid job", "paid jobs") : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No results yet";
}

export function partStatusLabel(p: ScorePart): string {
  if (p.status === "coming_next") return "Coming next";
  if (p.status === "no_test") return "No public test for this category yet";
  if (p.value === null) return "Not enough results";
  return String(Math.round(p.value));
}

const trim = (n: number) => String(Math.round(Math.abs(n) * 10) / 10);

/// Change against the previous window of the same length.
export function changeLabel(change: number | null, isNew: boolean): string {
  if (isNew) return "new";
  if (change === null || change === 0) return "";
  return change > 0 ? `up ${trim(change)}` : `down ${trim(change)}`;
}

/// The card line for each agent that has a snapshot.
export function ratingByAgentId(items: { agentId: string; categoryId: string; score: number | null; rank: number | null }[]): Map<string, string> {
  return new Map(items.map((i) => [i.agentId, scoreLine({ score: i.score, rank: i.rank, categoryLabel: categoryLabel(i.categoryId) })]));
}

/// The public Playground test for each testable category (spec 20.4). Example inputs live in Docs.
export const TEST_TASKS: Readonly<Record<string, { title: string; summary: string }>> = {
  "1": { title: "Live chain fact", summary: "Report Arc's chain id and a recent block with its source. The block must be within 200 of Agon's reading." },
  "3": { title: "Evidence under pressure", summary: "Separate observed facts from claims and refuse an instruction planted in the evidence." },
  "5": { title: "Transaction safety", summary: "Allow or reject each proposed transaction against the allowed destinations and actions." },
  "7": { title: "Selector guard", summary: "Decode several calldata cases and classify each one." },
  "8": { title: "Manifest anchor", summary: "Hash each safe service file exactly and flag the unsafe ones." },
};

/// Tests chosen by the input a Verification agent declares (backend tests/service.ts testFamilyFor).
const FAMILY_TASKS: Readonly<Record<string, { title: string; summary: string }>> = {
  "market-rules": { title: "Market rules", summary: "Read a real market's resolution rules: catch the trap that was argued, quote the rules word for word, and rate the dispute risk fairly." },
  "settlement-alerts": { title: "Settlement alerts", summary: "Follow a market through settlement, check by check, and raise exactly the right alerts at the right step." },
};
const TASK_IDS: Readonly<Record<string, string>> = { "arc-live-fact": "1", "evidence-under-pressure": "3", "transaction-safety": "5", "selector-guard": "7", "manifest-anchor": "8" };

function familyFor(categoryId: string, manifestBody: unknown): string | null {
  if (categoryId !== "8") return null;
  const props = (manifestBody as { invocation?: { requestSchema?: { properties?: unknown } } } | null | undefined)?.invocation?.requestSchema?.properties;
  if (!props || typeof props !== "object") return null;
  return Object.hasOwn(props, "markets") ? "settlement-alerts" : Object.hasOwn(props, "market") ? "market-rules" : null;
}

export function testInfo(categoryId: string, manifestBody?: unknown): { title: string; summary: string } | null {
  const family = familyFor(categoryId, manifestBody);
  return (family ? FAMILY_TASKS[family] : null) ?? TEST_TASKS[categoryId] ?? null;
}

/// A past run is named by the task it actually ran.
export function runTestTitle(run: { taskId: string; categoryId: string }): string | null {
  return FAMILY_TASKS[run.taskId]?.title ?? TEST_TASKS[TASK_IDS[run.taskId] ?? ""]?.title ?? null;
}

/// What to show when a public test cannot run.
export function runErrorText(error: unknown): string {
  const e = error as { status?: number; serverMessage?: string | null };
  if (e?.status === 401) return "Sign in to test this agent.";
  if (typeof e?.serverMessage === "string" && e.serverMessage) return e.serverMessage;
  return "The test could not run. Try again in a moment.";
}

/// One page of a list, with the page clamped to the last one when the list shrinks.
export function pageSlice<T>(items: readonly T[], page: number, size: number): { rows: T[]; page: number; pages: number; label: string } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  const rows = items.slice(at * size, at * size + size);
  const label = rows.length ? `${at * size + 1}-${at * size + rows.length} of ${items.length}` : "";
  return { rows, page: at, pages, label };
}
