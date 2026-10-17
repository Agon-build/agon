"use client";
import { AddFunds } from "@/components/stage/AddFunds";
import { shortWalletText, topUpAmount } from "@/lib/agon/hire-panel";
import type { StageWallet } from "@/lib/agon/stage-types";

/// Shown in place of the quote when the agent wallet cannot cover the price.
/// The page asks again on its own once the balance covers it.
export function TopUpPanel({ wallet, price, onFunded, onCancel }: { wallet: StageWallet | null; price: string; onFunded: () => void; onCancel: () => void }) {
  return (
    <section aria-labelledby="topup-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Top up to continue</p>
      <h2 id="topup-heading" className="mt-3 font-display text-2xl uppercase leading-tight tracking-[-.02em] text-ink sm:text-3xl">{price} USDC to hire</h2>
      <p role="status" className="mt-3 text-sm leading-6 text-ink-2">{shortWalletText(wallet?.balance ?? null, price)}</p>
      {wallet ? (
        <div className="mt-6 border-t border-[color:var(--hairline)] pt-5">
          <AddFunds key={price} wallet={wallet} onDone={onFunded} suggested={topUpAmount(price, wallet.balance)} compact />
        </div>
      ) : null}
      <p className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        <span aria-hidden className="inline-block size-1.5 animate-pulse bg-accent motion-reduce:animate-none" />
        Your question is kept. The price comes back when the funds land.
      </p>
      <button type="button" onClick={onCancel} className="mt-4 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Cancel</button>
    </section>
  );
}
