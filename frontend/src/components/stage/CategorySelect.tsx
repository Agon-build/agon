"use client";

import { categoryCountText } from "@/lib/agon/choice-view";
import { CHOICES_COPY } from "@/lib/agon/stage-copy";
import type { HireCategory, HireCategoryId } from "@/lib/agon/stage-types";

/// The seven Hire categories as one dropdown. Choosing one lists everything in it; the
/// counts come from the live catalog and are left out when they cannot be read.
export function CategorySelect({ categories, disabled, onPick }: { categories: HireCategory[]; disabled: boolean; onPick: (id: HireCategoryId) => void }) {
  if (categories.length === 0) return null;
  return (
    <label className="mt-8 block max-w-md">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{CHOICES_COPY.categories}</span>
      <select
        value="" disabled={disabled}
        onChange={(e) => { if (e.target.value) onPick(e.target.value as HireCategoryId); }}
        className="mt-3 min-h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-[12px] text-ink focus:border-accent focus:outline-none disabled:opacity-60"
      >
        <option value="">Choose a category</option>
        {categories.map((c) => {
          const count = categoryCountText(c);
          return <option key={c.id} value={c.id}>{count ? `${c.label} (${count})` : c.label}</option>;
        })}
      </select>
    </label>
  );
}
