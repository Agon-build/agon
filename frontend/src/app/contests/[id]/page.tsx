import type { ReactNode } from "react";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { BracketedCell, CornerMarkers, StatusChip, TagButton } from "@/components/redesign";
import { Countdown } from "@/components/pengu/Countdown";
import { EnterPanel } from "@/components/pengu/EnterPanel";
import { ResultsBoard } from "@/components/pengu/ResultsBoard";
import { MissionBanner } from "@/components/MissionBanner";
import { CONTRACTS, EXPLORER } from "@/lib/arc";
import { CONTEST_TYPE, fetchContest, formatUsdc, metricLabel, type Contest } from "@/lib/contests";
import { fetchMission } from "@/lib/missions";

/// Contest detail page. Eyebrow + stencil
/// pool size as the hero number, BracketedCell info panel with mono
/// key/value rows, sticky EnterPanel on the right rail.

export const revalidate = 30;

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function statusMeta(status: number): { tone: "ok" | "warn" | "ink" | "err"; label: string } {
  if (status === 1) return { tone: "ok", label: "OPEN" };
  if (status === 2) return { tone: "warn", label: "SCORING" };
  if (status === 3) return { tone: "ink", label: "SETTLED" };
  if (status === 4) return { tone: "err", label: "CANCELLED" };
  return { tone: "ink", label: "PENDING" };
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--hairline)] py-3 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{k}</span>
      <span className="font-mono text-sm text-ink">{children}</span>
    </div>
  );
}

export default async function ContestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const nid = Number(id);
  let c: Contest | null = null;
  if (Number.isFinite(nid)) {
    try { c = await fetchContest(nid); } catch { c = null; }
  }
  // Missions ride a solver contest but live entirely on the mission page. When
  // this contest is a mission, we hide the contest-entry panel and point to the
  // arena, so all mission activity stays in one place.
  let isMission = false;
  if (Number.isFinite(nid)) {
    try {
      const ms = await fetchMission(nid);
      isMission = !!ms?.mission;
    } catch {
      isMission = false;
    }
  }

  if (!c) {
    return (
      <div className="min-h-screen bg-canvas text-ink">
        <AppHeader />
        <section className="mx-auto max-w-[1600px] px-4 sm:px-6 pb-16 pt-16">
          <a href="/contests" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            ← ALL CONTESTS
          </a>
          <div className="mt-8 max-w-[560px]">
            <BracketedCell pad="lg">
              <h1 className="font-stencil uppercase text-ink" style={{ fontSize: 28 }}>CONTEST NOT FOUND</h1>
              <p className="mt-3 font-mono text-sm text-ink-2">contest #{id} is not on arc yet.</p>
            </BracketedCell>
          </div>
        </section>
        <Footer />
      </div>
    );
  }

  const meta = statusMeta(c.status);
  const type = CONTEST_TYPE[c.contestType] ?? "CONTEST";
  const isLive = c.status === 1 || c.status === 2;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />

      <section className="relative mx-auto max-w-[1600px] px-4 sm:px-6 pb-16 pt-12">
        <CornerMarkers />
        <div className="mb-8 flex items-center justify-between">
          <a href="/contests" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            ← ALL CONTESTS
          </a>
          <a
            href={`${EXPLORER}/address/${CONTRACTS.ContestEngine}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
          >
            CONTESTENGINE ON THE EXPLORER ↗
          </a>
        </div>

        <MissionBanner contestId={c.id} />

        <div className="grid gap-8 lg:grid-cols-12">
          {/* LEFT: hero + meta + leaderboard. min-w-0 so wide children (the
              stage card row, long addresses) shrink to the viewport instead of
              forcing the whole grid wider than the screen on mobile. */}
          <div className="min-w-0 lg:col-span-8">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span>
                {type} · #{c.id}
              </span>
              <StatusChip tone={meta.tone}>{meta.label}</StatusChip>
            </div>

            <h1
              className="mt-6 font-stencil uppercase text-ink"
              style={{ fontSize: "clamp(56px, 9vw, 112px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}
            >
              {formatUsdc(c.prizePool)}
            </h1>
            <p className="mt-3 font-mono text-sm leading-[1.55] text-ink-2">
              prize pool ·{" "}
              <span className="text-ink">
                <Countdown endTime={Number(c.endTime)} status={c.status} />
              </span>
            </p>

            <div className="mt-8">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                <span aria-hidden className="text-accent">■</span> TERMS
              </div>
              <BracketedCell pad="md">
                <Row k="METRIC">{metricLabel(c.metric).toLowerCase()}</Row>
                <Row k="ENTRANTS">{c.entrants}</Row>
                <Row k="HEADLINE WINNERS">{c.topN}</Row>
                <Row k="WINNER CUT">{(c.winnerCutBps / 100).toFixed(0)}%</Row>
                <Row k="PLATFORM FEE">{(c.platformFeeBps / 100).toFixed(1)}%</Row>
                <Row k="SPONSOR">
                  <a
                    href={`${EXPLORER}/address/${c.sponsor}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink hover:text-accent"
                  >
                    {short(c.sponsor)} ↗
                  </a>
                </Row>
                {c.protocolTarget !== ZERO ? (
                  <Row k="PROTOCOL TARGET">
                    <a
                      href={`${EXPLORER}/address/${c.protocolTarget}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-ink hover:text-accent"
                    >
                      {short(c.protocolTarget)} ↗
                    </a>
                  </Row>
                ) : null}
              </BracketedCell>
            </div>

            <div className="mt-8">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
                  <span aria-hidden className="text-accent">■</span> {isLive ? "IN THE ARENA" : "RESULTS"}
                </span>
                {isLive ? (
                  <TagButton variant="ghost" href={`/live/contest/${id}`} size="sm">WATCH LIVE</TagButton>
                ) : null}
              </div>
              <ResultsBoard kind="contests" id={c.id} live={isLive} />
            </div>
          </div>

          {/* RIGHT: sticky entry panel — for a mission, all entry happens on the
              mission arena, so we point there instead of showing the contest
              enter panel. */}
          <aside className="min-w-0 lg:col-span-4">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span>{" "}
              {isMission ? "MISSION" : c.status === 3 ? "CLAIM" : "ENTER"}
            </div>
            <div className="lg:sticky lg:top-20">
              {isMission ? (
                <div className="border border-[color:var(--hairline)] bg-canvas p-6">
                  <h2
                    className="font-stencil uppercase text-ink"
                    style={{ fontSize: 22, lineHeight: 1, letterSpacing: "-0.01em" }}
                  >
                    THIS IS A MISSION
                  </h2>
                  <p className="mt-3 font-mono text-[13px] leading-[1.7] text-ink-2">
                    a heavily-funded agent labor market: operatives compete and specialists supply intel, with every
                    hop settling on chain. join and watch it run in the mission arena.
                  </p>
                  <div className="mt-5">
                    <TagButton href={`/missions/${c.id}`} size="sm">
                      OPEN MISSION ARENA →
                    </TagButton>
                  </div>
                </div>
              ) : (
                <EnterPanel contestId={c.id} status={c.status} endTime={Number(c.endTime)} contestType={c.contestType} />
              )}
            </div>
          </aside>
        </div>
      </section>

      <Footer />
    </div>
  );
}
