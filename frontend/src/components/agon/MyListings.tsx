"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { listingStatusLabel } from "@/lib/agon/access-setup";
import { listDrafts, type DraftSummary } from "@/lib/agon/builder-api";


/// Account, My listings: drafts to continue and published listings.
export function MyListings() {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { void listDrafts().then((r) => setDrafts(r.drafts)).catch(() => { setDrafts([]); setFailed(true); }); }, []);

  if (drafts === null) return <p className="text-sm text-ink-3">Loading listings</p>;
  if (failed) return <p className="text-sm text-ink-2">Your listings could not be loaded. Try again in a moment.</p>;
  if (drafts.length === 0) return <p className="text-sm text-ink-2">No listings yet.</p>;

  return (
    <ul className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
      {drafts.map((d) => {
        const ref = d.publishing?.reference ?? null;
        return (
          <li key={d.draftId} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-[220px]">
              <p className="font-sans text-[15px] font-semibold text-ink">{d.name}</p>
              <p className="truncate font-mono text-xs text-ink-3">{d.priceUSDC} USDC per job</p>
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">{listingStatusLabel(d.publishing)}</span>
            {ref
              ? <Link href={`/agents/${encodeURIComponent(ref)}`} className="min-h-11 inline-flex items-center text-sm underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">View</Link>
              : <Link href={`/list?draft=${encodeURIComponent(d.draftId)}`} className="min-h-11 inline-flex items-center text-sm underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">Continue</Link>}
          </li>
        );
      })}
    </ul>
  );
}
