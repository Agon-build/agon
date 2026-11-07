import { HIRE_STEPS_RAIL } from "@/lib/agon/hire-layout";

/// Ask, Choose, Pay, Answer. A bar on top of each step fills as the hire moves on.
export function PhaseRail({ step, working }: { step: 0 | 1 | 2 | 3; working: boolean }) {
  return (
    <ol aria-label="Progress" className="grid grid-cols-4">
      {HIRE_STEPS_RAIL.map((label, i) => {
        const state = i < step ? "done" : i === step ? "now" : "next";
        return (
          <li
            key={label}
            aria-current={state === "now" ? "step" : undefined}
            className={`relative flex min-h-11 items-center gap-2 border-t-2 pr-2 pt-3 transition-colors duration-200 motion-reduce:transition-none ${state === "now" ? "border-t-accent" : state === "done" ? "border-t-ink-3" : "border-t-[color:var(--hairline)]"} ${state === "now" && working && i === 2 ? "agon-preview-scan" : ""}`}
          >
            {state === "done" ? (
              <span aria-hidden className="font-mono text-[11px] text-[color:var(--ok)]">✓</span>
            ) : (
              <span className={`font-mono text-[10px] tabular-nums ${state === "now" ? "text-accent" : "text-ink-3"}`}>0{i + 1}</span>
            )}
            <span className={`text-[13px] sm:text-sm ${state === "next" ? "text-ink-3" : state === "now" ? "font-medium text-ink" : "text-ink-2"}`}>
              {label}{state === "done" ? <span className="sr-only">, done</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
