"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

import { listingStatusLabel } from "@/lib/agon/access-setup";
import { isPaused } from "@/lib/agon/agents-layout";
import { listDrafts, type DraftSummary } from "@/lib/agon/builder-api";
import { getListing } from "@/lib/agon/client";
import { getCardScores } from "@/lib/agon/scores-api";
import type { AgonListing } from "@/lib/agon/types";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function statusOf(d: DraftSummary, l: AgonListing | undefined): { label: string; dot: string } {
  if (l && isPaused(l)) return { label: "Paused", dot: "bg-[color:var(--warn)]" };
  if (l && l.verification.status === "Verified") return { label: "Verified", dot: "bg-[color:var(--ok)]" };
  if (l) return { label: "Listed", dot: "border border-[color:var(--ink-3)]" };
  const label = listingStatusLabel(d.publishing);
  return { label: label === "Draft" ? "Not listed" : label, dot: label === "Needs attention" ? "bg-[color:var(--err)]" : "bg-[color:var(--ink-3)]" };
}

function lastCheck(l: AgonListing | undefined): string {
  if (!l) return "Not checked";
  const qa = l.endpointQa;
  if (!qa.checkedAt) return "Not checked yet";
  return `${qa.status === "passed" ? "Passed" : qa.status === "failed" ? "Failed" : "Checked"}, ${day(qa.checkedAt)}`;
}

/// Account, My listings: every draft and published listing, with its status, score and last check.
export function MyListings() {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [listings, setListings] = useState<Map<string, AgonListing>>(new Map());
  const [scores, setScores] = useState<Map<string, number | null> | null>(null);

  useEffect(() => { void listDrafts().then((r) => setDrafts(r.drafts)).catch(() => { setDrafts([]); setFailed(true); }); }, []);

  // Published rows read their live record; each one that fails to load keeps its draft facts.
  useEffect(() => {
    const refs = (drafts ?? []).map((d) => d.publishing?.reference).filter((r): r is string => Boolean(r));
    if (refs.length === 0) return;
    let active = true;
    void Promise.all(refs.map((r) => getListing(r).catch(() => null))).then(async (found) => {
      if (!active) return;
      const map = new Map(found.filter((l): l is AgonListing => l !== null).map((l) => [l.id, l]));
      setListings(map);
      const ids = [...new Set([...map.values()].map((l) => l.agentId))];
      const rows = await getCardScores(ids).catch(() => null);
      if (!active || !rows) return;
      setScores(new Map(ids.map((id) => [id, rows.filter((r) => r.agentId === id && r.score !== null).reduce<number | null>((m, r) => Math.max(m ?? 0, r.score!), null)])));
    });
    return () => { active = false; };
  }, [drafts]);

  if (drafts === null) return <p className="text-sm text-ink-3">Loading listings</p>;
  if (failed) return <p className="text-sm text-ink-2">Your listings could not be loaded. Try again in a moment.</p>;
  if (drafts.length === 0) return <p className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 text-sm text-ink-2">No listings yet.</p>;

  const anyPaused = [...listings.values()].some(isPaused);
  return (
    <div>
      <div className="relative overflow-x-auto border border-[color:var(--hairline-strong)]">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-canvas-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
            <tr><th className="px-5 py-3 font-normal">Agent</th><th className="px-3 py-3 font-normal">Version</th><th className="px-3 py-3 font-normal">Status</th><th className="px-3 py-3 font-normal">Agon score</th><th className="px-3 py-3 font-normal">Last check</th><th className="px-5 py-3"><span className="sr-only">Next step</span></th></tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const ref = d.publishing?.reference ?? null;
              const l = ref ? listings.get(ref) : undefined;
              const st = statusOf(d, l);
              const score = l && scores ? scores.get(l.agentId) ?? null : undefined;
              const action = !ref ? { label: "Continue", href: `/list?draft=${encodeURIComponent(d.draftId)}` }
                : l && isPaused(l) ? { label: "See why", href: `/agents/${encodeURIComponent(ref)}` }
                  : { label: "Update listing", href: `/list?update=${encodeURIComponent(ref)}` };
              return (
                <tr key={d.draftId} className="border-t border-[color:var(--hairline)]">
                  <td className="px-5 py-3.5"><p className="text-[14px] text-ink">{ref ? <Link href={`/agents/${encodeURIComponent(ref)}`} className="text-ink hover:text-accent">{d.name}</Link> : d.name}</p><p className="mt-0.5 font-mono text-[11px] text-ink-3">{d.priceUSDC} USDC per call</p></td>
                  <td className="px-3 py-3.5 font-mono text-[12px] text-ink-2">{l ? `v${l.version}` : ref ? "–" : "Draft"}</td>
                  <td className="px-3 py-3.5 text-[13px] text-ink"><span aria-hidden className={`mr-2 inline-block size-1.5 ${st.dot}`} />{st.label}</td>
                  <td className="px-3 py-3.5 font-mono text-[12px] tabular-nums text-ink-2">{score === undefined ? (ref ? "–" : "Not yet") : score === null ? "Not yet" : score.toFixed(1)}</td>
                  <td className="px-3 py-3.5 text-[13px] text-ink-2">{lastCheck(l)}</td>
                  <td className="px-5 py-3.5 text-right"><Link href={action.href} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-accent hover:underline">{action.label}</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {anyPaused ? (
        <p className="mt-4 flex items-start gap-3 bg-canvas-2 px-5 py-4 text-sm text-ink-2"><span aria-hidden className="mt-1.5 inline-block size-1.5 shrink-0 bg-[color:var(--warn)]" />A listing pauses after 3 failed checks in a row. It comes back on its own when a recheck passes.</p>
      ) : null}
    </div>
  );
}
