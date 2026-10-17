"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentProgress, StandingsEntry } from "@/lib/live";
import { AgentMascot, type AgentVariant } from "@/components/pengu/AgentMascot";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";

/// The visible competition surface that sits above the standings list. Picks
/// the right "stage" for the contest's type so the page declares "agents are
/// doing X" rather than "scores are climbing".
///
/// Real per-agent progress arrives on the standings broadcast for runners that
/// have something to stream:
///   - Solver  -> `progress.correct[]` (which puzzles the agent got right)
///   - Analyst -> `progress.calls[]` (each probability call and its outcome)
///   - Scout   -> `progress.recent[]` (real tx hashes from the hot wallet)
///
/// When the broadcast lacks progress (Scout preview, an old frame, a kind we
/// don't recognize) the stage falls back to score-derived placeholders so the
/// surface never goes blank.

function normalizeKind(raw?: string): "puzzle" | "volume" | "prediction" | "custom" {
  const k = (raw ?? "").toUpperCase();
  if (k === "SCOUT" || k === "VOLUME") return "volume";
  if (k === "ANALYST" || k === "PREDICTION") return "prediction";
  if (k === "SOLVER" || k === "PUZZLE") return "puzzle";
  return "custom";
}

const VARIANTS: AgentVariant[] = ["violet", "crimson", "cyan", "gold"];
function variantFor(agentId: number): AgentVariant {
  return VARIANTS[agentId % VARIANTS.length]!;
}

function variantColor(v: AgentVariant): string {
  switch (v) {
    case "crimson":
      return "#DC2626";
    case "cyan":
      return "#0891B2";
    case "gold":
      return "#D97706";
    case "violet":
      return "#7C3AED";
    default:
      return "#7c4dff";
  }
}

export function ContestStage({
  contestType,
  entries,
}: {
  contestType?: string;
  entries: StandingsEntry[];
}) {
  const kind = normalizeKind(contestType);
  // Show every agent in a horizontal slider rather than capping at the top 3,
  // so a viewer can swipe through the whole field in the pulse.
  const featured = entries;
  const maxScore = Math.max(...entries.map((e) => e.score), 1);

  return (
    <div className="relative overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas">
      <div className="relative z-10 flex items-center justify-between border-b border-[color:var(--hairline)] px-5 py-3">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span>
          STAGE · {kind.toUpperCase()}
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          {entries.length} AGENT{entries.length === 1 ? "" : "S"}
          {entries.length > 3 ? <span className="ml-2 text-ink-3">· SWIPE →</span> : null}
        </span>
      </div>

      <div className="relative z-10 p-5 sm:p-6">
        {featured.length === 0 ? (
          <EmptyStage kind={kind} />
        ) : (
          <StageBody kind={kind} featured={featured} maxScore={maxScore} />
        )}
      </div>
    </div>
  );
}

function EmptyStage({ kind }: { kind: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <AgentMascot variant="violet" mood="idle" live className="h-24 w-auto" />
      <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-3">
        WAITING FOR {kind.toUpperCase()} AGENTS TO ENTER THE STAGE…
      </p>
    </div>
  );
}

function StageBody({
  kind,
  featured,
  maxScore,
}: {
  kind: ReturnType<typeof normalizeKind>;
  featured: StandingsEntry[];
  maxScore: number;
}) {
  const headline =
    kind === "puzzle"
      ? "each agent's grid shows which puzzles it locked in · lit cell = correct answer"
      : kind === "prediction"
        ? "each agent placed a probability call per question · dots near the actual outcome score higher"
        : kind === "volume"
          ? "each agent ships real usdc tx from its own hot wallet · most recent first"
          : "custom metric · sponsor sets the rules · pulse tracks live progress";

  const bodies = featured.map((e) => {
    const accent = variantColor(variantFor(e.agentId));
    if (kind === "puzzle") return <PuzzleBody key={e.agentId} entry={e} accent={accent} maxScore={maxScore} />;
    if (kind === "prediction") return <PredictionBody key={e.agentId} entry={e} accent={accent} maxScore={maxScore} />;
    if (kind === "volume") return <VolumeBody key={e.agentId} entry={e} accent={accent} maxScore={maxScore} />;
    return <CustomBody key={e.agentId} entry={e} accent={accent} maxScore={maxScore} />;
  });

  return (
    <div>
      <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
        {headline}
      </div>
      <AgentRoster featured={featured} maxScore={maxScore} bodies={bodies} />
    </div>
  );
}

function AgentRoster({
  featured,
  maxScore,
  bodies,
}: {
  featured: StandingsEntry[];
  maxScore: number;
  bodies: React.ReactNode[];
}) {
  const names = useAgentNames(featured.map((e) => e.agentId));
  const skins = useAgentSkins(featured.map((e) => e.agentId));
  return (
    // Horizontal slider: every agent gets a card; swipe/scroll to see the
    // whole field. Snap so cards settle cleanly on touch. pt-3 leaves room for
    // the LEAD badge that floats above the #1 card (overflow-x-auto clips the
    // vertical axis too, which was cutting the badge).
    <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-2 pt-3">
      {featured.map((e, i) => {
        const pct = Math.min(1, e.score / maxScore);
        const leader = e.rank === 1;
        const skin = skinFor(skins, e.agentId);
        return (
          <div
            key={e.agentId}
            className={`relative flex w-[220px] shrink-0 snap-start flex-col items-center border p-4 ${
              leader
                ? "border-accent bg-canvas-2"
                : "border-[color:var(--hairline-strong)] bg-canvas"
            }`}
          >
            {leader ? (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 border border-accent bg-accent px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-accent-ink">
                LEAD
              </span>
            ) : null}

            <div className="flex w-full items-center justify-between">
              <span className={`font-stencil text-[14px] ${leader ? "text-accent" : "text-ink"}`}>
                #{e.rank}
              </span>
              <span key={e.score} className="tick-up font-mono text-[15px] tabular-nums text-ink">
                {e.score.toLocaleString()}
              </span>
            </div>

            {skin ? (
              <span
                className={`mt-2 flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-full bg-canvas-3 ${
                  leader ? "drift" : ""
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={skin} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
              </span>
            ) : (
              <AgentMascot
                variant={variantFor(e.agentId)}
                mood={leader ? "win" : "focus"}
                live
                className={`mt-2 h-20 w-auto ${leader ? "drift" : ""}`}
              />
            )}

            <div className="mt-2 w-full truncate text-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {nameFor(names, e.agentId)}
            </div>

            <div className="mt-3 w-full">{bodies[i]}</div>

            <div className="mt-3 h-1.5 w-full overflow-hidden border border-[color:var(--hairline)] bg-canvas-2">
              <div
                className="h-full"
                style={{
                  width: `${pct * 100}%`,
                  background: leader ? "var(--accent)" : "var(--ink-3)",
                  transition: "width 240ms linear",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Per-kind bodies ----------------

/// Solver puzzle stage. Reads `progress.correct[]` if present; each cell of the
/// row is one puzzle, lit when the agent's answer matched. Falls back to a
/// score-derived 6x6 grid when progress is missing (older frames).
function PuzzleBody({ entry, accent, maxScore }: { entry: StandingsEntry; accent: string; maxScore: number }) {
  if (entry.progress?.kind === "solver") {
    const { correct, total } = entry.progress;
    const cols = Math.min(total, 6);
    const rows = Math.ceil(total / cols);
    const cells = Array.from({ length: total }, (_, i) => correct[i] ?? false);
    return (
      <div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {cells.map((isCorrect, i) => (
            <span
              key={i}
              className="aspect-square rounded-[4px]"
              style={{
                background: isCorrect ? accent : "rgba(27,17,64,0.07)",
                border: isCorrect ? `1px solid ${accent}` : "1px solid rgba(27,17,64,0.05)",
              }}
              title={`q${i + 1} ${isCorrect ? "correct" : "missed"}`}
            />
          ))}
        </div>
        <div className="mt-1.5 text-right font-mono text-[10px] text-ink-3">
          {cells.filter(Boolean).length} / {total} solved
          <span className="sr-only">across {rows} row(s)</span>
        </div>
      </div>
    );
  }
  // Derived fallback when progress isn't on the frame yet.
  const pct = Math.min(1, entry.score / maxScore);
  const filled = Math.round(36 * pct);
  return (
    <div className="grid grid-cols-6 gap-[3px]">
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          className={`aspect-square rounded-[3px] ${i === filled - 1 || i === filled ? "glow-pulse" : ""}`}
          style={{ background: i < filled ? accent : "rgba(27,17,64,0.06)", color: accent }}
        />
      ))}
    </div>
  );
}

/// Analyst prediction stage. Each call is a dot placed on a 0..1 axis with the
/// actual outcome at 0 or 1. Color saturation reflects correctness; the closer
/// the dot to the outcome edge, the more confident-and-right the call.
function PredictionBody({ entry, accent, maxScore }: { entry: StandingsEntry; accent: string; maxScore: number }) {
  if (entry.progress?.kind === "analyst") {
    const { calls } = entry.progress;
    return (
      <div>
        <svg viewBox="0 0 100 36" className="h-12 w-full">
          {/* baseline */}
          <line x1="2" y1="18" x2="98" y2="18" stroke="rgba(27,17,64,0.18)" strokeWidth="0.6" />
          {/* 0 and 1 ticks */}
          <text x="0" y="34" fontSize="6" fill="rgba(27,17,64,0.45)" fontFamily="monospace">0</text>
          <text x="94" y="34" fontSize="6" fill="rgba(27,17,64,0.45)" fontFamily="monospace">1</text>
          {calls.map((c, i) => {
            const x = 4 + c.p * 92;
            const outcomeY = c.outcome === 1 ? 6 : 30;
            return (
              <g key={i}>
                {/* line from call to outcome edge */}
                <line
                  x1={x}
                  y1="18"
                  x2={x}
                  y2={outcomeY}
                  stroke={c.correct ? accent : "rgba(224,70,110,0.5)"}
                  strokeWidth="0.6"
                />
                <circle cx={x} cy="18" r="2" fill={c.correct ? accent : "#e0466e"} />
                <circle cx={x} cy={outcomeY} r="1.4" fill={c.outcome === 1 ? accent : "rgba(27,17,64,0.4)"} />
              </g>
            );
          })}
        </svg>
        <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-3">
          <span>{calls.filter((c) => c.correct).length} / {calls.length} right</span>
          <span className="text-ink-3">prob → outcome</span>
        </div>
      </div>
    );
  }
  // Derived fallback: a candle-like line that bends toward the leader.
  const pct = Math.min(1, entry.score / maxScore);
  return <DerivedPredictionChart accuracy={pct} accent={accent} />;
}

function DerivedPredictionChart({ accuracy, accent }: { accuracy: number; accent: string }) {
  const points = useMemo(() => {
    const xs = Array.from({ length: 12 }, (_, i) => i / 11);
    return xs.map((x) => {
      const noise = Math.sin(x * 9 + accuracy * 6) * 0.18;
      return 0.5 + noise * (1 - accuracy * 0.5);
    });
  }, [accuracy]);
  const actualY = 0.5 + (1 - accuracy) * 0.3 * (accuracy > 0.5 ? 1 : -1);
  return (
    <svg viewBox="0 0 100 40" className="h-14 w-full">
      <line x1="0" y1="20" x2="100" y2="20" stroke={accent} strokeWidth="0.6" strokeDasharray="2 2" opacity="0.6" />
      <polyline
        points={points.map((y, i) => `${(i / (points.length - 1)) * 100},${y * 40}`).join(" ")}
        fill="none"
        stroke={accent}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="100" cy={actualY * 40} r="2.5" fill={accent} />
    </svg>
  );
}

/// Scout volume stage. Reads `progress.recent[]` of actual tx hashes once the
/// final standings frame lands. During preview (when the runner is tier-proxy),
/// shows a "queued" state so we don't fake activity that hasn't happened.
function VolumeBody({ entry, accent, maxScore }: { entry: StandingsEntry; accent: string; maxScore: number }) {
  if (entry.progress?.kind === "scout") {
    const { recent, opsCount } = entry.progress;
    return (
      <div className="flex flex-col gap-1 border border-[color:var(--hairline)] bg-canvas-2 p-2 font-mono text-[10px] text-ink-2">
        {recent.length === 0 ? (
          <div className="py-2 text-center text-ink-3">no tx yet</div>
        ) : (
          recent.slice(0, 4).map((h, idx) => (
            <a
              key={h}
              href={`https://explorer.testnet.arc.io/tx/${h}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 tick-up hover:text-accent"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: accent, opacity: idx === 0 ? 1 : 0.45 }}
              />
              <span className="truncate">{h.slice(0, 10)}…{h.slice(-6)}</span>
            </a>
          ))
        )}
        <div className="mt-1 text-right font-display text-[9px] uppercase tracking-wide text-ink-3">
          {opsCount} tx total
        </div>
      </div>
    );
  }
  // Preview pass (no progress yet): show queued state, no synthetic hashes.
  const pct = Math.min(1, entry.score / maxScore);
  const queuedOps = Math.max(0, Math.round(5 * pct));
  return (
    <div className="flex flex-col gap-1 border border-[color:var(--hairline)] bg-canvas-2 p-2 font-mono text-[10px] text-ink-3">
      <div className="text-center text-ink-3">queued</div>
      <div className="text-center text-ink-3">{queuedOps} ops · waiting for window to close</div>
      <div className="mt-0.5 h-1 w-full overflow-hidden border border-[color:var(--hairline)] bg-canvas-2">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: accent, opacity: 0.5 }} />
      </div>
    </div>
  );
}

function CustomBody({ entry, accent, maxScore }: { entry: StandingsEntry; accent: string; maxScore: number }) {
  const pct = Math.min(1, entry.score / maxScore);
  return <Heartbeat accuracy={pct} accent={accent} />;
}

function Heartbeat({ accuracy, accent }: { accuracy: number; accent: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % 1000), 80);
    return () => clearInterval(t);
  }, []);
  const points = Array.from({ length: 28 }, (_, i) => {
    const t = (i + phase) / 28;
    const y = 0.5 + Math.sin(t * Math.PI * 4) * 0.2 * accuracy;
    return `${(i / 27) * 100},${y * 40}`;
  });
  return (
    <svg viewBox="0 0 100 40" className="h-14 w-full">
      <polyline points={points.join(" ")} fill="none" stroke={accent} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// Re-export progress type so callers can type-narrow before passing entries
// down. Avoids a separate import path.
export type { AgentProgress };
