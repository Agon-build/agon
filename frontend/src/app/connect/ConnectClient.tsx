"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { LoginButton } from "@/components/pengu/LoginButton";
import { TagButton } from "@/components/redesign/TagButton";
import { TopNav } from "@/components/redesign/TopNav";
import { useAuth } from "@/hooks/useAuth";
import { decideConnect, getConnectRequest, type ConnectRequest } from "@/lib/agon/connect-api";
import { LEVELS, needsTerms, type ConnectLevel } from "@/lib/agon/connect-view";
import { getTerms, StageApiError, type WalletTerms } from "@/lib/agon/stage";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ConnectClient() {
  const id = useSearchParams()?.get("request") ?? "";
  const { me, loading } = useAuth();
  const [request, setRequest] = useState<ConnectRequest | null>(null);
  const [terms, setTerms] = useState<WalletTerms | null>(null);
  const [level, setLevel] = useState<ConnectLevel>("read");
  const [state, setState] = useState<"loading" | "ready" | "expired" | "working" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me || !id) { if (!id) setState("expired"); return; }
    let active = true;
    getConnectRequest(id)
      .then((r) => { if (!active) return; setRequest(r); setLevel(r.level); setState("ready"); })
      .catch(() => { if (active) setState("expired"); });
    return () => { active = false; };
  }, [me, id]);

  const showTerms = request ? needsTerms(level, request.termsAccepted) : false;
  useEffect(() => {
    if (showTerms && !terms) getTerms().then(setTerms).catch(() => setError("Agon could not load the wallet terms. Try again."));
  }, [showTerms, terms]);

  async function decide(approve: boolean) {
    setState("working");
    setError(null);
    try {
      const out = await decideConnect(id, { approve, level, ...(approve && showTerms && terms ? { acceptTerms: true, termsVersion: terms.version } : {}) });
      setState("done");
      window.location.assign(out.redirectTo);
    } catch (e) {
      const code = e instanceof StageApiError ? e.code : "";
      if (code === "request_expired") setState("expired");
      else { setState("ready"); setError(code === "terms_required" ? "Accept the wallet terms to give this agent spending access." : "That did not go through. Try again."); }
    }
  }

  return (
    <div className="flex min-h-[100svh] flex-col bg-canvas text-ink">
      <TopNav />
      <main className="mx-auto w-full max-w-[640px] flex-1 px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Connect an agent</p>
        {state === "expired" ? (
          <>
            <h1 className="mt-4 font-display text-[clamp(2rem,6vw,3.25rem)] uppercase leading-[.95] tracking-[-.03em]">This request expired</h1>
            <p className="mt-4 text-sm leading-6 text-ink-2">Start the connection again from your agent.</p>
          </>
        ) : !me ? (
          <>
            <h1 className="mt-4 font-display text-[clamp(2rem,6vw,3.25rem)] uppercase leading-[.95] tracking-[-.03em]">Sign in to connect</h1>
            <p className="mt-4 text-sm leading-6 text-ink-2">An agent is asking to use your Agon account. Sign in to review it.</p>
            <div className="mt-8">{loading ? <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Checking your session</p> : <LoginButton />}</div>
          </>
        ) : !request ? (
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Loading the request</p>
        ) : (
          <section aria-labelledby="connect-heading">
            <h1 id="connect-heading" className="mt-4 font-display text-[clamp(2rem,6vw,3.25rem)] uppercase leading-[.95] tracking-[-.03em]">{request.verified ? request.clientName : "An unverified app"} wants to use Agon</h1>
            {request.verified ? (
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Published by {request.clientHost}</p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-ink-2">It calls itself <span className="text-ink">&ldquo;{request.clientName}&rdquo;</span>. Only confirm if you just started this from your own agent.</p>
            )}
            <dl className="mt-8 grid gap-px border-y border-[color:var(--hairline-strong)] sm:grid-cols-2">
              <div className="py-4 sm:pr-4"><dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Acting for</dt><dd className="mt-1 font-mono text-sm text-ink">{short(me.address)}</dd></div>
              <div className="py-4 sm:pl-4"><dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Goes back to</dt><dd className="mt-1 font-mono text-sm text-ink">{request.redirectHost}</dd></div>
            </dl>
            <fieldset className="mt-8">
              <legend className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">What it may do</legend>
              <div className="mt-3 grid gap-2">
                {LEVELS.map((l) => (
                  <label key={l.level} className={`flex min-h-11 cursor-pointer items-start gap-3 border p-4 ${level === l.level ? "border-accent" : "border-[color:var(--hairline)] hover:border-[color:var(--hairline-strong)]"}`}>
                    <input type="radio" name="level" className="mt-1 accent-[color:var(--accent)]" checked={level === l.level} onChange={() => setLevel(l.level)} />
                    <span><span className="block font-mono text-[12px] uppercase tracking-[0.12em] text-ink">{l.label}</span><span className="mt-1 block text-sm leading-6 text-ink-2">{l.detail}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            {showTerms ? (
              <div className="mt-6 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Your agent wallet</p>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-2">{(terms?.lines ?? []).map((line) => <li key={line}>{line}</li>)}</ul>
                <p className="mt-3 text-xs text-ink-3">Connecting with this level accepts these terms.</p>
              </div>
            ) : null}
            {error ? <p role="alert" className="mt-4 text-sm text-[color:var(--err)]">{error}</p> : null}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <TagButton onClick={() => void decide(true)} disabled={state !== "ready" || (showTerms && !terms)}>{state === "working" || state === "done" ? "Connecting" : "Confirm"}</TagButton>
              <TagButton variant="ghost" onClick={() => void decide(false)} disabled={state !== "ready"}>Cancel</TagButton>
            </div>
            <p className="mt-6 text-xs leading-5 text-ink-3">You can disconnect it any time in Account.</p>
          </section>
        )}
      </main>
    </div>
  );
}
