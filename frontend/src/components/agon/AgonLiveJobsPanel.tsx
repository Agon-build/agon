"use client";

import { useEffect, useState } from "react";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

type LiveJob = { jobId: string; rootId: string; parentId: string | null; depth: number; provider: string; buyer: string; state: string; price: string; traceId: string; createdAt: string; updatedAt: string; receiptUrl: string };

export function AgonLiveJobsPanel({ adminToken }: { adminToken: string }) {
  const [jobs, setJobs] = useState<LiveJob[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`${AUTH_URL}/admin/agon/jobs?limit=50`, { headers: { "x-admin-token": adminToken }, cache: "no-store" });
        const body = (await response.json()) as { jobs?: LiveJob[]; error?: string };
        if (!response.ok) throw new Error(body.error ?? "Could not load jobs.");
        if (!stopped) { setJobs(body.jobs ?? []); setError(null); }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load jobs.");
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 10_000);
    return () => { stopped = true; window.clearInterval(t); };
  }, [adminToken]);

  return (
    <section aria-labelledby="live-jobs-heading" className="mt-10 border-t border-[color:var(--hairline-strong)] pt-6">
      <h2 id="live-jobs-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Live jobs</h2>
      {error ? <p role="alert" className="mt-3 text-sm text-[color:var(--err)]">{error}</p> : null}
      {jobs.length === 0 && !error ? <p className="mt-3 text-sm text-ink-3">No jobs yet.</p> : null}
      {jobs.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[color:var(--hairline)] font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                <th scope="col" className="py-2 pr-3 font-normal">When</th><th scope="col" className="py-2 pr-3 font-normal">Provider</th><th scope="col" className="py-2 pr-3 font-normal">Buyer</th>
                <th scope="col" className="py-2 pr-3 font-normal">State</th><th scope="col" className="py-2 pr-3 text-right font-normal">Price</th><th scope="col" className="py-2 font-normal">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {jobs.map((j) => (
                <tr key={j.jobId} className={j.state === "paying" ? "text-ink" : "text-ink-2"}>
                  <td className="py-2 pr-3 font-mono text-[11px]">{new Date(j.createdAt).toLocaleTimeString()}</td>
                  <td className="py-2 pr-3">{j.depth > 0 ? "↳ " : ""}{j.provider}</td>
                  <td className="py-2 pr-3 font-mono text-[11px]">{j.buyer}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] uppercase">{j.state}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{j.price}</td>
                  <td className="py-2"><a href={j.receiptUrl} className="font-mono text-[11px] underline underline-offset-4 hover:text-accent">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
