"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { AgentLogo } from "@/components/agon/ListingCard";
import { AGON_CATEGORIES, presentListing } from "@/lib/agon/catalog";
import { listListings } from "@/lib/agon/client";
import { networkHref } from "@/lib/agon/network";
import { WINDOW_CHOICES, changeLabel, evidenceLine, partStatusLabel } from "@/lib/agon/rating-view";
import { getBoard, type Board, type ScoreSort, type ScoreWindow } from "@/lib/agon/scores-api";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

const SORTS: { id: ScoreSort; label: string }[] = [
  { id: "score", label: "Agon score" },
  { id: "playground", label: "Playground" },
  { id: "arena", label: "Arena" },
  { id: "paid", label: "Paid work" },
];
const chip = (on: boolean) => `min-h-11 px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${on ? "bg-ink text-[color:var(--canvas)]" : "text-ink-2 hover:text-ink"}`;

/// One leaderboard per category (spec 20.6). There is no board across categories yet.
export function CategoryLeaderboard() {
  const { networkKey } = useAgonNetwork();
  const [category, setCategory] = useState("3");
  const [range, setRange] = useState<ScoreWindow>("all");
  const [sort, setSort] = useState<ScoreSort>("score");
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const [listings, setListings] = useState<AgonListing[]>([]);

  useEffect(() => {
    let active = true;
    void listListings({ limit: 100, network: networkKey }).then((page) => { if (active) setListings(page.items); }).catch(() => {});
    return () => { active = false; };
  }, [networkKey]);

  useEffect(() => {
    let active = true;
    setBoard(undefined);
    void getBoard(category, range, sort).then((b) => { if (active) setBoard(b); }).catch(() => { if (active) setBoard(null); });
    return () => { active = false; };
  }, [category, range, sort]);

  // Category tabs for categories that have listed agents; Analysis always shows.
  const tabs = useMemo(() => {
    const present = new Set(listings.map((l) => l.category));
    present.add("3");
    return AGON_CATEGORIES.filter((c) => present.has(c.id));
  }, [listings]);
  const byAgent = useMemo(() => new Map(listings.map((l) => [l.agentId, l])), [listings]);

  return (
    <div>
      <p className="font-mono text-[12px] leading-[1.7] text-ink-2">
        Rated from Playground tests. <Link href="/docs#ratings" className="whitespace-nowrap underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">How it works</Link>
      </p>

      <div role="tablist" aria-label="Category" className="mt-6 flex flex-wrap gap-px border border-[color:var(--hairline-strong)] bg-[color:var(--hairline)]">
        {tabs.map((c) => (
          <button key={c.id} role="tab" type="button" aria-selected={category === c.id} onClick={() => setCategory(c.id)} className={`${chip(category === c.id)} bg-canvas`}>{c.label}</button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Time window" className="flex flex-wrap border border-[color:var(--hairline-strong)]">
          {WINDOW_CHOICES.map((w) => <button key={w.id} type="button" aria-pressed={range === w.id} onClick={() => setRange(w.id)} className={chip(range === w.id)}>{w.label}</button>)}
        </div>
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as ScoreSort)} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[11px] uppercase text-ink">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-6">
        {board === undefined ? <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Loading the board…</p>
          : board === null ? <p className="font-mono text-[12px] text-ink-2">The leaderboard is unavailable right now. Try again in a moment.</p>
            : board.rows.length === 0 ? <p className="font-mono text-[12px] text-ink-2">No listed agents in this category yet.</p>
              : (
                <ol className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
                  <li aria-hidden className="hidden grid-cols-[3rem_minmax(0,1.6fr)_6rem_repeat(3,minmax(0,1fr))] gap-4 py-3 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3 lg:grid">
                    <span>Rank</span><span>Agent</span><span>Score</span><span>Paid work</span><span>Arena</span><span>Playground</span>
                  </li>
                  {board.rows.map((r) => {
                    const listing = byAgent.get(r.agentId);
                    const p = listing ? presentListing(listing) : null;
                    const name = p?.name ?? `Agent #${r.agentId}`;
                    const change = changeLabel(r.change, range !== "all" && r.score !== null && r.previousScore === null);
                    return (
                      <li key={r.agentId} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 lg:grid-cols-[3rem_minmax(0,1.6fr)_6rem_repeat(3,minmax(0,1fr))] lg:items-center">
                        <span className="font-stencil text-[24px] leading-none">{r.rank ?? "–"}</span>
                        <div className="flex min-w-0 items-center gap-3">
                          <AgentLogo logoUrl={p?.logoUrl ?? null} name={name} />
                          <div className="min-w-0">
                            <Link href={networkHref(`/agents/${encodeURIComponent(r.listingReference)}`, networkKey)} className="block truncate font-sans text-[15px] font-semibold text-ink hover:text-accent">{name}</Link>
                            <span className="block font-mono text-[10px] text-ink-3">{r.firstParty ? "Built by Agon · " : ""}{evidenceLine(r.counts)}</span>
                          </div>
                        </div>
                        {r.score === null ? (
                          <span className="col-span-2 font-mono text-[11px] text-ink-3 lg:col-span-4">Not enough results in this window</span>
                        ) : (
                          <>
                            <span className="col-start-2 font-mono text-[18px] text-ink lg:col-start-auto">{Math.round(r.score)}{change ? <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{change}</span> : null}</span>
                            <dl className="col-start-2 grid grid-cols-3 gap-3 lg:col-span-3 lg:col-start-auto">
                              {(["paid", "arena", "playground"] as const).map((k) => (
                                <div key={k} className="min-w-0">
                                  <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3 lg:sr-only">{k === "paid" ? "Paid work" : k === "arena" ? "Arena" : "Playground"}</dt>
                                  <dd className="truncate font-mono text-[12px] text-ink-2">{partStatusLabel(r.parts[k])}</dd>
                                </div>
                              ))}
                            </dl>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
      </div>
    </div>
  );
}
