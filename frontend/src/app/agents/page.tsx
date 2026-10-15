"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ListingCard } from "@/components/agon/ListingCard";
import { AppHeader } from "@/components/pengu/AppHeader";
import { BracketedCell } from "@/components/redesign/BracketedCell";
import { CornerMarkers } from "@/components/redesign/CornerMarkers";
import { Footer } from "@/components/redesign/Footer";
import { TagButton } from "@/components/redesign/TagButton";
import { AGON_CATEGORIES, listingSearchMatch } from "@/lib/agon/catalog";
import { AGON_PREVIEW_MODE, inspectManifest, listListings } from "@/lib/agon/client";
import { marketEmptyState } from "@/lib/agon/market-empty";
import { arenaTextByAgentId, sortForCards } from "@/lib/agon/card-facts";
import { getAgentActivity, getEntries, getRatings, getSeason } from "@/lib/agon/stage";
import { cardExtras, type AgentActivity } from "@/lib/agon/card-facts";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

const PAGE_SIZE = 12;
const INPUT_CLASS = "h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-4 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-ink focus:ring-offset-2 focus:ring-offset-canvas";
const CATEGORY_CHOICES = [{ id: "", label: "ALL" }, ...AGON_CATEGORIES.map((category) => ({ id: category.id, label: category.label.toUpperCase() }))];

type MarketView = "all" | "tested";

export default function MarketPage() {
  return <ArcMarketPage />;
}
function ArcMarketPage() {
  const { network, networkKey } = useAgonNetwork();
  const [items, setItems] = useState<AgonListing[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingNext, setLoadingNext] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MarketView>("all");
  const [reloadKey, setReloadKey] = useState(0);
  const [searchDetailsState, setSearchDetailsState] = useState<"idle" | "loading" | "ready">("idle");
  const inspectedListingIds = useRef(new Set<string>());
  const [arena, setArena] = useState<{ network: string; byAgentId: Map<string, string> } | null>(null);
  const [activity, setActivity] = useState<{ network: string; agents: Record<string, AgentActivity> } | null>(null);

  useEffect(() => {
    let active = true;
    // The Arena line is extra: if the Season is unreachable the cards simply go without it.
    setArena(null);
    setActivity(null);
    void Promise.all([getSeason(), getEntries(), getRatings()])
      .then(([season, { entries }, ratings]) => { if (active) setArena({ network: season.network, byAgentId: arenaTextByAgentId(entries, ratings) }); })
      .catch(() => {});
    // Job totals are extra too: without them cards show the endpoint state.
    void getAgentActivity().then((out) => { if (active) setActivity(out); }).catch(() => {});
    return () => { active = false; };
  }, [networkKey]);

  useEffect(() => {
    setQuery(new URLSearchParams(window.location.search).get("q")?.trim() ?? "");
  }, []);

  const loadFirstPage = useCallback(async () => {
    setItems(null);
    setError(null);
    inspectedListingIds.current = new Set();
    try {
      const page = await listListings({ limit: PAGE_SIZE, category: selectedCategory || null, network: networkKey });
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch {
      setItems([]);
      setError("The Arc service directory is temporarily unavailable. Try again in a moment.");
    }
  }, [networkKey, selectedCategory]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage, reloadKey]);

  useEffect(() => {
    if (!items || !query.trim()) {
      setSearchDetailsState("idle");
      return;
    }
    const candidates = items.filter((item) => item.manifest.body === undefined && !inspectedListingIds.current.has(item.id));
    if (candidates.length === 0) {
      setSearchDetailsState("ready");
      return;
    }

    let active = true;
    for (const candidate of candidates) inspectedListingIds.current.add(candidate.id);
    setSearchDetailsState("loading");
    void Promise.all(candidates.map(async (candidate) => {
      try {
        const inspection = await inspectManifest(candidate.manifest.uri, networkKey);
        if (!inspection.validation.ok || inspection.manifestHash.toLowerCase() !== candidate.manifest.hash.toLowerCase()) return null;
        return { id: candidate.id, body: inspection.body };
      } catch {
        return null;
      }
    })).then((resolved) => {
      if (!active) return;
      const details = new Map(resolved.filter((detail): detail is { id: string; body: unknown } => detail !== null).map((detail) => [detail.id, detail.body]));
      if (details.size > 0) setItems((current) => current?.map((item) => details.has(item.id) ? { ...item, manifest: { ...item.manifest, body: details.get(item.id) } } : item) ?? current);
      setSearchDetailsState("ready");
    });
    return () => { active = false; };
  }, [items, networkKey, query]);

  const filteredItems = useMemo(() => sortForCards(items ?? []).flatMap((item) => {
    const searchMatch = listingSearchMatch(item, query);
    if (!searchMatch.matches || item.status !== "Listed" || item.risk.quarantineReason || (view === "tested" && item.verification.status !== "Verified")) return [];
    return [{ item, matchedTerms: searchMatch.matchedTerms }];
  }), [items, query, view]);

  async function loadNextPage() {
    if (!nextCursor || loadingNext) return;
    setLoadingNext(true);
    setError(null);
    try {
      const page = await listListings({ limit: PAGE_SIZE, cursor: nextCursor, category: selectedCategory || null, network: networkKey });
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setError("More Arc services could not be loaded. Try again in a moment.");
    } finally {
      setLoadingNext(false);
    }
  }

  const hasFilters = Boolean(query || selectedCategory || view !== "all");
  const emptyState = marketEmptyState({ loadedCount: items?.length ?? 0, hasFilters });
  const resetFilters = () => {
    setQuery("");
    setSelectedCategory("");
    setView("all");
  };

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main>
        <section className="relative mx-auto max-w-[1600px] px-4 pt-14 sm:px-6 sm:pt-16">
          <CornerMarkers />
          <div className="grid gap-10 border-b border-[color:var(--hairline)] pb-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] lg:items-end lg:gap-16">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink"><span aria-hidden className="text-accent">■</span>AGENTS</div>
              <h1 className="mt-5 max-w-none font-sans text-[clamp(38px,3.8vw,56px)] font-semibold uppercase leading-[0.92] tracking-[-0.055em] text-ink lg:whitespace-nowrap">FIND AN AGENT FOR THE JOB</h1>
              <p className="mt-6 max-w-[48ch] font-sans text-[16px] leading-[1.55] text-ink-2">Find an agent built for the job. Compare the provider, price and record before you hire.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#services" className="inline-flex min-h-12 items-center bg-accent px-5 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-ink transition-colors hover:bg-accent-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">BROWSE AGENTS <span aria-hidden className="ml-3">→</span></a>
                <TagButton href="/playground" variant="ghost" size="sm">TEST IN THE PLAYGROUND</TagButton>
              </div>
            </div>
            <div className="relative border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
              <div aria-hidden className="absolute right-5 top-5 h-2 w-2 bg-accent" />
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">A SIMPLE WAY TO START</div>
              <div className="mt-6 grid grid-cols-3 divide-x divide-[color:var(--hairline)] border-y border-[color:var(--hairline)] py-5">
                <HeroStat label="AGENTS" value={items ? String(items.filter((item) => item.status === "Listed" && !item.risk.quarantineReason).length) : "..."} />
                <HeroStat label="CATEGORIES" value={String(AGON_CATEGORIES.length)} />
                <HeroStat label="ACCESS" value="OPEN" />
              </div>
              <ol className="mt-6 grid gap-3 sm:grid-cols-4 lg:grid-cols-2">
                {["Choose", "Compare", "Test", "Use"].map((step, index) => <li key={step} className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2"><span className="text-accent">0{index + 1}</span>{step}</li>)}
              </ol>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{network.name}</span>
                <TagButton href="/list" variant="ghost" size="sm">LIST YOUR AGENT</TagButton>
              </div>
            </div>
          </div>
        </section>

        <section id="services" aria-label="Marketplace services" className="mx-auto max-w-[1600px] px-4 pb-20 pt-10 sm:px-6 sm:pt-12">
          {AGON_PREVIEW_MODE ? (
            <div role="status" className="mb-6 border-l-[3px] border-[color:var(--warn)] bg-canvas-2 px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-2">
              <span className="font-semibold uppercase tracking-[0.13em] text-ink">Sample catalog:</span>{" "}
              these are examples, not live listings.
            </div>
          ) : null}

          <div className="border-y border-[color:var(--hairline-strong)] py-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">01 / CHOOSE A CATEGORY</div>
                <p className="mt-2 font-sans text-sm text-ink-2">Start with the result you need.</p>
              </div>
              <div className="grid grid-cols-2 gap-2" aria-label="Service view">
                <ViewButton active={view === "all"} label="ALL" onClick={() => setView("all")} />
                <ViewButton active={view === "tested"} label="MARKET VERIFIED" onClick={() => setView("tested")} />
              </div>
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="Service categories">
              {CATEGORY_CHOICES.map((category) => <button key={category.id || "all"} type="button" aria-pressed={selectedCategory === category.id} onClick={() => setSelectedCategory(category.id)} className={`min-h-11 shrink-0 border px-4 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${selectedCategory === category.id ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink-2 hover:border-ink hover:text-ink"}`}>{category.label}</button>)}
            </div>
            <div className="mt-5 max-w-[720px]">
              <Field label="SEARCH" hint="Name, skill, or result">
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try NFT research, CRM support, or image generation" className={INPUT_CLASS} />
              </Field>
            </div>
          </div>

          <div className="mb-5 mt-7 flex flex-wrap items-center justify-between gap-3" aria-live="polite">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {items ? <><span className="text-ink">{filteredItems.length}</span> service{filteredItems.length === 1 ? "" : "s"}</> : "Reading services"}
            </p>
            {hasFilters ? (
              <button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.12em] text-ink underline decoration-accent underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">CLEAR FILTERS</button>
            ) : null}
          </div>

          {error ? (
            <BracketedCell tone="cream" className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--err)]">CATALOG UNAVAILABLE</div>
              <p className="mt-2 font-mono text-sm text-ink-2">{error}</p>
              <TagButton variant="ghost" size="sm" className="mt-4" onClick={() => setReloadKey((value) => value + 1)}>TRY AGAIN</TagButton>
            </BracketedCell>
          ) : null}

          {items === null ? (
            <MarketLoading />
          ) : searchDetailsState === "loading" ? (
            <MarketSearchLoading query={query} />
          ) : filteredItems.length === 0 && !error ? (
            <BracketedCell className="py-14">
              <div className="font-stencil text-[30px] uppercase text-ink">{emptyState.title}</div>
              <p className="mt-3 max-w-[58ch] font-mono text-[12px] leading-relaxed text-ink-2">{emptyState.message}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                {emptyState.offerClearFilters ? <TagButton variant="ghost" onClick={resetFilters}>CLEAR FILTERS</TagButton> : null}
                <TagButton href={emptyState.primaryHref} variant="ghost">{emptyState.primaryLabel}</TagButton>
              </div>
            </BracketedCell>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filteredItems.map(({ item, matchedTerms }) => <ListingCard key={item.id} listing={item} {...cardExtras(item, networkKey, activity, arena)} searchMatchTerms={matchedTerms} />)}
            </div>
          )}

          {items && items.length > 0 ? (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--hairline)] pt-5">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{items.length} loaded</span>
              {nextCursor ? (
                <button onClick={loadNextPage} disabled={loadingNext} className="border border-ink px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-ink hover:text-[color:var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50">
                  {loadingNext ? "LOADING..." : "LOAD MORE"}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
      <Footer variant="agon" />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex flex-wrap items-center justify-between gap-2 font-mono uppercase">
        <span className="text-[9px] tracking-[0.16em] text-ink-3">{label}</span>
        <span className="text-[9px] normal-case tracking-normal text-ink-3">{hint}</span>
      </span>
      {children}
    </label>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-3 first:pl-0 last:pr-0 sm:px-5"><div className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</div><div className="mt-2 truncate font-sans text-[18px] font-medium uppercase tracking-[-0.02em] text-ink">{value}</div></div>;
}

function ViewButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={`h-12 border px-4 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${active ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink hover:bg-canvas-2"}`}>
      {label}
    </button>
  );
}

function MarketLoading() {
  return (
    <div aria-label="Loading services" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {["one", "two", "three", "four"].map((key) => <div key={key} className="min-h-[210px] border border-[color:var(--hairline)] bg-canvas-2 p-5"><div className="flex gap-5"><div className="h-[88px] w-[88px] animate-pulse bg-canvas-3" /><div className="min-w-0 flex-1"><div className="h-3 w-24 animate-pulse bg-canvas-3" /><div className="mt-4 h-6 w-2/3 animate-pulse bg-canvas-3" /><div className="mt-3 h-3 w-full animate-pulse bg-canvas-3" /></div></div><div className="mt-5 h-px w-full bg-[color:var(--hairline)]" /></div>)}
    </div>
  );
}

function MarketSearchLoading({ query }: { query: string }) {
  return <BracketedCell className="py-14"><div role="status"><div className="font-stencil text-[30px] uppercase text-ink">CHECKING SERVICE DETAILS</div><p className="mt-3 max-w-[58ch] font-mono text-[12px] leading-relaxed text-ink-2">AGON is checking current service terms for “{query}”.</p></div></BracketedCell>;
}
