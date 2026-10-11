import type { FlowStatus } from "@/lib/agon/stage-view";
import type { StageEventKind } from "@/lib/agon/stage-types";
import { KIND_LABEL } from "@/lib/agon/stage-copy";

const STATUS_LABEL: Record<FlowStatus, string> = { settled: "Settled on Arc", pending: "Confirming", failed: "Failed" };

export function StatusMark({ status }: { status: FlowStatus }) {
  const cls = status === "settled" ? "bg-[color:var(--ok)]" : status === "failed" ? "bg-[color:var(--err)]" : "border border-[color:var(--ink-3)]";
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">
      <span aria-hidden className={`inline-block h-2 w-2 ${cls}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function KindMark({ kind }: { kind: StageEventKind }) {
  const cls =
    kind === "hire" ? "bg-accent" :
    kind === "haggle" ? "border border-accent" :
    kind === "refund" ? "bg-[color:var(--ok)]" :
    kind === "fail" ? "bg-[color:var(--err)]" :
    kind === "data" ? "bg-[color:var(--ink-2)]" : "border border-[color:var(--ink-3)]";
  return <span role="img" aria-label={KIND_LABEL[kind]} className={`inline-block h-2 w-2 translate-y-[-1px] ${cls}`} />;
}
