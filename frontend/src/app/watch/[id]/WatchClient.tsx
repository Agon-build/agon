"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { StageShell } from "@/components/stage/StageShell";
import { STAGE_API_URL } from "@/lib/agon/stage";
import { watchPageView, type WatchApi } from "@/lib/agon/watch-view";

const TONE: Record<string, string> = {
  open: "border border-[color:var(--ink-3)]",
  busy: "bg-[color:var(--warn)]",
  warn: "bg-[color:var(--err)]",
  done: "bg-[color:var(--ok)]",
};

export function WatchClient() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : null;
  const [data, setData] = useState<WatchApi | null>(null);
  const [error, setError] = useState<"not_found" | "unavailable" | null>(null);

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch(`${STAGE_API_URL}/agon/agents/specialists/watch/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (stopped) return;
        if (res.status === 404) { setError("not_found"); return; }
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as WatchApi);
        setError(null);
      } catch {
        if (!stopped) setError("unavailable");
      }
    };
    void load();
    // The watcher checks every 2 minutes; the page follows.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [id]);

  const view = data ? watchPageView(data, new Date()) : null;

  return (
    <StageShell network={null}>
      <div className="mx-auto max-w-[1100px] px-4 pb-24 pt-10 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Settlement alerts</p>
        <h1 className="mt-4 font-display text-[clamp(2rem,4vw,3.25rem)] uppercase leading-[1] tracking-[-.04em] text-ink">Resolution Watch</h1>

        {!view && !error ? <p className="mt-8 text-sm text-ink-3">Loading the watch.</p> : null}
        {!view && error ? (
          <p className="mt-8 text-sm leading-6 text-ink-2">
            {error === "not_found" ? "There is no watch at this link. Check the link from your hire." : "Agon could not be reached just now. This page tries again every minute."}
          </p>
        ) : null}

        {view ? (
          <>
            <p className="mt-5 max-w-[70ch] text-[15px] leading-7 text-ink-2">{view.summary}</p>

            <section aria-labelledby="markets-heading" className="mt-10">
              <h2 id="markets-heading" className="border-b border-[color:var(--hairline-strong)] pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Markets</h2>
              <ul className="divide-y divide-[color:var(--hairline)]">
                {view.markets.map((m) => (
                  <li key={m.url} className="grid gap-2 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:gap-8">
                    <a href={m.url} target="_blank" rel="noreferrer" className="break-words text-[15px] leading-6 text-ink underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">{m.question}</a>
                    <div>
                      <p className="inline-flex items-center gap-2 text-sm text-ink">
                        <span aria-hidden className={`inline-block h-2 w-2 ${TONE[m.tone]}`} />
                        {m.state}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-ink-2">{m.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="alerts-heading" className="mt-12">
              <h2 id="alerts-heading" className="border-b border-[color:var(--hairline-strong)] pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Alerts</h2>
              {view.alerts.length === 0 ? (
                <p className="py-6 text-sm leading-6 text-ink-2">No alerts yet. You will get one when a result is proposed, challenged or final, or the rules change.</p>
              ) : (
                <ol className="divide-y divide-[color:var(--hairline)]">
                  {view.alerts.map((a, i) => (
                    <li key={i} className="py-5">
                      <p className="text-[15px] leading-6 text-ink">{a.title}</p>
                      <p className="mt-1 text-sm leading-6 text-ink-2">{a.body}</p>
                      <p className="mt-2 font-mono text-[11px] text-ink-3">{a.when}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        ) : null}
      </div>
    </StageShell>
  );
}
