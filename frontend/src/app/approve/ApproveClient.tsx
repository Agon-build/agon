"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { LoginButton } from "@/components/pengu/LoginButton";
import { TagButton } from "@/components/redesign/TagButton";
import { RunView } from "@/components/stage/RunView";
import { StageShell } from "@/components/stage/StageShell";
import { useLiveJob } from "@/components/stage/useLiveJob";
import { useAuth } from "@/hooks/useAuth";
import { AGON_PREVIEW_MODE } from "@/lib/agon/client";
import { approve, getApproval, StageApiError } from "@/lib/agon/stage";
import { approvalFailureText } from "@/lib/agon/stage-copy";
import type { ApprovalResult, ApprovalView } from "@/lib/agon/stage-types";

export function ApproveClient() {
  const token = useSearchParams()?.get("t") ?? "";
  const { me } = useAuth();
  const [view, setView] = useState<ApprovalView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApprovalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchJob = view?.action === "over_limit_hire" && (busy || result?.ok) ? view.jobId : null;
  const { live } = useLiveJob(watchJob, { active: busy });

  useEffect(() => {
    if (!token) { setLoadError("not_found"); return; }
    getApproval(token).then((r) => setView(r.approval)).catch((e) => setLoadError(e instanceof StageApiError ? e.code : "network_unavailable"));
  }, [token]);

  async function onApprove() {
    setBusy(true);
    setError(null);
    try {
      const out = await approve(token);
      setResult(out);
      if (!out.ok) setError(out.code ?? "request_failed");
    } catch (e) {
      setError(e instanceof StageApiError ? e.code : "network_unavailable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StageShell network={view?.network ?? null}>
      <div className="mx-auto max-w-[1536px] px-4 pb-24 pt-8 sm:px-6">
        {loadError ? (
          <section className="max-w-[640px] border-y border-[color:var(--hairline-strong)] py-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Approval</p>
            <h1 className="mt-3 font-display text-4xl uppercase leading-none text-ink">Link not usable</h1>
            <p className="mt-4 text-sm leading-6 text-ink-2">{approvalFailureText(loadError)}</p>
          </section>
        ) : null}
        {!view && !loadError ? <p className="py-10 text-sm text-ink-3">Loading the approval.</p> : null}
        {view ? (
          <div className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section aria-labelledby="approve-heading" className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">One-time approval · {view.network}</p>
              <h1 id="approve-heading" className="mt-4 font-display text-[clamp(2.4rem,5vw,4.5rem)] uppercase leading-[.9] tracking-[-.04em] text-ink">{view.title}</h1>
              <dl className="mt-8 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline-strong)]">
                {view.rows.map((row) => (
                  <div key={row.label} className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr]">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{row.label}</dt>
                    <dd className={`break-all text-sm text-ink ${row.label === "Price" || row.label === "Amount" || row.label === "To" ? "font-mono" : ""}`}>{row.value}</dd>
                  </div>
                ))}
              </dl>
              {!view.testnet ? <p className="mt-4 text-sm text-ink">This moves real USDC on Arc.</p> : null}
              {view.owner === "telegram" ? <p className="mt-4 text-xs leading-5 text-ink-3">The first approval links this website sign-in to your Telegram chat. Later approvals must come from the same account.</p> : null}
              <div className="mt-8">
                {result?.ok ? (
                  <div role="status" className="border-l-2 border-[color:var(--ok)] pl-4">
                    <p className="text-base text-ink">{view.action === "withdraw" ? "Withdrawal started. It lands on Arc in a few seconds." : view.action === "unfreeze" ? "Your wallet is unfrozen." : "Approved and paid."}</p>
                    {result.jobId ? <a href={`/r/${result.jobId}`} className="mt-2 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:text-accent">Open the receipt →</a> : null}
                    {result.transferId ? <p className="mt-1 break-all font-mono text-[11px] text-ink-3">Transfer {result.transferId}</p> : null}
                  </div>
                ) : !me && !AGON_PREVIEW_MODE ? (
                  <div className="flex flex-wrap items-center gap-3"><LoginButton /><span className="text-sm text-ink-2">Sign in with your Agon account to approve.</span></div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <TagButton onClick={() => void onApprove()} disabled={busy}>{busy ? "Approving" : "Approve"}</TagButton>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{me ? `Signed in as ${me.address.slice(0, 6)}…${me.address.slice(-4)}` : "Preview data"}</span>
                  </div>
                )}
                {error ? <p role="alert" className="mt-4 text-sm text-[color:var(--err)]">{approvalFailureText(error)}</p> : null}
              </div>
            </section>
            <div className="min-w-0">{live ? <RunView live={live} /> : null}</div>
          </div>
        ) : null}
      </div>
    </StageShell>
  );
}
