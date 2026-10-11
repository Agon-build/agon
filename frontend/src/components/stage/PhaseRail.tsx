const STEPS = ["Ask", "Approve", "Agents at work", "Answer"] as const;

export function PhaseRail({ step, working }: { step: 0 | 1 | 2 | 3; working: boolean }) {
  return (
    <ol aria-label="Progress" className="grid grid-cols-4 border-y border-[color:var(--hairline-strong)]">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "now" : "next";
        return (
          <li
            key={label}
            aria-current={state === "now" ? "step" : undefined}
            className={`relative min-h-[64px] border-t-2 px-2 py-3 sm:px-3 ${i > 0 ? "border-l border-l-[color:var(--hairline)]" : ""} ${state === "now" ? "border-t-accent" : "border-t-transparent"} ${state === "now" && working && i === 2 ? "agon-preview-scan" : ""}`}
          >
            <span className={`font-mono text-[10px] tabular-nums ${state === "next" ? "text-ink-3" : "text-accent"}`}>0{i + 1}</span>
            <span className={`mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] sm:text-[11px] ${state === "next" ? "text-ink-3" : "text-ink"}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
