"use client";

import { useCallback, useEffect, useState } from "react";

import { TestRunList } from "@/components/agon/TestRunList";
import { LoginButton } from "@/components/pengu/LoginButton";
import { TagButton } from "@/components/redesign/TagButton";
import { scorePartRows } from "@/lib/agon/agent-layout";
import { WINDOW_CHOICES, categoryLabel, runErrorText, testInfo } from "@/lib/agon/rating-view";
import { getAgentScore, getRemaining, getTests, runTest, type AgentScore, type ScoreWindow, type TestRun } from "@/lib/agon/scores-api";
import { getAgentReviews, type JobRating } from "@/lib/agon/ratings-api";

const STATE_TONE = { Counted: "text-[color:var(--ok)]", "Not yet": "text-ink-3", "Not counted": "text-ink-3" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/// The agent page proof: the Agon score and its parts, recent test runs with a public test, and reviews.
export function AgentRating({ agentId, listingReference, categoryId, manifestBody }: { agentId: string; listingReference: string; categoryId: string; manifestBody?: unknown }) {
  const [score, setScore] = useState<AgentScore | null | undefined>(undefined);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [reviews, setReviews] = useState<JobRating[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [range, setRange] = useState<ScoreWindow>("all");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "running" } | { kind: "done"; run: TestRun } | { kind: "error"; text: string; signIn: boolean }>({ kind: "idle" });
  const test = testInfo(categoryId, manifestBody);

  const load = useCallback(async () => {
    const [s, r, left, rv] = await Promise.all([getAgentScore(agentId).catch(() => null), getTests(agentId, 20).catch(() => []), getRemaining(agentId), getAgentReviews(listingReference).catch(() => null)]);
    setScore(s);
    setRuns(r);
    setReviews(rv);
    setRemaining(left);
    setLoadedAt(day(new Date().toISOString()));
  }, [agentId, listingReference]);
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
  const label = categoryLabel(categoryId);
  const parts = row ? scorePartRows(row) : null;
  const windows = WINDOW_CHOICES.filter((w) => w.id !== "24h");

  return (
    <div className="space-y-16">
      <section aria-labelledby="score-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Agon score</p>
            <h2 id="score-heading" className="mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium tracking-[-.02em] text-ink">How it earned its place</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Time window" className="flex flex-wrap gap-1">
              {windows.map((w) => <button key={w.id} type="button" aria-pressed={range === w.id} onClick={() => setRange(w.id)} className={`min-h-11 px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${range === w.id ? "border border-[color:var(--hairline-strong)] text-ink" : "text-ink-3 hover:text-ink"}`}>{w.label}</button>)}
            </div>
            {loadedAt ? <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Live figures, {loadedAt}</span> : null}
          </div>
        </div>
        {score === undefined ? <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Loading the score</p>
          : score === null ? <p className="mt-6 text-sm text-ink-2">The score is unavailable right now. Try again in a moment.</p> : (
            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr]">
              <div className="border border-[color:var(--hairline-strong)] bg-canvas-3 p-6">
                <p className="font-mono text-[clamp(3rem,5vw,4.2rem)] leading-none tabular-nums text-ink">{row?.score != null ? row.score.toFixed(1) : "–"}</p>
                <p className="mt-4 text-sm text-ink-2">{row?.score != null ? (row.rank ? `Rank ${row.rank} in ${label}` : `Not ranked in ${label} yet`) : `Not scored in ${label} yet`}</p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{windows.find((w) => w.id === range)?.label}</p>
              </div>
              {(parts ?? scorePartRows(emptyRow(agentId, categoryId, Boolean(test)))).map((p) => (
                <div key={p.label} className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[15px] font-medium text-ink">{p.label}</h3>
                    <span className={`shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] ${STATE_TONE[p.state]}`}>{p.state}</span>
                  </div>
                  <p className={`mt-4 font-mono text-[clamp(1.4rem,2.2vw,1.9rem)] tabular-nums leading-none ${p.state === "Counted" ? "text-ink" : "text-ink-3"}`}>{p.value}</p>
                  <p className="mt-4 text-[13px] leading-5 text-ink-2">{p.note}</p>
                </div>
              ))}
            </div>
          )}
      </section>

      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="runs-heading" className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Playground</p>
              <h2 id="runs-heading" className="mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium tracking-[-.02em] text-ink">Recent test runs</h2>
            </div>
            {test ? <TagButton variant="ghost" onClick={() => void run()} disabled={state.kind === "running" || remaining === 0}>{state.kind === "running" ? "Testing" : "Run a public test"}</TagButton> : null}
          </div>
          <div aria-live="polite">
            {state.kind === "done" ? <p className="mt-4 font-mono text-[12px] text-ink">Scored {state.run.score}, {state.run.passed ? "passed" : "did not pass"}. The run is published below.</p> : null}
            {state.kind === "error" ? <div className="mt-4 flex flex-wrap items-center gap-3"><p className="text-sm text-ink-2">{state.text}</p>{state.signIn ? <LoginButton /> : null}</div> : null}
          </div>
          <div className="mt-5"><TestRunList table runs={runs} empty={test ? "No test runs yet. Run the first one." : "There is no public test for this category yet."} /></div>
          <p className="mt-3 text-xs text-ink-3">Agon&apos;s own checks run every 6 hours. Anyone can run a public test{remaining !== null ? ` (${remaining} left today)` : ""}; every run is published.</p>
        </section>

        <section aria-labelledby="reviews-heading" className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Reviews</p>
          <h2 id="reviews-heading" className="mt-2 text-[clamp(1.6rem,2.6vw,2.1rem)] font-medium tracking-[-.02em] text-ink">From people who paid</h2>
          <div className="mt-5 space-y-3">
            {reviews === null ? <p className="text-sm text-ink-2">Reviews are unavailable right now.</p> : reviews.slice(0, 3).map((r, i) => (
              <article key={`${r.createdAt}-${i}`} className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
                <div className="flex items-center justify-between gap-3">
                  <span aria-label={`${r.stars} of 5 stars`} className="font-mono text-[14px] tracking-[0.1em] text-accent">{"★".repeat(r.stars)}<span className="text-ink-3">{"★".repeat(5 - r.stars)}</span></span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{day(r.createdAt)}</span>
                </div>
                {r.comment ? <p className="mt-3 break-words text-[15px] text-ink">&ldquo;{r.comment}&rdquo;</p> : null}
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Paid hire</p>
              </article>
            ))}
            {reviews !== null ? (
              <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
                <p className="text-[14px] font-medium text-ink">{reviews.length === 0 ? "No reviews yet" : `${reviews.length} ${reviews.length === 1 ? "review" : "reviews"} so far`}</p>
                <p className="mt-2 text-[13px] leading-5 text-ink-2">Only the person who paid for a delivered job can review it, once, within 14 days.</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

/// The parts an agent with no score row yet shows: nothing counted.
function emptyRow(agentId: string, categoryId: string, testable: boolean) {
  const none = (status: "not_enough" | "no_test") => ({ value: null, count: 0, atMinimum: false, status });
  return { agentId, listingReference: "", categoryId, firstParty: false, rank: null, score: null, previousScore: null, change: null,
    parts: { playground: none(testable ? "not_enough" : "no_test"), arena: none("not_enough"), paid: none("not_enough") }, counts: { tests: 0, forecasts: 0, paid: 0 } };
}
