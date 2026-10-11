import type { BargainStep } from "@/lib/agon/stage-types";
import { haggleRows, haggleSummary } from "@/lib/agon/stage-view";

export function HaggleTape({ steps, seller }: { steps: BargainStep[]; seller: string }) {
  const rows = haggleRows(steps);
  const summary = haggleSummary(steps);
  return (
    <section aria-labelledby="haggle-heading" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--hairline-strong)] pb-3">
        <h3 id="haggle-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">The haggle</h3>
        {summary ? <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">{summary.percentOff}% under the ask</span> : null}
      </div>
      <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"><span>Agon lead agent</span><span className="truncate pl-4">{seller}</span></div>
      <ol className="mt-2 space-y-2">
        {rows.map((row) =>
          row.side === "deal" ? (
            <li key={row.key} className="stage-print flex items-baseline justify-between border-t-2 border-accent pt-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{row.label}</span>
              <span className="font-mono text-2xl tabular-nums text-ink">{row.amount} <span className="text-xs text-ink-3">USDC</span></span>
            </li>
          ) : row.side === "walk" ? (
            <li key={row.key} className="stage-print py-2 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{row.label}</li>
          ) : (
            <li key={row.key} className={`stage-print flex ${row.side === "seller" ? "justify-end" : "justify-start"}`}>
              <div className={`w-[min(100%,14rem)] border px-3 py-2 ${row.side === "seller" ? "border-[color:var(--hairline-strong)] text-right" : "border-[color:var(--hairline)] bg-canvas-2"}`}>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{row.label}</p>
                <p className="font-mono text-lg tabular-nums text-ink">{row.amount ?? "n/a"} <span className="text-[11px] text-ink-3">USDC</span></p>
              </div>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
