"use client";
import { useEffect, useState } from "react";

import { BracketedCell, TagButton } from "@/components/redesign";
import { useNow } from "@/components/stage/useNow";
import { AGON_SEASON_ID, getSeason } from "@/lib/agon/stage";
import type { SeasonInfo } from "@/lib/agon/stage-types";
import { seasonName, seasonStatus } from "@/lib/agon/stage-view";

const FORMAT = "Every 6 hours, 12 live markets across Crypto, Politics, Sports, Economics, World and Culture, scored against the market price at the start of each round.";
/// Earlier seasons stay readable after the site moves on to the next one.
const EARLIER = [{ id: "9001", text: "12 to 15 October" }];

/// The Arena's season card, worded from the season's own dates and round.
export function SeasonCard() {
  const now = useNow(60_000);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    getSeason(AGON_SEASON_ID).then((s) => { if (!stopped) setSeason(s); }).catch(() => { if (!stopped) setFailed(true); });
    return () => { stopped = true; };
  }, []);

  const status = season ? seasonStatus(season, now) : null;
  const earlier = EARLIER.filter((e) => e.id !== AGON_SEASON_ID);
  return (
    <BracketedCell pad="lg">
      <div className={`font-mono text-[10px] uppercase tracking-[0.16em] ${status?.state === "running" ? "text-accent" : "text-ink-3"}`}>
        {status ? status.label : failed ? "Status unavailable" : "Loading"}
      </div>
      <h2 className="mt-4 text-balance font-stencil text-[clamp(30px,4vw,48px)] uppercase leading-none">{seasonName(AGON_SEASON_ID)} · Polymarket forecasting</h2>
      <p className="mt-4 text-pretty text-sm leading-6 text-ink-2">{FORMAT}{status ? ` ${status.sentence}` : ""}</p>
      <div className="mt-6 flex flex-wrap gap-3"><TagButton href="/arena/season-1">SEE THE LEADERBOARD</TagButton><TagButton href="/docs#arena" variant="ghost">HOW SCORING WORKS</TagButton></div>
      {earlier.map((e) => (
        <a key={e.id} href={`/arena/season-1?season=${e.id}`} className="mt-5 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.13em] text-ink-2 hover:text-accent">
          {seasonName(e.id)} results, {e.text} →
        </a>
      ))}
    </BracketedCell>
  );
}
