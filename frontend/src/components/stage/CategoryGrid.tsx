"use client";

import { BracketedCell } from "@/components/redesign/BracketedCell";
import { categoryCountText } from "@/lib/agon/choice-view";
import { CHOICES_COPY } from "@/lib/agon/stage-copy";
import type { HireCategory, HireCategoryId } from "@/lib/agon/stage-types";

/// The seven Hire categories. A tile lists everything in its category; the counts
/// come from the live catalog and are left out when they cannot be read.
export function CategoryGrid({ categories, disabled, onPick }: { categories: HireCategory[]; disabled: boolean; onPick: (id: HireCategoryId) => void }) {
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="categories-heading" className="mt-10">
      <h2 id="categories-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{CHOICES_COPY.categories}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {categories.map((c) => {
          const count = categoryCountText(c);
          return (
            <li key={c.id} className="min-w-0">
              <BracketedCell hover pad="sm" className="h-full p-0">
                <button
                  type="button" disabled={disabled} onClick={() => onPick(c.id)}
                  className="flex h-full min-h-[5.5rem] w-full flex-col justify-between gap-3 p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                >
                  <span className="break-words text-sm leading-5 text-ink">{c.label}</span>
                  {count ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] tabular-nums text-ink-3">{count}</span> : null}
                </button>
              </BracketedCell>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
