"use client";

import { useEffect, useMemo, useState } from "react";

import { LoginModal } from "@/components/pengu/LoginModal";
import { X402ExecutionReview } from "@/components/agon/X402ExecutionReview";
import { X402AuthorizationSigner } from "@/components/agon/X402AuthorizationSigner";
import { TagButton } from "@/components/redesign/TagButton";
import { useAuth } from "@/hooks/useAuth";
import { AGON_PREVIEW_MODE, approveX402CallIntent, captureX402Quote, prepareX402Authorization, prepareX402CallIntent } from "@/lib/agon/client";
import { assessX402Readiness, buildCallIntentRequest, newCallIntentKey } from "@/lib/agon/call-intent";
import { formatUSDCBaseUnits } from "@/lib/agon/execution-review";
import type { AgonListing, X402ApprovalView, X402AuthorizationSubmittedView, X402AuthorizationView, X402CallIntentView, X402QuoteView } from "@/lib/agon/types";

type Props = {
  listing: AgonListing;
  defaultAmount: string | null;
  endpointUrl?: string | null;
};

export function X402CallIntentPanel({ listing, defaultAmount, endpointUrl }: Props) {
  const { me } = useAuth();
  const readiness = useMemo(() => assessX402Readiness(listing), [listing]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [method, setMethod] = useState<"GET" | "POST">("POST");
  const [input, setInput] = useState("{\n  \n}");
  const [maxAmountUSDC, setMaxAmountUSDC] = useState(defaultAmount ?? "0.01");
  const [intent, setIntent] = useState<X402CallIntentView | null>(null);
  const [approval, setApproval] = useState<X402ApprovalView | null>(null);
  const [quote, setQuote] = useState<X402QuoteView | null>(null);
  const [authorization, setAuthorization] = useState<X402AuthorizationView | null>(null);
  const [submittedAuthorization, setSubmittedAuthorization] = useState<X402AuthorizationSubmittedView | null>(null);
  const [authorizationSignature, setAuthorizationSignature] = useState<`0x${string}` | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (me && loginOpen) setLoginOpen(false);
  }, [loginOpen, me]);

  async function prepare() {
    setMessage(null);
    setIntent(null);
    setApproval(null);
    setQuote(null);
    setAuthorization(null);
    setSubmittedAuthorization(null);
    setAuthorizationSignature(null);
    if (!me && !AGON_PREVIEW_MODE) {
      setLoginOpen(true);
      return;
    }
    const key = idempotencyKey || newCallIntentKey();
    setIdempotencyKey(key);
    const request = buildCallIntentRequest(key, method, input, maxAmountUSDC, endpointUrl ?? undefined);
    if ("error" in request) {
      setMessage(request.error);
      return;
    }
    setPreparing(true);
    try {
      setIntent(await prepareX402CallIntent(listing.id, request));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agon could not prepare this call.");
    } finally {
      setPreparing(false);
    }
  }

  async function approve() {
    if (!intent || (!me && !AGON_PREVIEW_MODE)) return;
    setMessage(null);
    setPreparing(true);
    try {
      setApproval(await approveX402CallIntent(intent.intentId, { approvedAmountUSDC: intent.maxAmountUSDC }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agon could not record approval.");
    } finally {
      setPreparing(false);
    }
  }

  async function readQuote() {
    if (!approval || !intent) return;
    setMessage(null);
    setPreparing(true);
    try {
      setQuote(await captureX402Quote(intent.intentId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agon could not read the provider payment quote.");
    } finally {
      setPreparing(false);
    }
  }

  async function prepareAuthorization() {
    if (!quote || !intent) return;
    setMessage(null);
    setPreparing(true);
    try {
      setAuthorization(await prepareX402Authorization(intent.intentId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agon could not prepare the authorization payload.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <div className="mt-7 border-t border-current pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.14em]">HIRE THIS AGENT</div>
          <p className="mt-2 max-w-[42ch] font-mono text-[10px] leading-relaxed opacity-70">
            Enter the task and set the most you are willing to pay. Nothing is charged until you review and sign.
          </p>
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-[0.12em] ${readiness.eligible ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>
          {readiness.label}
        </span>
      </div>

      {AGON_PREVIEW_MODE ? <p className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed text-[color:var(--warn)]">SAMPLE ONLY · no wallet, payment, or provider is contacted.</p> : null}

      {!readiness.eligible ? (
        <p className="mt-4 border-l-2 border-[color:var(--err)] pl-3 font-mono text-[10px] leading-relaxed opacity-75">{readiness.reason}</p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)]">
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
              METHOD
              <select value={method} onChange={(event) => setMethod(event.target.value as "GET" | "POST")} className="mt-2 h-10 w-full border border-current bg-transparent px-2 font-mono text-[11px] opacity-100">
                <option value="POST">POST</option>
                <option value="GET">GET</option>
              </select>
            </label>
            <label className="font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
              YOUR SPEND LIMIT · USDC
              <input value={maxAmountUSDC} onChange={(event) => setMaxAmountUSDC(event.target.value)} inputMode="decimal" className="mt-2 h-10 w-full border border-current bg-transparent px-3 font-mono text-[11px] text-current" />
            </label>
          </div>
          <label className="mt-4 block font-mono text-[9px] uppercase tracking-[0.12em] opacity-65">
            TASK DETAILS (JSON)
            <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} spellCheck={false} className="mt-2 w-full resize-y border border-current bg-transparent p-3 font-mono text-[11px] leading-relaxed text-current" />
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {me || AGON_PREVIEW_MODE ? (
              <TagButton variant="primary" size="sm" onClick={prepare} disabled={preparing}>{preparing ? "CHECKING..." : "REVIEW TASK →"}</TagButton>
            ) : (
              <TagButton variant="primary" size="sm" onClick={() => setLoginOpen(true)}>SIGN IN TO CONTINUE →</TagButton>
            )}
            {idempotencyKey ? <span className="font-mono text-[9px] uppercase tracking-[0.08em] opacity-50">SAFE TO RETRY</span> : null}
          </div>
        </>
      )}

      {message ? <p role="alert" className="mt-4 border-l-2 border-[color:var(--warn)] pl-3 font-mono text-[10px] leading-relaxed">{message}</p> : null}
      {intent ? (
        <div className="mt-5 border border-[color:var(--ok)] p-4 font-mono text-[10px] leading-relaxed">
          <div className="flex items-center justify-between gap-3 uppercase tracking-[0.12em] text-[color:var(--ok)]"><span>{approval ? "SPENDING LIMIT APPROVED" : "TASK READY FOR REVIEW"}</span><span>NO PAYMENT YET</span></div>
          <div className="mt-3 opacity-75">YOUR LIMIT · {intent.maxAmountUSDC} USDC</div>
          <details className="mt-3 border-t border-current pt-3 opacity-70"><summary className="cursor-pointer uppercase tracking-[0.1em]">TECHNICAL REQUEST</summary><div className="mt-2 break-all">INPUT HASH · {intent.inputHash}</div></details>
          {approval ? (
            <div className="mt-4 border-t border-current pt-3">
              <div className="uppercase tracking-[0.1em] text-[color:var(--ok)]">APPROVED LIMIT · {approval.approvedAmountUSDC} USDC</div>
              {!quote ? <TagButton variant="primary" size="sm" className="mt-3" onClick={readQuote} disabled={preparing}>{preparing ? "CHECKING PRICE..." : "CONFIRM PROVIDER PRICE →"}</TagButton> : null}
              {quote ? (
                <div className="mt-4 space-y-3 border-t border-current pt-3 opacity-90">
                  <div className="text-[color:var(--warn)]">PROVIDER PRICE CONFIRMED</div>
                  {quote.accepts.map((option) => (
                    <div key={`${option.network}-${option.payTo}`} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{formatUSDCBaseUnits(option.amount)}</span>
                      <span className="opacity-65">{option.network}</span>
                    </div>
                  ))}
                  {!authorization ? (
                    <TagButton variant="primary" size="sm" className="mt-3" onClick={prepareAuthorization} disabled={preparing}>
                      {preparing ? "PREPARING REVIEW..." : "REVIEW PAYMENT →"}
                    </TagButton>
                  ) : (
                    <div className="mt-3 space-y-3 border-t border-current pt-3">
                      <div>{submittedAuthorization ? "PAYMENT APPROVAL SIGNED" : "READY FOR YOUR SIGNATURE"}</div>
                      <div>AMOUNT · {formatUSDCBaseUnits(authorization.payload.message.value)}</div>
                      <div>EXPIRES · {authorization.expiresAt}</div>
                      <details className="border-t border-current pt-3 opacity-70">
                        <summary className="cursor-pointer uppercase tracking-[0.1em]">TECHNICAL PAYMENT DETAILS</summary>
                        <div className="mt-2 break-all">QUOTE HASH · {quote.quoteHash}</div>
                        <div className="mt-1 break-all">PAYLOAD HASH · {authorization.payloadHash}</div>
                        <div className="mt-1 break-all">FROM · {authorization.payload.message.from}</div>
                        <div className="mt-1 break-all">TO · {authorization.payload.message.to}</div>
                        {submittedAuthorization ? <div className="mt-1 break-all">AUTHORIZATION HASH · {submittedAuthorization.authorizationHash}</div> : null}
                      </details>
                      {!submittedAuthorization ? <X402AuthorizationSigner intentId={intent.intentId} authorization={authorization} preview={AGON_PREVIEW_MODE} onSubmitted={setSubmittedAuthorization} /> : null}
                      {submittedAuthorization ? <X402ExecutionReview intentId={intent.intentId} refreshKey={submittedAuthorization.submittedAt} /> : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 border-t border-current pt-3">
              <p className="mb-3 opacity-75">Approve the maximum amount for this task. You will still review the provider price before signing a payment.</p>
              <TagButton variant="primary" size="sm" onClick={approve} disabled={preparing}>{preparing ? "SAVING..." : `SET ${intent.maxAmountUSDC} USDC LIMIT →`}</TagButton>
            </div>
          )}
        </div>
      ) : null}

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
