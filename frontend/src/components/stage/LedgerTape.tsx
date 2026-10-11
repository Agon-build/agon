import type { LedgerRow } from "@/lib/agon/stage-view";
import { moneySegments } from "@/lib/agon/stage-view";
import { KindMark } from "./StatusMark";

export function LedgerTape({ rows, working }: { rows: LedgerRow[]; working: boolean }) {
  return (
    <section aria-labelledby="ledger-heading" className="mt-10">
      <div className="flex items-baseline justify-between border-b border-[color:var(--hairline-strong)] pb-3">
        <h3 id="ledger-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">What the agents did</h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{rows.length} {rows.length === 1 ? "step" : "steps"}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-sm text-ink-3">{working ? "Waiting for the first step." : "No steps recorded."}</p>
      ) : (
        <ol aria-live="polite" className="divide-y divide-[color:var(--hairline)]">
          {rows.map((row) => (
            <li key={row.key} className="stage-print grid grid-cols-[3.75rem_0.75rem_minmax(0,1fr)] items-baseline gap-3 py-3">
              <span className="font-mono text-[11px] tabular-nums text-ink-3">{row.offset}</span>
              <KindMark kind={row.kind} />
              <p className="text-sm leading-6 text-ink">
                {moneySegments(row.text).map((s, i) => (s.money ? <span key={i} className="whitespace-nowrap font-mono text-[13px]">{s.text}</span> : <span key={i}>{s.text}</span>))}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
