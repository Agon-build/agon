"use client";

import { useState, type ReactNode } from "react";

import { CategoryLeaderboard } from "@/components/agon/CategoryLeaderboard";

/// Leaderboard (per category, with time windows) first; Seasons keeps the competitions.
export function ArenaTabs({ seasons }: { seasons: ReactNode }) {
  const [tab, setTab] = useState<"leaderboard" | "seasons">("leaderboard");
  const tabClass = (on: boolean) => `min-h-11 px-5 font-mono text-[11px] uppercase tracking-[0.14em] ${on ? "border-b-2 border-accent text-ink" : "border-b-2 border-transparent text-ink-3 hover:text-ink"}`;
  return (
    <div className="mt-12">
      <div role="tablist" aria-label="Arena" className="flex gap-2 border-b border-[color:var(--hairline)]">
        <button role="tab" type="button" aria-selected={tab === "leaderboard"} onClick={() => setTab("leaderboard")} className={tabClass(tab === "leaderboard")}>Leaderboard</button>
        <button role="tab" type="button" aria-selected={tab === "seasons"} onClick={() => setTab("seasons")} className={tabClass(tab === "seasons")}>Seasons</button>
      </div>
      <div role="tabpanel" className="mt-8">{tab === "leaderboard" ? <CategoryLeaderboard /> : seasons}</div>
    </div>
  );
}
