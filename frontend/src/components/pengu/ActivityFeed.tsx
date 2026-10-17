"use client";

import { useEffect, useState } from "react";
import { describeActivity, fetchActivity, txLink, type ActivityEvent } from "@/lib/activity";

const PER_PAGE = 15;
const BUFFER = 100; // fetched window; backend caps at 100

/// A live feed of recent on-chain activity across the arena: contests listed and
/// settled, entries, challenges, claims, agents. Polls the auth service and links
/// each line to the app and to its arcscan tx, so it doubles as on-chain proof.
/// Paginated locally so the column does not scroll forever.
export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let stop = false;
    async function load() {
      const e = await fetchActivity(BUFFER);
      if (!stop) setEvents(e);
    }
    load();
    const t = setInterval(load, 6000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const total = events?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageEvents = (events ?? []).slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);

  return (
    <div className="rounded-card border border-pengu-blue/15 bg-pengu-card p-6 shadow-[0_10px_30px_rgba(70,45,150,0.08)]">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-[#22c55e] animate-pulse-live" />
        <span className="font-bubble text-lg uppercase text-pengu-dark">arena activity</span>
      </div>

      {events === null ? (
        <p className="mt-4 font-mono text-sm text-pengu-dark/50">loading the feed…</p>
      ) : events.length === 0 ? (
        <p className="mt-4 font-mono text-sm text-pengu-dark/50">no activity yet. it shows up here as the chain moves.</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col">
            {pageEvents.map((ev, i) => {
              const d = describeActivity(ev);
              return (
                <li
                  key={`${ev.txHash}-${(safePage - 1) * PER_PAGE + i}`}
                  className="flex items-start gap-3 border-b border-pengu-blue/5 py-3 last:border-0"
                >
                  <span className="mt-0.5 flex-none rounded-full bg-pengu-blue/10 px-2 py-0.5 font-display text-[10px] uppercase tracking-wide text-pengu-blue">
                    {d.label}
                  </span>
                  <a href={d.href} className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-pengu-dark/75 hover:text-pengu-dark">
                    {d.text}
                  </a>
                  <a
                    href={txLink(ev.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-none font-mono text-[11px] text-pengu-dark/35 hover:text-pengu-blue"
                    title="view on the Arc explorer"
                  >
                    tx ↗
                  </a>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 ? (
            <div className="mt-5 flex items-center justify-center gap-3">
              <PageBtn disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                ← prev
              </PageBtn>
              <span className="font-mono text-xs text-pengu-dark/60">
                page {safePage} of {totalPages}
              </span>
              <PageBtn disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
                next →
              </PageBtn>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function PageBtn({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const base = "rounded-pill border px-3 py-1.5 font-display text-[11px] uppercase tracking-wide transition-colors";
  if (disabled) {
    return <span className={`${base} border-pengu-blue/10 text-pengu-dark/30`}>{children}</span>;
  }
  return (
    <button onClick={onClick} className={`${base} border-pengu-blue/30 bg-pengu-card text-pengu-blue hover:border-pengu-blue`}>
      {children}
    </button>
  );
}
