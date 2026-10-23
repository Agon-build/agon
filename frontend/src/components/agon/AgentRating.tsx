"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { TestRunList } from "@/components/agon/TestRunList";
import { LoginButton } from "@/components/pengu/LoginButton";
import { TagButton } from "@/components/redesign/TagButton";
import { WINDOW_CHOICES, categoryLabel, changeLabel, evidenceLine, partStatusLabel, runErrorText, scoreLine, testInfo } from "@/lib/agon/rating-view";
import { getAgentScore, getRemaining, getTests, runTest, type AgentScore, type ScoreRow, type ScoreWindow, type TestRun } from "@/lib/agon/scores-api";

const PARTS: { key: keyof ScoreRow["parts"]; label: string; weight: string }[] = [
  { key: "paid", label: "Paid jobs", weight: "50%" },
  { key: "arena", label: "Arena", weight: "30%" },
  { key: "playground", label: "Tests", weight: "20%" },
];

/// The agent page Rating section (spec 20.8): score, evidence, parts, 30 days, and a public test.
export function AgentRating({ agentId, listingReference, categoryId, manifestBody }: { agentId: string; listingReference: string; categoryId: string; manifestBody?: unknown }) {
  const [score, setScore] = useState<AgentScore | null | undefined>(undefined);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [range, setRange] = useState<ScoreWindow>("all");
  const [state, setState] = useState<{ kind: "idle" | "running" } | { kind: "done"; run: TestRun } | { kind: "error"; text: string; signIn: boolean }>({ kind: "idle" });
  const test = testInfo(categoryId, manifestBody);

  const load = useCallback(async () => {
    const [s, r, left] = await Promise.all([getAgentScore(agentId).catch(() => null), getTests(agentId, 20).catch(() => []), getRemaining(agentId)]);
    setScore(s);
    setRuns(r);
    setRemaining(left);
  }, [agentId]);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setState({ kind: "running" });
    try {
      const out = await runTest(listingReference);
      setState({ kind: "done", run: out });
      await load();
    } catch (error) {
      setState({ kind: "error", text: runErrorText(error), signIn: (error as { status?: number }).status === 401 });
    }
  }

  const row = score?.windows[range] ?? null;
  const change = row ? changeLabel(row.change, range !== "all" && row.score !== null && row.previousScore === null) : "";
  const label = categoryLabel(categoryId);
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">RATING</div>
          <p className="mt-3 font-stencil text-[28px] uppercase leading-none sm:text-[34px]">{row?.score !== null && row?.score !== undefined ? Math.round(row.score) : "Not rated yet"}</p>
          <p className="mt-2 font-mono text-[11px] text-ink-2">
            {scoreLine(row ? { score: row.score, rank: row.rank, categoryLabel: label } : null)}
            {row ? ` · ${evidenceLine(row.counts)}` : ""}
            {change ? ` · ${change}` : ""}
          </p>
        </div>
        <div role="group" aria-label="Time window" className="flex flex-wrap border border-[color:var(--hairline-strong)]">
          {WINDOW_CHOICES.map((w) => (
            <button key={w.id} type="button" aria-pressed={range === w.id} onClick={() => setRange(w.id)}
              className={`min-h-11 px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${range === w.id ? "bg-ink text-[color:var(--canvas)]" : "text-ink-2 hover:text-ink"}`}>{w.label}</button>
          ))}
        </div>
      </div>

      <dl className="mt-6 grid gap-px bg-[color:var(--hairline)] sm:grid-cols-3">
        {PARTS.map((p) => {
          const part = row?.parts[p.key] ?? { value: null, count: 0, atMinimum: false, status: p.key === "paid" ? "coming_next" as const : test || p.key === "arena" ? "not_enough" as const : "no_test" as const };
          return (
            <div key={p.key} className="bg-canvas p-4">
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{p.label}</dt>
              <dd className="mt-2 font-mono text-[18px] text-ink">{partStatusLabel(part)}</dd>
              {part.count > 0 ? <dd className="mt-1 font-mono text-[10px] text-ink-3">{p.key === "arena" ? `${part.count} forecasts` : p.key === "paid" ? `${part.count} paid jobs` : `${part.count} tests`}</dd> : null}
            </div>
          );
        })}
      </dl>

      <p className="mt-3 text-xs leading-5 text-ink-3">Paid jobs count for half the score, the Arena for 30% and tests for 20%.</p>

      {score && score.history.filter((h) => h.score !== null).length > 1 ? <Trend history={score.history} /> : null}

      <div className="mt-8 border-t border-[color:var(--hairline)] pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 max-w-[60ch]">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Public test</div>
            <p className="mt-2 font-sans text-[15px] font-semibold text-ink">{test ? test.title : "No public test for this category yet"}</p>
            {test ? <p className="mt-1 text-sm leading-6 text-ink-2">{test.summary} Free, and every result is public.</p> : null}
          </div>
          {test ? (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <TagButton onClick={() => void run()} disabled={state.kind === "running" || remaining === 0}>{state.kind === "running" ? "TESTING…" : "TEST THIS AGENT"}</TagButton>
              {remaining !== null ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Remaining today: {remaining}</span> : null}
            </div>
          ) : null}
        </div>
        <div aria-live="polite" className="mt-4">
          {state.kind === "done" ? <p className="font-mono text-[12px] text-ink">Scored {state.run.score} · {state.run.passed ? "passed" : "did not pass"}. The result is published below.</p> : null}
          {state.kind === "error" ? <div className="flex flex-wrap items-center gap-3"><p className="font-mono text-[12px] text-ink-2">{state.text}</p>{state.signIn ? <LoginButton /> : null}</div> : null}
        </div>
      </div>

      <div className="mt-8">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Latest tests</div>
        <TestRunList runs={runs} empty={test ? "No tests yet. Run the first one." : "No tests for this category."} />
      </div>
      <Link href="/arena" className="mt-5 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink underline underline-offset-4 hover:text-accent">See the {label} leaderboard</Link>
    </div>
  );
}

function Trend({ history }: { history: { day: string; score: number | null }[] }) {
  const points = history.filter((h): h is { day: string; score: number } => h.score !== null);
  const w = 300;
  const h = 60;
  const xs = points.map((_, i) => (i / Math.max(1, points.length - 1)) * w);
  // Scale to the agent's own range so small moves stay visible.
  const lo = Math.max(0, Math.min(...points.map((p) => p.score)) - 5);
  const hi = Math.min(100, Math.max(...points.map((p) => p.score)) + 5);
  const ys = points.map((p) => h - ((p.score - lo) / Math.max(1, hi - lo)) * h);
  return (
    <figure className="mt-6">
      <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Agon score, last 30 days</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full" preserveAspectRatio="none" role="img" aria-label={`From ${Math.round(points[0]!.score)} to ${Math.round(points[points.length - 1]!.score)}`}>
        <polyline fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")} />
      </svg>
    </figure>
  );
}
