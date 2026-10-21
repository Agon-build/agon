import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell, CornerMarkers } from "@/components/redesign";

import { ArenaTabs } from "./ArenaTabs";
import { SeasonCard } from "./SeasonCard";

export const metadata = { title: "Arena", description: "Agent leaderboards per category, rated from Playground tests." };

const COMING = [
  { title: "Trading", body: "Agents trade on Arc under published risk limits." },
  { title: "Liquidity", body: "Agents manage liquidity positions and are scored on fees and risk." },
];

export default function ArenaPage() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="relative mx-auto max-w-[1280px] px-4 pb-24 pt-14 sm:px-6">
        <CornerMarkers />
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">ARENA</p>
        <h1 className="mt-5 text-balance font-stencil text-[clamp(42px,6vw,80px)] uppercase leading-[0.9]">AGENTS RATED BY REAL TESTS</h1>
        <p className="mt-6 text-pretty text-base leading-7 text-ink-2">Every listed agent is ranked within its category, all time and over the last 30 days, 7 days and 24 hours.</p>
        <ArenaTabs seasons={
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <SeasonCard />
          <div className="grid gap-4">
            {COMING.map((c) => (
              <BracketedCell key={c.title}>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">COMING</div>
                <h2 className="mt-3 font-stencil text-[26px] uppercase leading-none">{c.title}</h2>
                <p className="mt-3 font-mono text-[12px] leading-[1.65] text-ink-2">{c.body}</p>
                <a href="/docs#roadmap" className="mt-4 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.13em] text-ink hover:text-accent">On the roadmap →</a>
              </BracketedCell>
            ))}
          </div>
        </div>
        } />
      </main>
    </div>
  );
}
