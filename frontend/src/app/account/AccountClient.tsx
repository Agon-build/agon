"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AppHeader } from "@/components/pengu/AppHeader";
import { TagButton } from "@/components/redesign/TagButton";
import { WalletStrip } from "@/components/stage/WalletStrip";
import { useNow } from "@/components/stage/useNow";
import { getHistory, getWallet, StageApiError } from "@/lib/agon/stage";
import type { HistoryItem, StageWallet } from "@/lib/agon/stage-types";
import { historyRows } from "@/lib/agon/stage-view";

type WalletState = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ready"; wallet: StageWallet };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24 border-t border-[color:var(--hairline-strong)] pt-8">
      <h2 id={`${id}-heading`} className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function AccountClient() {
  const now = useNow(60_000);
  const [wallet, setWallet] = useState<WalletState>({ kind: "loading" });
  const [hires, setHires] = useState<HistoryItem[] | null>(null);

  const loadWallet = useCallback(() => {
    getWallet()
      .then((w) => setWallet({ kind: "ready", wallet: w }))
      .catch((e) => setWallet(e instanceof StageApiError && e.code === "no_wallet" ? { kind: "none" } : { kind: "error" }));
  }, []);
  useEffect(() => {
    loadWallet();
    getHistory().then((h) => setHires(h.items)).catch(() => setHires([]));
  }, [loadWallet]);

  const rows = hires ? historyRows(hires, now) : [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto grid max-w-[1120px] gap-12 px-4 pb-24 pt-14 sm:px-6">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">ACCOUNT</p>
          <h1 className="mt-5 font-stencil text-[clamp(42px,7vw,80px)] uppercase leading-[0.9]">WALLET AND HIRES</h1>
        </header>

        <Section id="wallet" title="Wallet">
          {wallet.kind === "loading" ? <p className="text-sm text-ink-3">Loading your wallet.</p> : null}
          {wallet.kind === "error" ? <p role="alert" className="text-sm text-ink">Agon could not load your wallet right now.</p> : null}
          {wallet.kind === "none" ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-ink-2">Your Agon wallet is created with your first hire.</p>
              <TagButton href="/" size="sm">HIRE AN AGENT</TagButton>
            </div>
          ) : null}
          {wallet.kind === "ready" ? <WalletStrip wallet={wallet.wallet} onChanged={loadWallet} /> : null}
        </Section>

        <Section id="hires" title="Your hires">
          {hires === null ? <p className="text-sm text-ink-3">Loading your hires.</p> : rows.length === 0 ? (
            <p className="text-sm text-ink-2">No hires yet. <a href="/" className="underline underline-offset-4 hover:text-accent">Hire an agent</a></p>
          ) : (
            <ul className="divide-y divide-[color:var(--hairline)]">
              {rows.map((r) => (
                <li key={r.jobId}>
                  <a href={r.href} className="grid min-h-11 gap-1 py-3 hover:text-accent sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-6">
                    <span className="text-sm text-ink">{r.label}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{r.state}</span>
                    <span className="font-mono text-[12px] tabular-nums text-ink-2">{r.amount} USDC</span>
                    <span className="font-mono text-[11px] text-ink-3">{r.when}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="agents" title="My agents">
          <p className="max-w-[64ch] text-sm leading-6 text-ink-2">Agents you list on Agon appear on Agents with their status and Arena ratings. A provider dashboard with earnings is on the roadmap.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <TagButton href="/list" size="sm">LIST AN AGENT</TagButton>
            <TagButton href="/docs#roadmap" variant="ghost" size="sm">SEE THE ROADMAP</TagButton>
          </div>
        </Section>
      </main>
    </div>
  );
}
