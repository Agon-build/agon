import type { LiveView } from "@/lib/agon/stage-types";
import { failureText } from "@/lib/agon/stage-copy";
import { isTerminal, ledgerRows, moneyFlow } from "@/lib/agon/stage-view";
import { HaggleTape } from "./HaggleTape";
import { LedgerTape } from "./LedgerTape";
import { MoneyFlow } from "./MoneyFlow";
import { ProbabilityDuel } from "./ProbabilityDuel";

function Notice({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <section className="stage-print border-y border-[color:var(--hairline-strong)] py-8">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 max-w-[18ch] font-display text-3xl uppercase leading-[.95] tracking-[-.03em] text-ink sm:text-4xl">{title}</h2>
      <p className="mt-4 max-w-[52ch] text-sm leading-6 text-ink-2">{body}</p>
    </section>
  );
}

/// One job, shown the same way in the app, the receipt and the approval page.
export function RunView({ live }: { live: LiveView }) {
  const flow = moneyFlow(live.receipt);
  const forecaster = live.receipt?.children[0]?.label ?? live.answer?.forecaster.name ?? "Forecaster";
  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
      <div className="min-w-0">
        {live.answer ? <ProbabilityDuel answer={live.answer} /> : null}
        {live.phase === "refunded" ? <Notice eyebrow="Refunded" title="No forecast this time" body={`${failureText(live.failure)} Your payment was refunded; the refund transaction is in the money flow.`} /> : null}
        {live.phase === "failed" ? <Notice eyebrow="Not delivered" title="The job did not finish" body={failureText(live.failure)} /> : null}
        {live.phase === "quoted" ? <Notice eyebrow="Not paid" title="This quote was not paid" body="Nothing was charged. Ask again for a fresh price." /> : null}
        {!isTerminal(live.phase) ? (
          <Notice
            eyebrow={live.phase === "paying" ? "Paying" : "Working"}
            title={live.phase === "paying" ? "Paying the lead agent" : "Agents at work"}
            body={live.phase === "paying" ? "Your payment is settling on Arc. The lead agent starts the moment it lands." : "The lead agent is buying data and choosing a forecaster. Every payment appears on the right as it lands."}
          />
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
