"use client";

import { useRef, useState } from "react";

import { categoryLabel, testInfo } from "@/lib/agon/rating-view";
import { getTest, type TestRun, type TestRunDetail } from "@/lib/agon/scores-api";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/// Published Playground runs. Each opens its input and the agent's answer.
export function TestRunList({ runs, showAgent = false, empty = "No tests yet." }: { runs: TestRun[]; showAgent?: boolean; empty?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  const [failed, setFailed] = useState(false);

  async function open(id: string) {
    setDetail(null);
    setFailed(false);
    dialog.current?.showModal();
    try { setDetail(await getTest(id)); } catch { setFailed(true); }
  }

  if (!runs.length) return <p className="font-mono text-[11px] text-ink-3">{empty}</p>;
  return (
    <>
      <ul className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => void open(r.id)} className="grid min-h-11 w-full grid-cols-[3.5rem_1fr_auto] items-center gap-3 py-3 text-left hover:bg-canvas-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
              <span className={`font-mono text-[15px] ${r.passed ? "text-ink" : "text-ink-3"}`}>{r.score}</span>
              <span className="min-w-0">
                <span className="block truncate font-mono text-[11px] text-ink">
                  {showAgent ? `Agent #${r.agentId} · ` : ""}{testInfo(r.categoryId)?.title ?? categoryLabel(r.categoryId)}
                  {r.error ? <span className="text-ink-3"> · failed to answer</span> : null}
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{r.source === "agon_check" ? "Agon check" : r.runner ? <span className="normal-case">{r.runner}</span> : "Public test"} · {when(r.createdAt)}</span>
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: r.passed ? "var(--ok)" : "var(--err)" }}>{r.passed ? "Passed" : "Failed"}</span>
            </button>
          </li>
        ))}
      </ul>
      <dialog ref={dialog} className="w-[min(680px,calc(100vw-32px))] border border-ink bg-canvas p-0 text-ink backdrop:bg-black/50" onClose={() => setDetail(null)}>
        <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Test run</span>
          <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 px-3 font-mono text-[10px] uppercase tracking-[0.14em] hover:text-accent">Close</button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-5 py-5">
          {failed ? <p className="font-mono text-[11px] text-ink-2">This run could not be loaded.</p> : !detail ? <p className="font-mono text-[11px] text-ink-3">Loading…</p> : (
            <div className="space-y-5">
              <p className="font-mono text-[12px]">{testInfo(detail.categoryId)?.title ?? "Test"} · version {detail.variant + 1} · score {detail.score} · {(detail.durationMs / 1000).toFixed(1)}s</p>
              {detail.error ? <p className="font-mono text-[11px] text-ink-2">The agent did not give a valid answer ({detail.error.replaceAll("_", " ")}).</p> : null}
              <Block label="Input sent" value={detail.input} />
              <Block label="Answer" value={detail.output} />
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}

function Block({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-[color:var(--hairline)] bg-canvas-2 p-3 font-mono text-[11px] leading-relaxed">{value === null || value === undefined ? "None" : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
