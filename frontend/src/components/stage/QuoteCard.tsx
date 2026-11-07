import { TagButton } from "@/components/redesign/TagButton";
import { feeLine, moneyLine } from "@/lib/agon/hire-layout";
import type { AskResponse } from "@/lib/agon/stage-types";
import { hasFee, inputRows } from "@/lib/agon/route-view";
import { formatCountdown } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
const path = (url: string) => { try { const u = new URL(url); return `${u.pathname}${u.search}`; } catch { return url; } };

/// The exact terms for one hire. Within the per-hire limit one press pays; over it, the
/// payment is approved once in the browser.
export function QuoteCard({ quote, nowMs, paying, direct = false, onPay, onCancel, cancelLabel = "Cancel" }: { quote: Quote; nowMs: number; paying: boolean; direct?: boolean; onPay: () => void; onCancel: () => void; cancelLabel?: string }) {
  const expired = Date.parse(quote.expiresAt) <= nowMs;
  const routed = quote.input !== undefined;
  const total = quote.total ?? quote.amount;
  const money = moneyLine(quote.network) ?? (quote.testnet ? "Test USDC on Arc Testnet" : "Real USDC on Arc mainnet");
  const approval = quote.step !== "confirm_code";
  return (
    <section aria-labelledby="quote-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6">
      <p className={`font-mono text-[10px] uppercase tracking-[0.16em] ${approval ? "text-[color:var(--warn)]" : "text-ink-3"}`}>{approval ? "Needs your approval" : "Pay for this hire"}</p>
      <h2 id="quote-heading" className="mt-4 break-words text-2xl font-medium leading-tight tracking-[-.02em] text-ink sm:text-3xl">
        {approval ? `${total} USDC is over your per-hire limit.` : routed ? quote.providerLabel : `${quote.providerLabel} will forecast this`}
      </h2>

      {routed && !approval ? (
        <dl className="mt-4">
          {inputRows(quote.input ?? {}).map((r) => (
            <div key={r.label} className="mt-2 border border-[color:var(--hairline)] bg-canvas px-3 py-2">
              <dt className="break-words font-mono text-[10px] text-ink-3">{r.label}</dt>
              <dd className="break-words font-mono text-[13px] text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {!routed && !approval ? (
        <ul className="mt-4 space-y-1.5 text-sm leading-6 text-ink-2">
          <li>Buys the live market and a spot price from data sellers.</li>
          <li>Hires one of Agon's Season 1 forecasters it can afford, after haggling.</li>
          <li>Refunds you automatically if nothing can be delivered.</li>
        </ul>
      ) : null}

      <dl className="mt-5 border-t border-[color:var(--hairline)] pt-3">
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-sm text-ink-2">Price</dt>
          <dd className="font-mono text-sm tabular-nums text-ink-2">{quote.amount} USDC</dd>
        </div>
        {quote.fee !== undefined ? (
          <div className="flex items-baseline justify-between gap-4 py-1.5">
            <dt className="text-sm text-ink-2">Agon routing fee</dt>
            <dd className="font-mono text-sm tabular-nums text-ink-2">{feeLine(direct && !hasFee(quote.fee), quote.fee)}</dd>
          </div>
        ) : null}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[color:var(--hairline)] pt-3">
          <dt className="text-sm font-medium text-ink">Total</dt>
          <dd className="font-mono text-2xl tabular-nums text-ink">{total} USDC</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-5 text-ink-3">Paid from your agent wallet in {money.charAt(0).toLowerCase()}{money.slice(1)}.</p>
      {hasFee(quote.fee) ? <p className="mt-1 text-xs leading-5 text-ink-3">Agon's fees go out together once they reach 0.10 USDC, with one small network fee.</p> : null}
      {routed && quote.source === "circle" ? <p className="mt-3 text-sm leading-6 text-ink-2">Paid to an outside service up front. Agon takes its fee only if the answer arrives.</p> : null}
      {!quote.testnet ? <p className="mt-3 text-sm text-ink">This is real USDC on Arc. Every payment shows its transaction as it lands.</p> : null}

      {approval ? (
        <div className="mt-6 grid gap-3">
          <p className="text-sm leading-6 text-ink-2">Approve this one payment in your browser. Your limit stays as it is.</p>
          <TagButton href={path(quote.approvalUrl)}>{`Approve ${total} USDC`}</TagButton>
          <TagButton variant="ghost" onClick={onCancel}>{cancelLabel}</TagButton>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:-mx-5 max-lg:border-t max-lg:border-[color:var(--hairline)] max-lg:bg-canvas-2 max-lg:px-5 max-lg:py-3">
          <TagButton onClick={onPay} disabled={paying || expired}>{paying ? "Paying" : `Pay ${total} USDC`}</TagButton>
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onCancel} disabled={paying} className="min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent disabled:opacity-60">{cancelLabel}</button>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{expired ? "Quote expired" : `Price held ${formatCountdown(quote.expiresAt, nowMs)}`}</span>
          </div>
          <span className="sr-only" aria-live="polite">{expired ? "Quote expired" : ""}</span>
        </div>
      )}
    </section>
  );
}
