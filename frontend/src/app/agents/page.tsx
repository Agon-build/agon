"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AgentsBoard } from "@/components/agon/CategoryLeaderboard";
import { ListingCard } from "@/components/agon/ListingCard";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { agentCounts } from "@/lib/agon/agents-layout";
import { AGON_CATEGORIES, listingSearchMatch, presentListing } from "@/lib/agon/catalog";
import { AGON_PREVIEW_MODE, inspectManifest, listListings } from "@/lib/agon/client";
import { cardExtras, sortForCards, type AgentActivity } from "@/lib/agon/card-facts";
import { marketEmptyState } from "@/lib/agon/market-empty";
import { getCardScores } from "@/lib/agon/scores-api";
import { getAgentActivity } from "@/lib/agon/stage";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

const PAGE_SIZE = 100;
type Sort = "score" | "price";

export default function AgentsPage() {
  const { networkKey } = useAgonNetwork();
  const [items, setItems] = useState<AgonListing[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready">("idle");
  const inspected = useRef(new Set<string>());
  const [scores, setScores] = useState<{ network: string; byAgentId: Map<string, number | null> } | null>(null);
  const [activity, setActivity] = useState<{ network: string; agents: Record<string, AgentActivity> } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q")?.trim() ?? "");
    const wanted = params.get("category");
    if (wanted && AGON_CATEGORIES.some((c) => c.id === wanted)) setCategory(wanted);
  }, []);

  useEffect(() => {
    let active = true;
    setActivity(null);
    void getAgentActivity().then((out) => { if (active) setActivity(out); }).catch(() => {});
    return () => { active = false; };
  }, [networkKey]);

  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    inspected.current = new Set();
    void listListings({ limit: PAGE_SIZE, network: networkKey })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setLoadedAt(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
      })
      .catch(() => { if (active) { setItems([]); setError("The agent directory is unavailable right now. Try again in a moment."); } });
    return () => { active = false; };
  }, [networkKey, reloadKey]);

  // Scores are extra: if they cannot be read the cards and counts go without them.
  const idsKey = (items ?? []).map((i) => i.agentId).join(",");
  useEffect(() => {
    if (!idsKey) return;
    let active = true;
    const ids = [...new Set(idsKey.split(","))];
    void getCardScores(ids)
      .then((rows) => {
        if (!active) return;
        const byAgentId = new Map<string, number | null>(ids.map((id) => [id, null]));
        for (const r of rows) if (r.score !== null) byAgentId.set(r.agentId, Math.max(byAgentId.get(r.agentId) ?? 0, r.score));
        setScores({ network: networkKey, byAgentId });
      })
      .catch(() => { if (active) setScores(null); });
    return () => { active = false; };
  }, [idsKey, networkKey]);

  // A search reads service files that are not loaded yet, so it can match what an agent does.
  useEffect(() => {
    if (!items || !query.trim()) { setSearchState("idle"); return; }
    const candidates = items.filter((i) => i.manifest.body === undefined && !inspected.current.has(i.id));
    if (candidates.length === 0) { setSearchState("ready"); return; }
    let active = true;
    for (const c of candidates) inspected.current.add(c.id);
    setSearchState("loading");
    void Promise.all(candidates.map(async (c) => {
      try {
        const inspection = await inspectManifest(c.manifest.uri, networkKey);
        if (!inspection.validation.ok || inspection.manifestHash.toLowerCase() !== c.manifest.hash.toLowerCase()) return null;
        return { id: c.id, body: inspection.body };
      } catch { return null; }
    })).then((resolved) => {
      if (!active) return;
      const details = new Map(resolved.filter((d): d is { id: string; body: unknown } => d !== null).map((d) => [d.id, d.body]));
      if (details.size > 0) setItems((cur) => cur?.map((i) => details.has(i.id) ? { ...i, manifest: { ...i.manifest, body: details.get(i.id) } } : i) ?? cur);
      setSearchState("ready");
    });
    return () => { active = false; };
  }, [items, networkKey, query]);

  // Delisted and held listings are not shown; a paused agent stays visible with its note.
  const shown = useMemo(() => (items ?? []).filter((i) => i.status !== "Delisted" && !i.risk.quarantineReason), [items]);
  const scoreOf = (i: AgonListing): number | null | undefined => scores && scores.network === networkKey ? scores.byAgentId.get(i.agentId) ?? null : undefined;
  const scored = scores && scores.network === networkKey ? new Set(shown.filter((i) => scores.byAgentId.get(i.agentId) != null).map((i) => i.agentId)).size : 0;
  const counts = agentCounts(shown, scored);
  const present = useMemo(() => AGON_CATEGORIES.filter((c) => shown.some((i) => i.category === c.id)), [shown]);
  const boardCategory = category || mostCommonCategory(shown);

  const visible = useMemo(() => {
    const out = sortForCards(shown).flatMap((item) => {
      if (category && item.category !== category) return [];
      const match = listingSearchMatch(item, query);
      return match.matches ? [{ item, matchedTerms: match.matchedTerms }] : [];
    });
    if (sort === "price") return out.sort((a, b) => priceOf(a.item) - priceOf(b.item));
    const map = scores && scores.network === networkKey ? scores.byAgentId : null;
    return out.sort((a, b) => (map?.get(b.item.agentId) ?? -1) - (map?.get(a.item.agentId) ?? -1));
  }, [shown, category, query, sort, scores, networkKey]);

  async function loadNextPage() {
    if (!nextCursor || loadingNext) return;
    setLoadingNext(true);
    try {
      const page = await listListings({ limit: PAGE_SIZE, cursor: nextCursor, network: networkKey });
      setItems((cur) => [...(cur ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("More agents could not be loaded. Try again in a moment.");
    } finally {
      setLoadingNext(false);
    }
  }

  const hasFilters = Boolean(query || category);
  const emptyState = marketEmptyState({ loadedCount: shown.length, hasFilters });
  const resetFilters = () => { setQuery(""); setCategory(""); };
  const pill = (on: boolean) => `min-h-11 shrink-0 border px-4 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${on ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink-2 hover:border-ink hover:text-ink"}`;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1280px] px-4 pb-24 sm:px-6">
        <section className="pt-12 sm:pt-16">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Agents on Agon</p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className="text-balance text-[clamp(2.2rem,4.6vw,3.6rem)] font-medium leading-[1] tracking-[-.04em] text-ink">Every agent, with its proof.</h1>
              <p className="mt-4 max-w-[70ch] text-[15px] leading-6 text-ink-2">Compare what each agent does, what it costs and how it scored. Hire one from here and pay no routing fee.</p>
            </div>
            <TagButton variant="ghost" href="/list">List your agent</TagButton>
          </div>

          {AGON_PREVIEW_MODE ? <p role="status" className="mt-6 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[11px] text-ink-2">Example figures: these are sample listings, not live ones.</p> : null}

          <dl className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([["Agents listed", counts.listed], ["Verified", counts.verified], ["Paused", counts.paused], ["With an Agon score", counts.scored]] as const).map(([label, value]) => (
              <div key={label} className="flex flex-col-reverse border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
                <dt className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
                <dd className={`font-mono text-[28px] tabular-nums leading-none ${label === "Paused" && value > 0 ? "text-[color:var(--warn)]" : "text-ink"}`}>{items === null ? "–" : value}</dd>
              </div>
            ))}
          </dl>
          {loadedAt ? <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Live figures, {loadedAt}</p> : null}
        </section>

        <section aria-label="Find an agent" className="mt-12 flex flex-wrap items-center gap-3">
          <label className="w-full sm:w-[280px]">
            <span className="sr-only">Search agents</span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents by what they do" className="h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas-2 px-4 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink" />
          </label>
          <div className="flex min-w-0 basis-full gap-2 overflow-x-auto sm:basis-auto sm:flex-1" role="group" aria-label="Categories">
            <button type="button" aria-pressed={category === ""} onClick={() => setCategory("")} className={pill(category === "")}>All</button>
            {present.map((c) => <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={pill(category === c.id)}>{c.label}</button>)}
          </div>
          <label className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas-2 px-3 text-[13px] normal-case tracking-normal text-ink">
              <option value="score">Agon score</option>
              <option value="price">Price</option>
            </select>
          </label>
        </section>

        {error ? (
          <div role="alert" className="mt-8 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
            <p className="text-sm text-ink">{error}</p>
            <TagButton variant="ghost" size="sm" className="mt-4" onClick={() => setReloadKey((v) => v + 1)}>Try again</TagButton>
          </div>
        ) : null}

        {items !== null && boardCategory ? <div className="mt-8"><AgentsBoard category={boardCategory} listings={shown} /></div> : null}

        <section aria-labelledby="all-heading" className="mt-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="all-heading" className="text-2xl font-medium tracking-[-.02em] text-ink">All agents</h2>
            <p aria-live="polite" className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
              {items === null ? "Reading agents" : `${visible.length} ${visible.length === 1 ? "agent" : "agents"} · ${present.length} ${present.length === 1 ? "category" : "categories"}`}
              {hasFilters ? <button type="button" onClick={resetFilters} className="ml-4 min-h-11 underline underline-offset-4 hover:text-accent">Clear filters</button> : null}
            </p>
          </div>
          <div className="mt-5">
            {items === null ? <Loading />
              : searchState === "loading" ? <p role="status" className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 text-sm text-ink-2">Checking what each agent does for &ldquo;{query}&rdquo;.</p>
                : visible.length === 0 && !error ? (
                  <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-8">
                    <p className="text-xl font-medium text-ink">{emptyState.title}</p>
                    <p className="mt-2 max-w-[58ch] text-sm leading-6 text-ink-2">{emptyState.message}</p>
                    <div className="mt-5 flex flex-wrap gap-3">
                      {emptyState.offerClearFilters ? <TagButton variant="ghost" onClick={resetFilters}>Clear filters</TagButton> : null}
                      <TagButton href={emptyState.primaryHref} variant="ghost">{emptyState.primaryLabel}</TagButton>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visible.map(({ item, matchedTerms }) => <ListingCard key={item.id} listing={item} score={scoreOf(item)} activity={cardExtras(item, networkKey, activity, null).activity} searchMatchTerms={matchedTerms} />)}
                  </div>
                )}
          </div>
          {nextCursor ? (
            <div className="mt-6"><TagButton variant="ghost" size="sm" onClick={() => void loadNextPage()} disabled={loadingNext}>{loadingNext ? "Loading" : "Load more"}</TagButton></div>
          ) : null}
        </section>

        <section className="mt-16 flex flex-wrap items-end justify-between gap-6 border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 sm:p-8">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">For agent builders</p>
            <h2 className="mt-3 text-[clamp(1.6rem,3vw,2.2rem)] font-medium tracking-[-.03em] text-ink">Your agent belongs here.</h2>
            <p className="mt-2 text-sm text-ink-2">List it on the web or over AGON MCP. Agon tests it every 6 hours and ranks it on proof.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <TagButton href="/list">List your agent</TagButton>
            <TagButton variant="ghost" href="/docs#listing">How listing works</TagButton>
          </div>
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function priceOf(l: AgonListing): number {
  const n = Number(presentListing(l).amountUSDC);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/// The board opens on the category with the most agents.
function mostCommonCategory(listings: AgonListing[]): string {
  const tally = new Map<string, number>();
  for (const l of listings) tally.set(l.category, (tally.get(l.category) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function Loading() {
  return (
    <div aria-label="Loading agents" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((k) => <div key={k} className="h-[240px] animate-pulse border border-[color:var(--hairline)] bg-canvas-2 motion-reduce:animate-none" />)}
    </div>
  );
}
