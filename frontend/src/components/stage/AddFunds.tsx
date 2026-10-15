"use client";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";

import { TagButton } from "@/components/redesign/TagButton";
import { useAuth } from "@/hooks/useAuth";
import { fundingPath, parseAmount } from "@/lib/agon/add-funds";
import type { StageWallet } from "@/lib/agon/stage-types";

const USDC_ON_ARC = "0x3600000000000000000000000000000000000000" as const;
const ARC_TESTNET_ID = 5_042_002;
const AUTH_URL = (process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082").replace(/\/+$/, "");

/// Moves USDC from the signed-in account's own wallet into its Agon wallet:
/// a browser wallet signs the transfer, a Circle wallet confirms it here.
export function AddFunds({ wallet, onDone }: { wallet: StageWallet; onDone: () => void }) {
  const { me } = useAuth();
  const path = fundingPath(me?.walletKind, wallet.testnet);
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("1.00");
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
      if (path === "wallet") {
        if (!isConnected) throw new Error("connect");
        if (chainId !== ARC_TESTNET_ID) await switchChainAsync({ chainId: ARC_TESTNET_ID as never });
        const tx = await writeContractAsync({ address: USDC_ON_ARC, abi: erc20Abi, functionName: "transfer", args: [wallet.address as `0x${string}`, atomic], chainId: ARC_TESTNET_ID as never });
        setSent({ tx, note: `Sent ${amount.trim()} USDC.` });
      } else {
        const res = await fetch(`${AUTH_URL}/wallet/execute`, {
          method: "POST", credentials: "include", headers: { "content-type": "application/json" },
          body: JSON.stringify({ contractAddress: USDC_ON_ARC, abiFunctionSignature: "transfer(address,uint256)", abiParameters: [wallet.address, atomic.toString()] }),
        });
        if (!res.ok) throw new Error("circle");
        setSent({ tx: null, note: `Transfer of ${amount.trim()} USDC submitted. It lands in a few seconds.` });
      }
      refreshSoon();
    } catch (e) {
      const text = e instanceof Error ? e.message : "";
      setError(text === "connect" ? "Connect your wallet first, then try again." : /reject|denied/i.test(text) ? "You declined the transfer. Nothing was sent." : "Transfer failed. Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {path !== "address-only" ? (
        <form className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label className="grid gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Amount (USDC)</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-invalid={!atomic} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" />
          </label>
          <TagButton type="submit" disabled={busy || !atomic}>{busy ? "Waiting for approval" : `Add ${atomic ? amount.trim() : ""} USDC`}</TagButton>
          <p className="text-sm text-ink-2 sm:col-span-2">
            {path === "wallet" ? "From your connected wallet" : "From your Agon sign-in wallet"} to your Agon wallet on {wallet.network}.
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
        <p className="text-sm leading-6 text-ink-2">{path !== "address-only" ? "Or send" : "Send"} USDC on {wallet.network} to this address. The balance is yours and you can withdraw it any time.</p>
        <p className="mt-2 break-all font-mono text-sm text-ink">{wallet.address}</p>
        {wallet.testnet ? <p className="mt-2 text-xs text-ink-3">Get test USDC from <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">Circle's faucet</a>. Choose Arc Testnet and paste this address.</p> : null}
      </div>
    </div>
  );
}
