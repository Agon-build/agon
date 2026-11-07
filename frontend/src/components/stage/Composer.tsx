"use client";
import { useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { LoginButton } from "@/components/pengu/LoginButton";
import { HIRE_TODAY_NOTE } from "@/lib/agon/docs-content";
import { HIRE_EXAMPLES } from "@/lib/agon/hire-layout";
import type { HireCategory, HireCategoryId } from "@/lib/agon/stage-types";

const MAX_PRICES = [["0.50", "0.50 USDC"], ["1.00", "1.00 USDC"], ["", "No limit"]] as const;

/// The question box. With an agent name, the person is writing a task for the agent they chose.
/// A category chosen here goes with the question, so the choices stay inside it.
export function Composer({ disabled, signedIn, onSubmit, agentName, categories = [] }: {
  disabled: boolean;
  signedIn: boolean;
  onSubmit: (question: string, maxPrice: string | null, category?: HireCategoryId) => void;
  agentName?: string | null;
  categories?: HireCategory[];
}) {
  const [question, setQuestion] = useState("");
  const [maxPrice, setMaxPrice] = useState<string>("0.50");
  const [category, setCategory] = useState<HireCategoryId | "">("");
  const ready = question.trim().length >= 8 && question.trim().length <= 300;
  const submit = () => { if (ready && !disabled) onSubmit(question.trim(), maxPrice || null, category || undefined); };
  const action = agentName ? (disabled ? "Getting a price" : "Get a price") : (disabled ? "Finding agents" : "Find agents");
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="stage-print">
      {agentName ? null : <p className="mb-6 text-center text-[15px] leading-6 text-ink-2">{HIRE_TODAY_NOTE}</p>}
      <label htmlFor="ask-question" className={agentName ? "font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3" : "sr-only"}>
        {agentName ? `Your task for ${agentName}` : "What you need done"}
      </label>
      <div className={`flex flex-col gap-2 border border-[color:var(--hairline-strong)] bg-canvas-2 p-2 focus-within:border-accent sm:flex-row sm:items-center ${agentName ? "mt-3" : ""}`}>
        <textarea
          id="ask-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          maxLength={300}
          placeholder={agentName ? "Describe your task" : "A logo for my coffee shop, warm and simple"}
          className="min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 font-sans text-[17px] leading-6 text-ink placeholder:text-ink-3 focus:outline-none [field-sizing:content] max-h-40"
        />
        {!agentName && categories.length > 0 ? (
          <label className="sm:shrink-0">
            <span className="sr-only">Category</span>
            <select
              value={category} disabled={disabled} onChange={(e) => setCategory(e.target.value as HireCategoryId | "")}
              className="min-h-11 w-full border border-[color:var(--hairline)] bg-canvas px-3 text-sm text-ink-2 focus:border-accent focus:outline-none sm:w-auto"
            >
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        ) : null}
        {signedIn ? <span className="sm:shrink-0"><TagButton type="submit" disabled={!ready || disabled}>{action}</TagButton></span> : null}
      </div>
      {!signedIn ? (
        <p className="mt-4 flex flex-wrap items-center justify-center gap-3"><LoginButton /><span className="text-xs text-ink-3">Sign in to hire. You see the price before anything is paid.</span></p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {agentName ? null : (
          <>
            <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Try</span>
            {HIRE_EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setQuestion(ex)} className="min-h-11 border border-[color:var(--hairline)] px-3 text-left text-xs leading-5 text-ink-2 hover:border-accent hover:text-ink focus-visible:border-accent">{ex}</button>
            ))}
          </>
        )}
        <label className="ml-auto flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          Most I'll pay
          <select value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} className="min-h-11 border border-[color:var(--hairline)] bg-canvas px-2 font-mono text-[11px] uppercase text-ink">
            {MAX_PRICES.map(([value, label]) => <option key={label} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
    </form>
  );
}
