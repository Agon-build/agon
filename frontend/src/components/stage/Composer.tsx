"use client";
import { useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { LoginButton } from "@/components/pengu/LoginButton";

const EXAMPLES = [
  "What's the real chance BTC closes above $120k on Friday?",
  "Will ETH be above $5,000 at the end of this week?",
  "Will Solana close above $300 on Friday?",
] as const;
const MAX_PRICES = [["0.50", "Up to 0.50 USDC"], ["1.00", "Up to 1.00 USDC"], ["", "No maximum"]] as const;

export function Composer({ disabled, signedIn, onSubmit }: { disabled: boolean; signedIn: boolean; onSubmit: (question: string, maxPrice: string | null) => void }) {
  const [question, setQuestion] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("0.50");
  const ready = question.trim().length >= 8 && question.trim().length <= 300;
  const submit = () => { if (ready && !disabled) onSubmit(question.trim(), maxPrice || null); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stage-print">
      <label htmlFor="ask-question" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">What do you need done?</label>
      <textarea
        id="ask-question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        rows={3}
        maxLength={300}
        placeholder="Ask about a market outcome, in plain words."
        className="mt-4 w-full resize-none border-0 border-b border-[color:var(--hairline-strong)] bg-transparent pb-4 font-display text-[clamp(1.6rem,3.4vw,2.8rem)] leading-[1.08] tracking-[-.03em] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setQuestion(ex)} className="min-h-11 border border-[color:var(--hairline)] px-3 text-left text-xs leading-5 text-ink-2 hover:border-accent hover:text-ink focus-visible:border-accent">{ex}</button>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Spend
          <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-2 font-mono text-[11px] uppercase text-ink">
            {MAX_PRICES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </label>
        {signedIn ? (
          <TagButton type="submit" disabled={!ready || disabled}>{disabled ? "Getting a price" : "Get a price"}</TagButton>
        ) : (
          <span className="flex flex-wrap items-center gap-3"><LoginButton /><span className="text-xs text-ink-3">Sign in to ask. Prices show before anything is paid.</span></span>
        )}
      </div>
    </form>
  );
}
