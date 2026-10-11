import type { FlowModel, FlowNode } from "@/lib/agon/stage-view";
import { StatusMark } from "./StatusMark";
import { TxLink } from "./TxLink";

const ROLE: Record<FlowNode["role"], string> = { lead: "You paid", data: "Data bought", forecaster: "Forecaster hired", refund: "Refunded" };

function FlowRow({ node, nested }: { node: FlowNode; nested: boolean }) {
  return (
    // The name gets its own line; the payment (connector, amount, status, transaction) runs underneath.
    // Only very wide screens put the two side by side, so names are never cut off.
    <li className={`stage-print grid gap-3 py-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] 2xl:items-center 2xl:gap-6 ${nested ? "pl-5 sm:pl-6" : ""}`}>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{ROLE[node.role]}</p>
        <p className="mt-1 break-words font-display text-lg uppercase leading-tight tracking-[-.01em] text-ink">{node.label}</p>
        <p className="text-xs text-ink-2">{node.sublabel}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span aria-hidden className="stage-connector min-w-[3rem] flex-1" data-settled={node.status === "settled"} data-failed={node.status === "failed"} />
        <span className="whitespace-nowrap font-mono text-[15px] tabular-nums text-ink">{node.amount} <span className="text-[11px] text-ink-3">USDC</span></span>
        <StatusMark status={node.status} />
        <TxLink url={node.txUrl} />
      </div>
    </li>
  );
}

export function MoneyFlow({ flow }: { flow: FlowModel }) {
  return (
    <section aria-labelledby="flow-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--hairline-strong)] pb-3">
        <h3 id="flow-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Where the money went</h3>
        {flow.lead ? <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Agents paid out <span className="text-ink">{flow.agentSpend} USDC</span></span> : null}
      </div>
      {!flow.lead ? (
        <p className="py-6 text-sm text-ink-3">Payments appear here as they land on Arc.</p>
      ) : (
        <ol className="divide-y divide-[color:var(--hairline)]">
          <FlowRow node={flow.lead} nested={false} />
          {flow.sellers.length > 0 ? (
            <li className="relative">
              <ol className="ml-2 divide-y divide-[color:var(--hairline)] border-l border-[color:var(--hairline-strong)]">
                {flow.sellers.map((s) => <FlowRow key={s.id} node={s} nested />)}
              </ol>
            </li>
          ) : null}
          {flow.refund ? <FlowRow node={flow.refund} nested={false} /> : null}
        </ol>
      )}
    </section>
  );
}
