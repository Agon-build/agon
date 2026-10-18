import type { BargainStep } from "@/lib/agon/stage-types";
import { haggleRows, haggleSummary } from "@/lib/agon/stage-view";

/// The price talk between the lead agent and the forecaster, one move per row.
export function HaggleTape({ steps, seller }: { steps: BargainStep[]; seller: string }) {
  const rows = haggleRows(steps, seller);
  const summary = haggleSummary(steps);
  return (
    <section aria-labelledby="haggle-heading" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--hairline-strong)] pb-3">
        <h3 id="haggle-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">The price talk</h3>
        {summary ? <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{summary.percentOff}% under the ask</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-2">Agon's lead agent bargains with the forecaster before paying it. This comes out of the agents' budget, not your price.</p>
      <ol className="mt-3 divide-y divide-[color:var(--hairline)] border-b border-[color:var(--hairline)]">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`stage-print grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-3 ${row.side === "deal" ? "border-t-2 border-accent" : ""}`}
          >
            <span className={`min-w-0 break-words text-sm ${row.side === "deal" ? "font-mono text-[11px] uppercase tracking-[0.14em] text-accent" : row.side === "agon" ? "text-ink" : "text-ink-2"}`}>{row.label}</span>
            {row.amount ? (
              <span className={`font-mono tabular-nums text-ink ${row.side === "deal" ? "text-2xl" : "text-base"}`}>
                {row.amount} <span className="text-[11px] text-ink-3">USDC</span>
              </span>
            ) : <span />}
          </li>
        ))}
      </ol>
    </section>
  );
}
