"use client";
import { useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { networkLabel, priceLines, sourceLabel } from "@/lib/agon/route-view";
import type { RoutePick } from "@/lib/agon/stage-types";

/// Agon's pick for a request, with the other fits to swap to. Asking for the
/// exact price checks the service's live terms and fills its input.
export function RouteCard({ pick, alternatives, question, missing, busy, note, onSwap, onQuote, onCancel }: {
  pick: RoutePick;
  alternatives: RoutePick[];
  question: string | null;
  missing: string[];
  busy: boolean;
  note?: string | null;
  onSwap: (p: RoutePick) => void;
  onQuote: (answers?: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const field = missing[0] ?? null;
  // A new question starts with an empty box.
  useEffect(() => { setAnswer(""); }, [field]);
  const submit = () => onQuote(field && answer.trim() ? { [field]: answer.trim() } : undefined);
  return (
    <section aria-labelledby="route-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Agon's pick</p>
      <h2 id="route-heading" className="mt-3 break-words font-display text-2xl uppercase leading-tight tracking-[-.02em] text-ink sm:text-3xl">{pick.name}</h2>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2">{sourceLabel(pick)}</p>
      {pick.description ? <p className="mt-4 text-sm leading-6 text-ink-2">{pick.description}</p> : null}
      {note ? <p className="mt-3 border-l-2 border-[color:var(--hairline-strong)] pl-3 text-xs leading-5 text-ink-3">{note}</p> : null}

      <dl className="mt-6 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
        {priceLines(pick).map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">{l.label}</dt>
            <dd className={`font-mono tabular-nums ${l.label === "Total" ? "text-lg text-ink" : "text-sm text-ink-2"}`}>{l.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 inline-flex border border-[color:var(--hairline-strong)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">{networkLabel(pick.network)}</p>
      {pick.source === "circle" ? <p className="mt-4 text-sm leading-6 text-ink">An outside service on Circle. It is paid up front; Agon takes its fee only if the answer arrives.</p> : null}

      {field ? (
        <form className="mt-6 border-t border-[color:var(--hairline)] pt-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="route-answer" className="block text-sm leading-6 text-ink">{question ?? `What should I use for ${field}?`}</label>
          <input
            id="route-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} autoComplete="off"
            className="mt-3 min-h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink focus:border-accent focus:outline-none"
          />
        </form>
      ) : null}

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <TagButton onClick={submit} disabled={busy || (Boolean(field) && !answer.trim())}>{busy ? "Checking" : "Get the exact price"}</TagButton>
        <TagButton variant="ghost" onClick={onCancel} disabled={busy}>Cancel</TagButton>
      </div>

      {alternatives.length > 0 ? (
        <div className="mt-8 border-t border-[color:var(--hairline-strong)] pt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Other fits</h3>
          <ul className="mt-2 divide-y divide-[color:var(--hairline)]">
            {alternatives.map((a) => (
              <li key={a.reference}>
                <button
                  type="button" onClick={() => onSwap(a)} disabled={busy}
                  className="grid min-h-11 w-full gap-1 py-3 text-left hover:text-accent disabled:opacity-60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
                >
                  <span className="min-w-0">
                    <span className="block break-words text-sm text-ink">{a.name}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{sourceLabel(a)}</span>
                  </span>
                  <span className="font-mono text-[12px] tabular-nums text-ink-2">{a.total} USDC</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
