"use client";
import { useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { feeLine, moneyLine } from "@/lib/agon/hire-layout";
import { sourceLabel } from "@/lib/agon/route-view";
import type { RoutePick } from "@/lib/agon/stage-types";
import { OUTSIDE_PAYMENT_NOTE } from "@/lib/agon/stage-copy";

/// The hire the person is about to make: why this agent, the price with the routing fee and
/// the total, and which money pays it. Asking for the exact price checks the live terms and fills the input.
export function RouteCard({ pick, alternatives, question, missing, busy, note, direct = false, onSwap, onQuote, onCancel, heading = "Your hire", cancelLabel = "Cancel" }: {
  pick: RoutePick;
  alternatives: RoutePick[];
  question: string | null;
  missing: string[];
  busy: boolean;
  note?: string | null;
  direct?: boolean;
  onSwap: (p: RoutePick) => void;
  onQuote: (answers?: Record<string, string>) => void;
  onCancel: () => void;
  heading?: string;
  cancelLabel?: string;
}) {
  const [answer, setAnswer] = useState("");
  const field = missing[0] ?? null;
  // A new question starts with an empty box.
  useEffect(() => { setAnswer(""); }, [field]);
  const submit = () => onQuote(field && answer.trim() ? { [field]: answer.trim() } : undefined);
  const money = moneyLine(pick.network);
  return (
    <section aria-labelledby="route-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{heading}</p>
      <h2 id="route-heading" className="mt-4 break-words text-2xl font-medium leading-tight tracking-[-.02em] text-ink sm:text-3xl">{pick.name}</h2>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{sourceLabel(pick)}</p>
      {pick.reason ? <p className="mt-3 text-sm leading-6 text-ink-2">{pick.reason}</p> : pick.description ? <p className="mt-3 text-sm leading-6 text-ink-2">{pick.description}</p> : null}
      {note ? <p className="mt-3 border-l-2 border-[color:var(--hairline-strong)] pl-3 text-xs leading-5 text-ink-3">{note}</p> : null}

      {field ? (
        <form className="mt-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label htmlFor="route-answer" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">What Agon will send</label>
          <p className="mt-2 text-sm leading-6 text-ink">{question ?? `What should Agon use for ${field}?`}</p>
          <div className="mt-2 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 focus-within:border-accent">
            <span className="block font-mono text-[10px] text-ink-3">{field}</span>
            <input
              id="route-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} autoComplete="off"
              className="min-h-9 w-full bg-transparent font-mono text-sm text-ink focus:outline-none"
            />
          </div>
        </form>
      ) : null}

      <dl className="mt-5 border-t border-[color:var(--hairline)] pt-3">
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-sm text-ink-2">Price</dt>
          <dd className="font-mono text-sm tabular-nums text-ink-2">{pick.price} USDC</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="text-sm text-ink-2">Agon routing fee</dt>
          <dd className="font-mono text-sm tabular-nums text-ink-2">{feeLine(direct, pick.fee)}</dd>
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[color:var(--hairline)] pt-3">
          <dt className="text-sm font-medium text-ink">Total</dt>
          <dd className="font-mono text-2xl tabular-nums text-ink">{pick.total} USDC</dd>
        </div>
      </dl>
      {money ? <p className="mt-2 text-xs leading-5 text-ink-3">From your agent wallet, in {money.charAt(0).toLowerCase()}{money.slice(1)}.</p> : null}
      {pick.source === "circle" ? <p className="mt-3 text-sm leading-6 text-ink">{OUTSIDE_PAYMENT_NOTE}</p> : null}

      <div className="mt-6 grid gap-3">
        <TagButton onClick={submit} disabled={busy || (Boolean(field) && !answer.trim())}>{busy ? "Checking the price" : "Get the exact price"}</TagButton>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-11 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent disabled:opacity-60">{cancelLabel}</button>
      </div>
      <p className="mt-2 text-xs leading-5 text-ink-3">Nothing is paid until you press Pay.</p>

      {alternatives.length > 0 ? (
        <div className="mt-6 border-t border-[color:var(--hairline-strong)] pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">Other fits</h3>
          <ul className="mt-2 divide-y divide-[color:var(--hairline)]">
            {alternatives.map((a) => (
              <li key={a.reference}>
                <button
                  type="button" onClick={() => onSwap(a)} disabled={busy}
                  className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-left hover:text-accent disabled:opacity-60"
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
