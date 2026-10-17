"use client";

import { useMemo } from "react";
import { AgentAvatar, BracketedCell, robotVariantForId } from "@/components/redesign";
import { nameFor, skinFor, useAgentNames, useAgentSkins } from "@/hooks/useAgentNames";
import type { StandingsEntry } from "@/lib/live";

/// Promoted stage for SCOUT contests and VOLUME challenges. Two layers:
///   1) TX TAPE: every recent tx across every agent, newest on top, linked
///      to arcscan, with the value in USDC.
///   2) VOLUME BARS: per-agent total volume in this round, share-of-total
///      rendered as a horizontal bar.
///
/// During the preview window scout doesn't emit `progress`. We show "queued"
/// rows in that case so the page doesn't go blank.

const VARIANT_COLOR: Record<string, string> = {
  violet: "#7C5CFF",
  pink: "#FF3D8A",
  gold: "#D78A2B",
  mint: "#2BD4A3",
  crimson: "#E0345A",
};

const usdc = (amount6: string) => `${(Number(amount6) / 1e6).toFixed(2)} USDC`;
const ARCSCAN = "https://explorer.testnet.arc.io/tx/";

interface TapeRow {
  agentId: number;
  hash: string;
  volume: string | null;
  order: number; // smaller = newer; per-agent index
}

export function VolumeStage({ entries }: { entries: StandingsEntry[] }) {
  const names = useAgentNames(entries.map((e) => e.agentId));
  const skins = useAgentSkins(entries.map((e) => e.agentId));

  // Per-agent CUMULATIVE volume (raw bigint string), used for bars. Read the
  // cumulative `volume6` the runner sends, not the sum of recentVolumes, which
  // is only the short tape window and would freeze the bar as the window slides.
  // Fall back to summing recentVolumes for an older frame missing volume6.
  const totalsByAgent = useMemo(() => {
    const out = new Map<number, bigint>();
    for (const e of entries) {
      if (e.progress?.kind !== "scout") continue;
      const cumulative = e.progress.volume6
        ? BigInt(e.progress.volume6)
        : (e.progress.recentVolumes ?? []).reduce((acc, v) => acc + BigInt(v || "0"), 0n);
      out.set(e.agentId, cumulative);
    }
    return out;
  }, [entries]);
  const maxTotal = useMemo(() => {
    let m = 0n;
    for (const v of totalsByAgent.values()) if (v > m) m = v;
    return m;
  }, [totalsByAgent]);

  // Build the unified tape: interleave each agent's recent[] by index so the
  // newest of each agent surfaces first. Cap at 20 rows.
  const tape: TapeRow[] = useMemo(() => {
    const rows: TapeRow[] = [];
    for (const e of entries) {
      if (e.progress?.kind !== "scout") continue;
      const { recent, recentVolumes } = e.progress;
      recent.forEach((h, i) => {
        rows.push({
          agentId: e.agentId,
          hash: h,
          volume: recentVolumes?.[i] ?? null,
          order: i,
        });
      });
    }
    rows.sort((a, b) => a.order - b.order);
    return rows.slice(0, 20);
  }, [entries]);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* TX TAPE */}
      <div className="lg:col-span-7">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> TX TAPE
          <span className="ml-2 text-ink-3">· {tape.length} TX</span>
        </div>
        <BracketedCell pad="sm">
          <div className="scroll-brand max-h-[420px] overflow-y-auto pr-1">
            {tape.length === 0 ? (
              <p className="px-2 py-5 font-mono text-sm text-ink-2">
                queued. scout ops fire when the contest settles; tx hashes land here in real time.
              </p>
            ) : (
              <div className="flex flex-col">
                {tape.map((row, idx) => {
                  const variant = robotVariantForId(row.agentId);
                  const accent = VARIANT_COLOR[variant]!;
                  return (
                    <a
                      key={`${row.hash}-${idx}`}
                      href={`${ARCSCAN}${row.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[color:var(--hairline)] py-2 last:border-0 hover:bg-canvas-2"
                    >
                      <span className="flex h-5 w-5 flex-none items-center justify-center" style={{ background: accent }}>
                        <span className="text-[9px] font-mono text-white">■</span>
                      </span>
                      {/* Name on top, tx hash beneath, so a phone never has to
                          fit name + hash + value on one line. */}
                      <span className="min-w-0">
                        <span className="block truncate font-mono text-[11px] text-ink">
                          {nameFor(names, row.agentId)}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-ink-3">
                          {row.hash.slice(0, 10)}…{row.hash.slice(-6)}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] text-ink whitespace-nowrap">
                        {row.volume ? usdc(row.volume) : "—"}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        </BracketedCell>
      </div>

      {/* PER-AGENT VOLUME */}
      <div className="lg:col-span-5">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
          <span aria-hidden className="text-accent">■</span> VOLUME BY AGENT
        </div>
        <BracketedCell pad="sm">
          <div className="flex flex-col">
            {entries.map((e) => {
              const variant = robotVariantForId(e.agentId);
              const accent = VARIANT_COLOR[variant]!;
              const total = totalsByAgent.get(e.agentId) ?? 0n;
              const pct = maxTotal > 0n ? Number((total * 100n) / maxTotal) : 0;
              const scout = e.progress?.kind === "scout" ? e.progress : null;
              const ops = scout?.opsCount ?? 0;
              const research6 = scout?.researchSpent6 ? BigInt(scout.researchSpent6) : 0n;
              return (
                <div
                  key={e.agentId}
                  className="border-b border-[color:var(--hairline)] py-3 last:border-0"
                >
                  <div className="flex items-center justify-between gap-3 font-mono">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <AgentAvatar skin={skinFor(skins, e.agentId)} variant={variant} size={22} />
                      <span className="truncate text-[12px] uppercase tracking-[0.12em] text-ink">
                        {nameFor(names, e.agentId)}
                      </span>
                    </div>
                    <span className="text-[11px] text-ink whitespace-nowrap">
                      {usdc(total.toString())}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full border border-[color:var(--hairline-strong)] bg-canvas-2">
                    <div className="h-full" style={{ width: `${pct}%`, background: accent }} />
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-3">
                    <span>RANK #{e.rank}</span>
                    <span className="flex items-center gap-2">
                      {research6 > 0n ? (
                        <span
                          className="text-accent"
                          title={`paid ${scout?.researchLabel ?? "research"} before sizing this run`}
                        >
                          ${(Number(research6) / 1e6).toFixed(4)}
                          {scout?.researchLabel ? ` · ${scout.researchLabel.toUpperCase()}` : " RESEARCH"}
                        </span>
                      ) : null}
                      <span>{ops} OPS</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </BracketedCell>
      </div>
    </div>
  );
}
