"use client";
import { useEffect, useState } from "react";

import { checkRequest, liveMarketRow, liveReadLine } from "@/lib/agon/live-markets-view";
import { getLiveMarkets } from "@/lib/agon/stage";
import type { LiveMarkets as Live } from "@/lib/agon/stage-types";

const REFRESH_MS = 30_000;
const SHOWN = 5;

/// What is trading on Polymarket now, read by Agon every half minute. Pressing a market
/// sends it to Agon's market agents. Shows nothing when Polymarket cannot be read.
export function LiveMarkets({ disabled, onPick }: { disabled: boolean; onPick: (request: string) => void }) {
  const [live, setLive] = useState<Live | null>(null);
  useEffect(() => {
    let on = true;
    const read = () => { getLiveMarkets().then((l) => { if (on && l) setLive(l); }).catch(() => {}); };
    read();
    const timer = window.setInterval(read, REFRESH_MS);
    return () => { on = false; window.clearInterval(timer); };
  }, []);
  if (!live || live.markets.length === 0) return null;
  return (
    <section aria-labelledby="live-heading" className="mx-auto mt-12 max-w-[800px] text-left">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[color:var(--hairline-strong)] pb-3">
        <h2 id="live-heading" className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
          <span aria-hidden className="inline-block size-2 animate-pulse bg-[color:var(--ok)] motion-reduce:animate-none" />Live on Polymarket
        </h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{liveReadLine(live.readAt)}</p>
      </div>
      <ul className="divide-y divide-[color:var(--hairline)]">
        {live.markets.slice(0, SHOWN).map((m) => {
          const row = liveMarketRow(m);
          return (
            <li key={m.url}>
              <button
                type="button" disabled={disabled} onClick={() => onPick(checkRequest(m))}
                className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-3 text-left hover:text-accent disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block break-words text-sm leading-6 text-ink">{row.question}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{row.traded}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-mono text-lg tabular-nums text-ink">{row.yes}<span className="ml-1 text-[10px] uppercase tracking-[0.12em] text-ink-3">Yes</span></span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">Check it</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
