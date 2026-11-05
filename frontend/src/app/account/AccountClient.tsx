"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AgentAccess } from "@/components/agon/AgentAccess";
import { DeliverySettings } from "@/components/agon/DeliverySettings";
import { MyListings } from "@/components/agon/MyListings";
import { AppHeader } from "@/components/pengu/AppHeader";
import { Pager } from "@/components/redesign/Pager";
import { TagButton } from "@/components/redesign/TagButton";
import { WalletStrip } from "@/components/stage/WalletStrip";
import { useNow } from "@/components/stage/useNow";
import { useAuth } from "@/hooks/useAuth";
import { getHistory, getWallet, StageApiError } from "@/lib/agon/stage";
import type { HistoryItem, StageWallet } from "@/lib/agon/stage-types";
import { historyRows } from "@/lib/agon/stage-view";
import { tabFromHash } from "@/lib/agon/page-tabs";

/// Account shows one part at a time; the part is in the address (/account#deliveries).
const TABS = [
  { id: "hires", label: "Hires" },
  { id: "wallet", label: "Wallet" },
  { id: "deliveries", label: "Deliveries" },
  { id: "listings", label: "Listings" },
  { id: "access", label: "Agent access" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const TAB_IDS = TABS.map((t) => t.id);

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
  const { me } = useAuth();
  const [wallet, setWallet] = useState<WalletState>({ kind: "loading" });
  const [hires, setHires] = useState<HistoryItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [tab, setTab] = useState<TabId>("hires");
  useEffect(() => {
    const read = () => setTab(tabFromHash(window.location.hash, TAB_IDS, "hires") as TabId);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const loadWallet = useCallback(() => {
    getWallet()
      .then((w) => setWallet({ kind: "ready", wallet: w }))
      .catch((e) => setWallet(e instanceof StageApiError && e.code === "no_wallet" ? { kind: "none" } : { kind: "error" }));
  }, []);
  useEffect(() => { loadWallet(); }, [loadWallet]);
  useEffect(() => {
    let active = true;
    setHires(null);
    getHistory(page)
      .then((h) => { if (active) { setHires(h.items); setHasMore(h.hasMore); } })
      .catch(() => { if (active) { setHires([]); setHasMore(false); } });
    return () => { active = false; };
  }, [page]);

  const rows = hires ? historyRows(hires, now) : [];

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto grid max-w-[1120px] gap-12 px-4 pb-24 pt-14 sm:px-6">
        <header>
          <h1 className="font-stencil text-[clamp(42px,7vw,80px)] uppercase leading-[0.9]">ACCOUNT</h1>
          <nav aria-label="Account" className="mt-8 flex flex-wrap gap-2 border-b border-[color:var(--hairline-strong)] pb-3">
            {TABS.map((t) => (
              <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined}
                className={`inline-flex min-h-11 items-center border px-3 font-mono text-[10px] uppercase tracking-[0.14em] ${tab === t.id ? "border-accent text-accent" : "border-[color:var(--hairline)] text-ink-2 hover:text-ink"}`}>
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        {tab === "wallet" && me?.walletKind === "circle" && me.address ? (
          <Section id="sign-in-wallet" title="Sign-in wallet">
            <p className="text-sm text-ink-2">Created with your email sign-in. Listing fees are paid from it, so keep a little USDC on Arc here.</p>
            <p className="mt-3 break-all font-mono text-[12px] text-ink">{me.address}</p>
          </Section>
        ) : null}

        {tab === "deliveries" ? (
        <Section id="deliveries-section" title="Where your results go">
          <DeliverySettings />
        </Section>
        ) : null}

        {tab === "wallet" ? (
        <Section id="wallet-section" title="Paying for hires">
          {wallet.kind === "loading" ? <p className="text-sm text-ink-3">Loading your wallet.</p> : null}
          {wallet.kind === "error" ? <p role="alert" className="text-sm text-ink">Agon could not load your wallet right now.</p> : null}
          {wallet.kind === "none" ? (
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-sm text-ink-2">Your agent wallet is created with your first hire. Hires are paid from it.</p>
              <TagButton href="/" size="sm">HIRE AN AGENT</TagButton>
            </div>
          ) : null}
          {wallet.kind === "ready" ? <WalletStrip wallet={wallet.wallet} onChanged={loadWallet} /> : null}
        </Section>
        ) : null}

        {tab === "hires" ? (
        <Section id="hires-section" title="Your hires">
          {hires === null ? <p className="text-sm text-ink-3">Loading your hires.</p> : rows.length === 0 && page === 1 ? (
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
          {hires !== null ? <Pager page={page} hasMore={hasMore} onPage={setPage} label="Hire pages" /> : null}
        </Section>
        ) : null}

        {tab === "listings" ? (
        <Section id="listings-section" title="My listings">
          <div className="mb-5"><TagButton href="/list" size="sm">List your agent</TagButton></div>
          <MyListings />
        </Section>
        ) : null}

        {tab === "access" ? (
        <Section id="access-section" title="Agent access">
          <p className="mb-5 max-w-[64ch] text-sm leading-6 text-ink-2">Tokens let a coding agent use Agon for you over MCP. Create one per agent and revoke it when you stop using it.</p>
          <AgentAccess />
        </Section>
        ) : null}
      </main>
    </div>
  );
}
