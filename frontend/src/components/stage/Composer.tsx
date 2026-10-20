"use client";
import { useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { LoginButton } from "@/components/pengu/LoginButton";
import { HIRE_TODAY_NOTE } from "@/lib/agon/docs-content";

// Each was checked against open Polymarket markets on 2026-10-18.
const EXAMPLES = [
  "Will Arsenal win the Premier League this season?",
  "Will the Fed cut rates by December?",
  "Will Bitcoin be above $76,000 on Friday?",
] as const;
const MAX_PRICES = [["0.50", "0.50 USDC"], ["1.00", "1.00 USDC"], ["", "No limit"]] as const;

/// The question box. With an agent name, the person is writing a task for the agent they chose.
export function Composer({ disabled, signedIn, onSubmit, agentName }: { disabled: boolean; signedIn: boolean; onSubmit: (question: string, maxPrice: string | null) => void; agentName?: string | null }) {
  const [question, setQuestion] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("0.50");
  const ready = question.trim().length >= 8 && question.trim().length <= 300;
  const submit = () => { if (ready && !disabled) onSubmit(question.trim(), maxPrice || null); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stage-print">
      {agentName ? (
        <label htmlFor="ask-question" className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Your task for {agentName}</label>
      ) : (
        <>
          <p className="max-w-[56ch] text-sm leading-6 text-ink-2">{HIRE_TODAY_NOTE}</p>
          <label htmlFor="ask-question" className="sr-only">Your question</label>
        </>
      )}
      <textarea
        id="ask-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={2}
        maxLength={300}
        placeholder={agentName ? "Describe your task" : "Type your question"}
        className="mt-6 w-full resize-none border-0 border-b border-[color:var(--hairline-strong)] bg-transparent pb-4 font-display text-[clamp(1.6rem,3.4vw,2.8rem)] leading-[1.08] tracking-[-.03em] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      {agentName ? null : (
        <>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Or try one</p>
          <div className="mt-2 flex flex-wrap gap-2" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setQuestion(ex)} className="min-h-11 border border-[color:var(--hairline)] px-3 text-left text-xs leading-5 text-ink-2 hover:border-accent hover:text-ink focus-visible:border-accent">{ex}</button>
            ))}
          </div>
        </>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Most I'll pay
          <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-2 font-mono text-[11px] uppercase text-ink">
            {MAX_PRICES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </label>
        {signedIn ? (
          <TagButton type="submit" disabled={!ready || disabled}>{disabled ? "Getting a price" : "Get a price"}</TagButton>
        ) : (
          <span className="flex flex-wrap items-center gap-3"><LoginButton /><span className="text-xs text-ink-3">Sign in to ask. You see the price before anything is paid.</span></span>
        )}
      </div>
    </form>
  );
}
