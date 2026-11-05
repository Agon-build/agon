"use client";

/// Newer and Older for a list read a page at a time. Hidden when there is only one page.
export function Pager({ page, hasMore, onPage, label }: { page: number; hasMore: boolean; onPage: (page: number) => void; label: string }) {
  if (page <= 1 && !hasMore) return null;
  const btn = "min-h-11 px-2 text-ink hover:text-accent disabled:text-ink-3";
  return (
    <nav aria-label={label} className="mt-4 flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em]">
      <button type="button" disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} className={btn}>Newer</button>
      <span className="text-ink-3">Page {page}</span>
      <button type="button" disabled={!hasMore} onClick={() => onPage(page + 1)} className={btn}>Older</button>
    </nav>
  );
}
