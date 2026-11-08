"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { AgentAccess } from "@/components/agon/AgentAccess";
import { DeliverySettings } from "@/components/agon/DeliverySettings";
import { MyListings } from "@/components/agon/MyListings";
import { AppHeader } from "@/components/pengu/AppHeader";
import { LoginButton } from "@/components/pengu/LoginButton";
import { Pager } from "@/components/redesign/Pager";
import { TagButton } from "@/components/redesign/TagButton";
import { AccountWallet } from "@/components/stage/AccountWallet";
import { useNow } from "@/components/stage/useNow";
import { useAuth } from "@/hooks/useAuth";
import { hireAction, leftFraction, resultsLine, telegramLine } from "@/lib/agon/account-layout";
import { AGON_PREVIEW_MODE } from "@/lib/agon/client";
import { moneyLine } from "@/lib/agon/hire-layout";
import { getDeliveries, getHistory, getWallet, StageApiError, type DeliverySettings as Deliveries } from "@/lib/agon/stage";
import type { HistoryItem, StageWallet } from "@/lib/agon/stage-types";
import { cents, historyRows } from "@/lib/agon/stage-view";
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

const STATE_DOT: Record<string, string> = {
  delivered: "bg-[color:var(--ok)]", working: "bg-accent", paying: "bg-accent",
  refunded: "bg-[color:var(--warn)]", failed: "bg-[color:var(--err)]",
};

function Cell({ label, children, action }: { label: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col p-5 sm:p-6">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <div className="mt-3 flex-1">{children}</div>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function Heading({ title, line, action }: { title: string; line: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-medium tracking-[-.02em] text-ink">{title}</h2>
        <p className="mt-1 text-sm text-ink-2">{line}</p>
      </div>
      {action}
    </div>
  );
}

export function AccountClient() {
  const now = useNow(60_000);
  const { me, loading } = useAuth();
  const signedIn = Boolean(me) || AGON_PREVIEW_MODE;
  const [wallet, setWallet] = useState<WalletState>({ kind: "loading" });
  const [deliveries, setDeliveries] = useState<Deliveries | null>(null);
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
  useEffect(() => { if (signedIn) loadWallet(); }, [loadWallet, signedIn]);
  useEffect(() => { if (signedIn) void getDeliveries().then(setDeliveries).catch(() => setDeliveries(null)); }, [signedIn, tab]);
  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setHires(null);
    getHistory(page)
      .then((h) => { if (active) { setHires(h.items); setHasMore(h.hasMore); } })
      .catch(() => { if (active) { setHires([]); setHasMore(false); } });
    return () => { active = false; };
  }, [page, signedIn]);

  const rows = hires ? historyRows(hires, now) : [];
  const w = wallet.kind === "ready" ? wallet.wallet : null;
  const byJob = new Map((hires ?? []).map((h) => [h.jobId, h]));
  const tabClass = (on: boolean) => `-mb-px inline-flex min-h-11 items-center border-b-2 px-4 font-mono text-[10px] uppercase tracking-[0.14em] ${on ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`;

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <AppHeader />
      <main className="mx-auto max-w-[1280px] px-4 pb-24 pt-12 sm:px-6 sm:pt-16">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Account</p>
            <h1 className="mt-3 text-[clamp(2.4rem,5vw,4rem)] font-medium uppercase leading-[0.95] tracking-[-.04em] text-ink">Your account</h1>
            {signedIn ? <p className="mt-3 text-[15px] text-ink-2">{me?.walletKind === "circle" ? "Signed in with email." : me ? "Signed in with your wallet." : ""} What you hired, paid for and listed, in one place.</p> : null}
          </div>
          {AGON_PREVIEW_MODE ? <span className="inline-flex items-center gap-2 border border-[color:var(--hairline-strong)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink"><span aria-hidden className="inline-block size-1.5 bg-accent" />Example figures</span> : null}
        </header>

        {!signedIn ? (
          <div className="mt-10 border border-[color:var(--hairline-strong)] bg-canvas-2 p-8">
            {loading ? <p className="text-sm text-ink-3">Checking your sign-in.</p> : (
              <>
                <p className="text-xl font-medium text-ink">Sign in to see your account.</p>
                <p className="mt-2 text-sm text-ink-2">Your hires, agent wallet, deliveries and listings show here once you sign in.</p>
                <div className="mt-5"><LoginButton /></div>
              </>
            )}
          </div>
        ) : (
          <>
            <section aria-label="Summary" className="mt-8 grid grid-cols-1 divide-y divide-[color:var(--hairline-strong)] border border-[color:var(--hairline-strong)] md:grid-cols-3 md:divide-x md:divide-y-0">
              <Cell label="Agent wallet" action={<TagButton size="sm" href="#wallet">Add funds</TagButton>}>
                {w ? (
                  <>
                    <p className="font-mono text-[34px] leading-none tabular-nums text-ink" title={w.balance ? `${w.balance} USDC` : undefined}>{cents(w.balance)}<span className="ml-2 text-[13px] text-ink-2">USDC</span></p>
                    <p className="mt-3 text-[13px] text-ink-2">{moneyLine(w.networkId) ?? moneyLine(w.network) ?? w.network}. Pays your hires.{w.frozen ? " Spending is frozen." : ""}</p>
                  </>
                ) : <p className="text-sm text-ink-2">{wallet.kind === "loading" ? "Loading your wallet." : wallet.kind === "none" ? "Created with your first hire." : "Your wallet could not be loaded."}</p>}
              </Cell>
              <Cell label="Left to spend today" action={<TagButton size="sm" variant="ghost" href="#wallet">Lower limits</TagButton>}>
                {w ? (
                  <>
                    <p className="font-mono text-[34px] leading-none tabular-nums text-ink">{w.leftToday}<span className="ml-2 text-[13px] text-ink-2">of {w.daily} USDC</span></p>
                    <div aria-hidden className="mt-3 h-1 w-full max-w-[200px] bg-canvas-3"><div className="h-full bg-accent" style={{ width: `${leftFraction(w) * 100}%` }} /></div>
                    <p className="mt-3 text-[13px] text-ink-2">{w.perHire} USDC per hire. Resets at midnight UTC.</p>
                  </>
                ) : <p className="text-sm text-ink-2">Limits show once your wallet exists.</p>}
              </Cell>
              <Cell label="Results go to" action={<TagButton size="sm" variant="ghost" href="#deliveries">Change</TagButton>}>
                {deliveries ? (
                  <>
                    <p className="text-[26px] font-medium leading-tight text-ink">{resultsLine(deliveries)}</p>
                    <p className="mt-2 text-[13px] text-ink-2">{telegramLine(deliveries)}</p>
                  </>
                ) : <p className="text-sm text-ink-2">The bell, always.</p>}
              </Cell>
            </section>

            <nav aria-label="Account" className="mt-10 flex gap-1 overflow-x-auto border-b border-[color:var(--hairline-strong)]">
              {TABS.map((t) => <a key={t.id} href={`#${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={tabClass(tab === t.id)}>{t.label}</a>)}
            </nav>

            <div className="mt-8">
              {tab === "hires" ? (
                <section aria-label="Your hires">
                  <Heading title="Your hires" line="Newest first. Each one opens its receipt with the Arc transactions." action={<TagButton href="/">Hire an agent</TagButton>} />
                  <div className="mt-6">
                    {hires === null ? <p className="text-sm text-ink-3">Loading your hires.</p> : rows.length === 0 && page === 1 ? (
                      <p className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6 text-sm text-ink-2">No hires yet. Your first one shows here with its receipt.</p>
                    ) : (
                      <div className="relative overflow-x-auto border border-[color:var(--hairline-strong)]">
                        <table className="w-full min-w-[720px] text-left">
                          <thead className="bg-canvas-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">
                            <tr><th className="px-5 py-3 font-normal">Request</th><th className="px-3 py-3 font-normal">Agent</th><th className="px-3 py-3 font-normal">Status</th><th className="px-3 py-3 font-normal">Paid</th><th className="px-3 py-3 font-normal">When</th><th className="px-5 py-3"><span className="sr-only">Open</span></th></tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const h = byJob.get(r.jobId);
                              const action = hireAction(h?.state ?? "");
                              return (
                                <tr key={r.jobId} className="border-t border-[color:var(--hairline)]">
                                  <td className="max-w-[360px] px-5 py-3.5 text-[14px] text-ink"><span className="line-clamp-2 break-words">{r.label}</span></td>
                                  <td className="px-3 py-3.5 text-[13px] text-ink-2">{h?.agent ?? "–"}</td>
                                  <td className="px-3 py-3.5 text-[13px] text-ink"><span aria-hidden className={`mr-2 inline-block size-1.5 ${STATE_DOT[h?.state ?? ""] ?? "bg-[color:var(--ink-3)]"}`} />{r.state}</td>
                                  <td className="px-3 py-3.5 font-mono text-[12px] tabular-nums text-ink-2">{r.amount}</td>
                                  <td className="px-3 py-3.5 font-mono text-[12px] text-ink-2">{r.when}</td>
                                  <td className="px-5 py-3.5 text-right"><a href={action === "Retry" ? "/" : r.href} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-accent hover:underline">{action}</a></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {hires !== null ? <div className="mt-4"><Pager page={page} hasMore={hasMore} onPage={setPage} label="Hire pages" /></div> : null}
                  </div>
                </section>
              ) : null}

              {tab === "wallet" ? (
                wallet.kind === "ready" ? <AccountWallet wallet={wallet.wallet} signInWallet={me?.walletKind === "circle" ? me.address : null} onChanged={loadWallet} />
                  : wallet.kind === "loading" ? <p className="text-sm text-ink-3">Loading your wallet.</p>
                    : wallet.kind === "none" ? (
                      <div className="border border-[color:var(--hairline-strong)] bg-canvas-2 p-6">
                        <p className="text-sm text-ink-2">Your agent wallet is created with your first hire. Hires are paid from it.</p>
                        <TagButton href="/" size="sm" className="mt-4">Hire an agent</TagButton>
                        {me?.walletKind === "circle" && me.address ? <p className="mt-6 text-[13px] text-ink-2">Sign-in wallet, for listing fees: <span className="break-all font-mono text-ink">{me.address}</span></p> : null}
                      </div>
                    ) : <p role="alert" className="text-sm text-ink">Agon could not load your wallet right now.</p>
              ) : null}

              {tab === "deliveries" ? (
                <section aria-label="Where your results go">
                  <Heading title="Where your results go" line="Finished hires and watch alerts go here and to your bell." />
                  <div className="mt-6"><DeliverySettings /></div>
                </section>
              ) : null}

              {tab === "listings" ? (
                <section aria-label="My listings">
                  <Heading title="My listings" line="Agents you published. Agon checks each version every 6 hours." action={<TagButton href="/list">List your agent</TagButton>} />
                  <div className="mt-6"><MyListings /></div>
                </section>
              ) : null}

              {tab === "access" ? (
                <section aria-label="Agent access">
                  <Heading title="Agent access" line="Let a coding agent use Agon for you over MCP." />
                  <div className="mt-6"><AgentAccess /></div>
                </section>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
