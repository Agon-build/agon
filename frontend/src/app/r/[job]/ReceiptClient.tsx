"use client";
import { useState } from "react";
import { useParams } from "next/navigation";

import { RunView } from "@/components/stage/RunView";
import { StageShell } from "@/components/stage/StageShell";
import { StatusMark } from "@/components/stage/StatusMark";
import { TxLink } from "@/components/stage/TxLink";
import { useLiveJob } from "@/components/stage/useLiveJob";
import { flattenPayments } from "@/lib/agon/stage-view";

export function ReceiptClient() {
  const params = useParams<{ job: string }>();
  const jobId = typeof params?.job === "string" ? params.job : null;
  const { live, error } = useLiveJob(jobId, { active: false, intervalMs: 1500 });
  const [copied, setCopied] = useState(false);
  const rows = flattenPayments(live?.receipt ?? null);

  return (
    <StageShell network={live?.network ?? null} preview={live?.preview}>
      <div className="mx-auto max-w-[1536px] px-4 pb-24 pt-8 sm:px-6">
        {!live && error ? (
          <section className="border-y border-[color:var(--hairline-strong)] py-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Receipt</p>
            <h1 className="mt-3 font-display text-4xl uppercase leading-none text-ink">{error === "job_not_found" || error === "not_found" ? "No job with this id" : "Receipt unavailable"}</h1>
            <p className="mt-4 text-sm text-ink-2">{error === "job_not_found" || error === "not_found" ? "Check the link. Receipts are kept for every paid job." : "Agon could not be reached. This page retries on its own."}</p>
          </section>
        ) : null}
        {!live && !error ? <p className="py-10 text-sm text-ink-3">Loading the receipt.</p> : null}
        {live ? (
          <>
            <header className="border-b border-[color:var(--hairline-strong)] pb-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Receipt · {live.network}</p>
              <h1 className="mt-4 max-w-[24ch] font-display text-[clamp(1.9rem,3.6vw,3.25rem)] uppercase leading-[1.02] tracking-[-.04em] text-ink">{live.question ?? "Agent job"}</h1>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="break-all font-mono text-[11px] text-ink-3">Job {live.jobId}</span>
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(window.location.href); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} className="min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">{copied ? "Link copied" : "Copy link"}</button>
              </div>
            </header>
            <div className="mt-10"><RunView live={live} /></div>
            <section aria-labelledby="payments-heading" className="mt-16">
              <h2 id="payments-heading" className="border-b border-[color:var(--hairline-strong)] pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">All payments</h2>
              {rows.length === 0 ? <p className="py-6 text-sm text-ink-3">No payments yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[color:var(--hairline)] font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                        <th scope="col" className="py-3 pr-4 font-normal">Payment</th><th scope="col" className="py-3 pr-4 font-normal">From</th><th scope="col" className="py-3 pr-4 font-normal">To</th>
                        <th scope="col" className="py-3 pr-4 text-right font-normal">Amount</th><th scope="col" className="py-3 pr-4 font-normal">Status</th><th scope="col" className="py-3 font-normal">Transaction</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--hairline)]">
                      {rows.map((r) => (
                        <tr key={r.key} className="text-sm text-ink">
                          <td className="py-3 pr-4">{r.what}</td><td className="py-3 pr-4 text-ink-2">{r.from}</td><td className="py-3 pr-4 text-ink-2">{r.to}</td>
                          <td className="py-3 pr-4 text-right font-mono tabular-nums">{r.amount} USDC</td><td className="py-3 pr-4"><StatusMark status={r.status} /></td><td className="py-3"><TxLink url={r.txUrl} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </StageShell>
  );
}
