import { answerView, type AnswerView } from "@/lib/agon/route-view";
import type { LiveView } from "@/lib/agon/stage-types";
import { failureText } from "@/lib/agon/stage-copy";
import { isTerminal, ledgerRows, moneyFlow, workingNotice } from "@/lib/agon/stage-view";
import { HaggleTape } from "./HaggleTape";
import { LedgerTape } from "./LedgerTape";
import { MoneyFlow } from "./MoneyFlow";
import { ProbabilityDuel } from "./ProbabilityDuel";

function Notice({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="stage-print border-y border-[color:var(--hairline-strong)] py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 max-w-[18ch] break-words font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink sm:text-4xl">{title}</h2>
      <p className="mt-4 max-w-[52ch] text-sm leading-6 text-ink-2">{body}</p>
    </section>
  );
}

function RoutedAnswer({ view }: { view: AnswerView }) {
  return (
    <section aria-labelledby="answer-heading" className="stage-print border-y border-[color:var(--hairline-strong)] py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Delivered</p>
      <h2 id="answer-heading" className="mt-3 font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink sm:text-4xl">The answer</h2>
      {view.kind === "text" ? (
        <pre className="mt-5 max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ink">{view.text}</pre>
      ) : (
        <dl className="mt-5 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
          {view.rows.map((r) => (
            <div key={r.label} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-4">
              <dt className="break-words font-mono text-[11px] text-ink-3">{r.label}</dt>
              <dd className="break-words font-mono text-[12px] text-ink">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/// One job, shown the same way in the app, the receipt and the approval page.
export function RunView({ live }: { live: LiveView }) {
  const flow = moneyFlow(live.receipt);
  const forecaster = live.receipt?.children[0]?.label ?? live.answer?.forecaster.name ?? "Forecaster";
  const routed = !live.answer && live.phase === "answered" ? answerView(live.result) : null;
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
      <div className="min-w-0">
        {live.answer ? <ProbabilityDuel answer={live.answer} /> : null}
        {routed ? <RoutedAnswer view={routed} /> : null}
        {live.phase === "refunded" ? <Notice eyebrow="Refunded" title="No forecast this time" body={`${failureText(live.failure)} Your payment was refunded; the refund transaction is in the money flow.`} /> : null}
        {live.phase === "failed" ? <Notice eyebrow="Not delivered" title="The job did not finish" body={failureText(live.failure)} /> : null}
        {live.phase === "quoted" ? <Notice eyebrow="Not paid" title="This quote was not paid" body="Nothing was charged. Ask again for a fresh price." /> : null}
        {!isTerminal(live.phase) ? (
          <Notice eyebrow={live.phase === "paying" ? "Paying" : "Working"} {...workingNotice(live.phase === "paying" ? "paying" : "working", live.receipt)} />
        ) : null}
        {live.haggle.length > 0 ? <HaggleTape steps={live.haggle} seller={forecaster} /> : null}
      </div>
      <div className="min-w-0">
        <MoneyFlow flow={flow} />
        <LedgerTape rows={ledgerRows(live.events, live.startedAt)} working={!isTerminal(live.phase)} />
      </div>
    </div>
  );
}
