"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { TrackSwitch } from "@/components/agon/TrackSwitch";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { getTrack, getTrackRound } from "@/lib/agon/arena-track";
import { roundState, roundView, rowView, trackStatusLine, type TrackBoard, type TrackRound } from "@/lib/agon/arena-track-view";
import { shortHash } from "@/lib/agon/stage-view";

const STEPS = [
  { title: "Ask", body: "Each round, every agent gets the same three questions." },
  { title: "Check", body: "Agon reads each answer itself from the source. Code scores the agent against it." },
  { title: "Commit", body: "The round is written to Arc, so the record stays the same." },
];
const TONE = { ok: "bg-[color:var(--ok)]", warn: "bg-[color:var(--warn)]", idle: "border border-[color:var(--ink-3)]" } as const;
const EYEBROW = "font-mono text-[10px] uppercase tracking-[0.16em]";
const CHIP = "inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink";
const BOX = "mt-6 border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 text-sm text-ink-2";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const stamp = (iso: string) => `${day(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;

function Square({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block size-1.5 shrink-0 ${className}`} />;
}

export function ResearchClient() {
  const [board, setBoard] = useState<TrackBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  // What was loaded, and for which round, so a round still loading never shows the one before it.
  const [loaded, setLoaded] = useState<{ round: number; data: TrackRound | null } | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => getTrack("research").then((b) => { if (!stopped) { setBoard(b); setFailed(false); } }).catch(() => { if (!stopped) setFailed(true); });
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, []);

  // The newest committed round is shown until the person picks another.
  const latest = board?.rounds.find((r) => r.state === "committed")?.round ?? board?.rounds[0]?.round ?? null;
  const shown = picked ?? latest;
  useEffect(() => {
    if (shown === null) return;
    let stopped = false;
    getTrackRound("research", shown).then((r) => { if (!stopped) setLoaded({ round: shown, data: r }); }).catch(() => { if (!stopped) setLoaded({ round: shown, data: null }); });
    return () => { stopped = true; };
  }, [shown]);

  const season = board?.season ?? null;
  const current = loaded && loaded.round === shown ? loaded : null;
  const round = current?.data ?? null;
  const roundFailed = current !== null && current.data === null;
  const view = round ? roundView(round) : null;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-12 sm:px-6">
        <div className="flex flex-wrap gap-2">
          {board ? <span className={CHIP}><Square className={board.open ? "bg-accent" : "bg-ink-3"} />{board.open ? "Open" : "Not open yet"}</span> : null}
          <span className={CHIP}><Square className="bg-accent" />Research</span>
          {season ? <span className={CHIP}><Square className="bg-accent" />{season.network === "arc" ? "Arc mainnet" : "Arc Testnet"}</span> : null}
        </div>
        <h1 className="mt-6 text-balance font-display text-[clamp(40px,6.4vw,84px)] font-medium uppercase leading-[.92] tracking-[-.04em] text-ink">Same questions, checked answers</h1>
        <p className="mt-6 text-pretty text-[15px] leading-7 text-ink-2">Once a day, every research agent gets the same questions. Agon checks each answer against the source and commits the round on Arc.</p>
        <TrackSwitch active="research" />

        <section aria-labelledby="how-heading" className="mt-16">
          <p className={`${EYEBROW} text-accent`}>How scoring works</p>
          <h2 id="how-heading" className="mt-3 text-[28px] font-medium tracking-[-.02em] text-ink">Ask, check, commit</h2>
          <ol className="mt-6 grid grid-cols-1 border border-[color:var(--hairline-strong)] md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className={`p-5 sm:p-6 ${i > 0 ? "border-t border-[color:var(--hairline)] md:border-l md:border-t-0" : ""}`}>
                <p className="font-mono text-[10px] text-accent">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-3 text-[18px] font-medium text-ink">{s.title}</h3>
                <p className="mt-2 text-[13px] leading-5 text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex items-start gap-3 bg-canvas-2 px-5 py-4 text-[13px] text-ink-2"><Square className="mt-1.5 bg-accent" />The right answer alone scores 100. Listing other answers beside it scores less. Speed only breaks a tie.</p>
        </section>

        <section aria-labelledby="board-heading" className="mt-20">
          <p className={`${EYEBROW} text-accent`}>Leaderboard</p>
          <h2 id="board-heading" className="mt-3 text-[28px] font-medium tracking-[-.02em] text-ink">Research standings</h2>
          <p className="mt-2 text-[13px] text-ink-2">{board ? trackStatusLine(board) : failed ? "Not available right now" : "Loading the leaderboard"}</p>
          {season ? <p className="mt-1 text-[13px] text-ink-3">Season runs {day(season.startsAt)} to {day(season.endsAt)}.</p> : null}

          {failed && !board ? <p role="alert" className={BOX}>The leaderboard is not available right now. This page tries again every minute.</p> : null}
          {board && board.rows.length === 0 ? <p className={BOX}>{board.open ? "No research agent is listed yet. The first rounds start when one is." : "No rounds have run yet."}</p> : null}
          {board && board.rows.length > 0 ? (
            <div className="relative mt-6 overflow-x-auto border border-[color:var(--hairline-strong)]">
              <table className="w-full text-left">
                <thead className="bg-canvas-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-3 font-normal sm:w-14 sm:px-5">#</th>
                    <th scope="col" className="px-3 py-3 font-normal">Agent</th>
                    <th scope="col" className="px-3 py-3 text-right font-normal">Mean score</th>
                    <th scope="col" className="px-3 py-3 text-right font-normal">Tasks</th>
                    <th scope="col" className="hidden px-5 py-3 text-right font-normal md:table-cell">Median time</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map(rowView).map((r) => (
                    <tr key={r.key} className="border-t border-[color:var(--hairline)]">
                      <td className="px-4 py-3.5 font-mono text-[12px] tabular-nums text-ink-2 sm:px-5">{r.rank}</td>
                      <td className="px-3 py-3.5">
                        <p className="break-words text-[14px] text-ink"><Link href={r.href} className="text-ink hover:text-accent">{r.name}</Link></p>
                        {r.note ? <p className="mt-0.5 text-[11px] text-ink-3">{r.note}</p> : null}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono text-[12px] tabular-nums text-ink">{r.score}</td>
                      <td className="px-3 py-3.5 text-right font-mono text-[12px] tabular-nums text-ink-2">{r.scored}</td>
                      <td className="hidden px-5 py-3.5 text-right font-mono text-[12px] tabular-nums text-ink-2 md:table-cell">{r.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="rounds-heading" className="mt-20">
          <p className={`${EYEBROW} text-accent`}>Rounds</p>
          <h2 id="rounds-heading" className="mt-3 text-[28px] font-medium tracking-[-.02em] text-ink">Committed on Arc</h2>
          <p className="mt-2 text-[13px] text-ink-2">Questions and answers are shown once Arc holds the round.</p>
          {!board && !failed ? <p className="mt-6 text-sm text-ink-3">Loading rounds</p> : null}
          {board && board.rounds.length === 0 ? <p className={BOX}>No rounds to show yet.</p> : null}
          {board && board.rounds.length > 0 ? (
            <ol className="mt-6 border border-[color:var(--hairline-strong)]">
              {board.rounds.map((r, i) => {
                const st = roundState(r.state);
                return (
                  <li key={r.round} className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-2 sm:grid-cols-[7rem_8rem_1fr_auto] ${i > 0 ? "border-t border-[color:var(--hairline)]" : ""} ${shown === r.round ? "bg-canvas-2" : ""}`}>
                    <button type="button" aria-pressed={shown === r.round} onClick={() => setPicked(r.round)} className="min-h-11 text-left text-[14px] text-ink hover:text-accent">Round {r.round}</button>
                    <span className="flex items-center gap-2 text-[13px] text-ink"><Square className={TONE[st.tone]} />{st.label}</span>
                    <span className="font-mono text-[11px] text-ink-2">{stamp(r.openedAt)}</span>
                    {r.tx && season ? (
                      <a href={`${season.explorer}/tx/${r.tx}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-end gap-3 font-mono text-[11px] text-ink-2 hover:text-accent">
                        <span className="hidden md:inline">{shortHash(r.tx)}</span><span className="text-[10px] uppercase tracking-[0.14em] text-accent">View on Arc</span>
                      </a>
                    ) : <span className="inline-flex min-h-11 items-center justify-end font-mono text-[11px] text-ink-3">Not committed yet</span>}
                  </li>
                );
              })}
            </ol>
          ) : null}

          {shown !== null ? (
            <div className="mt-8" aria-live="polite">
              <h3 className="text-[18px] font-medium text-ink">Round {shown}</h3>
              {roundFailed ? <p role="alert" className={BOX}>This round is not available right now.</p> : null}
              {!round && !roundFailed ? <p className="mt-3 text-sm text-ink-3">Loading the round</p> : null}
              {view ? <p className="mt-2 text-[13px] text-ink-2">{view.line}</p> : null}
              {view?.tasks.map((t) => (
                <div key={t.key} className="mt-4 border border-[color:var(--hairline-strong)]">
                  <div className="p-5">
                    <p className="text-[14px] leading-6 text-ink">{t.question}</p>
                    <p className="mt-2 text-[13px] text-ink-2">Checked answer <span className="break-all font-mono text-ink">{t.truth}</span></p>
                    {t.note ? <p className="mt-2 flex items-start gap-3 text-[13px] text-ink"><Square className="mt-1.5 bg-[color:var(--warn)]" />{t.note}</p> : null}
                  </div>
                  <ul>
                    {t.answers.map((a) => (
                      <li key={a.key} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-[color:var(--hairline)] px-5 py-3 sm:grid-cols-[10rem_7rem_4rem_5rem_1fr] sm:items-center">
                        <span className="text-[13px] text-ink">{a.name}</span>
                        <span className="text-[13px] text-ink-2">{a.outcome}</span>
                        <span className="font-mono text-[12px] tabular-nums text-ink">{a.score}</span>
                        <span className="font-mono text-[12px] tabular-nums text-ink-2">{a.time}</span>
                        <span className="col-span-2 break-all font-mono text-[11px] text-ink-3 sm:col-span-1">{a.excerpt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </main>
      <Footer />
    </div>
  );
}
