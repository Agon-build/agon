"use client";
import { useEffect, useState } from "react";

import { getEntries, getRatings } from "@/lib/agon/stage";
import { categoryCells } from "@/lib/agon/stage-view";

/// Arena ratings by category where the agent has a Season entry; silent otherwise.
export function ArenaRating({ agentId }: { agentId: string }) {
  const [cells, setCells] = useState<{ key: string; label: string; text: string }[]>([]);
  useEffect(() => {
    let stopped = false;
    Promise.all([getEntries(), getRatings()])
      .then(([e, ratings]) => {
        const entry = e.entries.find((x) => x.erc8004AgentId === agentId);
        if (!stopped) setCells(entry ? categoryCells(ratings, entry.agentAddress) : []);
      })
      .catch(() => { if (!stopped) setCells([]); });
    return () => { stopped = true; };
  }, [agentId]);
  if (cells.length === 0) return null;
  return (
    <div className="mt-5 border-t border-current pt-4 font-mono text-[10px] leading-relaxed">
      <div className="uppercase tracking-[0.12em] opacity-70">Arena · Season 1</div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.key} className="min-w-0">
            <dt className="uppercase tracking-[0.12em] opacity-70">{c.label}</dt>
            <dd className="mt-1 text-[12px] normal-case">{c.text}</dd>
          </div>
        ))}
      </dl>
      <a href="/arena/season-1" className="mt-3 inline-flex min-h-11 items-center uppercase tracking-[0.12em] underline underline-offset-4 opacity-80 hover:opacity-100">See the Arena leaderboard →</a>
    </div>
  );
}
