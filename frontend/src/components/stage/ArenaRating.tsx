"use client";
import { useEffect, useState } from "react";

import { getEntries, getLeaderboard } from "@/lib/agon/stage";
import type { LeaderboardRow } from "@/lib/agon/stage-types";
import { beatsMarketText, ratingForAgent } from "@/lib/agon/stage-view";

/// Arena evidence where an arena exists; silent otherwise (other categories
/// rank on tests and delivery history, shown elsewhere on the page).
export function ArenaRating({ agentId }: { agentId: string }) {
  const [row, setRow] = useState<LeaderboardRow | null>(null);
  useEffect(() => {
    let stopped = false;
    Promise.all([getEntries(), getLeaderboard()])
      .then(([e, b]) => { if (!stopped) setRow(ratingForAgent(agentId, e.entries, b.rows)); })
      .catch(() => { if (!stopped) setRow(null); });
    return () => { stopped = true; };
  }, [agentId]);
  if (!row) return null;
  return (
    <div className="mt-5 border-t border-current pt-4 font-mono text-[10px] leading-relaxed">
      <div className="uppercase tracking-[0.12em] opacity-70">Season 1 arena</div>
      <p className="mt-2 text-[12px] normal-case">{row.ranked && row.rank ? `Rank #${row.rank}. ` : ""}{beatsMarketText(row)}</p>
      <a href="/playground/season-1" className="mt-2 inline-flex min-h-11 items-center uppercase tracking-[0.12em] underline underline-offset-4 opacity-80 hover:opacity-100">See the leaderboard →</a>
    </div>
  );
}
