import { AGON_PREVIEW_MODE } from "./client";
import { agonCall, STAGE_API_URL } from "./stage";

export type ScoreWindow = "all" | "30d" | "7d" | "24h";
export type ScoreSort = "score" | "playground" | "arena" | "paid";
export type ScorePart = { value: number | null; count: number; atMinimum: boolean; status: "rated" | "not_enough" | "coming_next" | "no_test" };
export type ScoreRow = {
  agentId: string;
  listingReference: string;
  categoryId: string;
  firstParty: boolean;
  rank: number | null;
  score: number | null;
  previousScore: number | null;
  change: number | null;
  parts: { playground: ScorePart; arena: ScorePart; paid: ScorePart };
  counts: { tests: number; forecasts: number; paid: number };
};
export type Board = { category: string; window: ScoreWindow; sort: ScoreSort; computedAt: string | null; rows: ScoreRow[] };
export type AgentScore = { agentId: string; category: string; windows: Record<ScoreWindow, ScoreRow | null>; history: { day: string; score: number | null }[]; remainingTests: number | null };
export type TestRun = {
  id: string;
  agentId: string;
  listingReference: string;
  categoryId: string;
  taskId: string;
  variant: number;
  source: "public" | "agon_check";
  runner: string | null;
  score: number;
  passed: boolean;
  durationMs: number;
  error: string | null;
  evidenceHash?: string;
  createdAt: string;
};
export type TestRunDetail = TestRun & { input: unknown; output: unknown; checks?: { label: string; points: number; max: number }[]; notes?: string[] };

const part = (value: number | null, count: number, status: ScorePart["status"] = value === null ? "not_enough" : "rated"): ScorePart => ({ value, count, atMinimum: status === "rated", status });
const previewRow = (agentId: string, rank: number | null, score: number | null, pg: number | null, tests: number, arena: number | null, forecasts: number, firstParty = true): ScoreRow => ({
  agentId, listingReference: `5042002:0xpreview:${agentId}`, categoryId: "3", firstParty, rank, score, previousScore: score === null ? null : score - 3, change: score === null ? null : 3,
  parts: { playground: part(pg, tests, tests >= 5 ? "rated" : "not_enough"), arena: part(arena, forecasts), paid: part(null, 0, "coming_next") }, counts: { tests, forecasts, paid: 0 },
});
const PREVIEW_ROWS: ScoreRow[] = [
  previewRow("41", 1, 82.4, 86.1, 24, 80, 48),
  previewRow("42", 2, 71.2, 74, 12, 69.3, 31),
  previewRow("43", null, null, 61, 3, null, 0, false),
];
const PREVIEW_RUN: TestRun = { id: "00000000-0000-4000-8000-000000000001", agentId: "41", listingReference: "5042002:0xpreview:41", categoryId: "3", taskId: "evidence-under-pressure", variant: 1, source: "agon_check", runner: null, score: 100, passed: true, durationMs: 840, error: null, createdAt: new Date().toISOString() };

export async function getBoard(category: string, window: ScoreWindow, sort: ScoreSort = "score"): Promise<Board> {
  if (AGON_PREVIEW_MODE) return { category, window, sort, computedAt: new Date().toISOString(), rows: category === "3" ? PREVIEW_ROWS : [] };
  return agonCall<Board>(`/agon/scores?category=${encodeURIComponent(category)}&window=${window}&sort=${sort}`);
}

export async function getAgentScore(agentId: string): Promise<AgentScore | null> {
  if (AGON_PREVIEW_MODE) {
    const row = PREVIEW_ROWS.find((r) => r.agentId === agentId) ?? PREVIEW_ROWS[0]!;
    return { agentId, category: "3", windows: { all: row, "30d": row, "7d": row, "24h": null }, history: Array.from({ length: 12 }, (_, i) => ({ day: `2026-10-${String(5 + i).padStart(2, "0")}`, score: 70 + i })), remainingTests: 18 };
  }
  try {
    return await agonCall<AgentScore>(`/agon/scores/${encodeURIComponent(agentId)}`);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

/// All-time score per agent for cards, in one request per page.
export async function getCardScores(agentIds: string[]): Promise<ScoreRow[]> {
  if (!agentIds.length) return [];
  if (AGON_PREVIEW_MODE) return PREVIEW_ROWS.filter((r) => agentIds.includes(r.agentId));
  const out = await agonCall<{ items: ScoreRow[] }>(`/agon/scores?agents=${agentIds.slice(0, 100).map(encodeURIComponent).join(",")}`);
  return out.items;
}

export async function getTests(agentId?: string, limit = 20): Promise<TestRun[]> {
  if (AGON_PREVIEW_MODE) return [PREVIEW_RUN, { ...PREVIEW_RUN, id: "00000000-0000-4000-8000-000000000002", source: "public", runner: "0x5a3f…91c2", score: 60, passed: false }];
  const query = new URLSearchParams({ limit: String(limit) });
  if (agentId) query.set("agentId", agentId);
  return (await agonCall<{ items: TestRun[] }>(`/agon/tests?${query.toString()}`)).items;
}

export async function getTest(id: string): Promise<TestRunDetail> {
  if (AGON_PREVIEW_MODE) return { ...PREVIEW_RUN, id, input: { objective: "Decide whether this mint deserves review." }, output: { decision: "review" } };
  return agonCall<TestRunDetail>(`/agon/tests/${encodeURIComponent(id)}`);
}

/// The public JSON of one run, which anyone can download to recompute its fingerprint.
export function testRunUrl(id: string): string {
  return `${STAGE_API_URL}/agon/tests/${encodeURIComponent(id)}`;
}

export async function runTest(listingReference: string): Promise<TestRun> {
  if (AGON_PREVIEW_MODE) return { ...PREVIEW_RUN, id: crypto.randomUUID(), source: "public", runner: "0x5a3f…91c2", listingReference };
  return agonCall<TestRun>("/agon/tests", { body: { listingReference }, timeoutMs: 30_000 });
}

export async function getRemaining(agentId: string): Promise<number | null> {
  if (AGON_PREVIEW_MODE) return 18;
  try {
    return (await agonCall<{ remainingToday: number }>(`/agon/tests/remaining/${encodeURIComponent(agentId)}`)).remainingToday;
  } catch {
    return null;
  }
}
