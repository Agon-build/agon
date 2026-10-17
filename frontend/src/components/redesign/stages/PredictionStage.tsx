"use client";

import { useMemo } from "react";
import { AgentAvatar, ArcanaMark, BracketedCell, robotVariantForId } from "@/components/redesign";

/// Live Arcana Markets contract on Arc Testnet. Single source of truth for
/// the wait state's "powered by" strip and the active branch banner. When
/// a viewer wants to verify the integration is real, they can pop the chip
/// open and land on the actual contract page.
const ARCANA_CONTRACT = "0x443a47eF1025e047879b1BA08c94e6dedB354D54";
const ARCANA_SCAN_URL = `https://explorer.testnet.arc.io/address/${ARCANA_CONTRACT}`;
const ARCANA_SITE_URL = "https://www.arcanamarkets.xyz";
const ARCANA_SITE_LABEL = "ARCANAMARKETS.XYZ";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import type { StandingsEntry } from "@/lib/live";

/// Promoted stage for ANALYST contests and PREDICTION challenges. Two
/// rendering branches:
///   1. ARCANA branch (when any entry carries progress.arcana): per-agent
///      list of real prediction-market positions with current odds, stake,
///      and live PnL.
///   2. SYNTHETIC branch (legacy): chart of YES/NO call probabilities vs
///      the round's outcome edges, plus a calibration scorecard.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};
const ERR = "#E0345A";
const OK = "#2BD4A3";

// Chart dimensions in viewBox units (synthetic branch).
const CHART_W = 720;
const CHART_H = 200;
const PAD_X = 32;
const PAD_Y = 24;

/// Markets pinned to the contest at open by the coordinator. When present,
/// the Arcana branch renders even with zero entries so the round's menu is
/// visible before any agent trades. Mirrors the ContestOpenMessage
/// arcanaMarkets shape so the live page can pass it straight through.
export interface PinnedMarket {
  id: number;
  title: string;
  category: string;
  endTime: number;
}

export function PredictionStage({
  entries,
  pinnedArcanaMarkets,
}: {
  entries: StandingsEntry[];
  pinnedArcanaMarkets?: PinnedMarket[];
}) {
  const names = useAgentNames(entries.map((e) => e.agentId));
  const skins = useAgentSkins(entries.map((e) => e.agentId));

  // Detect the Arcana branch when any agent carries positions OR the
  // contest has a pinned menu (set at open). Either signal is enough.
  const hasArcana = useMemo(() => {
    if (pinnedArcanaMarkets && pinnedArcanaMarkets.length > 0) return true;
    for (const e of entries) {
      if (e.progress?.kind === "analyst" && (e.progress.arcana?.length ?? 0) > 0) return true;
    }
    return false;
  }, [entries, pinnedArcanaMarkets]);

  if (hasArcana) {
    return <ArcanaBranch entries={entries} names={names} skins={skins} pinnedMarkets={pinnedArcanaMarkets ?? []} />;
  }

  // Total YES/NO calls across analyst entries. With the synthetic fallback
  // disabled by default, this stays at 0 when Arcana has no markets, so
  // we drop straight into the branded waiting placeholder instead of
  // showing an empty call chart.
  const totalAnalystCalls = useMemo(() => {
    let total = 0;
    for (const e of entries) {
      if (e.progress?.kind === "analyst") total += e.progress.calls.length;
    }
    return total;
  }, [entries]);

  if (totalAnalystCalls === 0) {
    return <ArcanaWaitingPlaceholder entryCount={entries.length} />;
  }

  // Aggregate the question count from whichever entry carries calls first.
  // Reaches here only when synthetic fallback is enabled and calls exist.
  const totalQs = useMemo(() => {
    for (const e of entries) {
      if (e.progress?.kind === "analyst") return e.progress.calls.length;
    }
    return 0;
  }, [entries]);

  // Outcomes are identical across all agents; pull from the first analyst row.
  const outcomes = useMemo(() => {
    for (const e of entries) {
      if (e.progress?.kind === "analyst") return e.progress.calls.map((c) => c.outcome);
    }
    return [];
  }, [entries]);

  const colW = (CHART_W - PAD_X * 2) / Math.max(1, totalQs);

  return (
    <div className="flex flex-col gap-5">
      {/* Fallback badge: explains why this round didn't route through
          Arcana so the synthetic call chart isn't confusing. Shows only
          when Arcana had no markets to pin AND no agent traded. */}
      <SyntheticFallbackBadge />

      {/* CHART */}
      <BracketedCell pad="sm">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> CALL CHART
          <span className="ml-2 text-ink-3">· DOTS = AGENT CALLS · TOP = OUTCOME 1 · BOTTOM = OUTCOME 0</span>
        </div>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H + PAD_Y * 2}`}
          className="mt-3 h-[220px] w-full"
        >
          {/* 0 and 1 baselines */}
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y}
            y2={PAD_Y}
            stroke="var(--hairline-strong)"
            strokeWidth="0.5"
          />
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y + CHART_H}
            y2={PAD_Y + CHART_H}
            stroke="var(--hairline-strong)"
            strokeWidth="0.5"
          />
          {/* 0.5 reference dashed */}
          <line
            x1={PAD_X}
            x2={CHART_W - PAD_X}
            y1={PAD_Y + CHART_H / 2}
            y2={PAD_Y + CHART_H / 2}
            stroke="var(--ink-3)"
            strokeWidth="0.4"
            strokeDasharray="3 3"
          />
          <text x={PAD_X - 6} y={PAD_Y + 4} textAnchor="end" fontSize="9" fontFamily="monospace" fill="var(--ink-3)">1</text>
          <text x={PAD_X - 6} y={PAD_Y + CHART_H} textAnchor="end" fontSize="9" fontFamily="monospace" fill="var(--ink-3)">0</text>

          {/* Per-question column markers: an outcome circle at the right edge */}
          {outcomes.map((o, i) => {
            const x = PAD_X + colW * (i + 0.5);
            const y = o === 1 ? PAD_Y : PAD_Y + CHART_H;
            return (
              <g key={`outcome-${i}`}>
                <text
                  x={x}
                  y={PAD_Y + CHART_H + 16}
                  textAnchor="middle"
                  fontSize="8"
                  fontFamily="monospace"
                  fill="var(--ink-3)"
                >
                  Q{i + 1}
                </text>
                <circle cx={x} cy={y} r="3.5" fill="var(--ink)" />
              </g>
            );
          })}

          {/* Each agent's calls */}
          {entries.map((e) => {
            if (e.progress?.kind !== "analyst") return null;
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            return (
              <g key={e.agentId}>
                {e.progress.calls.map((c, i) => {
                  const x = PAD_X + colW * (i + 0.5);
                  const yCall = PAD_Y + (1 - c.p) * CHART_H;
                  const yOutcome = c.outcome === 1 ? PAD_Y : PAD_Y + CHART_H;
                  const color = c.correct ? accent : ERR;
                  return (
                    <g key={i}>
                      <line
                        x1={x}
                        x2={x}
                        y1={yCall}
                        y2={yOutcome}
                        stroke={color}
                        strokeWidth="0.7"
                        opacity={0.5}
                      />
                      <circle cx={x} cy={yCall} r="2.5" fill={color} />
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </BracketedCell>

      {/* CALIBRATION SCORECARDS */}
      <BracketedCell pad="sm">
        <div className="flex flex-col">
          {entries.map((e) => {
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            const analyst = e.progress?.kind === "analyst" ? e.progress : null;
            const correct = analyst?.calls.filter((c) => c.correct).length ?? 0;
            const total = analyst?.calls.length ?? 0;
            const correctIdx = analyst
              ? analyst.calls
                  .map((c, i) => ({ c, i }))
                  .filter(({ c }) => c.correct)
                  .map(({ i }) => `Q${i + 1}`)
                  .join(" ")
              : "";
            return (
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
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">
                      {analyst ? `${correct}/${total} CORRECT` : "queued"}
                      {correctIdx ? ` · NAILED ${correctIdx}` : ""}
                    </div>
                  </div>
                  <span
                    key={e.score}
                    className="tick-up flex-none text-right font-mono text-[12px] tabular-nums text-ink"
                  >
                    {Math.round(e.score).toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full border border-[color:var(--hairline-strong)] bg-canvas-2">
                  <div
                    className="h-full"
                    style={{ width: total > 0 ? `${(correct / total) * 100}%` : "0%", background: accent }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </BracketedCell>
    </div>
  );
}

/// Branded placeholder for PREDICTION events that opened while Arcana had
/// no open markets. Shows on the live page until either markets ship and
/// agents start trading (state flips to ArcanaBranch automatically on the
/// next standings frame) or the deadline hits and the coordinator
/// cancels-and-refunds.
function ArcanaWaitingPlaceholder({ entryCount }: { entryCount: number }) {
  const shortContract = `${ARCANA_CONTRACT.slice(0, 6)}…${ARCANA_CONTRACT.slice(-4)}`;
  return (
    <BracketedCell pad="md">
      <div className="flex flex-col gap-5">
        {/* Brand banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hairline)] pb-4">
          <div className="flex items-center gap-3 text-ink">
            <ArcanaMark size={28} />
          </div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            <span aria-hidden className="text-accent">■</span>
            POWERED BY
          </div>
        </div>

        {/* Big stencil */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
            PREDICTION ROUND · STATUS
          </span>
          <h2
            className="font-stencil uppercase text-ink"
            style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1, letterSpacing: "-0.02em" }}
          >
            WAITING FOR ARCANA TO OPEN MARKETS
          </h2>
          <p className="max-w-[640px] font-mono text-[13px] leading-[1.55] text-ink-2">
            no live prediction markets are open on arcana right now. agents stay
            parked. when arcana ships markets before the deadline, this round
            runs automatically. otherwise the round closes and stakes refund.
          </p>
        </div>

        {/* Pulsing indicator strip */}
        <div className="flex flex-wrap items-center gap-3 border border-[color:var(--hairline)] bg-canvas-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
          <span className="live-dot" style={{ background: "var(--accent)" }} />
          <span>POLLING ARCANA · MARKETS APPEAR HERE THE INSTANT THEY OPEN</span>
        </div>

        {/* Contract chip + entry line */}
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={ARCANA_SCAN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:border-ink hover:text-accent"
          >
            <span aria-hidden className="text-ink-3">CONTRACT</span>
            <span>{shortContract}</span>
            <span aria-hidden>↗</span>
          </a>
          <a
            href={ARCANA_SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink hover:border-ink hover:text-accent"
          >
            {ARCANA_SITE_LABEL}
            <span aria-hidden>↗</span>
          </a>
          {entryCount > 0 ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              · {entryCount} AGENT{entryCount === 1 ? "" : "S"} STAKED · REFUND ON CLOSE IF NO MARKET
            </span>
          ) : null}
        </div>
      </div>
    </BracketedCell>
  );
}

/// Compact "POWERED BY ARCANA MARKETS" header for the active branch.
/// Sits above the per-agent positions so the brand persists once trading
/// has started, not just on the waiting state.
function ArcanaBranchHeader() {
  const shortContract = `${ARCANA_CONTRACT.slice(0, 6)}…${ARCANA_CONTRACT.slice(-4)}`;
  return (
    <BracketedCell pad="sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-ink">
          <ArcanaMark size={20} />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            ROUND TRADING ON
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={ARCANA_SCAN_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-[color:var(--hairline)] bg-canvas px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-accent"
          >
            {shortContract}
            <span aria-hidden>↗</span>
          </a>
          <a
            href={ARCANA_SITE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-[color:var(--hairline)] bg-canvas px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-accent"
          >
            {ARCANA_SITE_LABEL}
            <span aria-hidden>↗</span>
          </a>
        </div>
      </div>
    </BracketedCell>
  );
}

function SyntheticFallbackBadge() {
  return (
    <div className="flex flex-wrap items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2">
      <span className="border border-[color:var(--hairline-strong)] px-1.5 py-0.5 text-ink-3">SYNTHETIC FALLBACK</span>
      <span>
        no open arcana markets at round start. agents predicted live arc state instead. arcana branch resumes automatically when their pipeline ships markets.
      </span>
    </div>
  );
}

// ===========================================================================
// Arcana branch: real prediction-market positions, live PnL, claim status.
// ===========================================================================

function ArcanaBranch({
  entries,
  names,
  skins,
  pinnedMarkets,
}: {
  entries: StandingsEntry[];
  names: ReturnType<typeof useAgentNames>;
  skins: ReturnType<typeof useAgentSkins>;
  /// Coordinator-pinned market set. Shown immediately at contest open so
  /// the menu is visible before agents trade. Merges with any markets
  /// agents have already taken positions in (which may be a subset).
  pinnedMarkets: PinnedMarket[];
}) {
  // Aggregate distinct markets visible this round. Pinned set is the
  // ground truth; agent positions add anything not in the pin (shouldn't
  // happen with D.1 enforcement, but defensive).
  const marketSet = useMemo(() => {
    const seen = new Map<number, string>();
    for (const m of pinnedMarkets) {
      seen.set(m.id, m.title || `Market #${m.id}`);
    }
    for (const e of entries) {
      if (e.progress?.kind !== "analyst") continue;
      for (const p of e.progress.arcana ?? []) {
        if (!seen.has(p.marketId)) seen.set(p.marketId, p.title || `Market #${p.marketId}`);
      }
    }
    return Array.from(seen.entries()).map(([id, title]) => ({ id, title }));
  }, [entries, pinnedMarkets]);

  return (
    <div className="flex flex-col gap-5">
      <ArcanaBranchHeader />

      {/* PINNED MARKETS THIS ROUND */}
      <BracketedCell pad="sm">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
            ARCANA MARKETS THIS ROUND
          </span>
          {marketSet.length === 0 ? (
            <p className="font-mono text-[12px] text-ink-2">no positions yet. agents are picking their trades.</p>
          ) : (
            <ul className="flex flex-col gap-1 font-mono text-[12px] text-ink">
              {marketSet.map((m) => (
                <li key={m.id} className="flex items-baseline gap-2">
                  <span className="text-ink-3">#{m.id}</span>
                  <span className="truncate">{m.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </BracketedCell>

      {/* PER-AGENT POSITIONS */}
      <BracketedCell pad="sm">
        <div className="flex flex-col">
          {entries.map((e) => {
            const variant = robotVariantForId(e.agentId);
            const accent = VARIANT_COLOR[variant]!;
            const analyst = e.progress?.kind === "analyst" ? e.progress : null;
            const positions = analyst?.arcana ?? [];
            const totalStakeUsd = positions.reduce(
              (acc, p) => acc + Number(BigInt(p.stakeUsdc)) / 1e6,
              0,
            );
            const totalPnlUsd = positions.reduce((acc, p) => {
              const n = Number(BigInt(p.mtmPnLUsdc6));
              return acc + n / 1e6;
            }, 0);
            const pnlColor = totalPnlUsd > 0 ? OK : totalPnlUsd < 0 ? ERR : "var(--ink-3)";
            return (
              <div
                key={e.agentId}
                className="flex flex-col gap-2 border-b border-[color:var(--hairline)] py-3 last:border-0"
              >
                <div className="flex items-start gap-3">
                  <span className={`font-stencil text-[16px] ${e.rank === 1 ? "text-accent" : "text-ink"}`}>
                    #{e.rank}
                  </span>
                  <AgentAvatar skin={skinFor(skins, e.agentId)} variant={variant} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink truncate">
                        {nameFor(names, e.agentId)}
                      </span>
                      {analyst?.ticksBudget && analyst.ticksBudget > 0 ? (
                        <span
                          className="border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-2"
                          title="ticks used / tick budget (tier, speed stat, and traits)"
                        >
                          T {analyst.ticksUsed ?? 0}/{analyst.ticksBudget}
                        </span>
                      ) : null}
                      {analyst?.researchSpent6 && BigInt(analyst.researchSpent6) > 0n ? (
                        (() => {
                          const tx = analyst.researchTx && /^0x[a-fA-F0-9]{64}$/.test(analyst.researchTx) ? analyst.researchTx : "";
                          const label = (
                            <>
                              ${(Number(BigInt(analyst.researchSpent6)) / 1e6).toFixed(4)}
                              {analyst.researchLabel ? ` · ${analyst.researchLabel}` : " RESEARCH"}
                              {tx ? " ↗" : null}
                            </>
                          );
                          const cls = "border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-accent";
                          // When the x402 payment settled on-chain, link the chip
                          // straight to the Base tx so judges can verify it.
                          return tx ? (
                            <a
                              href={`https://basescan.org/tx/${tx}`}
                              target="_blank"
                              rel="noreferrer"
                              className={`${cls} cursor-pointer`}
                              title={`paid ${analyst.researchLabel ?? "research"} via x402 · view on basescan`}
                            >
                              {label}
                            </a>
                          ) : (
                            <span className={cls} title={`paid ${analyst.researchLabel ?? "research"} before trading`}>
                              {label}
                            </span>
                          );
                        })()
                      ) : null}
                    </div>
                    <div className="font-mono text-[10px] text-ink-3">
                      {positions.length > 0
                        ? `${positions.length} POSITION${positions.length === 1 ? "" : "S"} · STAKE $${totalStakeUsd.toFixed(2)}`
                        : "QUEUED"}
                      {positions.length > 0 ? (
                        <>
                          {" · PnL "}
                          <span style={{ color: pnlColor }}>
                            {totalPnlUsd >= 0 ? "+" : "−"}${Math.abs(totalPnlUsd).toFixed(2)}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <span
                    key={e.score}
                    className="tick-up flex-none text-right font-mono text-[12px] tabular-nums text-ink"
                  >
                    {Math.round(e.score).toLocaleString()}
                  </span>
                </div>

                {/* Per-position chips, full width below the name row */}
                {positions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {positions.map((p) => (
                      <PositionChip key={`${p.marketId}-${p.side}`} pos={p} accent={accent} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </BracketedCell>
    </div>
  );
}

function PositionChip({
  pos,
  accent,
}: {
  pos: NonNullable<
    Extract<StandingsEntry["progress"], { kind: "analyst" }>["arcana"]
  >[number];
  accent: string;
}) {
  const pnl = Number(BigInt(pos.mtmPnLUsdc6)) / 1e6;
  const pnlColor = pnl > 0 ? OK : pnl < 0 ? ERR : "var(--ink-3)";
  const sideColor = pos.side === "yes" ? accent : "var(--ink-2)";
  const stakeUsd = Number(BigInt(pos.stakeUsdc)) / 1e6;
  const currentPct = Math.round((pos.side === "yes" ? pos.currentYesProb : 1 - pos.currentYesProb) * 100);
  return (
    <div
      className="flex flex-col gap-0.5 border border-[color:var(--hairline)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]"
      title={pos.title}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color: sideColor }}>{pos.side.toUpperCase()}</span>
        <span className="text-ink-3">#{pos.marketId}</span>
        {pos.resolved ? <span className="text-ink-3">· DONE</span> : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-ink">${stakeUsd.toFixed(2)}</span>
        <span className="text-ink-3">@ {currentPct}%</span>
        <span style={{ color: pnlColor }}>
          {pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
        </span>
      </div>
    </div>
  );
}
