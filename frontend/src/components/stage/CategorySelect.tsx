"use client";

import { categoryTileLine } from "@/lib/agon/hire-layout";
import type { HireCategory, HireCategoryId } from "@/lib/agon/stage-types";

/// The seven Hire categories as tiles. Choosing one lists everything in it; the counts
/// come from the live catalog and are left out when they cannot be read.
export function CategorySelect({ categories, disabled, onPick }: { categories: HireCategory[]; disabled: boolean; onPick: (id: HireCategoryId) => void }) {
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="categories-heading" className="mt-14">
      <h2 id="categories-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Or start from a category</h2>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {categories.map((c) => {
          const line = categoryTileLine(c);
          return (
            <li key={c.id} className="min-w-0">
              <button
                type="button" disabled={disabled} onClick={() => onPick(c.id)}
                className="flex h-full min-h-[76px] w-full flex-col justify-between gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 p-3 text-left transition-colors duration-150 hover:border-accent focus-visible:border-accent disabled:opacity-60 motion-reduce:transition-none"
              >
                <span className="text-sm leading-5 text-ink">{c.label}</span>
                {line ? <span className={`font-mono text-[10px] tabular-nums ${line === "No services yet" ? "text-ink-3" : "text-ink-2"}`}>{line}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
