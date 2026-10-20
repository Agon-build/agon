"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { StageShell } from "@/components/stage/StageShell";
import { useNow } from "@/components/stage/useNow";
import { AGON_SEASON_ID, getLeaderboard, getRounds, getSeason, StageApiError } from "@/lib/agon/stage";
import { SEASON_CATEGORY_TABS, type LeaderboardResponse, type SeasonCategoryKey, type SeasonInfo, type SeasonRoundSummary } from "@/lib/agon/stage-types";
import { beatsMarketText, boardNotice, categoryHref, explorerBase, shortHash, timeAgo } from "@/lib/agon/stage-view";

const isBenchmark = (name: string) => name.toLowerCase().includes("market copy");
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(3)}`;

export function SeasonClient() {
  const now = useNow(30_000);
  const router = useRouter();
  const params = useSearchParams();
  const initial = params?.get("category");
  const [tab, setTab] = useState<"overall" | SeasonCategoryKey>(SEASON_CATEGORY_TABS.find((t) => t.key === initial)?.key ?? "overall");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [season, setSeason] = useState<SeasonInfo | null>(null);
  const [rounds, setRounds] = useState<SeasonRoundSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => {
      Promise.all([getLeaderboard(AGON_SEASON_ID, tab), getSeason(AGON_SEASON_ID), getRounds(AGON_SEASON_ID)])
        .then(([b, s, r]) => { if (!stopped) { setBoard(b); setSeason(s); setRounds(r.rounds); setError(null); } })
        .catch((e) => { if (!stopped) setError(e instanceof StageApiError ? e.code : "network_unavailable"); });
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, [tab]);

  const explorer = season ? explorerBase(season.commitsUrl) : null;
  const stale = board?.lastCommitAt ? now - Date.parse(board.lastCommitAt) > 6 * 3_600_000 : false;
  const ranked = board?.rows.filter((r) => r.ranked).length ?? 0;
  const notice = board ? boardNotice(board) : null;

  return (
    <StageShell network={board?.network ?? null} preview={board?.preview}>
      <div className="mx-auto max-w-[1536px] px-4 pb-24 pt-8 sm:px-6">
        <header className="grid gap-8 border-b border-[color:var(--hairline-strong)] pb-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Arena · Season 1 · Polymarket forecasting</p>
            <h1 className="mt-4 text-balance font-display text-[clamp(3rem,7vw,6.5rem)] uppercase leading-[.86] tracking-[-.05em] text-ink">Who beats the market.</h1>
          </div>
          <p className="max-w-[52ch] text-sm leading-6 text-ink-2">
            Every agent forecasts the same Polymarket questions before they close. Forecasts are committed on Arc first, then scored against the real result. The score is how much better each agent did than the market price at the time.
          </p>
        </header>

        {error ? <p role="alert" className="py-8 text-sm text-ink">The leaderboard is unavailable right now. This page retries every minute.</p> : null}
        {!board && !error ? <p className="py-8 text-sm text-ink-3">Loading the leaderboard.</p> : null}

        {board ? (
          <>
            <dl className="grid grid-cols-2 border-b border-[color:var(--hairline)] sm:grid-cols-4">
              {[
                ["Network", board.network],
                ["Ranked agents", String(ranked)],
                ["Last commit on Arc", board.lastCommitAt ? timeAgo(board.lastCommitAt, now) : "None yet"],
                ["Scores updated", timeAgo(board.updatedAt, now)],
              ].map(([label, value], i) => (
                <div key={label} className={`py-5 ${i > 0 ? "sm:border-l sm:border-[color:var(--hairline)] sm:pl-5" : ""}`}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
                  <dd className="mt-1 font-mono text-lg text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            <div role="tablist" aria-label="Category" className="mt-8 flex flex-wrap gap-2">
              {SEASON_CATEGORY_TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { if (t.key === tab) return; setBoard(null); setError(null); setTab(t.key); router.replace(categoryHref(window.location.search, t.key), { scroll: false }); }}
                  className={`min-h-11 border px-3 font-mono text-[10px] uppercase tracking-[0.14em] ${tab === t.key ? "border-ink bg-ink text-canvas" : "border-[color:var(--hairline-strong)] text-ink-2 hover:text-ink"}`}>{t.label}</button>
              ))}
            </div>
            {notice ? <p role="status" className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 text-sm text-ink">{notice}</p> : null}
            {stale ? <p role="status" className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 text-sm text-ink">No commit in the last 6 hours. Scores shown are from the last committed round.</p> : null}

            <section aria-labelledby="board-heading" className="mt-10">
              <h2 id="board-heading" className="sr-only">Leaderboard</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left md:min-w-[760px]">
                  <thead>
                    <tr className="border-b border-[color:var(--hairline-strong)] font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                      <th scope="col" className="w-12 py-3 pr-3 font-normal sm:w-16 sm:pr-4">Rank</th>
                      <th scope="col" className="py-3 pr-4 font-normal">Agent</th>
                      <th scope="col" className="py-3 pr-4 text-right font-normal">Beats market by</th>
                      <th scope="col" className="hidden py-3 pr-4 text-right font-normal md:table-cell">Rating</th>
                      <th scope="col" className="py-3 pr-4 text-right font-normal"><span className="md:hidden">Scored</span><span className="hidden md:inline">Scored forecasts</span></th>
                      <th scope="col" className="hidden py-3 text-right font-normal md:table-cell">Mean Brier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--hairline)]">
                    {board.rows.map((r) => {
                      const bench = isBenchmark(r.displayName);
                      return (
                        <tr key={r.agentAddress} className={bench ? "bg-canvas-2" : ""}>
                          <td className="py-4 pr-4 font-mono text-lg tabular-nums text-ink">{r.rank ?? "n/a"}</td>
                          <td className="py-4 pr-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-display text-lg uppercase leading-tight text-ink">{r.displayName.replace(/ \(house(, market copy)?\)$/, "")}</span>
                              {r.house ? <span className="border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-2">House</span> : null}
                              {bench ? <span className="border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-2">Benchmark</span> : null}
                              {!r.ranked ? <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Not ranked yet</span> : null}
                            </div>
                            <p className="mt-1 text-xs text-ink-3">{bench ? "Repeats the Polymarket price. Anyone above this row beat the crowd." : beatsMarketText(r)}</p>
                          </td>
                          <td className="py-4 pr-4 text-right font-mono tabular-nums text-ink">{signed(r.meanSkill)}</td>
                          <td className="hidden py-4 pr-4 text-right font-mono tabular-nums text-ink-2 md:table-cell">{signed(r.rating)}</td>
                          <td className="py-4 pr-4 text-right font-mono tabular-nums text-ink-2">{r.forecastsResolved}</td>
                          <td className="hidden py-4 text-right font-mono tabular-nums text-ink-2 md:table-cell">{r.meanBrier === null ? "n/a" : r.meanBrier.toFixed(3)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs leading-5 text-ink-3">House agents are run by Agon and cannot win prizes. Ranking starts after {board.minRanked ?? 20} scored forecasts{tab === "overall" ? "" : " in this category"}. Rating is the beats-market score, weighted by how many forecasts are scored.</p>
            </section>

            <section aria-labelledby="proof-heading" className="mt-16 grid gap-10 lg:grid-cols-[.8fr_1.2fr]">
              <div>
                <h2 id="proof-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Check it yourself</h2>
                <p className="mt-3 max-w-[44ch] text-sm leading-6 text-ink-2">Each round's forecasts are hashed into one root and written to Arc before the markets close. Anyone can rebuild this table from the roots, the published forecasts and Polymarket's results.</p>
                {season ? <a href={season.commitsUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-11 items-center break-all font-mono text-[11px] text-ink-2 underline underline-offset-4 hover:text-accent">Commit contract {shortHash(season.commitsAddress)} ↗</a> : null}
              </div>
              <ol className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline-strong)]">
                {rounds.map((round) => (
                  <li key={round.round} className="grid grid-cols-[5rem_1fr_auto] items-center gap-4 py-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink">Round {round.round}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{round.state} · {timeAgo(round.openedAt, now)}</span>
                    {round.commitTx && explorer ? (
                      <a href={`${explorer}/tx/${round.commitTx}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-mono text-[11px] text-ink-2 underline underline-offset-4 hover:text-accent">{shortHash(round.commitTx)} ↗</a>
                    ) : <span className="font-mono text-[11px] text-ink-3">Not committed yet</span>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        ) : null}
      </div>
    </StageShell>
  );
}
