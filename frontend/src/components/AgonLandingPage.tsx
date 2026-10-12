"use client";

import { useEffect, useState } from "react";
import { AgonMark } from "@/components/redesign/AgonMark";
import { TagButton } from "@/components/redesign";
import { AgonNetworkSelector } from "@/components/redesign/AgonNetworkSelector";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { AgonHomeSurface } from "@/components/agon/AgonHomeSurface";
import { AgonHelpButton } from "@/components/agon/AgonHelpButton";
import { AgonIntro } from "@/components/agon/AgonIntro";
import { useAuth } from "@/hooks/useAuth";

const STARTUP_STORAGE_KEY = "agon-startup-seen-v1";
const STARTUP_HOLD_MS = 3000;
const STARTUP_EXIT_MS = 680;

export function AgonLandingPage() {
  const { network } = useAgonNetwork();
  const { me } = useAuth();
  const [startupPhase, setStartupPhase] = useState<"visible" | "exiting" | "hidden">("visible");
  const [startupReady, setStartupReady] = useState(false);

  useEffect(() => {
    const seen = (() => {
      try { return window.sessionStorage.getItem(STARTUP_STORAGE_KEY) === "1"; }
      catch { return false; }
    })();
    if (seen) { setStartupPhase("hidden"); return; }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setStartupReady(true); return; }
    const timer = window.setTimeout(() => setStartupReady(true), STARTUP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, []);

  function finishStartup() {
    try { window.sessionStorage.setItem(STARTUP_STORAGE_KEY, "1"); }
    catch { /* The intro remains dismissible without storage. */ }
    setStartupPhase("exiting");
    window.setTimeout(() => setStartupPhase("hidden"), STARTUP_EXIT_MS);
  }

  return (
    <>
    {startupPhase !== "hidden" ? <AgonIntro phase={startupPhase} ready={startupReady} onEnter={finishStartup} /> : null}
    <div aria-hidden={startupPhase !== "hidden"} className={`flex min-h-[100svh] min-w-0 flex-col bg-canvas text-ink ${startupPhase !== "hidden" ? "invisible pointer-events-none" : ""}`}>
      <header className="shrink-0 border-b border-[color:var(--hairline)]">
        <div className="mx-auto flex h-16 max-w-[1536px] items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6">
          <a href="/" aria-label="AGON home" className="inline-flex min-w-0 shrink-0 items-center text-ink"><AgonMark /></a>
          {me ? <nav aria-label="Primary" className="hidden items-center gap-6 lg:flex">
            <a href="/market" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">Find services</a>
            <a href="#how-it-works" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">How it works</a>
            <a href="/docs" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">Docs</a>
          </nav> : <nav aria-label="Public" className="hidden items-center gap-6 lg:flex"><a href="/docs" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">Docs</a></nav>}
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <span className="max-[399px]:hidden"><AgonNetworkSelector /></span>
            <TagButton href="/login" size="sm" variant="ghost" className="max-[359px]:px-2">SIGN IN</TagButton>
          </div>
        </div>
        {!me ? <nav aria-label="Public" className="flex justify-center gap-6 border-t border-[color:var(--hairline)] py-2 lg:hidden"><a href="/docs" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">Docs</a></nav> : null}
      </header>

      <main className="min-w-0 flex-1">
        <AgonHomeSurface network={network} />
      </main>

      <footer className="shrink-0 border-t border-[color:var(--hairline)]">
        <div className="mx-auto grid max-w-[1536px] gap-4 px-3 py-4 text-sm text-ink-2 sm:grid-cols-3 sm:gap-5 sm:px-6 sm:py-6">
          <div><div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">AGON</div><p className="mt-2">Find agent services with clear terms and a price per use.</p></div>
          <div><div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">BEFORE YOU HIRE</div><p className="mt-2">Check availability, price, and the version AGON tested.</p></div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">{me ? "EXPLORE" : "OPEN MARKET"}</div>
            {me ? <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><a href="/market" className="hover:text-ink">Find services</a><a href="/docs" className="hover:text-ink">Docs</a></div> : <div className="mt-2"><p>Browse and test services before you sign in.</p><a href="/docs#roadmap" className="mt-3 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink">What Agon is building</a></div>}
            <div className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{network.brand} {network.environment} · AGON.SURF</div>
            <AgonHelpButton />
          </div>
        </div>
      </footer>
    </div>
    </>
  );
}
