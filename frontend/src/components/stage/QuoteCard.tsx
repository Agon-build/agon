import { TagButton } from "@/components/redesign/TagButton";
import type { AskResponse } from "@/lib/agon/stage-types";
import { formatCountdown } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };

export function QuoteCard({ quote, nowMs, paying, onPay, onCancel }: { quote: Quote; nowMs: number; paying: boolean; onPay: () => void; onCancel: () => void }) {
  const expired = Date.parse(quote.expiresAt) <= nowMs;
  return (
    <section aria-labelledby="quote-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">The terms</p>
      <h2 id="quote-heading" className="mt-3 font-display text-2xl uppercase leading-tight tracking-[-.02em] text-ink sm:text-3xl">{quote.providerLabel} will forecast this</h2>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-y border-[color:var(--hairline)] py-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Price, paid once</p>
          <p className="mt-1 font-mono text-5xl tabular-nums leading-none text-ink">{quote.amount}<span className="ml-2 text-base text-ink-2">USDC</span></p>
        </div>
        <span className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">
          {quote.network} · {quote.testnet ? "Test USDC" : "Real USDC"}
        </span>
      </div>
      <ul className="mt-5 space-y-2 text-sm leading-6 text-ink-2">
        <li>Buys the live market and a spot price from data sellers.</li>
        <li>Hires the best-rated Season 1 forecaster it can afford, after haggling.</li>
        <li>Refunds you automatically if nothing can be delivered.</li>
      </ul>
      {!quote.testnet ? <p className="mt-4 text-sm text-ink">This is real USDC on Arc. Every payment shows its transaction as it lands.</p> : null}
      {quote.step === "confirm_code" ? (
        <div className="mt-7 flex flex-wrap items-center gap-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-5 max-lg:border-t max-lg:border-[color:var(--hairline)] max-lg:bg-canvas-2 max-lg:px-5 max-lg:py-3">
          <TagButton onClick={onPay} disabled={paying || expired}>{paying ? "Paying" : `Pay ${quote.amount} USDC`}</TagButton>
          <TagButton variant="ghost" onClick={onCancel} disabled={paying}>Cancel</TagButton>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3" aria-live="polite">{expired ? "Quote expired" : `Expires in ${formatCountdown(quote.expiresAt, nowMs)}`}</span>
        </div>
      ) : (
        <div className="mt-7">
          <p className="text-sm leading-6 text-ink-2">This is over your per-hire limit, so it needs one approval in your browser.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <TagButton href={path(quote.approvalUrl)}>Approve this hire</TagButton>
            <TagButton variant="ghost" onClick={onCancel}>Cancel</TagButton>
          </div>
        </div>
      )}
    </section>
  );
}
