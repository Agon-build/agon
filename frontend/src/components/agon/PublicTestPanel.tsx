"use client";

import { useEffect, useMemo, useState } from "react";

import { TestRunList } from "@/components/agon/TestRunList";
import { LoginButton } from "@/components/pengu/LoginButton";
import { BracketedCell, TagButton } from "@/components/redesign";
import { presentListing } from "@/lib/agon/catalog";
import { listListings } from "@/lib/agon/client";
import { categoryLabel, runErrorText, testInfo } from "@/lib/agon/rating-view";
import { getRemaining, getTests, runTest, type TestRun } from "@/lib/agon/scores-api";
import type { AgonListing } from "@/lib/agon/types";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";

/// Test any listed agent in a testable category; every result is published (spec 20.3).
export function PublicTestPanel() {
  const { networkKey } = useAgonNetwork();
  const [listings, setListings] = useState<AgonListing[]>([]);
  const [selected, setSelected] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [feed, setFeed] = useState<TestRun[]>([]);
  const [state, setState] = useState<{ kind: "idle" | "running" } | { kind: "done"; run: TestRun } | { kind: "error"; text: string; signIn: boolean }>({ kind: "idle" });

  useEffect(() => {
    let active = true;
    void listListings({ limit: 100, network: networkKey }).then((page) => {
      if (!active) return;
      const testable = page.items.filter((l) => l.status === "Listed" && testInfo(l.category));
      setListings(testable);
      const requested = new URLSearchParams(window.location.search).get("listing");
      setSelected(testable.find((l) => l.id === requested)?.id ?? testable[0]?.id ?? "");
    }).catch(() => {});
    void getTests(undefined, 20).then((runs) => { if (active) setFeed(runs); }).catch(() => {});
    return () => { active = false; };
  }, [networkKey]);

  const listing = useMemo(() => listings.find((l) => l.id === selected) ?? null, [listings, selected]);
  useEffect(() => {
    setRemaining(null);
    setState({ kind: "idle" });
    if (listing) void getRemaining(listing.agentId).then(setRemaining);
  }, [listing]);

  async function run() {
    if (!listing) return;
    setState({ kind: "running" });
    try {
      const out = await runTest(listing.id);
      setState({ kind: "done", run: out });
      setFeed((current) => [out, ...current].slice(0, 20));
      setRemaining(await getRemaining(listing.agentId));
    } catch (error) {
      setState({ kind: "error", text: runErrorText(error), signIn: (error as { status?: number }).status === 401 });
    }
  }

  const test = listing ? testInfo(listing.category, listing.manifest.body) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <BracketedCell pad="lg">
        <div className="font-mono text-[10px] uppercase tracking-[.15em] text-accent">PUBLIC TEST</div>
        <h2 className="mt-2 font-stencil text-3xl uppercase leading-none sm:text-4xl">TEST A LISTED AGENT</h2>
        {listings.length === 0 ? <p className="mt-6 font-mono text-[12px] text-ink-2">No listed agents in a testable category yet.</p> : (
          <>
            <label className="mt-6 block">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Agent</span>
              <select value={selected} onChange={(e) => setSelected(e.target.value)} className="mt-2 min-h-12 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[12px] text-ink">
                {listings.map((l) => <option key={l.id} value={l.id}>{presentListing(l).name} · {categoryLabel(l.category)}</option>)}
              </select>
            </label>
            {test ? (
              <div className="mt-5">
                <p className="font-sans text-[15px] font-semibold text-ink">{test.title}</p>
                <p className="mt-1 text-sm leading-6 text-ink-2">{test.summary} Free, published and counted toward its rating.</p>
              </div>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <TagButton onClick={() => void run()} disabled={!listing || state.kind === "running" || remaining === 0}>{state.kind === "running" ? "TESTING…" : "RUN THE TEST"}</TagButton>
              {remaining !== null ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Remaining today: {remaining}</span> : null}
            </div>
            <div aria-live="polite" className="mt-4">
              {state.kind === "done" ? <p className="font-mono text-[12px] text-ink">Scored {state.run.score} · {state.run.passed ? "passed" : "did not pass"}. Published in the feed.</p> : null}
              {state.kind === "error" ? <div className="flex flex-wrap items-center gap-3"><p className="font-mono text-[12px] text-ink-2">{state.text}</p>{state.signIn ? <LoginButton /> : null}</div> : null}
            </div>
            <p className="mt-6 font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-ink-3">5 tests per person per hour · 20 public tests per agent per day</p>
          </>
        )}
      </BracketedCell>
      <BracketedCell pad="lg">
        <div className="mb-4 font-mono text-[10px] uppercase tracking-[.15em] text-ink-3">RECENT TESTS</div>
        <TestRunList runs={feed} showAgent empty="No tests yet." names={new Map(listings.map((l) => [l.agentId, presentListing(l).name]))} />
      </BracketedCell>
    </div>
  );
}
