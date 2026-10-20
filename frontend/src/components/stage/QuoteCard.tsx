import { TagButton } from "@/components/redesign/TagButton";
import type { AskResponse } from "@/lib/agon/stage-types";
import { hasFee, inputRows, priceLines } from "@/lib/agon/route-view";
import { formatCountdown } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };

export function QuoteCard({ quote, nowMs, paying, onPay, onCancel }: { quote: Quote; nowMs: number; paying: boolean; onPay: () => void; onCancel: () => void }) {
  const expired = Date.parse(quote.expiresAt) <= nowMs;
  const routed = quote.input !== undefined;
  const total = quote.total ?? quote.amount;
  return (
    <section aria-labelledby="quote-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">The terms</p>
      <h2 id="quote-heading" className="mt-3 font-display text-2xl uppercase leading-tight tracking-[-.02em] text-ink sm:text-3xl">{routed ? quote.providerLabel : `${quote.providerLabel} will forecast this`}</h2>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-y border-[color:var(--hairline)] py-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{hasFee(quote.fee) ? "Total, paid once" : "Price, paid once"}</p>
          <p className="mt-1 font-mono text-5xl tabular-nums leading-none text-ink">{total}<span className="ml-2 text-base text-ink-2">USDC</span></p>
        </div>
        <span className="border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">
          {quote.network} · {quote.testnet ? "Test USDC" : "Real USDC"}
        </span>
      </div>
      {hasFee(quote.fee) ? (
        <dl className="mt-4 divide-y divide-[color:var(--hairline)]">
          {priceLines({ price: quote.amount, fee: quote.fee, total: quote.total }).slice(0, 2).map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{l.label}</dt>
              <dd className="font-mono text-sm tabular-nums text-ink-2">{l.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hasFee(quote.fee) ? <p className="mt-2 text-xs leading-5 text-ink-3">Sending Agon's fee also uses a network fee of under 0.005 USDC from your wallet.</p> : null}
      {routed ? (
        <div className="mt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Sending</h3>
          <dl className="mt-2 border-y border-[color:var(--hairline)]">
            {inputRows(quote.input ?? {}).map((r) => (
              <div key={r.label} className="grid gap-1 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-4">
                <dt className="break-words font-mono text-[11px] text-ink-3">{r.label}</dt>
                <dd className="break-words font-mono text-[12px] text-ink">{r.value}</dd>
              </div>
            ))}
          </dl>
          {quote.source === "circle" ? <p className="mt-4 text-sm leading-6 text-ink-2">Paid to an outside service up front. Agon takes its fee only if the answer arrives.</p> : null}
        </div>
      ) : (
        <ul className="mt-5 space-y-2 text-sm leading-6 text-ink-2">
          <li>Buys the live market and a spot price from data sellers.</li>
          <li>Hires one of Agon's Season 1 forecasters it can afford, after haggling.</li>
          <li>Refunds you automatically if nothing can be delivered.</li>
        </ul>
      )}
      {!quote.testnet ? <p className="mt-4 text-sm text-ink">This is real USDC on Arc. Every payment shows its transaction as it lands.</p> : null}
      {quote.step === "confirm_code" ? (
        <div className="mt-7 flex flex-wrap items-center gap-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-5 max-lg:border-t max-lg:border-[color:var(--hairline)] max-lg:bg-canvas-2 max-lg:px-5 max-lg:py-3">
          <TagButton onClick={onPay} disabled={paying || expired}>{paying ? "Paying" : `Pay ${total} USDC`}</TagButton>
          <TagButton variant="ghost" onClick={onCancel} disabled={paying}>Cancel</TagButton>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{expired ? "Quote expired" : `Expires in ${formatCountdown(quote.expiresAt, nowMs)}`}</span>
          <span className="sr-only" aria-live="polite">{expired ? "Quote expired" : ""}</span>
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
