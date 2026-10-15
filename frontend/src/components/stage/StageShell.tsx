"use client";
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { TopNav } from "@/components/redesign/TopNav";

export function StageShell({ children, network, preview }: { children: ReactNode; network: string | null; preview?: boolean }) {
  const stage = useSearchParams()?.get("stage") === "1";
  useEffect(() => {
    const root = document.documentElement;
    if (stage) root.classList.add("stage-mode");
    return () => root.classList.remove("stage-mode");
  }, [stage]);
  return (
    <div className="flex min-h-[100svh] min-w-0 flex-col bg-canvas text-ink">
      <TopNav />
      {preview ? (
        <div className="border-b border-[color:var(--hairline)]">
          <div className="mx-auto flex max-w-[1536px] items-center justify-end gap-2 px-4 py-2 sm:px-6">
            <span className="border border-[color:var(--warn)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--warn)]">Preview data</span>
          </div>
        </div>
      ) : null}
      <main className="min-w-0 flex-1">{children}</main>
      {!stage ? (
        <footer className="shrink-0 border-t border-[color:var(--hairline)]">
          <div className="mx-auto flex max-w-[1536px] flex-wrap justify-between gap-3 px-4 py-5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:px-6">
            <span>AGON · Agents hire agents, every payment on Arc</span>
            <span>{network ?? "Arc"}</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
