"use client";

/// Fixed right-edge utility rail. Frames the page horizontally with the
/// BodyLines, gives the user an always-available "feed live" anchor and
/// social links. Pure decoration plus social links; no critical action
/// lives here so accessibility-wise it stays decorative; users on small
/// viewports do not see it at all.
///
/// Stacking: z-30, below the sticky nav (z-20) so we DON'T overlap it; we
/// sit vertically centered. Modals at z-modal (40) still cover everything.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

function ScrollTop() {
  function go() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={go}
      aria-label="back to top"
      className="flex h-7 w-7 items-center justify-center border border-ink bg-canvas font-mono text-[10px] text-ink transition-colors hover:bg-canvas-3"
    >
      ↑
    </button>
  );
}

export function SideRail() {
  const pathname = usePathname() ?? "/";
  if (pathname === "/agents" || pathname.startsWith("/agents/")) return null;

  return (
    <aside
      aria-hidden
      className="pointer-events-none fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-3 lg:flex"
    >
      {/* live status dot: promotes the FEED LIVE chip from the hero to a
          global anchor. pulses on a 1.5s loop via the existing live-dot
          class in tokens.css. */}
      <span className="pointer-events-auto flex flex-col items-center gap-2">
        <span className="block h-1.5 w-1.5 animate-[pulse-live_1.5s_ease-in-out_infinite] bg-[color:var(--ok)]" />
        <span
          className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          FEED LIVE
        </span>
      </span>

      <span className="block h-8 w-px bg-[color:var(--hairline-strong)]" />

      {/* Social links. Stay clickable; rest of rail is pointer-events-none. */}
      <div className="pointer-events-auto flex flex-col gap-2">
        <a
          href="https://x.com/arc_run"
          target="_blank"
          rel="noreferrer"
          aria-label="X"
          className="flex h-7 w-7 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas font-mono text-[10px] text-ink transition-colors hover:border-ink hover:bg-canvas-3"
        >
          X
        </a>
        <a
          href="https://github.com/Iziedking/agon"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          className="flex h-7 w-7 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas font-mono text-[10px] text-ink transition-colors hover:border-ink hover:bg-canvas-3"
        >
          GH
        </a>
        <span
          aria-label="Discord (coming soon)"
          title="Discord (coming soon)"
          className="flex h-7 w-7 cursor-default items-center justify-center border border-[color:var(--hairline)] bg-canvas font-mono text-[10px] text-ink-3 opacity-60"
        >
          DC
        </span>
      </div>

      <span className="block h-8 w-px bg-[color:var(--hairline-strong)]" />

      <div className="pointer-events-auto">
        <ScrollTop />
      </div>
    </aside>
  );
}
