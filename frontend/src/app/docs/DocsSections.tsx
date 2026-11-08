"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { DOCS_REVIEWED, DOCS_SECTIONS, type DocsSectionId } from "@/lib/agon/docs-content";
import { PART_ACTIONS, PART_HEADINGS, docsParts, partPosition } from "@/lib/agon/docs-nav";
import { tabFromHash } from "@/lib/agon/page-tabs";

import { DocsPicker, DocsToc } from "./DocsToc";

const PARTS = docsParts();
const IDS = PARTS.map((p) => p.id);
const label = (id: DocsSectionId) => DOCS_SECTIONS.find((s) => s.id === id)!.label;
/// A heading anchor inside a part opens that part, then scrolls to the heading.
const partOf = (hash: string): DocsSectionId | null => {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if ((IDS as string[]).includes(id)) return id as DocsSectionId;
  const found = (Object.entries(PART_HEADINGS) as [DocsSectionId, readonly { id: string }[]][]).find(([, hs]) => hs.some((h) => h.id === id));
  return found ? found[0] : null;
};

/// The Docs page shows one part at a time. The part is in the address hash, so the map, links and
/// Back all work. Before the page is interactive every part is shown, so nothing is hidden from search.
export function DocsSections({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DocsSectionId | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = (scroll: boolean) => {
      const hash = window.location.hash;
      const part = partOf(hash) ?? (tabFromHash(hash, IDS, IDS[0]!) as DocsSectionId);
      setActive(part);
      if (!scroll) return;
      const heading = hash.replace(/^#/, "");
      if (heading !== part) requestAnimationFrame(() => document.getElementById(heading)?.scrollIntoView({ block: "start" }));
      else top.current?.scrollIntoView({ block: "start" });
    };
    read(false);
    const onHash = () => read(true);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const shown = active ?? IDS[0]!;
  const pos = partPosition(shown);
  const headings = PART_HEADINGS[shown];
  const action = PART_ACTIONS[shown];

  return (
    <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_220px]">
      <aside className="hidden lg:block"><DocsToc active={shown} /></aside>

      <div ref={top} className="min-w-0 scroll-mt-24">
        <DocsPicker active={shown} />
        {active ? <style>{`[data-docs-sections] > section { display: none; } [data-docs-sections] > section#${CSS.escape(active)} { display: block; }`}</style> : null}
        <div data-docs-sections className="mt-8 flex flex-col gap-20 lg:mt-0">{children}</div>
        {active && action ? <div className="mt-12 xl:hidden"><ActionBox action={action} /></div> : null}
        {active ? (
          <nav aria-label="Previous and next part" className="mt-14 grid gap-3 sm:grid-cols-2">
            {pos.prev ? (
              <a href={`#${pos.prev}`} className="block border border-[color:var(--hairline-strong)] p-5 transition-colors duration-150 hover:border-ink">
                <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">Previous</span>
                <span className="mt-2 block text-[16px] text-ink">{label(pos.prev)}</span>
              </a>
            ) : <span className="hidden sm:block" />}
            {pos.next ? (
              <a href={`#${pos.next}`} className="block border border-[color:var(--hairline-strong)] p-5 text-right transition-colors duration-150 hover:border-ink">
                <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">Next</span>
                <span className="mt-2 block text-[16px] text-ink">{label(pos.next)}</span>
              </a>
            ) : null}
          </nav>
        ) : null}
      </div>

      <aside aria-label="About this part" className="hidden xl:block">
        <div className="sticky top-24 grid gap-6">
          {headings.length > 0 ? (
            <nav aria-label="On this part">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">On this part</p>
              <ul className="mt-2 grid">
                {headings.map((h) => <li key={h.id}><a href={`#${h.id}`} className="flex min-h-9 items-center text-[13px] text-ink-2 hover:text-ink">{h.label}</a></li>)}
              </ul>
            </nav>
          ) : null}
          <div className="border border-[color:var(--hairline-strong)] p-5">
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">Last reviewed</p>
            <p className="mt-3 font-mono text-[16px] text-ink">{DOCS_REVIEWED}</p>
            <p className="mt-2 text-[12px] leading-5 text-ink-2">Checked against the live app on agon.surf.</p>
          </div>
          {action ? <ActionBox action={action} /> : null}
        </div>
      </aside>
    </div>
  );
}

function ActionBox({ action }: { action: { title: string; body: string; label: string; href: string } }) {
  return (
    <div className="bg-canvas-2 p-5">
      <p className="text-[15px] font-medium text-ink">{action.title}</p>
      <p className="mt-2 text-[12px] leading-5 text-ink-2">{action.body}</p>
      <div className="mt-4"><TagButton href={action.href} size="sm">{action.label}</TagButton></div>
    </div>
  );
}
