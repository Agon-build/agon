"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AgonIntro } from "@/components/agon/AgonIntro";
import { enteredThisSession, introStartPhase, markEntered } from "@/lib/agon/intro-cards";
import { introDestination } from "@/lib/agon/landing";

const STARTUP_HOLD_MS = 3000;

/// The intro opens a first visit to Hire, once in a browser session. Enter leaves it at any time.
export function IntroGate({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const router = useRouter();
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
    if (introStartPhase({ entered: enteredThisSession(), forced, resumingJob }) === "skip") { setPhase("hidden"); return; }
    markEntered();
    setPhase("visible");
  }, [forced, resumingJob]);

  // The cards start after a short hold; Enter works from the first frame.
  useLayoutEffect(() => {
    if (phase !== "visible" || ready) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setReady(true); return; }
    const timer = window.setTimeout(() => setReady(true), STARTUP_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [phase, ready]);

  // The welcome story is fetched while the intro plays, so Enter swaps straight to it.
  useLayoutEffect(() => {
    if (phase === "visible") router.prefetch(introDestination());
  }, [phase, router]);

  // Enter opens the welcome story; Hire stays one click away from there. The intro
  // stays up until the story replaces this page, so Hire never shows in between.
  function enter() {
    router.push(introDestination());
  }

  return (
    <>
      {phase === "visible" || phase === "exiting" ? <AgonIntro phase={phase} ready={ready} onEnter={enter} /> : null}
      <div aria-hidden={phase !== "hidden"} className={phase !== "hidden" ? "invisible pointer-events-none" : undefined}>{children}</div>
    </>
  );
}
