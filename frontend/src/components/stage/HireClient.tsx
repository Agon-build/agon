"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Composer } from "@/components/stage/Composer";
import { PhaseRail } from "@/components/stage/PhaseRail";
import { QuoteCard } from "@/components/stage/QuoteCard";
import { RouteCard } from "@/components/stage/RouteCard";
import { RunView } from "@/components/stage/RunView";
import { StageShell } from "@/components/stage/StageShell";
import { TermsPanel } from "@/components/stage/TermsPanel";
import { TopUpPanel } from "@/components/stage/TopUpPanel";
import { WalletStrip } from "@/components/stage/WalletStrip";
import { useLiveJob } from "@/components/stage/useLiveJob";
import { useNow } from "@/components/stage/useNow";
import { LoginButton } from "@/components/pengu/LoginButton";
import { useAuth } from "@/hooks/useAuth";
import { confirmHire, getHistory, getLeaderboard, getStageConfig, getWallet, quoteRoute, routeDirect, routeRequest, StageApiError } from "@/lib/agon/stage";
import { presentListing } from "@/lib/agon/catalog";
import { getListing, inspectManifest } from "@/lib/agon/client";
import { canAfford } from "@/lib/agon/hire-panel";
import { mainnetInView, mergeAnswers, sourcesNote } from "@/lib/agon/route-view";
import { askRefusalText, confirmFailureText, hireHeading, showConfirmError } from "@/lib/agon/stage-copy";
import type { AskResponse, HistoryItem, LeaderboardRow, RoutePick, StageConfig, StageWallet } from "@/lib/agon/stage-types";
import { beatsMarketText, phaseStep } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
/// Agon's pick for a request, before the exact price is asked for.
type Routed = { kind: "routed"; question: string; routeId: string; pick: RoutePick; alternatives: RoutePick[]; missing: string[]; prompt: string | null; busy: boolean; answers: Record<string, string>; note: string | null };
type Mode =
  | { kind: "idle" }
  | { kind: "quoting"; question: string }
  | Routed
  | { kind: "quote"; question: string; quote: Quote }
  | { kind: "refused"; question: string; maxPrice: string | null; code: string; amount?: string; network?: "arc-testnet" | "arc"; back?: Routed; note?: string | null }
  | { kind: "run"; jobId: string; question: string | null; paying: boolean; confirmError: string | null; mainnet: boolean };

export function HireClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, refresh } = useAuth();
  const now = useNow();
  const resumeJob = params?.get("job") ?? null;
  // An agent the person chose on its page: their task goes to it, with no routing fee.
  const agentRef = params?.get("agent") ?? null;
  const [agentName, setAgentName] = useState<string | null>(null);
  const stageQuery = params?.get("stage") === "1" ? "&stage=1" : "";
  const [config, setConfig] = useState<StageConfig | null>(null);
  const [wallet, setWallet] = useState<StageWallet | null>(null);
  const [mainnetWallet, setMainnetWallet] = useState<StageWallet | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [best, setBest] = useState<LeaderboardRow | null>(null);
  const [mode, setMode] = useState<Mode>(resumeJob ? { kind: "run", jobId: resumeJob, question: null, paying: false, confirmError: null, mainnet: false } : { kind: "idle" });
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
  useEffect(() => {
    if (!agentRef) { setAgentName(null); return; }
    setAgentName(null);
    let live = true;
    // The catalog may return the listing without its service file; read the file for the name, as the agent page does.
    getListing(agentRef)
      .then(async (l) => {
        if (l.manifest.body !== undefined) return presentListing(l).name;
        const read = await inspectManifest(l.manifest.uri).catch(() => null);
        return presentListing(read?.validation.ok ? { ...l, manifest: { ...l.manifest, body: read.body } } : l).name;
      })
      .then((name) => { if (live) setAgentName(name); })
      .catch(() => { if (live) setAgentName("this agent"); });
    return () => { live = false; };
  }, [agentRef]);

  const refreshMainnet = useCallback(() => { getWallet("arc").then(setMainnetWallet).catch(() => {}); }, []);

  // Agon reads the request and picks: forecasts go to the Lead, anything else to the best fit across Agon and Circle.
  async function ask(question: string, maxPrice: string | null) {
    setMode({ kind: "quoting", question });
    try {
      const routed = agentRef ? await routeDirect(agentRef, question) : await routeRequest(question);
      if (routed.kind === "pick") {
        setMode({ kind: "routed", question, routeId: routed.routeId, pick: routed.pick, alternatives: routed.alternatives, missing: [], prompt: null, busy: false, answers: {}, note: sourcesNote(routed.sources) });
        if (routed.pick.network === "arc" || routed.alternatives.some((a) => a.network === "arc")) refreshMainnet();
      } else if (routed.kind === "none") {
        setMode({ kind: "refused", question, maxPrice, code: "no_match", note: sourcesNote(routed.sources) });
      } else if (routed.kind === "lead") {
        const quote = routed as AskResponse;
        if (quote.ok && maxPrice && !canAfford(quote.total ?? quote.amount, maxPrice)) setMode({ kind: "refused", question, maxPrice, code: "over_your_max", amount: quote.total ?? quote.amount });
        else if (quote.ok) setMode({ kind: "quote", question, quote });
        else setMode({ kind: "refused", question, maxPrice, code: quote.code ?? "network_unavailable", amount: quote.amount });
      } else {
        setMode({ kind: "refused", question, maxPrice, code: routed.code });
      }
      refreshWallet();
    } catch (e) {
      const code = e instanceof StageApiError ? e.code : "network_unavailable";
      // A lapsed session: show the page signed out so the sign-in button appears.
      if (code === "unauthorized") void refresh();
      setMode({ kind: "refused", question, maxPrice, code });
    }
  }

  // The exact price for the chosen service, with the person's answer laid over the filled input.
  async function quoteRouted(prev: Routed, add?: Record<string, string>) {
    // Every answer given so far goes with each quote, so a second question never undoes the first.
    const r = { ...prev, answers: mergeAnswers(prev.answers, add), busy: false };
    setMode({ ...r, busy: true });
    try {
      const quote = await quoteRoute(r.routeId, r.pick.reference, Object.keys(r.answers).length > 0 ? r.answers : undefined);
      if (quote.ok) setMode({ kind: "quote", question: r.question, quote });
      else if (quote.code === "missing_input") setMode({ ...r, missing: quote.missing ?? [], prompt: quote.question ?? null });
      else setMode({ kind: "refused", question: r.question, maxPrice: null, code: quote.code, amount: quote.amount, network: quote.network, back: r });
    } catch (e) {
      const code = e instanceof StageApiError ? e.code : "network_unavailable";
      if (code === "unauthorized") void refresh();
      setMode({ kind: "refused", question: r.question, maxPrice: null, code, back: r });
    }
    refreshWallet();
    if (r.pick.network === "arc") refreshMainnet();
  }

  function swap(r: Routed, next: RoutePick) {
    setMode({ ...r, pick: next, alternatives: [r.pick, ...r.alternatives.filter((a) => a.reference !== next.reference)], missing: [], prompt: null, answers: {} });
    if (next.network === "arc") refreshMainnet();
  }

  function retry(m: Extract<Mode, { kind: "refused" }>) {
    if (m.back) void quoteRouted(m.back);
    else void ask(m.question, m.maxPrice);
  }

  // Signed in again after a lapsed session: ask the same question once more (once per question).
  const signInRetried = useRef<string | null>(null);
  useEffect(() => {
    if (mode.kind !== "refused" || signInRetried.current === mode.question) return;
    if (mode.code === "unauthorized" && me) {
      signInRetried.current = mode.question;
      retry(mode);
    }
  }, [me]);

  // Short wallet: watch the balance on the hire's network, and ask again once it covers the price.
  const shortOf = mode.kind === "refused" && mode.code === "insufficient_balance" && mode.amount ? mode.amount : null;
  const shortMainnet = mode.kind === "refused" && mode.network === "arc";
  const shortWallet = shortMainnet ? mainnetWallet : wallet;
  const retriedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!shortOf) { retriedAt.current = null; return; }
    const poll = () => (shortMainnet ? getWallet("arc").then(setMainnetWallet) : getWallet().then(setWallet)).catch(() => {});
    poll();
    const timer = window.setInterval(poll, 4_000);
    return () => window.clearInterval(timer);
  }, [shortOf, shortMainnet]);
  useEffect(() => {
    if (mode.kind !== "refused" || !shortOf || !shortWallet || !canAfford(shortOf, shortWallet.balance)) return;
    if (retriedAt.current === shortWallet.balance) return;
    retriedAt.current = shortWallet.balance;
    retry(mode);
  }, [shortOf, shortWallet]);

  async function pay(quote: Quote, question: string) {
    if (quote.step !== "confirm_code") return;
    const mainnet = !quote.testnet;
    setMode({ kind: "run", jobId: quote.jobId, question, paying: true, confirmError: null, mainnet });
    router.replace(`/?job=${quote.jobId}${stageQuery}`, { scroll: false });
    try {
      const out = await confirmHire(quote.jobId, quote.code);
      setMode({ kind: "run", jobId: quote.jobId, question, paying: false, confirmError: out.ok ? null : out.code, mainnet });
    } catch (e) {
      setMode({ kind: "run", jobId: quote.jobId, question, paying: false, confirmError: e instanceof StageApiError ? e.code : "network_unavailable", mainnet });
    }
    refreshWallet();
    if (mainnet) refreshMainnet();
  }

  function reset() {
    setMode({ kind: "idle" });
    router.replace(agentRef ? `/?agent=${encodeURIComponent(agentRef)}` : `/${stageQuery ? "?stage=1" : ""}`, { scroll: false });
  }

  // While the payment is in flight the job can still read "quoted"; show it as paying, not as unpaid.
  const shown = live && mode.kind === "run" && mode.paying && live.phase === "quoted" ? { ...live, phase: "paying" as const } : live;
  const question = mode.kind === "idle" ? null : mode.kind === "run" ? (mode.question ?? live?.question ?? null) : mode.question;
  const heading = hireHeading(question, live?.receipt?.label ?? agentName ?? null);
  const step = mode.kind === "idle" ? 0 : mode.kind === "run" ? phaseStep(shown?.phase ?? "paying") : 1;
  // The mainnet wallet strip shows while a mainnet service is on screen.
  const onMainnet = mainnetInView({
    kind: mode.kind,
    ...(mode.kind === "routed" ? { pickNetwork: mode.pick.network } : {}),
    ...(mode.kind === "quote" ? { testnet: mode.quote.testnet } : {}),
    ...(mode.kind === "refused" ? { network: mode.network } : {}),
    ...(mode.kind === "run" ? { mainnet: mode.mainnet || live?.network === "Arc" } : {}),
  });
  const working = mode.kind === "run" && (shown ? shown.phase === "paying" || shown.phase === "working" : true);

  return (
    <StageShell network={config?.network ?? null} preview={config?.preview}>
      <div className="mx-auto max-w-[1536px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        {canAct && wallet && !onMainnet ? <WalletStrip wallet={wallet} onChanged={refreshWallet} /> : null}
        {canAct && mainnetWallet && onMainnet ? <WalletStrip wallet={mainnetWallet} onChanged={refreshMainnet} /> : null}
        {mode.kind === "run" ? <div className="mt-6"><PhaseRail step={step} working={working} /></div> : null}

        <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-16">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Hire{onMainnet ? " · Arc mainnet" : config ? ` · ${config.network}` : ""}</p>
            <h1 className={`mt-4 text-balance font-display uppercase tracking-[-.04em] text-ink ${heading.title ? "text-[clamp(1.6rem,2.8vw,2.5rem)] leading-[1.05]" : "text-[clamp(2.4rem,5vw,4.5rem)] leading-[.9]"}`}>
              {heading.title ?? (agentRef ? `Hire ${agentName ?? "this agent"}` : "Ask about any Polymarket market")}
            </h1>
            {heading.lines ? (
              <ul className="mt-4 space-y-1 break-all font-mono text-[13px] leading-6 text-ink-2">
                {heading.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : null}
            {mode.kind === "idle" || mode.kind === "quoting" ? (
              <div className="mt-10"><Composer disabled={mode.kind === "quoting"} signedIn={canAct} onSubmit={ask} agentName={agentRef ? (agentName ?? "this agent") : null} /></div>
            ) : null}
            {mode.kind === "refused" && !shortOf && mode.code !== "terms_required" ? (
              <div role="alert" className="stage-print mt-8 border-y border-[color:var(--hairline-strong)] py-6">
                <p className="text-base leading-7 text-ink">{askRefusalText(mode.code, mode.amount)}</p>
                {mode.note ? <p className="mt-2 text-sm leading-6 text-ink-2">{mode.note}</p> : null}
                {mode.code === "unauthorized" && !me ? <div className="mt-4"><LoginButton /></div> : null}
                <button type="button" onClick={reset} className="mt-4 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Describe something else</button>
              </div>
            ) : null}
            {mode.kind === "run" && showConfirmError(mode.confirmError, shown?.phase) ? (
              <p role="alert" className="mt-6 border-l-2 border-[color:var(--err)] pl-3 text-sm leading-6 text-ink">{confirmFailureText(mode.confirmError!)}</p>
            ) : null}
          </div>

          <div className="min-w-0">
            {(mode.kind === "idle" || mode.kind === "quoting") && agentRef ? (
              <aside aria-labelledby="chosen-heading" className="border-y border-[color:var(--hairline-strong)] py-6">
                <h2 id="chosen-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">You chose {agentName ?? "this agent"}</h2>
                <p className="mt-4 text-sm leading-6 text-ink-2">You pay its price and no Agon routing fee. You see the price before anything is paid.</p>
                <a href={`/agents/${encodeURIComponent(agentRef)}`} className="mt-4 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Back to the agent</a>
              </aside>
            ) : null}
            {(mode.kind === "idle" || mode.kind === "quoting") && !agentRef ? (
              <aside aria-labelledby="how-heading" className="border-y border-[color:var(--hairline-strong)] py-6">
                <h2 id="how-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">How it works</h2>
                <ol className="mt-4 divide-y divide-[color:var(--hairline)]">
                  {[
                    ["01", "Ask about a Polymarket market: a match, an election, a price."],
                    ["02", "See the full price, Agon's fee included, before anything is paid."],
                    ["03", "Watch the agents work. Every payment shows its Arc transaction. If no market matches, your money comes back."],
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
            {mode.kind === "routed" ? (
              <RouteCard
                pick={mode.pick} alternatives={mode.alternatives} question={mode.prompt} missing={mode.missing} busy={mode.busy} note={mode.note}
                onSwap={(p) => swap(mode, p)} onQuote={(answers) => void quoteRouted(mode, answers)} onCancel={reset}
              />
            ) : null}
            {mode.kind === "quote" ? <QuoteCard quote={mode.quote} nowMs={now} paying={false} onPay={() => void pay(mode.quote, mode.question)} onCancel={reset} /> : null}
            {mode.kind === "refused" && mode.code === "terms_required" ? <TermsPanel onAccepted={() => retry(mode)} onCancel={reset} /> : null}
            {shortOf ? <TopUpPanel wallet={shortWallet} price={shortOf} onFunded={shortMainnet ? refreshMainnet : refreshWallet} onCancel={reset} /> : null}
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
