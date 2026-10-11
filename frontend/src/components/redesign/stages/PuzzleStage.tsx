"use client";

import { useState } from "react";
import { AgentAvatar, BracketedCell, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import type { PuzzleCard, StandingsEntry } from "@/lib/live";

/// Promoted stage for SOLVER contests and PUZZLE challenges. Shows:
///   - top FASTEST agent (highest correct, lowest cumulative ms tiebreak)
///   - PUZZLE TYPES THIS ROUND chip strip (gas / classify / route)
///   - per-agent row: mascot, name, full-width puzzle grid, total time
/// Falls back to a score-derived grid when progress hasn't landed yet.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};
const KIND_LABEL: Record<string, string> = {
  gas: "GAS PICK",
  classify: "CLASSIFY",
  route: "ROUTE",
  research: "RESEARCH",
  quiz: "QUIZ",
  arithmetic: "MATH",
  routing: "ROUTING",
  pattern: "PATTERN",
  wordcount: "COUNT",
};

const FORMAT_LABEL: Record<PuzzleCard["format"], string> = {
  integer: "INTEGER",
  single_word: "1 WORD",
  phrase: "PHRASE",
  choice: "CHOICE",
};

const TOOLS_LABEL: Record<PuzzleCard["toolsAllowed"], string> = {
  none: "NO TOOLS",
  calc: "CALC",
  "calc+web": "CALC AND WEB",
};

/// 6-decimal USDC string ("13600") → human "$0.0136". Falls back to "$0"
/// for empty/invalid inputs so the cell never reads NaN.
function formatSpentUsdc(spent6: string | undefined): string {
  if (!spent6) return "$0";
  let n: bigint;
  try {
    n = BigInt(spent6);
  } catch {
    return "$0";
  }
  if (n <= 0n) return "$0";
  const dollars = Number(n) / 1_000_000;
  return `$${dollars.toFixed(4)}`;
}

/// Sum a string[] of 6-dec USDC values into a single bigint for the
/// per-agent and round totals.
function sumSpent6(spent?: string[]): bigint {
  if (!spent) return 0n;
  let total = 0n;
  for (const s of spent) {
    try {
      total += BigInt(s);
    } catch {
      // skip
    }
  }
  return total;
}

export function PuzzleStage({ entries }: { entries: StandingsEntry[] }) {
  const names = useAgentNames(entries.map((e) => e.agentId));
  const skins = useAgentSkins(entries.map((e) => e.agentId));
  const maxScore = Math.max(...entries.map((e) => e.score), 1);
  const [showAllCards, setShowAllCards] = useState(false);

  // Round-total nanopayment spend, summed across every agent. Drives the
  // "■ NANOPAYMENTS" chip at the top of the stage.
  const roundSpent6 = entries.reduce((acc, e) => {
    if (e.progress?.kind === "solver") return acc + sumSpent6(e.progress.spent);
    return acc;
  }, 0n);

  // Aggregate puzzle metadata from whichever entry carries the data first.
  // Backend sends the same puzzles to every agent in a round, so any entry
  // with progress.puzzleCards will have the same array. Prefer the
  // standardized cards if present; fall back to puzzleKinds for older runs.
  const cards = (() => {
    for (const e of entries) {
      if (e.progress?.kind === "solver" && e.progress.puzzleCards && e.progress.puzzleCards.length > 0) {
        return e.progress.puzzleCards;
      }
    }
    return null;
  })();
  const kinds = (() => {
    for (const e of entries) {
      if (e.progress?.kind === "solver" && e.progress.puzzleKinds && e.progress.puzzleKinds.length > 0) {
        return e.progress.puzzleKinds;
      }
    }
    return null;
  })();

  // FASTEST: most correct, then lowest cumulative ms.
  const fastest = (() => {
    let best: { entry: StandingsEntry; correctCount: number; totalMs: number } | null = null;
    for (const e of entries) {
      if (e.progress?.kind !== "solver") continue;
      const cc = e.progress.correct.filter(Boolean).length;
      const ms = e.progress.perPuzzleMs?.reduce((sum, m) => sum + m, 0) ?? Infinity;
      if (!best || cc > best.correctCount || (cc === best.correctCount && ms < best.totalMs)) {
        best = { entry: e, correctCount: cc, totalMs: ms };
      }
    }
    return best;
  })();

  return (
    <div className="flex flex-col gap-5">
      {/* NANOPAYMENTS chip: total round research spend, only when > 0 */}
      {roundSpent6 > 0n ? (
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.16em]">
          <span aria-hidden className="text-accent">■</span>
          <span className="text-ink-3">NANOPAYMENTS</span>
          <span className="text-ink">{formatSpentUsdc(roundSpent6.toString())} spent on research this round</span>
        </div>
      ) : null}

      {/* THIS ROUND: standardized puzzle cards or fallback to legacy chip strip */}
      {cards ? (
        <BracketedCell pad="sm">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
              THIS ROUND
            </span>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(showAllCards ? cards : cards.slice(0, 6)).map((card, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1 border border-[color:var(--hairline)] p-2 font-mono text-[10px] uppercase tracking-[0.08em]"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-ink">
                      #{i + 1} {card.family}
                    </span>
                    <span className="text-ink-3">D{card.difficulty}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
                    <span>{FORMAT_LABEL[card.format]}</span>
                    <span>·</span>
                    <span>{card.timeLimitSec}s</span>
                    <span>·</span>
                    <span>{TOOLS_LABEL[card.toolsAllowed]}</span>
                  </div>
                </div>
              ))}
            </div>
            {cards.length > 6 ? (
              <button
                onClick={() => setShowAllCards((v) => !v)}
                className="self-start font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent"
              >
                {showAllCards ? "SHOW LESS ↑" : `+ ${cards.length - 6} MORE THIS ROUND ↓`}
              </button>
            ) : null}
          </div>
        </BracketedCell>
      ) : kinds ? (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em]">
          <span className="text-ink-3">PUZZLE TYPES</span>
          {kinds.map((k, i) => (
            <span
              key={i}
              className="border border-ink-3 px-2 py-0.5 text-ink"
            >
              {KIND_LABEL[k] ?? k.toUpperCase()}
            </span>
          ))}
        </div>
      ) : null}

      {/* FASTEST leader */}
      {fastest ? (
        <BracketedCell pad="sm">
          <div className="flex items-center gap-4">
            <span aria-hidden className="text-accent">★</span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">FASTEST</span>
            <span className="font-stencil text-[20px] uppercase text-ink">
              {nameFor(names, fastest.entry.agentId)}
            </span>
            <span className="font-mono text-[12px] text-ink-2">
              {fastest.correctCount}/{fastest.entry.progress?.kind === "solver" ? fastest.entry.progress.total : "?"} solved
              {Number.isFinite(fastest.totalMs)
                ? ` · ${(fastest.totalMs / 1000).toFixed(2)}s`
                : ""}
            </span>
          </div>
        </BracketedCell>
      ) : null}

      {/* Per-agent rows */}
      <BracketedCell pad="sm">
        <div className="flex flex-col">
          {entries.map((e) => {
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            const solver = e.progress?.kind === "solver" ? e.progress : null;
            const correctCount = solver ? solver.correct.filter(Boolean).length : 0;
            const totalMs = solver?.perPuzzleMs?.reduce((s, m) => s + m, 0);
            const isFastest = fastest?.entry.agentId === e.agentId;
            return (
              // Mobile-first: name row on top, puzzle grid full-width below.
              // The old 4-column grid squeezed the cells on small screens; a
              // stacked card reads cleanly at 360px and on desktop alike.
              <div
                key={e.agentId}
                className="flex flex-col gap-2 border-b border-[color:var(--hairline)] py-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <span className={`font-stencil text-[16px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                    #{e.rank}
                  </span>
                  <AgentAvatar skin={skinFor(skins, e.agentId)} variant={variant} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink truncate">
                      {nameFor(names, e.agentId)}
                      {isFastest ? <span className="ml-2 text-accent">★</span> : null}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">
                      {solver ? `${correctCount}/${solver.total} solved` : "queued"}
                      {totalMs ? ` · ${(totalMs / 1000).toFixed(2)}s` : ""}
                      {(() => {
                        const agentSpent6 = solver ? sumSpent6(solver.spent) : 0n;
                        return agentSpent6 > 0n ? (
                          <>
                            {" · "}
                            <span className="text-accent">
                              spent {formatSpentUsdc(agentSpent6.toString())}
                            </span>
                          </>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <span
                    key={e.score}
                    className="tick-up flex-none text-right font-mono text-[12px] tabular-nums text-ink"
                  >
                    {Math.round(e.score).toLocaleString()}
                  </span>
                </div>
                {/* Per-puzzle cells, full-width under the name row. */}
                <PuzzleRow entry={e} accent={accent} maxScore={maxScore} />
              </div>
            );
          })}
        </div>
      </BracketedCell>
    </div>
  );
}

function PuzzleRow({
  entry,
  accent,
  maxScore,
}: {
  entry: StandingsEntry;
  accent: string;
  maxScore: number;
}) {
  if (entry.progress?.kind === "solver") {
    const { correct, total, perPuzzleMs, spent, spentLabels, spentTx } = entry.progress;
    const cells = Array.from({ length: total }, (_, i) => {
      const spent6 = spent?.[i];
      let spentN = 0n;
      try {
        spentN = spent6 ? BigInt(spent6) : 0n;
      } catch {
        spentN = 0n;
      }
      const tx = spentTx?.[i] ?? "";
      return {
        hit: correct[i] ?? false,
        ms: perPuzzleMs?.[i] ?? null,
        spent6: spentN,
        label: spentLabels?.[i] ?? "",
        tx: /^0x[a-fA-F0-9]{64}$/.test(tx) ? tx : "",
      };
    });
    return (
      // Fixed small cells that wrap, instead of full-width 1fr aspect-square
      // squares (which blew up to huge boxes on a wide stage).
      <div className="flex flex-wrap gap-1.5">
        {cells.map((c, i) => {
          const titleParts: string[] = [];
          if (c.ms) titleParts.push(`${c.ms}ms`);
          if (c.spent6 > 0n) {
            const spendStr = formatSpentUsdc(c.spent6.toString());
            titleParts.push(c.label ? `${spendStr} on ${c.label}` : spendStr);
          }
          if (c.tx) titleParts.push(`x402 paid · click to view on basescan`);
          const inner = (
            <>
              {c.hit ? "■" : i + 1}
              {c.spent6 > 0n || c.tx ? (
                <span
                  aria-hidden
                  className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-accent text-[7px] font-mono leading-none text-canvas"
                  style={{ lineHeight: 0 }}
                >
                  $
                </span>
              ) : null}
            </>
          );
          const cellStyle = {
            background: c.hit ? accent : "transparent",
            border: c.hit ? `1px solid ${accent}` : "1px solid var(--hairline)",
            color: c.hit ? "#fff" : "var(--ink-3)",
          };
          const cellCls = "relative flex h-7 w-7 items-center justify-center text-[9px] font-mono";
          // A paid puzzle's cell links straight to the on-chain x402 settlement
          // tx on Basescan, so judges can verify the nanopayment in one click.
          return c.tx ? (
            <a
              key={i}
              href={`https://basescan.org/tx/${c.tx}`}
              target="_blank"
              rel="noreferrer"
              className={`${cellCls} cursor-pointer`}
              style={cellStyle}
              title={titleParts.join(" · ")}
            >
              {inner}
            </a>
          ) : (
            <span key={i} className={cellCls} style={cellStyle} title={titleParts.join(" · ")}>
              {inner}
            </span>
          );
        })}
      </div>
    );
  }
  // No real solve progress yet (queued during the join window, or a frame
  // without solver data). Show empty cells numbered 1-6 so the row reads as
  // "six puzzles, none solved yet" instead of faking progress from the score.
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <span
          key={i}
          className="flex h-7 w-7 items-center justify-center font-mono text-[9px] text-ink-3"
          style={{ background: "transparent", border: "1px solid var(--hairline)" }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}
