import type { StageAnswer } from "@/lib/agon/stage-types";
import { compareProbability } from "@/lib/agon/stage-view";

export function ProbabilityDuel({ answer }: { answer: StageAnswer }) {
  const c = compareProbability(answer);
  return (
    <section aria-labelledby="answer-heading" className="stage-print">
      <h2 id="answer-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">The forecast</h2>
      {answer.marketQuestion ? <p className="mt-3 max-w-[60ch] text-sm leading-6 text-ink-2">Market: {answer.marketQuestion}</p> : null}
      <div className="mt-5 grid grid-cols-2 border-y border-[color:var(--hairline-strong)]">
        <div className="py-6 pr-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Agon</p>
          <p className="mt-2 font-display text-[clamp(4rem,10vw,8rem)] leading-[.82] tracking-[-.06em] tabular-nums text-ink">{c.agonPct}<span className="text-[.45em] tracking-normal">%</span></p>
          <p className="mt-2 text-xs text-ink-2">chance of Yes</p>
        </div>
        <div className="border-l border-[color:var(--hairline)] py-6 pl-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Polymarket</p>
          <p className="mt-2 font-display text-[clamp(4rem,10vw,8rem)] leading-[.82] tracking-[-.06em] tabular-nums text-ink-3">{c.marketPct ?? "n/a"}{c.marketPct !== null ? <span className="text-[.45em] tracking-normal">%</span> : null}</p>
          <p className="mt-2 text-xs text-ink-2">crowd price now</p>
        </div>
      </div>
      <div className="relative mt-6 h-6" aria-hidden>
        <span className="absolute inset-x-0 top-3 h-px bg-[color:var(--hairline-strong)]" />
        {c.marketPct !== null ? <span className="absolute top-1.5 h-3 w-[3px] bg-[color:var(--ink-3)]" style={{ left: `calc(${c.marketPct}% - 1px)` }} /> : null}
        <span className="absolute top-0 h-6 w-[3px] bg-accent" style={{ left: `calc(${c.agonPct}% - 1px)` }} />
        <span className="absolute -bottom-4 left-0 font-mono text-[9px] text-ink-3">0</span>
        <span className="absolute -bottom-4 right-0 font-mono text-[9px] text-ink-3">100</span>
      </div>
      <p className="mt-8 font-mono text-[12px] uppercase tracking-[0.14em] text-ink">{c.sentence}</p>
      {answer.reasons.length > 0 ? (
        <ol className="mt-6 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
          {answer.reasons.map((r, i) => (
            <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-2 py-3 text-sm leading-6 text-ink">
              <span className="font-mono text-[11px] text-accent">0{i + 1}</span>{r}
            </li>
          ))}
        </ol>
      ) : null}
      <p className="mt-5 text-sm leading-6 text-ink-2">
        Forecast by <span className="text-ink">{answer.forecaster.name}</span>, {answer.forecaster.reason}. Agreed <span className="font-mono text-ink">{answer.forecaster.agreed} USDC</span> (asked {answer.forecaster.asked}).
      </p>
    </section>
  );
}
