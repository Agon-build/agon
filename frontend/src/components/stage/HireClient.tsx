"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Composer } from "@/components/stage/Composer";
import { PhaseRail } from "@/components/stage/PhaseRail";
import { QuoteCard } from "@/components/stage/QuoteCard";
import { RunView } from "@/components/stage/RunView";
import { StageShell } from "@/components/stage/StageShell";
import { TermsPanel } from "@/components/stage/TermsPanel";
import { TopUpPanel } from "@/components/stage/TopUpPanel";
import { WalletStrip } from "@/components/stage/WalletStrip";
import { useLiveJob } from "@/components/stage/useLiveJob";
import { useNow } from "@/components/stage/useNow";
import { useAuth } from "@/hooks/useAuth";
import { askLead, confirmHire, getHistory, getLeaderboard, getStageConfig, getWallet, StageApiError } from "@/lib/agon/stage";
import { canAfford } from "@/lib/agon/hire-panel";
import { askRefusalText, confirmFailureText } from "@/lib/agon/stage-copy";
import type { AskResponse, HistoryItem, LeaderboardRow, StageConfig, StageWallet } from "@/lib/agon/stage-types";
import { beatsMarketText, phaseStep } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
type Mode =
  | { kind: "idle" }
  | { kind: "quoting"; question: string }
  | { kind: "quote"; question: string; quote: Quote }
  | { kind: "refused"; question: string; maxPrice: string | null; code: string; amount?: string }
  | { kind: "run"; jobId: string; question: string | null; paying: boolean; confirmError: string | null };

export function HireClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useAuth();
  const now = useNow();
  const resumeJob = params?.get("job") ?? null;
  const stageQuery = params?.get("stage") === "1" ? "&stage=1" : "";
  const [config, setConfig] = useState<StageConfig | null>(null);
  const [wallet, setWallet] = useState<StageWallet | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [best, setBest] = useState<LeaderboardRow | null>(null);
  const [mode, setMode] = useState<Mode>(resumeJob ? { kind: "run", jobId: resumeJob, question: null, paying: false, confirmError: null } : { kind: "idle" });
  const { live, error: liveError } = useLiveJob(mode.kind === "run" ? mode.jobId : null, { active: mode.kind === "run" && mode.paying });

  const canAct = Boolean(me) || Boolean(config?.preview);
  const refreshWallet = useCallback(() => {
    if (!canAct) return;
    getWallet().then(setWallet).catch(() => setWallet(null));
    getHistory(1, 3).then((h) => setHistory(h.items)).catch(() => setHistory([]));
  }, [canAct]);

  useEffect(() => {
    getStageConfig().then(setConfig).catch(() => setConfig(null));
    getLeaderboard().then((b) => setBest(b.rows.find((r) => r.ranked && !r.displayName.includes("market copy")) ?? null)).catch(() => setBest(null));
  }, []);
  useEffect(() => { refreshWallet(); }, [refreshWallet]);

  async function ask(question: string, maxPrice: string | null) {
    setMode({ kind: "quoting", question });
    try {
      const quote = await askLead(question, maxPrice ?? undefined);
      if (quote.ok) setMode({ kind: "quote", question, quote });
      else setMode({ kind: "refused", question, maxPrice, code: quote.code, amount: quote.amount });
      refreshWallet();
    } catch (e) {
      setMode({ kind: "refused", question, maxPrice, code: e instanceof StageApiError ? e.code : "network_unavailable" });
    }
  }

  // Short wallet: watch the balance, and ask again with the same question once it covers the price.
  const shortOf = mode.kind === "refused" && mode.code === "insufficient_balance" && mode.amount ? mode.amount : null;
  const retriedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!shortOf) { retriedAt.current = null; return; }
    const timer = window.setInterval(() => { getWallet().then(setWallet).catch(() => {}); }, 4_000);
    return () => window.clearInterval(timer);
  }, [shortOf]);
  useEffect(() => {
    if (mode.kind !== "refused" || !shortOf || !wallet || !canAfford(shortOf, wallet.balance)) return;
    if (retriedAt.current === wallet.balance) return;
    retriedAt.current = wallet.balance;
    void ask(mode.question, mode.maxPrice);
  }, [shortOf, wallet]);

  async function pay(quote: Quote, question: string) {
    if (quote.step !== "confirm_code") return;
    setMode({ kind: "run", jobId: quote.jobId, question, paying: true, confirmError: null });
    router.replace(`/?job=${quote.jobId}${stageQuery}`, { scroll: false });
    try {
      const out = await confirmHire(quote.jobId, quote.code);
      setMode({ kind: "run", jobId: quote.jobId, question, paying: false, confirmError: out.ok ? null : out.code });
    } catch (e) {
      setMode({ kind: "run", jobId: quote.jobId, question, paying: false, confirmError: e instanceof StageApiError ? e.code : "network_unavailable" });
    }
    refreshWallet();
  }

  function reset() {
    setMode({ kind: "idle" });
    router.replace(`/${stageQuery ? "?stage=1" : ""}`, { scroll: false });
  }

  // While the payment is in flight the job can still read "quoted"; show it as paying, not as unpaid.
  const shown = live && mode.kind === "run" && mode.paying && live.phase === "quoted" ? { ...live, phase: "paying" as const } : live;
  const question = mode.kind === "idle" ? null : mode.kind === "run" ? (mode.question ?? live?.question ?? null) : mode.question;
  const step = mode.kind === "idle" ? 0 : mode.kind === "run" ? phaseStep(shown?.phase ?? "paying") : 1;
  const working = mode.kind === "run" && (shown ? shown.phase === "paying" || shown.phase === "working" : true);

  return (
    <StageShell network={config?.network ?? null} preview={config?.preview}>
      <div className="mx-auto max-w-[1536px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        {canAct && wallet ? <WalletStrip wallet={wallet} onChanged={refreshWallet} /> : null}
        {mode.kind === "run" ? <div className="mt-6"><PhaseRail step={step} working={working} /></div> : null}

        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Hire{config ? ` · ${config.network}` : ""}</p>
            <h1 className={`mt-4 font-display uppercase tracking-[-.04em] text-ink ${question ? "max-w-[24ch] text-[clamp(1.6rem,2.8vw,2.5rem)] leading-[1.05]" : "max-w-[10ch] text-[clamp(3rem,7vw,6.5rem)] leading-[.86]"}`}>
              {question ?? "Describe it"}
            </h1>
            {mode.kind === "idle" || mode.kind === "quoting" ? (
              <div className="mt-10"><Composer disabled={mode.kind === "quoting"} signedIn={canAct} onSubmit={ask} /></div>
            ) : null}
            {mode.kind === "refused" && !shortOf && mode.code !== "terms_required" ? (
              <div role="alert" className="stage-print mt-8 border-y border-[color:var(--hairline-strong)] py-6">
                <p className="text-base leading-7 text-ink">{askRefusalText(mode.code, mode.amount)}</p>
                <button type="button" onClick={reset} className="mt-4 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Describe something else</button>
              </div>
            ) : null}
            {mode.kind === "run" && mode.confirmError ? (
              <p role="alert" className="mt-6 border-l-2 border-[color:var(--err)] pl-3 text-sm leading-6 text-ink">{confirmFailureText(mode.confirmError)}</p>
            ) : null}
          </div>

          <div className="min-w-0">
            {mode.kind === "idle" || mode.kind === "quoting" ? (
              <aside aria-labelledby="how-heading" className="border-y border-[color:var(--hairline-strong)] py-6">
                <h2 id="how-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">How it works</h2>
                <ol className="mt-4 divide-y divide-[color:var(--hairline)]">
                  {[
                    ["01", "You ask in plain words and see the price before anything is paid."],
                    ["02", "The Agon Lead Agent buys live data and haggles with the best Season 1 forecaster."],
                    ["03", "Every payment lands on Arc with its transaction. If nothing can be delivered, you are refunded."],
                  ].map(([n, text]) => <li key={n} className="grid grid-cols-[2.5rem_1fr] py-3 text-sm leading-6 text-ink-2"><span className="font-mono text-[11px] text-accent">{n}</span>{text}</li>)}
                </ol>
                {best ? (
                  <a href="/arena/season-1" className="group mt-6 block border border-[color:var(--hairline)] p-4 hover:border-accent">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Top of Season 1 right now</p>
                    <p className="mt-2 font-display text-2xl uppercase leading-tight text-ink">{best.displayName}</p>
                    <p className="mt-1 text-sm text-ink-2">{beatsMarketText(best)}</p>
                    <span className="mt-3 inline-flex font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3 group-hover:text-accent">See the leaderboard →</span>
                  </a>
                ) : null}
              </aside>
            ) : null}
            {mode.kind === "quote" ? <QuoteCard quote={mode.quote} nowMs={now} paying={false} onPay={() => void pay(mode.quote, mode.question)} onCancel={reset} /> : null}
            {mode.kind === "refused" && mode.code === "terms_required" ? <TermsPanel onAccepted={() => void ask(mode.question, mode.maxPrice)} onCancel={reset} /> : null}
            {shortOf ? <TopUpPanel wallet={wallet} price={shortOf} onFunded={refreshWallet} onCancel={reset} /> : null}
          </div>
        </div>

        {mode.kind === "run" ? (
          <div className="mt-14">
            {shown ? <RunView live={shown} /> : <p className="text-sm text-ink-3">{liveError ? "Agon could not load this job." : "Loading the job."}</p>}
            {live ? (
              <div className="mt-12 flex flex-wrap gap-4 border-t border-[color:var(--hairline-strong)] pt-6">
                <a href={`/r/${live.jobId}`} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:text-accent">Open the receipt →</a>
                <a href="/arena/season-1" className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Season 1 leaderboard →</a>
                <button type="button" onClick={reset} className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Hire again</button>
              </div>
            ) : null}
          </div>
        ) : null}

        {canAct && history.length > 0 && mode.kind !== "run" ? (
          <section aria-labelledby="history-heading" className="mt-20">
            <h2 id="history-heading" className="border-b border-[color:var(--hairline-strong)] pb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Your recent hires</h2>
            <ul className="divide-y divide-[color:var(--hairline)]">
              {history.slice(0, 3).map((h) => (
                <li key={h.jobId}>
                  <a href={`/r/${h.jobId}`} className="grid min-h-11 gap-1 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6 hover:text-accent">
                    <span className="text-sm text-ink">{h.question ?? "Agent job"}</span>
                    <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">{h.state}</span>
                    <span className="font-mono text-[12px] tabular-nums text-ink-2">{h.price} USDC</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </StageShell>
  );
}
