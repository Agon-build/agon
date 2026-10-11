"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { TagButton } from "@/components/redesign/TagButton";
import { freezeWallet, requestUnfreeze, requestWithdraw, StageApiError } from "@/lib/agon/stage";
import type { StageWallet } from "@/lib/agon/stage-types";
import { shortHash } from "@/lib/agon/stage-view";

const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <div className="mt-1 font-mono text-sm tabular-nums text-ink">{children}</div>
    </div>
  );
}

export function WalletStrip({ wallet, onChanged }: { wallet: StageWallet; onChanged: () => void }) {
  const router = useRouter();
  const [panel, setPanel] = useState<"none" | "deposit" | "withdraw">("none");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await action(); } catch (e) { setMessage(e instanceof StageApiError ? e.code.replaceAll("_", " ") : "Something went wrong."); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Your Agon wallet" className="border-y border-[color:var(--hairline-strong)]">
      <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-[auto_auto_auto_1fr] sm:items-center sm:gap-8">
        <Fact label="Your wallet">
          <button type="button" className="min-h-11 underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent" onClick={() => { void navigator.clipboard?.writeText(wallet.address); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>
            {shortHash(wallet.address)}<span className="sr-only">, copy the full address</span>
          </button>
          <span aria-live="polite" className="ml-2 text-[10px] uppercase text-ink-3">{copied ? "Copied" : ""}</span>
        </Fact>
        <Fact label="Balance">{wallet.balance ?? "n/a"} <span className="text-ink-3">USDC</span></Fact>
        <Fact label="Left today">{wallet.leftToday} <span className="text-ink-3">of {wallet.daily}</span></Fact>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:justify-end">
          <TagButton size="sm" variant="ghost" arrow={false} onClick={() => setPanel(panel === "deposit" ? "none" : "deposit")}>Add funds</TagButton>
          <TagButton size="sm" variant="ghost" arrow={false} onClick={() => setPanel(panel === "withdraw" ? "none" : "withdraw")}>Withdraw</TagButton>
          {wallet.frozen
            ? <TagButton size="sm" disabled={busy} onClick={() => void run(async () => router.push(path((await requestUnfreeze()).approvalUrl)))}>Unfreeze</TagButton>
            : <TagButton size="sm" variant="ghost" arrow={false} disabled={busy} onClick={() => void run(async () => { await freezeWallet(); onChanged(); })}>Freeze</TagButton>}
        </div>
      </div>
      {wallet.frozen ? <p className="border-t border-[color:var(--hairline)] py-3 text-sm text-ink">Spending is frozen. Nothing can be paid from this wallet until you unfreeze it in your browser.</p> : null}
      {panel === "deposit" ? (
        <div className="stage-print border-t border-[color:var(--hairline)] py-4">
          <p className="text-sm leading-6 text-ink-2">Send USDC on {wallet.network} to this address. The balance is yours and you can withdraw it any time.</p>
          <p className="mt-2 break-all font-mono text-sm text-ink">{wallet.address}</p>
          {wallet.testnet ? <p className="mt-2 text-xs text-ink-3">Test USDC from Circle's faucet was added when this wallet was created.</p> : null}
        </div>
      ) : null}
      {panel === "withdraw" ? (
        <form
          className="stage-print grid gap-3 border-t border-[color:var(--hairline)] py-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end"
          onSubmit={(e) => { e.preventDefault(); void run(async () => { const out = await requestWithdraw(to.trim(), amount.trim()); if (out.ok && out.approvalUrl) router.push(path(out.approvalUrl)); else setMessage(out.code?.replaceAll("_", " ") ?? "Withdraw refused."); }); }}
        >
          <label className="grid gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">To address</span><input value={to} onChange={(e) => setTo(e.target.value)} required pattern="^0x[0-9a-fA-F]{40}$" className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" /></label>
          <label className="grid gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Amount (USDC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" /></label>
          <TagButton type="submit" disabled={busy}>Continue</TagButton>
          <p className="text-xs text-ink-3 sm:col-span-3">You approve every withdrawal on the next page.</p>
        </form>
      ) : null}
      {message ? <p role="alert" className="border-t border-[color:var(--hairline)] py-3 text-sm text-[color:var(--err)]">{message}</p> : null}
    </section>
  );
}
