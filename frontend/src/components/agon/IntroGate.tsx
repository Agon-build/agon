"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { AgonIntro } from "@/components/agon/AgonIntro";
import { introStartPhase } from "@/lib/agon/intro-cards";

const STARTUP_HOLD_MS = 3000;
const STARTUP_EXIT_MS = 680;

/// Lives for one page load: a new visit to agon.surf starts it at false again,
/// while moving back to Hire inside the app keeps it.
let shownThisLoad = false;

/// The intro opens every visit to agon.surf over Hire. Enter leaves it at any time.
export function IntroGate({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const forced = params?.get("intro") === "1";
  const resumingJob = Boolean(params?.get("job"));
  // "pending" paints nothing over Hire; the decision runs once, before the first paint,
  // so a later URL change (paying a hire moves to /?job=...) never brings the intro back.
  const [phase, setPhase] = useState<"pending" | "visible" | "exiting" | "hidden">("pending");
  const [ready, setReady] = useState(false);
  const decided = useRef(false);

  useLayoutEffect(() => {
    if (decided.current) return;
    decided.current = true;
    if (introStartPhase({ shownThisLoad, forced, resumingJob }) === "skip") { setPhase("hidden"); return; }
    shownThisLoad = true;
    setPhase("visible");
  }, [forced, resumingJob]);

  // The cards start after a short hold; Enter works from the first frame.
  useLayoutEffect(() => {
    if (phase !== "visible" || ready) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setReady(true); return; }
    const timer = window.setTimeout(() => setReady(true), STARTUP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, ready]);

  function enter() {
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
