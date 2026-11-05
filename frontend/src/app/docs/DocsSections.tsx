"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { neighbours, tabFromHash } from "@/lib/agon/page-tabs";

/// The Docs page shows one section at a time instead of one long scroll. The section
/// is in the address hash, so the table of contents, links and Back all work. Before
/// the page is interactive every section is shown, so nothing is hidden from search.
export function DocsSections({ items, children }: { items: { id: string; label: string }[]; children: ReactNode }) {
  const ids = items.map((i) => i.id);
  const first = ids[0] ?? "";
  const [active, setActive] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = (scroll: boolean) => {
      setActive(tabFromHash(window.location.hash, ids, first));
      if (scroll) top.current?.scrollIntoView({ block: "start" });
    };
    read(false);
    const onHash = () => read(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [ids.join(","), first]);

  const { prev, next } = neighbours(items, active ?? first);
  const go = (id: string) => { window.location.hash = id; };
  return (
    <div ref={top} className="min-w-0 scroll-mt-24">
      {active ? <style>{`[data-docs-sections] > section { display: none; } [data-docs-sections] > section#${CSS.escape(active)} { display: block; }`}</style> : null}
      <div data-docs-sections className="space-y-16">{children}</div>
      {active ? (
        <nav aria-label="Docs sections" className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--hairline-strong)] pt-6 font-mono text-[11px] uppercase tracking-[0.12em]">
          {prev ? <button type="button" onClick={() => go(prev.id)} className="min-h-11 text-ink-2 hover:text-accent">← {prev.label}</button> : <span />}
          {next ? <button type="button" onClick={() => go(next.id)} className="min-h-11 text-ink hover:text-accent">{next.label} →</button> : null}
        </nav>
      ) : null}
    </div>
  );
}
