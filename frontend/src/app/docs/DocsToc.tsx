"use client";
import { useRef } from "react";

import { DOCS_SECTIONS, type DocsSectionId } from "@/lib/agon/docs-content";
import { DOCS_GROUPS, partPosition } from "@/lib/agon/docs-nav";

const label = (id: DocsSectionId) => DOCS_SECTIONS.find((s) => s.id === id)?.label ?? id;

function Groups({ active, onPick }: { active: DocsSectionId; onPick?: () => void }) {
  return (
    <div className="grid gap-7">
      {DOCS_GROUPS.map((g) => (
        <div key={g.title}>
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-3">{g.title}</p>
          <ul className="mt-2 grid">
            {g.ids.map((id) => {
              const on = id === active;
              return (
                <li key={id}>
                  <a href={`#${id}`} onClick={onPick} aria-current={on ? "true" : undefined}
                    className={`flex min-h-11 items-center gap-3 border-l-2 px-3 text-[13px] transition-colors duration-150 ${on ? "border-accent bg-canvas-2 text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
                    <span className={`font-mono text-[10px] tabular-nums ${on ? "text-accent" : "text-ink-3"}`}>{String(partPosition(id).index).padStart(2, "0")}</span>
                    {label(id)}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/// The Docs map: grouped parts in a sidebar on wide screens.
export function DocsToc({ active }: { active: DocsSectionId }) {
  return (
    <nav aria-label="Docs parts" className="sticky top-24">
      <p className="mb-6 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Docs</p>
      <Groups active={active} />
    </nav>
  );
}

/// On small screens the same map is a part picker above the article.
export function DocsPicker({ active }: { active: DocsSectionId }) {
  const box = useRef<HTMLDetailsElement>(null);
  const pos = partPosition(active);
  return (
    <nav aria-label="Docs parts" className="lg:hidden">
      <details ref={box} className="border border-[color:var(--hairline-strong)] bg-canvas-2">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-accent">{`Part ${pos.index} of ${pos.total}`}</span>
            <span className="mt-1 block truncate text-[14px] text-ink">{label(active)}</span>
          </span>
          <span aria-hidden className="font-mono text-[11px] text-ink-3">↓</span>
        </summary>
        <div className="border-t border-[color:var(--hairline)] px-2 py-4"><Groups active={active} onPick={() => { if (box.current) box.current.open = false; }} /></div>
      </details>
    </nav>
  );
}
