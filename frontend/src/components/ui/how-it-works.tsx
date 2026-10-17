import { Search, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import type React from "react";

import { cn } from "@/lib/utils";

export type HowItWorksStep = { icon: "search" | "hire" | "proof"; title: string; body: string; points: readonly string[] };

interface HowItWorksProps extends React.HTMLAttributes<HTMLElement> {
  eyebrow?: string;
  heading: string;
  lead: string;
  steps: readonly HowItWorksStep[];
}

const ICONS: Record<HowItWorksStep["icon"], LucideIcon> = { search: Search, hire: Zap, proof: ShieldCheck };

function StepCard({ step, index }: { step: HowItWorksStep; index: number }) {
  const Icon = ICONS[step.icon];
  return (
    <li className="group relative bg-canvas p-6 transition-colors duration-200 hover:bg-canvas-2 sm:p-7">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100 motion-reduce:transition-none" />
      <div className="flex items-center justify-between">
        <span className="flex h-11 w-11 items-center justify-center border border-[color:var(--hairline-strong)] text-accent">
          <Icon aria-hidden className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <span className="font-mono text-[11px] tabular-nums tracking-[0.14em] text-ink-3 md:hidden">0{index + 1}</span>
      </div>
      <h3 className="mt-6 font-display text-xl uppercase leading-tight tracking-[-.01em] text-ink">{step.title}</h3>
      <p className="mt-3 text-sm leading-6 text-ink-2">{step.body}</p>
      <ul className="mt-5 space-y-2.5 border-t border-[color:var(--hairline)] pt-5">
        {step.points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-sm leading-6 text-ink-2">
            <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 bg-accent" />
            {point}
          </li>
        ))}
      </ul>
    </li>
  );
}

/// A three-step "How it works" band in the Agon system: flat hairline cells,
/// stencil titles, mono step numbers and the pink accent on hover.
export function HowItWorks({ eyebrow = "HOW IT WORKS", heading, lead, steps, className, ...props }: HowItWorksProps) {
  return (
    <section aria-labelledby="how-it-works-heading" className={cn("w-full", className)} {...props}>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-end">
        <h2 id="how-it-works-heading" className="font-stencil text-[clamp(32px,4.5vw,56px)] uppercase leading-[0.92]">{heading}</h2>
        <p className="max-w-[60ch] text-base leading-7 text-ink-2">{lead}</p>
      </div>
      <div aria-hidden className="relative mt-10 hidden md:grid md:grid-cols-3">
        <span className="absolute left-[16.667%] right-[16.667%] top-1/2 h-px -translate-y-1/2 bg-[color:var(--hairline-strong)]" />
        {steps.map((s, i) => (
          <span key={s.title} className="relative justify-self-center border border-[color:var(--hairline-strong)] bg-canvas px-3 py-1 font-mono text-[11px] tabular-nums tracking-[0.14em] text-ink">STEP 0{i + 1}</span>
        ))}
      </div>
      <ol className="mt-6 grid gap-px border border-[color:var(--hairline)] bg-[color:var(--hairline)] md:grid-cols-3">
        {steps.map((step, index) => <StepCard key={step.title} step={step} index={index} />)}
      </ol>
    </section>
  );
}
