"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { TagButton } from "@/components/redesign/TagButton";
import { AddFunds } from "@/components/stage/AddFunds";
import { outsideWalletCopy } from "@/lib/agon/account-layout";
import { moneyLine } from "@/lib/agon/hire-layout";
import { freezeWallet, lowerLimits, requestUnfreeze, requestWithdraw, StageApiError } from "@/lib/agon/stage";
import { walletRefusalText } from "@/lib/agon/stage-copy";
import type { StageWallet } from "@/lib/agon/stage-types";

const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };
const INPUT = "min-h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none";
const plain = (e: unknown) => (e instanceof StageApiError ? e.code.replaceAll("_", " ") : "Something went wrong. Try again.");

function Box({ title, line, children }: { title: string; line: string; children: ReactNode }) {
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6">
      <h3 className="text-[17px] font-medium text-ink">{title}</h3>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">{line}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/// Account, Wallet: add funds, withdraw, limits, freeze, and the sign-in wallet.
export function AccountWallet({ wallet, mainnet, signInWallet, onChanged, onMainnetChanged }: { wallet: StageWallet; mainnet: StageWallet | null; signInWallet: string | null; onChanged: () => void; onMainnetChanged: () => void }) {
  const outside = outsideWalletCopy(mainnet);
  const router = useRouter();
  const money = moneyLine(wallet.networkId) ?? moneyLine(wallet.network) ?? `USDC on ${wallet.network}`;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [perHire, setPerHire] = useState("");
  const [daily, setDaily] = useState("");
  const [lowering, setLowering] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ box: string; text: string } | null>(null);

  async function run(box: string, action: () => Promise<void>) {
    setBusy(box);
    setNote(null);
    try { await action(); } catch (e) { setNote({ box, text: plain(e) }); } finally { setBusy(null); }
  }
  const noteFor = (box: string) => note?.box === box ? <p role="alert" className="mt-3 text-sm text-[color:var(--err)]">{note.text}</p> : null;

  return (
    <div>
      <h2 className="text-2xl font-medium tracking-[-.02em] text-ink">Paying for hires</h2>
      <p className="mt-1 text-sm text-ink-2">Hires are paid from your agent wallet, only what you confirm, inside your limits.</p>
      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Box title="Add funds" line={`Send ${money} to this address. The balance updates when it lands.`}>
            <AddFunds wallet={wallet} onDone={onChanged} compact />
          </Box>
          <Box title={outside.title} line={outside.line}>
            {mainnet ? <AddFunds wallet={mainnet} onDone={onMainnetChanged} suggested="0.50" compact /> : <TagButton href="/" size="sm" variant="ghost">Go to Hire</TagButton>}
          </Box>
          <Box title="Withdraw" line="Move USDC out to any Arc address. You approve every withdrawal on the next page.">
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]" onSubmit={(e) => { e.preventDefault(); void run("withdraw", async () => { const out = await requestWithdraw(to.trim(), amount.trim()); if (out.ok && out.approvalUrl) router.push(path(out.approvalUrl)); else setNote({ box: "withdraw", text: walletRefusalText(out.code, out.max) }); }); }}>
              <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">To address</span><input value={to} onChange={(e) => setTo(e.target.value)} required pattern="^0x[0-9a-fA-F]{40}$" placeholder="0x…" className={INPUT} /></label>
              <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Amount (USDC)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} required inputMode="decimal" placeholder="0.00" className={INPUT} /></label>
              <div><TagButton type="submit" variant="ghost" size="sm" disabled={busy === "withdraw"}>Continue</TagButton></div>
            </form>
            {noteFor("withdraw")}
          </Box>
        </div>

        <div className="grid gap-4">
          <Box title="Limits" line="Lower them any time. A payment over your per-hire limit is approved in your browser.">
            <dl className="divide-y divide-[color:var(--hairline)] text-sm">
              {([["Per hire", wallet.perHire], ["Per day", wallet.daily], ["Spent today", wallet.spentToday]] as const).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2.5"><dt className="text-ink-2">{k}</dt><dd className="font-mono tabular-nums text-ink">{v} USDC</dd></div>
              ))}
            </dl>
            {lowering ? (
              <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); void run("limits", async () => {
                const input = { ...(perHire.trim() ? { perHire: perHire.trim() } : {}), ...(daily.trim() ? { daily: daily.trim() } : {}) };
                const out = await lowerLimits(input);
                if (!out.ok) { setNote({ box: "limits", text: walletRefusalText(out.code) }); return; }
                setLowering(false); setPerHire(""); setDaily(""); onChanged();
              }); }}>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Per hire</span><input value={perHire} onChange={(e) => setPerHire(e.target.value)} inputMode="decimal" placeholder={wallet.perHire} className={INPUT} /></label>
                  <label className="grid gap-1"><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Per day</span><input value={daily} onChange={(e) => setDaily(e.target.value)} inputMode="decimal" placeholder={wallet.daily} className={INPUT} /></label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <TagButton type="submit" size="sm" disabled={busy === "limits" || (!perHire.trim() && !daily.trim())}>Save lower limits</TagButton>
                  <button type="button" onClick={() => setLowering(false)} className="min-h-11 px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Cancel</button>
                </div>
              </form>
            ) : <div className="mt-4"><TagButton variant="ghost" size="sm" onClick={() => setLowering(true)}>Lower limits</TagButton></div>}
            {noteFor("limits")}
          </Box>

          <Box title="Freeze spending" line={wallet.frozen ? "Spending is frozen. Nothing can be paid from this wallet." : "Stops every payment from this wallet until you unfreeze it in your browser."}>
            {wallet.frozen
              ? <TagButton size="sm" disabled={busy === "freeze"} onClick={() => void run("freeze", async () => router.push(path((await requestUnfreeze()).approvalUrl)))}>Unfreeze</TagButton>
              : <TagButton variant="ghost" size="sm" disabled={busy === "freeze"} onClick={() => void run("freeze", async () => { await freezeWallet(); onChanged(); })}>Freeze spending</TagButton>}
            {noteFor("freeze")}
          </Box>

          {signInWallet ? (
            <Box title="Sign-in wallet" line="Created with your email sign-in. Listing fees are paid from it.">
              <p className="break-all font-mono text-[12px] text-ink">{signInWallet}</p>
            </Box>
          ) : null}
        </div>
      </div>
    </div>
  );
}
