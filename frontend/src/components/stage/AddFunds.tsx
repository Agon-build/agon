"use client";
import { useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { sendErrorText, useUsdcSend } from "@/components/stage/useUsdcSend";
import { parseAmount } from "@/lib/agon/add-funds";
import type { StageWallet } from "@/lib/agon/stage-types";

/// Moves USDC from the signed-in account's own wallet into its agent wallet:
/// a browser wallet signs the transfer, a Circle wallet confirms it here.
export function AddFunds({ wallet, onDone, suggested, compact = false }: { wallet: StageWallet; onDone: () => void; suggested?: string; compact?: boolean }) {
  const { path, send: sendUsdc } = useUsdcSend(wallet.testnet);
  const [amount, setAmount] = useState(suggested ?? "1.00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ tx: string | null; note: string } | null>(null);
  const atomic = parseAmount(amount);

  function refreshSoon() {
    onDone();
    window.setTimeout(onDone, 5_000);
  }

  async function send() {
    if (!atomic) return;
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const { tx } = await sendUsdc(wallet.address, atomic);
      setSent({ tx, note: tx ? `Sent ${amount.trim()} USDC.` : `Transfer of ${amount.trim()} USDC submitted. It lands in a few seconds.` });
      refreshSoon();
    } catch (e) {
      setError(sendErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {path !== "address-only" ? (
        <form className={compact ? "grid gap-3" : "grid gap-3 sm:grid-cols-[minmax(0,12rem)_auto] sm:items-end"} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label className="grid gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Amount (USDC)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-invalid={!atomic} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" />
          </label>
          <TagButton type="submit" disabled={busy || !atomic}>{busy ? "Waiting for approval" : `Add ${atomic ? amount.trim() : ""} USDC`}</TagButton>
          <p className={compact ? "text-xs text-ink-3" : "text-sm text-ink-2 sm:col-span-2"}>
            {path === "wallet" ? "From your connected wallet" : "From your Agon sign-in wallet"} to your agent wallet on {wallet.network}.
          </p>
        </form>
      ) : null}
      {sent ? (
        <p role="status" className="text-sm text-ink">
          {sent.note}{" "}
          {sent.tx ? <a href={`${wallet.explorer}/tx/${sent.tx}`} target="_blank" rel="noopener noreferrer" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">View on the explorer</a> : null}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-[color:var(--err)]">{error}</p> : null}
      <div className={path !== "address-only" ? "border-t border-[color:var(--hairline)] pt-4" : ""}>
        <p className="text-sm leading-6 text-ink-2">{path !== "address-only" ? "Or send" : "Send"} USDC on {wallet.network} to this address.{compact ? "" : " The balance is yours and you can withdraw it any time."}</p>
        <p className="mt-2 break-all font-mono text-sm text-ink">{wallet.address}</p>
        {wallet.testnet ? <p className="mt-2 text-xs text-ink-3">Get test USDC from <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">Circle's faucet</a>. Choose Arc Testnet and paste this address.</p> : null}
      </div>
    </div>
  );
}
