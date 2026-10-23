"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { TagButton } from "@/components/redesign/TagButton";
import { AddFunds } from "@/components/stage/AddFunds";
import { freezeWallet, requestUnfreeze, requestWithdraw, StageApiError } from "@/lib/agon/stage";
import type { StageWallet } from "@/lib/agon/stage-types";
import { cents, shortHash } from "@/lib/agon/stage-view";

const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };
type Tab = "add" | "withdraw" | "freeze";
const TABS: [Tab, string][] = [["add", "Add funds"], ["withdraw", "Withdraw"], ["freeze", "Freeze"]];

/// One line of wallet facts; everything that changes the wallet lives in the Manage sheet.
export function WalletStrip({ wallet, onChanged }: { wallet: StageWallet; onChanged: () => void }) {
  const [open, setOpen] = useState<Tab | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <section aria-label="Your agent wallet" className="border-y border-[color:var(--hairline-strong)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 font-mono text-[12px] tabular-nums text-ink-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Agent wallet</span>
        <button type="button" className="min-h-11 text-ink underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent" onClick={() => { void navigator.clipboard?.writeText(wallet.address); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>
          {copied ? "Copied" : shortHash(wallet.address)}<span className="sr-only">, copy the full address</span>
        </button>
        <span title={wallet.balance ? `${wallet.balance} USDC` : undefined}><span className="text-sm text-ink">{cents(wallet.balance)}</span> USDC</span>
        <span>{wallet.leftToday} of {wallet.daily} left today</span>
        {wallet.frozen ? <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--err)]">Frozen</span> : null}
        <span className="ml-auto">
          <TagButton size="sm" variant="ghost" arrow={false} onClick={() => setOpen("add")}>Manage</TagButton>
        </span>
      </div>
      {open ? <ManageSheet wallet={wallet} tab={open} onTab={setOpen} onClose={() => setOpen(null)} onChanged={onChanged} /> : null}
    </section>
  );
}

function ManageSheet({ wallet, tab, onTab, onClose, onChanged }: { wallet: StageWallet; tab: Tab; onTab: (t: Tab) => void; onClose: () => void; onChanged: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try { await action(); } catch (e) { setMessage(e instanceof StageApiError ? e.code.replaceAll("_", " ") : "Something went wrong."); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div role="dialog" aria-modal="true" aria-label="Manage your agent wallet" className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[color:var(--hairline-strong)] bg-canvas p-5 sm:p-7">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Agent wallet</p>
          <button type="button" onClick={onClose} className="min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Close</button>
        </div>
        <p className="mt-3 font-mono text-4xl tabular-nums text-ink" title={wallet.balance ? `${wallet.balance} USDC` : undefined}>{cents(wallet.balance)}<span className="ml-2 text-base text-ink-2">USDC</span></p>
        <p className="mt-1 font-mono text-[11px] text-ink-3">{wallet.leftToday} of {wallet.daily} left today · {wallet.perHire} per hire</p>
        <div role="tablist" className="mt-6 grid grid-cols-3 border-y border-[color:var(--hairline-strong)]">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setMessage(null); onTab(key); }}
              className={`min-h-11 border-t-2 font-mono text-[10px] uppercase tracking-[0.14em] ${tab === key ? "border-t-accent text-ink" : "border-t-transparent text-ink-3 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6">
          {tab === "add" ? <AddFunds wallet={wallet} onDone={onChanged} compact /> : null}
          {tab === "withdraw" ? (
            <form
              className="grid gap-3"
              onSubmit={(e) => { e.preventDefault(); void run(async () => { const out = await requestWithdraw(to.trim(), amount.trim()); if (out.ok && out.approvalUrl) router.push(path(out.approvalUrl)); else setMessage(out.code?.replaceAll("_", " ") ?? "Withdraw refused."); }); }}
            >
              <label className="grid gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">To address</span><input value={to} onChange={(e) => setTo(e.target.value)} required pattern="^0x[0-9a-fA-F]{40}$" className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" /></label>
              <label className="grid gap-1"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Amount (USDC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink" /></label>
              <TagButton type="submit" disabled={busy}>Continue</TagButton>
              <p className="text-xs text-ink-3">You approve every withdrawal on the next page.</p>
            </form>
          ) : null}
          {tab === "freeze" ? (
            wallet.frozen ? (
              <div className="grid gap-3">
                <p className="text-sm leading-6 text-ink">Spending is frozen. Nothing can be paid from this wallet.</p>
                <TagButton disabled={busy} onClick={() => void run(async () => router.push(path((await requestUnfreeze()).approvalUrl)))}>Unfreeze</TagButton>
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm leading-6 text-ink-2">Stops every payment from this wallet until you unfreeze it.</p>
                <TagButton variant="ghost" arrow={false} disabled={busy} onClick={() => void run(async () => { await freezeWallet(); onChanged(); })}>Freeze spending</TagButton>
              </div>
            )
          ) : null}
          {message ? <p role="alert" className="mt-4 text-sm text-[color:var(--err)]">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
