"use client";

import { useMemo, useState } from "react";

import { useArcWrite } from "@/hooks/useArcWrite";
import { useAuth } from "@/hooks/useAuth";
import {
  getAgonPrizeClaimTransaction,
  getAgonSyndicateContributionTransaction,
  markAgonPrizeClaimSubmitted,
  markAgonSyndicateContributionSubmitted,
  prepareAgonPrizeClaim,
  prepareAgonSyndicateContribution,
  reconcileAgonPrizeClaim,
  reconcileAgonSyndicateContribution,
} from "@/lib/agon/client";
import { agonPrizeVaultAbi, agonSyndicateRegistryAbi } from "@/lib/agon/abi";
import type {
  AgonPrizeClaimView,
  AgonSyndicateContributionView,
  AgonSyndicatePrizeTransactionView,
} from "@/lib/agon/types";
import { confirmTx } from "@/lib/arc";

const inputClass = "w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink";
const hashPattern = /^0x[0-9a-fA-F]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const positiveInteger = /^[1-9]\d*$/;
const nonNegativeInteger = /^\d+$/;

export function AgonSyndicatePrizeIntentPanel() {
  const { me } = useAuth();
  const { writeContractAsync, isPending } = useArcWrite();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [syndicateId, setSyndicateId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [contributionKey, setContributionKey] = useState("");
  const [score, setScore] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [contribution, setContribution] = useState<AgonSyndicateContributionView | null>(null);
  const [contributionTx, setContributionTx] = useState<AgonSyndicatePrizeTransactionView | null>(null);

  const [poolKey, setPoolKey] = useState("");
  const [claimIndex, setClaimIndex] = useState("0");
  const [beneficiary, setBeneficiary] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimProof, setClaimProof] = useState("");
  const [claim, setClaim] = useState<AgonPrizeClaimView | null>(null);
  const [claimTx, setClaimTx] = useState<AgonSyndicatePrizeTransactionView | null>(null);

  const resolvedBeneficiary = beneficiary || me?.address || "";
  const contributionValid = positiveInteger.test(syndicateId)
    && positiveInteger.test(agentId)
    && hashPattern.test(contributionKey)
    && positiveInteger.test(score)
    && hashPattern.test(evidenceHash);
  const claimProofValues = useMemo(
    () => claimProof.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
    [claimProof],
  );
  const claimValid = hashPattern.test(poolKey)
    && nonNegativeInteger.test(claimIndex)
    && addressPattern.test(resolvedBeneficiary)
    && positiveInteger.test(claimAmount)
    && claimProofValues.every((value) => hashPattern.test(value));

  function resetStatus() {
    setMessage(null);
    setError(null);
  }

  async function prepareContribution() {
    if (!me) { setError("Sign in before preparing a syndicate contribution."); return; }
    if (!contributionValid) return;
    setBusy(true); resetStatus(); setContribution(null); setContributionTx(null);
    try {
      const next = await prepareAgonSyndicateContribution({
        idempotencyKey: `admin-syndicate-contribution-${syndicateId}-${contributionKey}`,
        syndicateId,
        agentId,
        contributionKey: contributionKey as `0x${string}`,
        score,
        evidenceHash: evidenceHash as `0x${string}`,
      });
      setContribution(next);
      setContributionTx(await getAgonSyndicateContributionTransaction(next.intentId));
      setMessage("Contribution intent prepared. Review the exact calldata before signing.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare the contribution."); }
    finally { setBusy(false); }
  }

  async function prepareClaim() {
    if (!me) { setError("Sign in before preparing a prize claim."); return; }
    if (!claimValid) return;
    setBusy(true); resetStatus(); setClaim(null); setClaimTx(null);
    try {
      const next = await prepareAgonPrizeClaim({
        idempotencyKey: `admin-prize-claim-${poolKey}-${claimIndex}-${resolvedBeneficiary}`,
        poolKey: poolKey as `0x${string}`,
        index: claimIndex,
        beneficiary: resolvedBeneficiary as `0x${string}`,
        amount: claimAmount,
        proof: claimProofValues as `0x${string}`[],
      });
      setClaim(next);
      setClaimTx(await getAgonPrizeClaimTransaction(next.intentId));
      setMessage("Prize claim intent prepared. Review the exact calldata before signing.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare the prize claim."); }
    finally { setBusy(false); }
  }

  async function submitContribution() {
    if (!contribution || !contributionTx) return;
    setBusy(true); resetStatus();
    try {
      const hash = await writeContractAsync({
        address: contributionTx.to,
        abi: agonSyndicateRegistryAbi,
        functionName: contributionTx.functionName,
        args: contributionTx.args,
      });
      await confirmTx(hash);
      const submitted = await markAgonSyndicateContributionSubmitted(contribution.intentId, hash);
      setContribution(submitted);
      setContribution(await reconcileAgonSyndicateContribution(contribution.intentId));
      setMessage(`Contribution independently confirmed on Arc: ${hash}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Contribution signing or confirmation failed. No submission marker was recorded."); }
    finally { setBusy(false); }
  }

  async function submitClaim() {
    if (!claim || !claimTx) return;
    setBusy(true); resetStatus();
    try {
      const hash = await writeContractAsync({
        address: claimTx.to,
        abi: agonPrizeVaultAbi,
        functionName: claimTx.functionName,
        args: claimTx.args,
      });
      await confirmTx(hash);
      const submitted = await markAgonPrizeClaimSubmitted(claim.intentId, hash);
      setClaim(submitted);
      setClaim(await reconcileAgonPrizeClaim(claim.intentId));
      setMessage(`Prize claim independently confirmed on Arc: ${hash}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Claim signing or confirmation failed. No submission marker was recorded."); }
    finally { setBusy(false); }
  }

  async function reconcileContribution() {
    if (!contribution) return;
    setBusy(true); resetStatus();
    try { setContribution(await reconcileAgonSyndicateContribution(contribution.intentId)); setMessage("Contribution finality confirmed from contract state and receipt evidence."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Contribution reconciliation failed."); }
    finally { setBusy(false); }
  }

  async function reconcileClaim() {
    if (!claim) return;
    setBusy(true); resetStatus();
    try { setClaim(await reconcileAgonPrizeClaim(claim.intentId)); setMessage("Prize claim finality confirmed from the claimed bitmap and receipt evidence."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Prize claim reconciliation failed."); }
    finally { setBusy(false); }
  }

  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">SYNDICATE AND PRIZE INTENTS</div>
      <p className="mt-2 max-w-3xl font-mono text-[10px] leading-5 text-ink-3">Prepare an authenticated, idempotent intent; inspect the exact unsigned calldata; then explicitly sign from the connected wallet. A confirmed hash is recorded as a submission marker, not treated as final reconciliation.</p>
      {message ? <p role="status" className="mt-3 border-l-2 border-accent p-3 font-mono text-[10px] leading-5">{message}</p> : null}
      {error ? <p role="alert" className="mt-3 border-l-2 border-[color:var(--err)] p-3 font-mono text-[10px] leading-5 text-[color:var(--err)]">{error}</p> : null}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <IntentCard title="Record syndicate contribution">
          <Field label="SYNDICATE ID" value={syndicateId} onChange={setSyndicateId} />
          <Field label="AGENT ID" value={agentId} onChange={setAgentId} />
          <Field label="CONTRIBUTION KEY" value={contributionKey} onChange={setContributionKey} placeholder="bytes32 evidence identity" />
          <Field label="SCORE" value={score} onChange={setScore} />
          <Field label="EVIDENCE HASH" value={evidenceHash} onChange={setEvidenceHash} placeholder="bytes32" />
          <button type="button" disabled={busy || isPending || !contributionValid} onClick={() => void prepareContribution()} className="action">{busy ? "WORKING" : "PREPARE CONTRIBUTION"}</button>
          {contribution ? <IntentDetails intentId={contribution.intentId} state={contribution.state} nextAction={contribution.nextAction} transaction={contributionTx} /> : null}
          {contribution && contributionTx ? <button type="button" disabled={busy || isPending || contribution.state !== "prepared"} onClick={() => void submitContribution()} className="action bg-accent text-accent-ink">SIGN AND RECORD SUBMISSION</button> : null}
          {contribution?.state === "submitted" ? <button type="button" disabled={busy} onClick={() => void reconcileContribution()} className="action">RECONCILE FINALITY</button> : null}
        </IntentCard>

        <IntentCard title="Claim prize allocation">
          <Field label="POOL KEY" value={poolKey} onChange={setPoolKey} placeholder="bytes32 pool key" />
          <div className="grid gap-3 sm:grid-cols-2"><Field label="CLAIM INDEX" value={claimIndex} onChange={setClaimIndex} /><Field label="AMOUNT / BASE UNITS" value={claimAmount} onChange={setClaimAmount} /></div>
          <Field label="BENEFICIARY" value={resolvedBeneficiary} onChange={setBeneficiary} placeholder={me?.address ?? "0x... authenticated actor"} />
          <Field label="MERKLE PROOF" value={claimProof} onChange={setClaimProof} placeholder="bytes32 hashes separated by spaces" />
          <button type="button" disabled={busy || isPending || !claimValid} onClick={() => void prepareClaim()} className="action">{busy ? "WORKING" : "PREPARE PRIZE CLAIM"}</button>
          {claim ? <IntentDetails intentId={claim.intentId} state={claim.state} nextAction={claim.nextAction} transaction={claimTx} /> : null}
          {claim && claimTx ? <button type="button" disabled={busy || isPending || claim.state !== "prepared"} onClick={() => void submitClaim()} className="action bg-accent text-accent-ink">SIGN AND RECORD SUBMISSION</button> : null}
          {claim?.state === "submitted" ? <button type="button" disabled={busy} onClick={() => void reconcileClaim()} className="action">RECONCILE FINALITY</button> : null}
        </IntentCard>
      </div>
      <style jsx>{`.action { min-height: 44px; border: 1px solid var(--hairline-strong); padding: 0 14px; font: 10px/1 monospace; letter-spacing: .12em; text-transform: uppercase; } .action:hover:not(:disabled) { border-color: var(--ink); background: var(--ink); color: var(--canvas); } .action:disabled { cursor: not-allowed; opacity: .4; }`}</style>
    </section>
  );
}

function IntentCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="border-t border-[color:var(--hairline-strong)] pt-4"><h3 className="font-mono text-[11px] uppercase tracking-[.14em]">{title}</h3><div className="mt-4 grid gap-3">{children}</div></div>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[.12em] text-ink-3">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} /></label>;
}

function IntentDetails({ intentId, state, nextAction, transaction }: { intentId: string; state: string; nextAction: string; transaction: AgonSyndicatePrizeTransactionView | null }) {
  return <div className="grid gap-2 border-t border-[color:var(--hairline)] pt-3 font-mono text-[10px] leading-5 text-ink-2"><span className="break-all">INTENT {intentId}</span><span>STATE {state} / NEXT {nextAction}</span>{transaction ? <><span className="break-all">CALL {transaction.functionName} → {transaction.to}</span><span className="break-all">DATA {transaction.data}</span></> : null}</div>;
}
