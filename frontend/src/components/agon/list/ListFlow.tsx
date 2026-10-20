"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ListingCard } from "@/components/agon/ListingCard";
import { LoginButton } from "@/components/pengu/LoginButton";
import { TagButton } from "@/components/redesign/TagButton";
import { sendErrorText, useUsdcSend } from "@/components/stage/useUsdcSend";
import { useAgonNetwork } from "@/hooks/useAgonNetwork";
import { useAuth } from "@/hooks/useAuth";
import { useHydrated } from "@/hooks/useHydrated";
import { advancePublishing, approvePublishing, createDraft, getDraft, getListingDraft, runChecks, setupPublishing, type CheckResult, type PublishingResult } from "@/lib/agon/builder-api";
import { AGON_CATEGORIES } from "@/lib/agon/catalog";
import { getListing } from "@/lib/agon/client";
import { EMPTY_FORM, FEE_ATOMIC, LIVE_MAX_FAILURES, afterLiveAttempt, draftFromForm, feeLanding, formFromDraft, liveOutcome, missingFee, stepAfterError, stepFor, timeline, validateForm, type DraftForm, type FlowStep } from "@/lib/agon/listing-flow";
import { StageApiError } from "@/lib/agon/stage";
import type { AgonListing } from "@/lib/agon/types";

const STEPS: { key: FlowStep; title: string; line: string }[] = [
  { key: "describe", title: "Describe", line: "Name, logo, what it does, category, price and endpoint." },
  { key: "check", title: "Check", line: "Agon calls your endpoint without paying and runs its certification task." },
  { key: "approve", title: "Approve and pay", line: "Review what goes on chain and pay a 0.50 USDC network fee." },
  { key: "live", title: "Live", line: "Your agent is listed, then Verified when certification passes." },
];
const INPUT = "min-h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink";
const errorText = (e: unknown, fallback: string) => (e instanceof StageApiError ? e.serverMessage ?? (e.code === "rate_limited" ? "Up to 10 checks an hour. Try again later." : fallback) : fallback);

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
      {children}
      {error ? <span className="text-xs text-[color:var(--err)]">{error}</span> : null}
    </label>
  );
}

function previewListing(form: DraftForm): AgonListing {
  return {
    id: "preview", chainId: "5042002", serviceRegistry: "0x0", listingId: "0", agentId: "0", serviceKey: "0x0", category: form.category, version: "1",
    manifest: { hash: "0x0", uri: "", body: { service: { name: form.name || "Your agent", description: form.outcome || "What it does, in one line.", logoUrl: form.logoUrl.startsWith("https://") ? form.logoUrl : undefined }, pricing: form.priceUSDC ? { amountUSDC: form.priceUSDC } : undefined } },
    providerSnapshot: "0x0", status: "Listed",
    verification: { status: "Unverified", scope: { agentId: "0", listingId: "0", version: "1", category: form.category } },
    risk: { unverified: true, warning: null, quarantineReason: null },
    endpointQa: { status: "not_checked", checkedAt: null, endpointStatus: null, evidenceHash: null, reason: null, attempts: 0, passedAttempts: 0, successRate: 0 },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "0", sourceTxHash: "0x0", sourceLogIndex: 0 },
    firstParty: false,
  } as unknown as AgonListing;
}

/// The four-step List your agent flow. Every step reads from the server, so a reload resumes.
export function ListFlow() {
  const hydrated = useHydrated();
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const { network, networkKey } = useAgonNetwork();
  const testnet = network.chainId === 5_042_002;
  const { path: payPath, send } = useUsdcSend(testnet);
  const draftId = params.get("draft");
  // Updating a listing this account published through Agon: it becomes the next version of that listing.
  const updates = params.get("update");

  const [step, setStep] = useState<FlowStep>("describe");
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const [checks, setChecks] = useState<CheckResult | null>(null);
  const [publishing, setPublishing] = useState<PublishingResult | null>(null);
  const [verification, setVerification] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live publishing stops after repeated failures and waits for the builder to try again.
  const [stalled, setStalled] = useState(false);
  // Checks start by themselves the first time the Check step opens for a saved draft.
  const autoChecked = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [payTx, setPayTx] = useState<string | null>(null);
  const [paidAt, setPaidAt] = useState<number | null>(null);
  const [feeShort, setFeeShort] = useState(false);
  const errors = useMemo(() => validateForm(form), [form]);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // A different draft starts from its own server state, never from the previous draft's checks.
  useEffect(() => { setChecks(null); setPublishing(null); setVerification(null); setFeeShort(false); }, [draftId]);

  // Resume a saved draft from the address bar.
  useEffect(() => {
    if (!draftId || !me) return;
    let active = true;
    void getDraft(draftId).then((d) => {
      if (!active) return;
      setForm(formFromDraft(d.draft));
      setPublishing(d.publishing);
      // Approval needs a fresh passing check, so a resumed draft goes to Check unless it is already publishing.
      setStep(stepFor(d.publishing, false));
    }).catch(() => { if (active) setError("That draft could not be found. Start a new one."); });
    return () => { active = false; };
  }, [draftId, me]);

  // An update starts from the details the listing was published with.
  useEffect(() => {
    if (!updates || draftId || !me) return;
    let active = true;
    void getListingDraft(updates)
      .then((d) => { if (active) setForm(formFromDraft(d.draft)); })
      .catch((e) => { if (active) setError(errorText(e, "This listing could not be loaded for an update.")); });
    return () => { active = false; };
  }, [updates, draftId, me]);

  // Live: wait for a paid fee to land, advance publishing until listed, then watch for Verified.
  useEffect(() => {
    if (step !== "live" || !draftId) return;
    let stop = false;
    let tries = { failures: 0, stalled: false };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tick = async () => {
      let reference: string | null = null;
      for (let i = 0; i < 400 && !stop && live.current; i += 1) {
        try {
          if (!reference) {
            const current = (await getDraft(draftId)).publishing;
            if (stop) return;
            if (current) setPublishing(current);
            if (current?.reference) { reference = current.reference; continue; }
            const landing = feeLanding({ balanceUSDC: current?.balanceUSDC ?? null, paidAt, now: Date.now() });
            if (landing === "wait") { await sleep(3_000); continue; }
            const p = await advancePublishing(draftId);
            if (stop) return;
            setPublishing(p);
            setError(null);
            tries = afterLiveAttempt(tries, true);
            const outcome = liveOutcome(p);
            if (outcome.stop) { setError(outcome.message); return; }
            setFeeShort(p.status === "fund_wallet" && feeLanding({ balanceUSDC: p.balanceUSDC, paidAt, now: Date.now() }) === "ask_again");
            if (p.reference) reference = p.reference;
            await sleep(3_000);
            continue;
          }
          const listing = await getListing(reference, networkKey).catch(() => null);
          if (listing) setVerification(listing.verification.status);
          if (listing?.verification.status === "Verified" || i > 120) return;
          await sleep(10_000);
        } catch (e) {
          tries = afterLiveAttempt(tries, false);
          // A single failed try is retried quietly; the reason shows only once publishing has stopped.
          if (tries.stalled) { setError(errorText(e, "Publishing paused. It resumes when you come back.")); setStalled(true); return; }
          await sleep(3_000);
        }
      }
    };
    void tick();
    return () => { stop = true; };
  }, [step, draftId, networkKey, paidAt, attempt]);

  const run = useCallback(async (label: string, action: () => Promise<void>, fallback: string) => {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      const message = errorText(e, fallback);
      setError(message);
      const back = stepAfterError(message);
      if (back) { setChecks(null); setStep(back); }
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (step !== "check" || !draftId || checks || autoChecked.current) return;
    autoChecked.current = true;
    void run("check", async () => { setChecks(await runChecks(draftId)); }, "The checks could not run. Try again.");
  }, [step, draftId, checks, run]);


  if (!hydrated) return null;
  if (!me) {
    return (
      <section className="grid gap-6">
        <ol className="grid gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-4">
          {STEPS.map((s, i) => <li key={s.key} className="bg-canvas p-4"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">0{i + 1}</p><p className="mt-2 font-sans text-[15px] font-semibold text-ink">{s.title}</p><p className="mt-1 text-sm text-ink-2">{s.line}</p></li>)}
        </ol>
        <div className="flex flex-wrap items-center gap-4"><LoginButton /><span className="text-sm text-ink-2">Sign in to list your agent.</span></div>
      </section>
    );
  }

  const set = (key: keyof DraftForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const current = STEPS.findIndex((s) => s.key === step);

  return (
    <section className="grid gap-8">
      <ol aria-label="Steps" className="grid grid-cols-2 gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.key} aria-current={i === current ? "step" : undefined} className={`p-3 ${i === current ? "bg-canvas-2" : "bg-canvas"}`}>
            <p className={`font-mono text-[10px] uppercase tracking-[0.14em] ${i <= current ? "text-accent" : "text-ink-3"}`}>0{i + 1}</p>
            <p className={`mt-1 font-sans text-[14px] font-semibold ${i <= current ? "text-ink" : "text-ink-3"}`}>{s.title}</p>
          </li>
        ))}
      </ol>

      {updates ? <p className="border-l-[3px] border-accent bg-canvas-2 px-4 py-3 text-sm text-ink">You are updating {form.name || "your agent"}. It keeps its agent ID, tests and scores; the changes publish as its next version.</p> : null}
      {error ? <p role="alert" className="border-l-[3px] border-[color:var(--err)] bg-canvas-2 px-4 py-3 text-sm text-ink">{error}</p> : null}

      {step === "describe" ? (
        <form
          className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (Object.keys(errors).length) return;
            void run("save", async () => {
              const out = await createDraft(draftFromForm(form));
              router.replace(`/list?draft=${encodeURIComponent(out.draftId)}${updates ? `&update=${encodeURIComponent(updates)}` : ""}`);
              setStep("check");
            }, "The draft could not be saved. Try again.");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={touched ? errors.name : undefined}><input className={INPUT} value={form.name} onChange={set("name")} maxLength={80} /></Field>
            <Field label="Category" error={touched ? errors.category : undefined}>
              <select className={INPUT} value={form.category} onChange={set("category")}>{AGON_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </Field>
            <div className="sm:col-span-2"><Field label="What it does (one line)" error={touched ? errors.outcome : undefined}><input className={INPUT} value={form.outcome} onChange={set("outcome")} maxLength={500} /></Field></div>
            <Field label="Logo URL (https)" error={touched ? errors.logoUrl : undefined}><input className={INPUT} value={form.logoUrl} onChange={set("logoUrl")} inputMode="url" /></Field>
            <Field label="Price per call (USDC)" error={touched ? errors.priceUSDC : undefined}><input className={INPUT} value={form.priceUSDC} onChange={set("priceUSDC")} inputMode="decimal" /></Field>
            <div className="sm:col-span-2"><Field label="Endpoint (https, takes paid x402 requests)" error={touched ? errors.endpoint : undefined}><input className={INPUT} value={form.endpoint} onChange={set("endpoint")} inputMode="url" /></Field></div>
            <Field label="What it takes, one per line as name: what it is" error={touched ? errors.inputs : undefined}><textarea className={`${INPUT} min-h-24 py-2`} value={form.inputs} onChange={set("inputs")} placeholder={"market: a Polymarket link, slug or condition id\nnotes: short notes (optional)"} /></Field>
            <Field label="What it returns (one per line)" error={touched ? errors.outputs : undefined}><textarea className={`${INPUT} min-h-24 py-2`} value={form.outputs} onChange={set("outputs")} /></Field>
            <Field label="Privacy" error={touched ? errors.privacy : undefined}><input className={INPUT} value={form.privacy} onChange={set("privacy")} /></Field>
            <Field label="If it fails" error={touched ? errors.failurePolicy : undefined}><input className={INPUT} value={form.failurePolicy} onChange={set("failurePolicy")} /></Field>
            <Field label="Typical answer time (seconds)" error={touched ? errors.expectedLatencySeconds : undefined}><input className={INPUT} value={form.expectedLatencySeconds} onChange={set("expectedLatencySeconds")} inputMode="numeric" /></Field>
            <div className="flex items-end sm:col-span-2"><TagButton type="submit" disabled={busy !== null}>{busy === "save" ? "Saving" : "Save and continue"}</TagButton></div>
          </div>
          <aside aria-label="Card preview" className="grid content-start gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">How it will look on Agents</p>
            <ListingCard listing={previewListing(form)} />
          </aside>
        </form>
      ) : null}

      {step === "check" ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <TagButton disabled={busy !== null || !draftId} onClick={() => void run("check", async () => { setChecks(await runChecks(draftId!)); }, "The checks could not run. Try again.")}>{busy === "check" ? "Checking your endpoint" : checks ? "Run checks again" : "Run checks"}</TagButton>
            <button type="button" className="min-h-11 text-sm text-ink-2 underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent" onClick={() => setStep("describe")}>Edit details</button>
          </div>
          {checks ? (
            <ul className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
              {checks.checks.map((c) => (
                <li key={c.name} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
                  <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink">
                    <span aria-hidden className={`h-2 w-2 ${c.status === "passed" ? "bg-[color:var(--ok)]" : c.status === "failed" ? "bg-[color:var(--err)]" : "bg-[color:var(--hairline-strong)]"}`} />
                    {{ secure_endpoint: "Secure endpoint", asks_for_payment: "Asks for payment", price_matches: "Price matches", certification: "Certification" }[c.name]}
                    {c.required ? null : <span className="text-ink-3">(optional)</span>}
                  </span>
                  <span className="text-sm text-ink-2">{c.detail} {c.status === "failed" ? <Link href="/docs#listing" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">How to fix</Link> : null}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {checks?.requiredPassed ? <div><TagButton onClick={() => setStep("approve")}>Continue</TagButton></div> : null}
        </div>
      ) : null}

      {step === "approve" ? (
        <ApproveStep
          draftId={draftId}
          form={form}
          publishing={publishing}
          busy={busy}
          payTx={payTx}
          payPath={payPath}
          updating={Boolean(updates)}
          onSetup={() => run("setup", async () => { setPublishing(await setupPublishing(draftId!, updates ?? undefined)); }, "Publishing is not available right now.")}
          onPay={() => run("pay", async () => {
            let p = publishing ?? await setupPublishing(draftId!, updates ?? undefined);
            if (p.status === "review_terms") p = await approvePublishing(draftId!, p.termsDigest);
            setPublishing(p);
            if (!p.fundingAddress) throw new Error("no wallet");
            // An update is paid from the publishing wallet's balance; the builder sends gas only when it is short.
            if (updates && p.status !== "fund_wallet") { setStep("live"); return; }
            // Without a wallet Agon can send from, the builder sends the fee to the address shown and continues.
            if (payPath !== "address-only") try {
              const { tx } = await send(p.fundingAddress, p.status === "fund_wallet" && Number(p.balanceUSDC ?? "0") > 0 ? missingFee(p.nextAction) : FEE_ATOMIC);
              setPayTx(tx);
              setPaidAt(Date.now());
              setFeeShort(false);
            } catch (e) {
              throw new StageApiError("send_failed", 0, sendErrorText(e));
            }
            setStep("live");
          }, "Publishing could not continue. Try again.")}
        />
      ) : null}

      {step === "live" ? (
        <div className="grid gap-4">
          <ol className="grid gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-4">
            {timeline(publishing, verification).map((s) => (
              <li key={s.label} className="bg-canvas p-3">
                <span className={`font-mono text-[11px] uppercase tracking-[0.12em] ${s.done ? "text-ink" : "text-ink-3"}`}>{s.done ? "Done " : "Waiting "}</span>
                <span className="block text-sm text-ink">{s.label}</span>
              </li>
            ))}
          </ol>
          {payTx ? <p className="text-sm text-ink-2">Fee sent. <a className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent" href={`${network.explorerUrl}/tx/${payTx}`} target="_blank" rel="noopener noreferrer">View on the explorer</a></p> : null}
          {publishing?.txHash ? <p className="text-sm text-ink-2">Listing transaction: <a className="font-mono underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent" href={`${network.explorerUrl}/tx/${publishing.txHash}`} target="_blank" rel="noopener noreferrer">{publishing.txHash.slice(0, 10)}…</a></p> : null}
          {feeShort ? <p className="text-sm text-ink">The publishing wallet needs a little more gas. <button type="button" className="underline underline-offset-4 hover:text-accent" onClick={() => setStep("approve")}>Add it</button></p> : null}
          {publishing?.agentId ? <p className="font-mono text-xs text-ink-3">Agent #{publishing.agentId}, published from {publishing.fundingAddress}</p> : null}
          {publishing?.reference ? <div><TagButton href={`/agents/${encodeURIComponent(publishing.reference)}`}>View your agent</TagButton></div> : null}
          {!publishing?.reference && !error && !stalled ? <p className="text-sm text-ink-2">Publishing on Arc. This usually takes under a minute.</p> : null}
          {!publishing?.reference && stalled ? (
            <div className="grid gap-3">
              <p className="text-sm text-ink-2">Publishing stopped after {LIVE_MAX_FAILURES} tries. Your fee is safe in the publishing wallet, and nothing is sent twice.</p>
              <div><TagButton variant="ghost" onClick={() => { setStalled(false); setError(null); setAttempt((a) => a + 1); }}>Try again</TagButton></div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ApproveStep(props: { draftId: string | null; form: DraftForm; publishing: PublishingResult | null; busy: string | null; payTx: string | null; payPath: string; updating: boolean; onSetup: () => void; onPay: () => void }) {
  const { publishing, onSetup } = props;
  const asked = useRef(false);
  useEffect(() => {
    if (publishing || !props.draftId || asked.current) return;
    asked.current = true;
    onSetup();
  }, [publishing, props.draftId, onSetup]);
  const short = publishing?.status === "fund_wallet";
  return (
    <div className="grid gap-4">
      <dl className="grid gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)] sm:grid-cols-2">
        {[
          ["Identity", props.updating ? `Your agent's existing identity${publishing?.agentId ? `, Agent #${publishing.agentId}` : ""}` : "A new ERC-8004 agent identity, held in an Agon-managed wallet"],
          ["Listing", `${props.form.name} at ${props.form.priceUSDC} USDC per call`],
          ["Network fee", short ? "The publishing wallet needs a little more gas" : props.updating ? "Paid from the publishing wallet's balance" : props.payPath === "circle" ? "0.50 USDC from your sign-in wallet (see Account)" : "0.50 USDC from your connected wallet"],
          ["Publishing wallet", publishing?.fundingAddress ?? "Preparing"],
        ].map(([k, v]) => <div key={k} className="bg-canvas p-3"><dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{k}</dt><dd className="mt-1 break-all text-sm text-ink">{v}</dd></div>)}
      </dl>
      {publishing ? <p className="break-all font-mono text-xs text-ink-3">Terms digest {publishing.termsDigest}</p> : null}
      {props.payPath === "address-only" && publishing?.fundingAddress && (!props.updating || short)
        ? <p className="text-sm text-ink-2">Send 0.50 USDC on Arc to {publishing.fundingAddress}, then continue.</p>
        : null}
      {!publishing && props.busy === null ? <div><TagButton variant="ghost" onClick={onSetup}>Try again</TagButton></div> : null}
      <div><TagButton disabled={props.busy !== null || !publishing} onClick={props.onPay}>{props.busy === "pay" ? "Waiting for your wallet" : short ? "Add gas and continue" : props.updating ? "Approve and publish the update" : props.payPath === "address-only" ? "I sent it, publish" : "Pay 0.50 USDC and publish"}</TagButton></div>
    </div>
  );
}
