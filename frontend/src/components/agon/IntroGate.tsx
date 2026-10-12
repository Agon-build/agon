"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { AgonIntro } from "@/components/agon/AgonIntro";
import { introStartPhase } from "@/lib/agon/intro-cards";

const STARTUP_STORAGE_KEY = "agon-startup-seen-v1";
const STARTUP_HOLD_MS = 3000;
const STARTUP_EXIT_MS = 680;

/// The intro shows once per browser session over Hire (spec 4a); ?intro=1 always shows it.
export function IntroGate({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const forced = params?.get("intro") === "1";
  const resumingJob = Boolean(params?.get("job"));
  // "pending" paints nothing over Hire; the decision runs before the first paint.
  const [phase, setPhase] = useState<"pending" | "visible" | "exiting" | "hidden">("pending");
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const seen = (() => { try { return window.sessionStorage.getItem(STARTUP_STORAGE_KEY) === "1"; } catch { return false; } })();
    if (introStartPhase({ seen, forced, resumingJob }) === "skip") { setPhase("hidden"); return; }
    setPhase("visible");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setReady(true); return; }
    const timer = window.setTimeout(() => setReady(true), STARTUP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [forced, resumingJob]);

  function enter() {
    try { window.sessionStorage.setItem(STARTUP_STORAGE_KEY, "1"); } catch { /* still dismissible without storage */ }
    setPhase("exiting");
    window.setTimeout(() => setPhase("hidden"), STARTUP_EXIT_MS);
  }

  return (
    <>
      {phase === "visible" || phase === "exiting" ? <AgonIntro phase={phase} ready={ready} onEnter={enter} /> : null}
      <div aria-hidden={phase !== "hidden"} className={phase !== "hidden" ? "invisible pointer-events-none" : undefined}>{children}</div>
    </>
  );
}
