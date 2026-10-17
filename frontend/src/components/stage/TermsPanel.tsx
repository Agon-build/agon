"use client";
import { useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { acceptTerms, getTerms, type WalletTerms } from "@/lib/agon/stage";

/// Shown once, before the first hire creates the agent wallet Agon holds for this account.
export function TermsPanel({ onAccepted, onCancel }: { onAccepted: () => void; onCancel: () => void }) {
  const [terms, setTerms] = useState<WalletTerms | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getTerms().then(setTerms).catch(() => setError("Agon could not load the terms. Try again in a moment.")); }, []);

  async function agree() {
    if (!terms) return;
    setBusy(true);
    setError(null);
    try { await acceptTerms(terms.version); onAccepted(); } catch { setError("That did not go through. Try again."); } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="terms-heading" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-7">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Before your first hire</p>
      <h2 id="terms-heading" className="mt-3 font-display text-2xl uppercase leading-tight tracking-[-.02em] text-ink sm:text-3xl">Your agent wallet</h2>
      {terms ? (
        <ul className="mt-5 space-y-2 border-y border-[color:var(--hairline)] py-5 text-sm leading-6 text-ink-2">
          {terms.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {error ? <p role="alert" className="mt-4 text-sm text-[color:var(--err)]">{error}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <TagButton onClick={() => void agree()} disabled={!terms || busy}>{busy ? "Saving" : "I agree"}</TagButton>
        <TagButton variant="ghost" onClick={onCancel} disabled={busy}>Cancel</TagButton>
      </div>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Your question is kept. The price comes next.</p>
    </section>
  );
}
