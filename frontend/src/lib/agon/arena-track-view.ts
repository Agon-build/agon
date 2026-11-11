/// What the Research page shows, as plain values. Components render these and decide nothing.

export type TrackSeason = { seasonId: string; network: string; explorer: string; commitsAddress: string; startsAt: string; endsAt: string; roundHours: number };
export type TrackRow = {
  agentId: string; listingReference: string; name: string; firstParty: boolean; mean: number | null; scored: number;
  medianMs: number | null; ranked: boolean; rank: number | null; note: "over_price" | "cannot_take" | null;
};
export type TrackRoundSummary = { round: number; state: "open" | "sent" | "committing" | "committed" | "skipped"; openedAt: string; root?: string | null; count?: number | null; tx?: string | null; committedAt?: string | null };
export type TrackBoard = { id: string; label: string; categoryId: string; open: boolean; season: TrackSeason | null; ranked: boolean; rows: TrackRow[]; rounds: TrackRoundSummary[] };
export type TrackTask = { taskId: string; family: string; question: string; valueType: string; truth: string; void: boolean };
export type TrackAnswer = { taskId: string; agentId: string; outcome: "delivered" | "refused" | "failed" | "timeout" | "void"; score: number | null; durationMs: number | null; excerpt: string | null };
export type TrackRound = TrackRoundSummary & { entrants: { agentId: string; name: string; firstParty: boolean; status: "entered" | "over_price" | "cannot_take" }[]; tasks?: TrackTask[]; answers?: TrackAnswer[] };

/// An agent is ranked from this many scored tasks; a track from this many ranked agents.
export const RANKED_TASKS = 15;
export const UNRANKED_LINE = "Not ranked yet: needs three agents";
export const CLOSED_LINE = "Research opens soon";

const NOTES: Record<NonNullable<TrackRow["note"]>, string> = { over_price: "Priced above the Arena limit", cannot_take: "Cannot take Arena tasks" };
const OUTCOMES: Record<TrackAnswer["outcome"], string> = { delivered: "Answered", refused: "Refused", failed: "Failed", timeout: "Timed out", void: "Not counted" };

export const seconds = (ms: number | null): string => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

/// The line above the board: closed, waiting for a first round, unranked, or ranked.
export function trackStatusLine(board: Pick<TrackBoard, "open" | "ranked" | "rows" | "rounds">): string {
  if (!board.open) return CLOSED_LINE;
  if (board.rows.length === 0) return "No agents entered yet";
  if (!board.ranked) return UNRANKED_LINE;
  return `Ranked on mean score. An agent is ranked after ${RANKED_TASKS} scored tasks.`;
}

export type RowView = { key: string; rank: string; name: string; note: string; score: string; scored: string; time: string; href: string };

export function rowView(r: TrackRow): RowView {
  const notes = [r.firstParty ? "Built by Agon" : "", r.note ? NOTES[r.note] : "", !r.note && !r.ranked ? `${r.scored} of ${RANKED_TASKS} tasks` : ""].filter(Boolean);
  return {
    key: r.agentId,
    rank: r.rank === null ? "–" : String(r.rank),
    name: r.name,
    note: notes.join(". "),
    score: r.mean === null ? "–" : r.mean.toFixed(1),
    scored: String(r.scored),
    time: seconds(r.medianMs),
    href: `/agents/${encodeURIComponent(r.listingReference)}`,
  };
}

const STATES: Record<TrackRoundSummary["state"], { label: string; tone: "ok" | "warn" | "idle" }> = {
  committed: { label: "Committed", tone: "ok" },
  committing: { label: "Committing", tone: "warn" },
  sent: { label: "Closing", tone: "warn" },
  open: { label: "Open", tone: "idle" },
  skipped: { label: "Skipped", tone: "idle" },
};
export const roundState = (state: TrackRoundSummary["state"]) => STATES[state];

export type TaskView = { key: string; question: string; truth: string; note: string; answers: { key: string; name: string; outcome: string; score: string; time: string; excerpt: string }[] };

/// One round as the page shows it. Until Arc holds the round there are no tasks to show.
export function roundView(round: TrackRound): { line: string; tasks: TaskView[] } {
  if (round.state === "skipped") return { line: "This round was skipped. Nothing was scored.", tasks: [] };
  if (round.state !== "committed" || !round.tasks || !round.answers) return { line: "Round in progress", tasks: [] };
  const names = new Map(round.entrants.map((e) => [e.agentId, e.name]));
  const tasks = round.tasks.map((t): TaskView => ({
    key: t.taskId,
    question: t.question,
    truth: t.truth,
    note: t.void ? "Not counted: the answer changed before the round closed." : "",
    answers: round.answers!.filter((a) => a.taskId === t.taskId).map((a) => ({
      key: `${t.taskId}:${a.agentId}`,
      name: names.get(a.agentId) ?? `Agent ${a.agentId}`,
      outcome: OUTCOMES[a.outcome],
      score: a.score === null ? "–" : String(a.score),
      time: seconds(a.outcome === "delivered" ? a.durationMs : null),
      excerpt: (a.excerpt ?? "").slice(0, 160),
    })),
  }));
  return { line: `${round.answers.length} answers committed on Arc`, tasks };
}
