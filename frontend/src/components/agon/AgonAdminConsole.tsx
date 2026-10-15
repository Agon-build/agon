"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";

import { ConnectButton } from "@/components/ConnectButton";
import { LoginModal } from "@/components/pengu/LoginModal";
import { ProtocolActions } from "@/components/agon/ProtocolActions";
import { X402CallIntentPanel } from "@/components/agon/X402CallIntentPanel";
import { AgonSyndicatePrizeIntentPanel } from "@/components/agon/AgonSyndicatePrizeIntentPanel";
import { AgonOperationsAlertsPanel } from "@/components/agon/AgonOperationsAlertsPanel";
import { AgonLiveJobsPanel } from "@/components/agon/AgonLiveJobsPanel";
import { useAuth } from "@/hooks/useAuth";
import { useArcWrite } from "@/hooks/useArcWrite";
import { confirmTx } from "@/lib/arc";
import { agonArenaAbi } from "@/lib/agon/abi";
import { arenaEvaluationIdFromReceipt, arenaPrimaryAction, arenaProgressPercent } from "@/lib/agon/arena";
import { categoryById } from "@/lib/agon/catalog";
import {
  getAgonEscrowReadiness,
  getAgonEscrowTransaction,
  getAgonHealth,
  getAgonJobEscrowJob,
  getAgonJobEscrowTransaction,
  evaluatePlaygroundTask,
  getAgonArenaEvaluation,
  prepareAgonArenaEvaluation,
  getAgonArenaRequestTransaction,
  getAgonArenaEvidenceTransaction,
  markAgonArenaEvaluationSubmitted,
  markAgonArenaEvidenceSubmitted,
  reconcileAgonArenaEvaluation,
  listListings,
  prepareAgonEscrowIntent,
  prepareAgonJobEscrowIntent,
  reconcileAgonJobEscrowIntent,
  setAgonAdminAuthorization,
} from "@/lib/agon/client";
import type { AgonArenaEvaluationView, AgonArenaTransactionView, AgonEscrowIntentView, AgonEscrowReadinessView, AgonEscrowTransactionView, AgonHealth, AgonJobEscrowIntentView, AgonJobEscrowJobView, AgonJobEscrowTransactionView, AgonListing } from "@/lib/agon/types";

const inputClass = "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink";

// Arena tasks are selected from the immutable on-chain listing category. The
// operator console must never run a development challenge against an analysis
// listing (or silently anchor evidence to the wrong category).
const ARENA_TASK_BY_LISTING_CATEGORY: Record<string, {
  category: "development" | "research" | "analysis" | "verification" | "execution";
  taskId: string;
}> = {
  "1": { category: "research", taskId: "arc-live-fact" },
  // Live provider adapters currently expose the adversarial analysis contract.
  // Keep the operator category as Analysis while selecting the provider-supported task.
  "3": { category: "analysis", taskId: "evidence-under-pressure" },
  "5": { category: "execution", taskId: "transaction-safety" },
  "7": { category: "development", taskId: "selector-guard" },
  "8": { category: "verification", taskId: "manifest-anchor" },
};

export function AgonAdminConsole({ adminToken }: { adminToken: string }) {
  const { address: connectedAddress } = useAccount();
  const { me } = useAuth();
  const { signerAddress, signerRoute } = useArcWrite();
  const [health, setHealth] = useState<AgonHealth | null>(null);
  const [listings, setListings] = useState<AgonListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    // The actor must be the wallet that will sign the exact provider call.
    // Circle developer-controlled wallets do not appear in wagmi's account
    // connector, so useArcWrite() is the source of truth for both injected
    // and Circle sessions.
    setAgonAdminAuthorization(adminToken, signerAddress ?? null);
    return () => setAgonAdminAuthorization(null, null);
  }, [adminToken, signerAddress]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextHealth, nextListings] = await Promise.all([
        getAgonHealth(),
        listListings({ limit: 50 }),
      ]);
      setHealth(nextHealth);
      setListings(nextListings.items);
      setSelectedId((current) => current || nextListings.items[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Agon operator state.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const selected = useMemo(
    () => listings.find((listing) => listing.id === selectedId) ?? null,
    [listings, selectedId],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-[color:var(--hairline-strong)] pb-6">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">AGON OPS / ARC TESTNET</div>
          <h2 className="mt-2 font-stencil text-4xl uppercase leading-none sm:text-5xl">Run the market safely</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">Choose a service, run its proof, then prepare a hire or payment. Chain details stay available when you need to inspect them.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {me?.walletKind === "circle" && signerAddress ? <span className="border border-[color:var(--ok)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--ok)]">CIRCLE WALLET {signerAddress.slice(0, 6)}...{signerAddress.slice(-4)}</span> : <ConnectButton />}
          {!me ? <button onClick={() => setLoginOpen(true)} className="border border-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent hover:bg-accent/10">SIGN IN / USE CIRCLE</button> : null}
          <button onClick={() => void load()} disabled={loading} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink disabled:opacity-50">{loading ? "READING" : "REFRESH"}</button>
        </div>
      </header>

      {error ? <p className="border-l-2 border-[color:var(--err)] p-3 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}
      <AgonStatusSummary health={health} address={signerAddress ?? connectedAddress ?? null} signerRoute={signerRoute} authenticated={Boolean(me)} listingCount={listings.length} />
      <AgonOperationsAlertsPanel adminToken={adminToken} />
      <AgonLiveJobsPanel adminToken={adminToken} />

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">01 / CHOOSE A SERVICE</div><h3 className="mt-2 font-stencil text-3xl uppercase leading-none">What are you working on?</h3></div><p className="max-w-md text-sm leading-5 text-ink-2">Every action below uses the selected listing and its immutable version.</p></div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]"><AgonListingPicker listings={listings} selectedId={selectedId} onChange={setSelectedId} /><AgonSelectedService listing={selected} /></div>
      </section>

      <section>
        <div className="mb-4"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">02 / VERIFY</div><h3 className="mt-2 font-stencil text-3xl uppercase leading-none">Prove this service works</h3><p className="mt-2 max-w-2xl text-sm leading-5 text-ink-2">The provider signs in, Agon runs the matching category task, and Arena records the evidence. Nothing is marked tested until chain state reconciles.</p></div>
        <AgonArenaEvaluationPanel listing={selected} />
      </section>

      <section>
        <div className="mb-4"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">03 / HIRE</div><h3 className="mt-2 font-stencil text-3xl uppercase leading-none">Run paid work</h3><p className="mt-2 max-w-2xl text-sm leading-5 text-ink-2">Use direct x402 for a single call. Use escrow when the deployed contract and policy gates are ready.</p></div>
        <div className="grid gap-6 lg:grid-cols-2">
          {selected ? <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DIRECT X402 CALL</div><div className="mt-2 text-sm text-ink-2">Prepare a bounded call against the selected provider.</div><X402CallIntentPanel listing={selected} defaultAmount={selected.manifest.body && typeof selected.manifest.body === "object" && "pricing" in selected.manifest.body ? null : "0.01"} endpointUrl={selected.endpointQa.endpointUrl ?? null} /></section> : <EmptyState message="Choose a listed service first." />}
          <AgonJobEscrowIntentPanel listing={selected} capabilities={health?.capabilities ?? null} />
        </div>
      </section>

      <details className="border border-[color:var(--hairline-strong)] bg-canvas">
        <summary className="cursor-pointer list-none px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">Advanced controls and audit tools</summary>
        <div className="grid gap-6 border-t border-[color:var(--hairline)] p-5"><AgonReadiness health={health} /><AgonEscrowPreparation listing={selected} /><AgonSyndicatePrizeIntentPanel /><ProtocolActions /><AgonJobInspector /></div>
      </details>
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </div>
  );
}

function AgonStatusSummary({ health, address, signerRoute, authenticated, listingCount }: { health: AgonHealth | null; address: string | null; signerRoute: string; authenticated: boolean; listingCount: number }) {
  const capabilities = health?.capabilities;
  const arenaExecutionReady = capabilities?.arenaEvaluatorReadiness?.executionEnabled === true;
  const walletLabel = !address
    ? "CONNECT"
    : signerRoute === "circle_developer_controlled"
      ? "CIRCLE ACTIVE"
      : authenticated
        ? "SIWE READY"
        : "SIGN IN";
  const cells = [
    { label: "API", value: health?.ok ? "ONLINE" : "READING", tone: health?.ok ? "var(--ok)" : "var(--ink-3)" },
    { label: "ARC", value: capabilities?.protocolReadiness?.chainId ? String(capabilities.protocolReadiness.chainId) : "UNKNOWN", tone: "var(--accent)" },
    { label: "LISTINGS", value: String(listingCount), tone: "var(--ink)" },
    { label: "ARENA", value: arenaExecutionReady ? "READY" : "ACTION NEEDED", tone: arenaExecutionReady ? "var(--ok)" : "var(--warn)" },
    { label: "ALERTS", value: capabilities?.operationsAlerts?.ready ? "READY" : "ACTION NEEDED", tone: capabilities?.operationsAlerts?.ready ? "var(--ok)" : "var(--warn)" },
    { label: "X402", value: capabilities?.directX402 ? "READY" : "GATED", tone: capabilities?.directX402 ? "var(--ok)" : "var(--ink-3)" },
    { label: "WALLET", value: walletLabel, tone: !address ? "var(--warn)" : authenticated ? "var(--ok)" : "var(--warn)" },
  ];
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">LIVE CONTROL STATUS</div><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">refresh before a write</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">{cells.map((cell) => <div key={cell.label} className="border border-[color:var(--hairline)] bg-canvas px-3 py-3"><div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{cell.label}</div><div className="mt-2 font-mono text-sm" style={{ color: cell.tone }}>{cell.value}</div></div>)}</div>{address && !authenticated ? <p className="mt-3 border-l-2 border-[color:var(--warn)] p-3 text-sm text-ink-2">Wallet connected. Sign in with your wallet before running provider verification or other operator actions.</p> : null}{arenaExecutionReady ? null : <p className="mt-3 border-l-2 border-[color:var(--warn)] p-3 text-sm text-ink-2">Arena automation is not ready. Confirm the evaluator role, validator signer, and Arena execution flag before starting a provider review.</p>}</section>;
}

function AgonSelectedService({ listing }: { listing: AgonListing | null }) {
  if (!listing) return <EmptyState message="No service selected. Publish a listing, then refresh this console." />;
  const category = categoryById(listing.category);
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="flex items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">SELECTED SERVICE</div><h4 className="mt-2 font-stencil text-2xl uppercase leading-none">Agent {listing.agentId}</h4></div><span className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${listing.status === "Listed" ? "border-[color:var(--ok)] text-[color:var(--ok)]" : "border-[color:var(--err)] text-[color:var(--err)]"}`}>{listing.status}</span></div><div className="mt-5 grid gap-3 text-sm"><div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-3"><span className="text-ink-3">Category</span><span className="font-mono text-ink">{category.label} / {listing.category}</span></div><div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-3"><span className="text-ink-3">Version</span><span className="font-mono text-ink">v{listing.version}</span></div><div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-3"><span className="text-ink-3">Trust</span><span className="font-mono" style={{ color: listing.verification.status === "Verified" ? "var(--ok)" : "var(--warn)" }}>{listing.verification.status}</span></div><div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-3"><span className="text-ink-3">Payment</span><span className="font-mono text-ink">{listing.payment.rail}</span></div><div className="flex items-center justify-between border-t border-[color:var(--hairline)] pt-3"><span className="text-ink-3">Endpoint check</span><span className="font-mono text-ink">{listing.endpointQa.status.replace(/_/g, " ")}</span></div></div><details className="mt-5 border-t border-[color:var(--hairline)] pt-3"><summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Technical record</summary><div className="mt-3 grid gap-2 break-all font-mono text-[10px] leading-5 text-ink-3"><span>LISTING {listing.listingId}</span><span>SERVICE KEY {listing.serviceKey}</span><span>MANIFEST {listing.manifest.hash}</span><span>URI {listing.manifest.uri}</span><span>PROVIDER SNAPSHOT {listing.providerSnapshot}</span></div></details></section>;
}

function AgonArenaEvaluationPanel({ listing }: { listing: AgonListing | null }) {
  const { me } = useAuth();
  const { writeContractAsync, isPending } = useArcWrite();
  const [loginOpen, setLoginOpen] = useState(false);
  const [evaluation, setEvaluation] = useState<AgonArenaEvaluationView | null>(null);
  const [requestTransaction, setRequestTransaction] = useState<AgonArenaTransactionView | null>(null);
  const [evidenceTransaction, setEvidenceTransaction] = useState<AgonArenaTransactionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const storageKey = listing ? `agon:arena:${listing.id}:${listing.version}` : null;
  const working = busy || isPending;

  async function refresh(intent = evaluation, quiet = false) {
    if (!intent) return;
    if (!quiet) { setBusy(true); setMessage(null); }
    try {
      const next = await reconcileAgonArenaEvaluation(intent.intentId);
      setEvaluation(next);
      if (next.state === "evidence_ready") {
        setEvidenceTransaction(await getAgonArenaEvidenceTransaction(next.intentId));
      }
      if (next.state === "verified") setMessage("Verification complete. This service passed the Arena review.");
      if (next.state === "rejected") setMessage("Verification finished. This result needs provider review before another attempt.");
    } catch (cause) {
      if (!quiet) setMessage(cause instanceof Error ? cause.message : "Could not refresh Arena verification.");
    } finally {
      if (!quiet) setBusy(false);
    }
  }

  useEffect(() => {
    setEvaluation(null);
    setRequestTransaction(null);
    setEvidenceTransaction(null);
    setMessage(null);
    if (!storageKey || !me) return;
    const intentId = window.localStorage.getItem(storageKey);
    if (!intentId) return;
    let cancelled = false;
    void getAgonArenaEvaluation(intentId).then(async (next) => {
      if (cancelled) return;
      setEvaluation(next);
      if (next.state === "prepared") setRequestTransaction(await getAgonArenaRequestTransaction(next.intentId));
      if (next.state === "evidence_ready") setEvidenceTransaction(await getAgonArenaEvidenceTransaction(next.intentId));
    }).catch(() => window.localStorage.removeItem(storageKey));
    return () => { cancelled = true; };
  }, [storageKey, me]);

  useEffect(() => {
    if (!evaluation?.evaluationId || !["request_submitted", "evidence_submitted", "unknown"].includes(evaluation.state)) return;
    const timer = window.setInterval(() => void refresh(evaluation, true), 5_000);
    return () => window.clearInterval(timer);
  }, [evaluation?.intentId, evaluation?.state]);

  async function prepare() {
    if (!listing) return;
    if (!me) { setLoginOpen(true); return; }
    const task = ARENA_TASK_BY_LISTING_CATEGORY[listing.category];
    if (!task) { setMessage(`Arena verification is not available for ${categoryById(listing.category).label} services yet.`); return; }
    setBusy(true); setMessage(null); setEvaluation(null); setRequestTransaction(null); setEvidenceTransaction(null);
    try {
      const key = `admin-arena-${listing.listingId}-${Date.now()}`;
      const run = await evaluatePlaygroundTask({
        category: task.category,
        taskId: task.taskId,
        listingReference: listing.id,
        listingVersion: listing.version,
        idempotencyKey: `${key}-run`,
      });
      if (!run.passed) throw new Error("This service did not pass the category test. Review the result before trying again.");
      const next = await prepareAgonArenaEvaluation({
        listingReference: listing.id,
        idempotencyKey: key,
        playgroundRunId: run.runId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      setEvaluation(next);
      setRequestTransaction(await getAgonArenaRequestTransaction(next.intentId));
      if (storageKey) window.localStorage.setItem(storageKey, next.intentId);
      setMessage("Test passed. Confirm the Arena request in the provider wallet.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not prepare Arena verification."); }
    finally { setBusy(false); }
  }

  async function submitRequest() {
    if (!evaluation || !requestTransaction) return;
    setBusy(true); setMessage(null);
    try {
      const hash = await writeContractAsync({
        address: requestTransaction.to,
        abi: agonArenaAbi,
        functionName: "requestEvaluation",
          args: [
            evaluation.validationRequestHash,
            BigInt(evaluation.listing.listingId),
            evaluation.capabilityHash,
            evaluation.evaluatorVersionHash,
            evaluation.taskCommitment,
            BigInt(Math.floor(new Date(evaluation.expiresAt).getTime() / 1000)),
          ],
        refId: evaluation.intentId,
      });
      const receipt = await confirmTx(hash);
      const onchainId = arenaEvaluationIdFromReceipt(receipt, evaluation.arenaContract, evaluation.validationRequestHash);
      const next = await markAgonArenaEvaluationSubmitted(evaluation.intentId, onchainId, hash);
      setEvaluation(next);
      setRequestTransaction(null);
      setMessage("Request confirmed. AGON's evaluator will start the independent review automatically.");
      await refresh(next, true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not submit the Arena request."); }
    finally { setBusy(false); }
  }

  async function submitEvidence() {
    if (!evaluation?.evaluationId) return;
    setBusy(true); setMessage(null);
    try {
      const plan = evidenceTransaction ?? await getAgonArenaEvidenceTransaction(evaluation.intentId);
      const hash = await writeContractAsync({
        address: plan.to,
        abi: agonArenaAbi,
        functionName: "submitEvidence",
        args: [BigInt(evaluation.evaluationId), evaluation.evidenceRoot],
        refId: evaluation.intentId,
      });
      await confirmTx(hash);
      const next = await markAgonArenaEvidenceSubmitted(evaluation.intentId, hash);
      setEvaluation(next);
      setEvidenceTransaction(null);
      setMessage("Evidence confirmed. AGON is finalizing the score and public verification record.");
      await refresh(next, true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not submit Arena evidence."); }
    finally { setBusy(false); }
  }

  const action = evaluation ? arenaPrimaryAction(evaluation) : null;
  const progress = arenaProgressPercent(evaluation);
  const actionLabel = !me
    ? "SIGN IN TO VERIFY"
    : !evaluation
      ? "RUN SERVICE TEST"
      : action === "submit_request"
        ? "CONFIRM VERIFICATION REQUEST"
        : action === "submit_evidence"
          ? "SUBMIT TEST EVIDENCE"
          : action === "retry_reconciliation"
            ? "CHECK VERIFICATION"
            : null;
  const actionHandler = !evaluation
    ? prepare
    : action === "submit_request"
      ? submitRequest
      : action === "submit_evidence"
        ? submitEvidence
        : action === "retry_reconciliation"
          ? () => refresh()
          : null;
  const statusText = !evaluation
    ? "Ready to test"
    : evaluation.state === "request_submitted"
      ? "Evaluator is reviewing the request"
      : evaluation.state === "evidence_ready"
        ? "Evidence is ready for provider confirmation"
        : evaluation.state === "evidence_submitted"
          ? "Final score is being confirmed"
          : evaluation.state === "verified"
            ? "Verified by AGON Arena"
            : evaluation.state === "rejected"
              ? "Review did not pass"
              : evaluation.state.replace(/_/g, " ");

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">AGON ARENA VERIFICATION</div><h4 className="mt-2 font-stencil text-2xl uppercase leading-none">{statusText}</h4></div>{evaluation ? <span className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">{progress}%</span> : null}</div>
    <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-2">AGON runs the correct challenge for this service, records the provider's evidence, and independently checks the final chain result. Wallet confirmations appear only for the provider's two Arena actions.</p>
    {evaluation ? <div className="mt-5 h-1 bg-canvas-2"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div> : null}
    {actionLabel && actionHandler ? <button disabled={working || !listing} onClick={() => !me ? setLoginOpen(true) : void actionHandler()} className="mt-5 bg-accent px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">{working ? "WORKING" : actionLabel}</button> : null}
    {action === "wait_for_evaluator" || action === "finalizing" ? <div className="mt-5 flex flex-wrap items-center gap-3"><span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--warn)]" /><span className="text-sm text-ink-2">This page refreshes the Arena status automatically.</span><button disabled={working} onClick={() => void refresh()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em]">CHECK NOW</button></div> : null}
    {message ? <p role={evaluation?.state === "rejected" ? "alert" : "status"} className="mt-4 border-l-2 border-[color:var(--hairline-strong)] px-4 py-2 text-sm leading-6 text-ink-2">{message}</p> : null}
    {evaluation ? <details className="mt-5 border-t border-[color:var(--hairline)] pt-4"><summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Technical record</summary><div className="mt-3 grid gap-2 break-all font-mono text-[10px] leading-5 text-ink-3"><span>INTENT {evaluation.intentId}</span><span>ARENA TEST {evaluation.evaluationId ?? "NOT SUBMITTED"}</span><span>PLAYGROUND RUN {evaluation.playgroundRunId}</span><span>EVIDENCE {evaluation.evidenceRoot}</span><span>REQUEST TX {evaluation.requestTransactionHash ?? "PENDING"}</span><span>EVALUATOR TX {evaluation.startTransactionHash ?? "PENDING"}</span><span>EVIDENCE TX {evaluation.evidenceTransactionHash ?? "PENDING"}</span></div></details> : null}
    <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
  </section>;
}

const JOB_STATUS = ["Created", "Accepted", "Submitted", "Complete", "Rejected", "Disputed", "Failed"];
const JOB_SETTLEMENT = ["None", "Provider paid", "Buyer refunded"];

function AgonJobInspector() {
  const { me } = useAuth();
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState<AgonJobEscrowJobView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function inspect() {
    if (!me) { setMessage("Sign in before inspecting a deployed job."); return; }
    if (!/^[1-9]\d*$/.test(jobId)) { setMessage("Enter a positive onchain job id."); return; }
    setBusy(true); setMessage(null); setJob(null);
    try { setJob(await getAgonJobEscrowJob(jobId)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not inspect the deployed job."); }
    finally { setBusy(false); }
  }

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DEPLOYED AGON JOB INSPECTOR</div><p className="mt-2 max-w-2xl font-mono text-[10px] leading-5 text-ink-3">Read-only inspection of the canonical AgonJobEscrow contract. This panel never signs, funds, settles, or retries a transaction.</p><div className="mt-4 flex flex-wrap gap-2"><input value={jobId} onChange={(event) => setJobId(event.target.value)} inputMode="numeric" placeholder="onchain job id" className={`${inputClass} max-w-xs`} /><button disabled={busy || !/^[1-9]\d*$/.test(jobId)} onClick={() => void inspect()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink disabled:opacity-50">{busy ? "READING" : "INSPECT JOB"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{job ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2 sm:grid-cols-2"><span>JOB {job.jobId} / LISTING {job.listingId} / AGENT {job.agentId}</span><span>STATE {JOB_STATUS[job.status] ?? `UNKNOWN(${job.status})`}</span><span>SETTLEMENT {JOB_SETTLEMENT[job.settlement] ?? `UNKNOWN(${job.settlement})`}</span><span>AMOUNT {job.amount} / FEE {job.fee} BASE UNITS</span><span className="break-all">BUYER {job.buyer}</span><span className="break-all">PROVIDER {job.provider}</span><span className="break-all">TERMS {job.termsHash}</span><span className="break-all">DELIVERABLE {job.deliverableHash}</span><span>ACCEPT BY {job.acceptanceDeadline}</span><span>REVIEW BY {job.reviewDeadline ?? "NOT SUBMITTED"}</span></div> : null}</section>;
}

function AgonJobEscrowIntentPanel({ listing, capabilities }: { listing: AgonListing | null; capabilities: AgonHealth["capabilities"] | null }) {
  const { me } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reviewHours, setReviewHours] = useState("24");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [jobId, setJobId] = useState("");
  const [intent, setIntent] = useState<AgonJobEscrowIntentView | null>(null);
  const [transaction, setTransaction] = useState<AgonJobEscrowTransactionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (!listing) return;
    if (!me) { setLoginOpen(true); return; }
    setBusy(true); setMessage(null); setIntent(null); setTransaction(null);
    try {
      const value = await prepareAgonJobEscrowIntent({
        listingReference: listing.id,
        idempotencyKey: idempotencyKey || `admin-job-escrow-${listing.listingId}-${Date.now()}`,
        amountBaseUnits: amount,
        reviewHours: Number(reviewHours),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      setIntent(value);
      setTransaction(await getAgonJobEscrowTransaction(value.intentId));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not prepare the deployed job escrow intent."); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!intent || !/^[1-9]\d*$/.test(jobId)) return;
    setBusy(true); setMessage(null);
    try { setIntent(await reconcileAgonJobEscrowIntent(intent.intentId, jobId)); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not reconcile the onchain job."); }
    finally { setBusy(false); }
  }

  const calldataSupported = capabilities?.jobEscrowCalldataSupported === true;
  const valid = calldataSupported && listing && /^\d+$/.test(amount) && amount !== "0" && /^[1-9]\d*$/.test(reviewHours) && Number(reviewHours) <= 720;
  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">DEPLOYED JOB ESCROW INTENT</div><p className="mt-2 max-w-3xl font-mono text-[10px] leading-5 text-ink-3">Pins exact createJob terms only when the configured deployment interface matches the generated calldata. Existing jobs remain available through read-only reconciliation.</p>{!calldataSupported ? <p className="mt-3 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">NEW JOBS GATED: {capabilities?.jobEscrowExecutionReason ?? "contract interface has not been verified"}</p> : null}<div className="mt-4 grid gap-2 sm:grid-cols-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="amount in USDC base units" className={inputClass} /><input value={reviewHours} onChange={(event) => setReviewHours(event.target.value)} placeholder="review hours (1-720)" className={inputClass} /><div className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] text-ink-2">FEE TERMS COME FROM THE VERIFIED CONTRACT INTERFACE</div><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" className={inputClass} /><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="idempotency key, optional" className={`${inputClass} sm:col-span-2`} /><button disabled={busy || !valid} onClick={() => void prepare()} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50 sm:col-span-2">{busy ? "WORKING" : "PREPARE JOB INTENT"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{intent ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2"><span>INTENT {intent.intentId}</span><span>STATE {intent.state} / {intent.nextAction}</span><span>CLIENT REF {intent.clientReference}</span><span>TERMS {intent.termsHash}</span>{transaction ? <span className="break-all">UNSIGNED CALL {transaction.functionName} TO {transaction.to} / {transaction.data}</span> : null}<div className="mt-2 flex flex-wrap gap-2"><input value={jobId} onChange={(event) => setJobId(event.target.value)} placeholder="onchain job id" inputMode="numeric" className={`${inputClass} max-w-xs`} /><button disabled={busy || !/^[1-9]\d*$/.test(jobId)} onClick={() => void reconcile()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] hover:text-ink disabled:opacity-50">RECONCILE READ-ONLY</button></div></div> : null}<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} /></section>;
}

function AgonReadiness({ health }: { health: AgonHealth | null }) {
  if (!health) return <EmptyState message="Agon health has not been loaded yet." />;
  const capabilities = health.capabilities;
  const rows = [
    ["profile writes", capabilities.profileWrites],
    ["listing writes", capabilities.listingWrites],
    ["direct x402", capabilities.directX402],
    ["escrow contract", capabilities.escrow],
    ["arena contract", capabilities.arenaVerification],
    ["syndicate registry", capabilities.syndicateRegistry],
    ["prize vault", capabilities.prizeVault],
  ] as const;
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">LIVE BACKEND CAPABILITIES</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">AGON / NETWORK {capabilities.protocolReadiness.chainId ?? "UNKNOWN"}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, enabled]) => <div key={label} className="flex items-center justify-between border-t border-[color:var(--hairline)] py-2 font-mono text-[11px]"><span className="text-ink-2">{label}</span><span className={enabled ? "text-[color:var(--ok)]" : "text-ink-3"}>{enabled ? "READY" : "GATED"}</span></div>)}
      </div>
      <div className="mt-5 border-t border-[color:var(--hairline)] pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
          <span className="text-ink-2">protocol release gate</span>
          <span className={capabilities.protocolReadiness.ready ? "text-[color:var(--ok)]" : "text-[color:var(--warn)]"}>
            {capabilities.protocolReadiness.ready ? "READY" : "BLOCKED"}
          </span>
        </div>
        <div className="mt-2 grid gap-1 font-mono text-[10px] leading-5 text-ink-3">
          <span>CHAIN {capabilities.protocolReadiness.chainId ?? "UNKNOWN"}</span>
          {capabilities.protocolReadiness.missingContracts.length ? <span>MISSING {capabilities.protocolReadiness.missingContracts.join(", ")}</span> : null}
          {capabilities.protocolReadiness.unverifiedContracts.length ? <span>UNVERIFIED {capabilities.protocolReadiness.unverifiedContracts.join(", ")}</span> : null}
          {capabilities.protocolReadiness.externalRegistry.validation ? <span>VALIDATION REGISTRY {capabilities.protocolReadiness.externalRegistry.validation}</span> : null}
        </div>
        {capabilities.protocolReadiness.reasons.length ? <div className="mt-3 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">RELEASE GATE: {capabilities.protocolReadiness.reasons.join(", ")}</div> : null}
      </div>
      {capabilities.escrowReadiness.reasons.length ? <div className="mt-4 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">ESCROW READINESS: {capabilities.escrowReadiness.reasons.join(", ")}</div> : null}
      {capabilities.jobEscrowExecutionReason ? <div className="mt-4 border-l-2 border-[color:var(--warn)] p-3 font-mono text-[10px] leading-5 text-ink-2">JOB ESCROW EXECUTION: {capabilities.jobEscrowExecutionReason}</div> : null}
    </section>
  );
}

function AgonListingPicker({ listings, selectedId, onChange }: { listings: AgonListing[]; selectedId: string; onChange: (value: string) => void }) {
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">INDEXED SERVICES</div>
      <p className="mt-2 text-sm leading-5 text-ink-2">Pick one service. The verification, hire, and payment tools will follow this selection.</p>
      <div className="mt-5 grid gap-3">
        {listings.length ? listings.map((listing) => {
          const category = categoryById(listing.category);
          const selected = selectedId === listing.id;
          return <button key={listing.id} onClick={() => onChange(listing.id)} className={`grid gap-3 border p-4 text-left transition-colors ${selected ? "border-accent bg-canvas-2" : "border-[color:var(--hairline)] hover:border-[color:var(--hairline-strong)]"}`}>
            <div className="flex items-start justify-between gap-3"><span className="font-mono text-sm text-ink">Agent {listing.agentId}</span><span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: listing.verification.status === "Verified" ? "var(--ok)" : "var(--warn)" }}>{listing.verification.status}</span></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3"><span>{category.label}</span><span>v{listing.version}</span><span>{listing.payment.rail}</span><span>QA {listing.endpointQa.status.replace(/_/g, " ")}</span></div>
            {selected ? <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">SELECTED</span> : null}
          </button>;
        }) : <EmptyState message="No listings returned." />}
      </div>
    </section>
  );
}

function AgonEscrowPreparation({ listing }: { listing: AgonListing | null }) {
  const { me } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [intent, setIntent] = useState<AgonEscrowIntentView | null>(null);
  const [readiness, setReadiness] = useState<AgonEscrowReadinessView | null>(null);
  const [transaction, setTransaction] = useState<AgonEscrowTransactionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    if (!listing) return;
    if (!me) { setLoginOpen(true); return; }
    setBusy(true); setMessage(null); setIntent(null); setReadiness(null); setTransaction(null);
    try {
      const value = await prepareAgonEscrowIntent({
        listingReference: listing.id,
        idempotencyKey: idempotencyKey || `admin-escrow-${listing.listingId}-${Date.now()}`,
        amountBaseUnits: amount,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      setIntent(value);
      const [nextReadiness, nextTransaction] = await Promise.all([
        getAgonEscrowReadiness(value.intentId),
        getAgonEscrowTransaction(value.intentId),
      ]);
      setReadiness(nextReadiness);
      setTransaction(nextTransaction);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not prepare the escrow intent.");
    } finally { setBusy(false); }
  }

  return <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">ESCROW BACKEND FLOW</div><p className="mt-2 font-mono text-[10px] leading-5 text-ink-3">Prepare exact terms, inspect readiness, and review the unsigned createJob transaction. The protocol fee is fixed at 5%; funding still requires the buyer wallet.</p><div className="mt-4 grid gap-2"><input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="amount in USDC base units" className={inputClass} /><div className="grid gap-2 sm:grid-cols-2"><div className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] text-ink-2">PROTOCOL FEE: 5% FIXED</div><input value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" className={inputClass} /></div><input value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} placeholder="idempotency key, optional" className={inputClass} /><button disabled={busy || !listing || !/^\d+$/.test(amount) || amount === "0"} onClick={() => void prepare()} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">{busy ? "PREPARING" : "PREPARE ESCROW"}</button></div>{message ? <p className="mt-3 font-mono text-[10px] text-[color:var(--err)]">{message}</p> : null}{intent ? <div className="mt-4 grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] text-ink-2"><span>INTENT {intent.intentId}</span><span>STATE {intent.state} / {intent.nextAction}</span><span>TERMS {intent.termsHash}</span>{readiness ? <span>READINESS {readiness.status} / {readiness.reason}</span> : null}{transaction ? <span className="break-all">CALL {transaction.functionName} TO {transaction.to} / {transaction.data}</span> : null}</div> : null}<LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} /></section>;
}

function EmptyState({ message }: { message: string }) {
  return <div className="border border-dashed border-[color:var(--hairline-strong)] p-4 font-mono text-[11px] leading-5 text-ink-3">{message}</div>;
}
