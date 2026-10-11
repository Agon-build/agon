"use client";
import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

import { AgonMark } from "@/components/redesign/AgonMark";
import { LoginButton } from "@/components/pengu/LoginButton";

const NAV = [["Ask", "/ask"], ["Season 1", "/playground/season-1"], ["Market", "/market"]] as const;

export function StageShell({ children, network, preview }: { children: ReactNode; network: string | null; preview?: boolean }) {
  const stage = useSearchParams()?.get("stage") === "1";
  useEffect(() => {
    const root = document.documentElement;
    if (stage) root.classList.add("stage-mode");
    return () => root.classList.remove("stage-mode");
  }, [stage]);
  return (
    <div className="flex min-h-[100svh] min-w-0 flex-col bg-canvas text-ink">
      <header className="shrink-0 border-b border-[color:var(--hairline)]">
        <div className="mx-auto flex h-16 max-w-[1536px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <a href="/" aria-label="AGON home" className="inline-flex shrink-0 items-center text-ink"><AgonMark /></a>
            <nav aria-label="Stage" className="hidden items-center gap-6 md:flex">
              {NAV.map(([label, href]) => <a key={href} href={href} className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">{label}</a>)}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {preview ? <span className="border border-[color:var(--warn)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--warn)]">Preview data</span> : null}
            {network ? <span className="hidden border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 sm:inline">{network}</span> : null}
            <LoginButton />
          </div>
        </div>
      </header>
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
