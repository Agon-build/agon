import { answerView, type AnswerView, type RulesAnswerView, type WatchAnswerView } from "@/lib/agon/route-view";
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

function RulesAnswer({ view }: { view: RulesAnswerView }) {
  return (
    <section aria-labelledby="answer-heading" className="stage-print border-y border-[color:var(--hairline-strong)] py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Delivered</p>
      <h2 id="answer-heading" className="mt-3 font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink sm:text-4xl">The rules</h2>
      {view.marketQuestion ? (
        <p className="mt-4 break-words text-sm leading-6 text-ink-2">
          {view.marketUrl ? <a href={view.marketUrl} target="_blank" rel="noreferrer" className="underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-ink">{view.marketQuestion}</a> : view.marketQuestion}
        </p>
      ) : null}
      <p className="mt-5 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
        <span aria-hidden className={`inline-block h-2 w-2 ${view.risk === "low" ? "bg-[color:var(--ok)]" : "bg-[color:var(--warn)]"}`} />
        {view.riskText}
      </p>
      {view.decides.length > 0 ? (
        <dl className="mt-5 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
          {view.decides.map((d) => (
            <div key={d.label} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] sm:gap-4">
              <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{d.label}</dt>
              <dd className="break-words text-sm leading-6 text-ink">{d.text}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {view.traps.length > 0 ? (
        <ol className="mt-6 space-y-5">
          {view.traps.map((t, i) => (
            <li key={i} className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{t.label}</p>
              <p className="mt-1.5 break-words text-sm leading-6 text-ink">{t.explain}</p>
              <blockquote className="mt-2 break-words border-l-2 border-accent pl-3 font-mono text-[12px] leading-5 text-ink-2">“{t.quote}”</blockquote>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-6 text-sm leading-6 text-ink-2">No traps found in these rules.</p>
      )}
      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Quotes checked word for word against the rules</p>
    </section>
  );
}

function WatchAnswer({ view }: { view: WatchAnswerView }) {
  return (
    <section aria-labelledby="answer-heading" className="stage-print border-y border-[color:var(--hairline-strong)] py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Watching</p>
      <h2 id="answer-heading" className="mt-3 font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink sm:text-4xl">Settlement alerts are on</h2>
      <p className="mt-4 text-sm leading-6 text-ink-2">Alerts arrive in your bell, and in Telegram if it is linked, when settlement starts, is challenged, settles, or the rules change. The watch runs until every market settles, or {view.until}.</p>
      <ul className="mt-5 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
        {view.markets.map((m) => (
          <li key={m.url} className="py-2.5 text-sm leading-6 text-ink">
            <a href={m.url} target="_blank" rel="noreferrer" className="break-words underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-accent">{m.question}</a>
          </li>
        ))}
      </ul>
      <a href={view.watchPath} className="mt-5 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.13em] text-ink hover:text-accent">Follow your markets →</a>
    </section>
  );
}

function RoutedAnswer({ view }: { view: AnswerView }) {
  if (view.kind === "rules") return <RulesAnswer view={view} />;
  if (view.kind === "watch") return <WatchAnswer view={view} />;
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
        {/* A job with no steps to show (a direct hire) does not need an empty steps panel once it is done. */}
        {live.events.length > 0 || !isTerminal(live.phase) ? <LedgerTape rows={ledgerRows(live.events, live.startedAt)} working={!isTerminal(live.phase)} /> : null}
      </div>
    </div>
  );
}
