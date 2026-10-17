import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/// Questions and answers as native disclosure rows: keyboard and screen reader
/// friendly with no script, one hairline between rows.
export function FaqList({ items, className }: { items: readonly { q: string; a: string }[]; className?: string }) {
  return (
    <div className={cn("divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline-strong)]", className)}>
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 py-4 text-left [&::-webkit-details-marker]:hidden">
            <span className="text-[15px] font-semibold leading-6 text-ink group-open:text-accent">{item.q}</span>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <p className="max-w-[72ch] pb-5 text-sm leading-7 text-ink-2">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
