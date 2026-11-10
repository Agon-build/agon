"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CategorySelect } from "@/components/stage/CategorySelect";
import { LiveMarkets } from "@/components/stage/LiveMarkets";
import { ChoiceList } from "@/components/stage/ChoiceList";
import { Composer } from "@/components/stage/Composer";
import { PhaseRail } from "@/components/stage/PhaseRail";
import { RatePanel } from "@/components/stage/RatePanel";
import { Pager } from "@/components/redesign/Pager";
import { TagButton } from "@/components/redesign/TagButton";
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
import { confirmHire, getCategories, getHistory, getStageConfig, getWallet, quoteRoute, routeDirect, routeRequest, StageApiError } from "@/lib/agon/stage";
import { presentListing } from "@/lib/agon/catalog";
import { getListing, inspectManifest } from "@/lib/agon/client";
import { canAfford } from "@/lib/agon/hire-panel";
import { hasFee, mainnetInView, mergeAnswers, sourcesNote } from "@/lib/agon/route-view";
import { askRefusalText, CHOICES_COPY, confirmFailureText, hireHeading, showConfirmError } from "@/lib/agon/stage-copy";
import type { AskResponse, ChoiceGroups, HireCategory, HireCategoryId, HistoryItem, RoutePick, RouteSourceStatus, StageConfig, StageWallet } from "@/lib/agon/stage-types";
import { hireLabel, hireStateText, phaseStep } from "@/lib/agon/stage-view";

type Quote = Extract<AskResponse, { ok: true }>;
/// Agon's pick for a request, before the exact price is asked for.
/// The choices for a request or a browsed category; typed is null when the person browsed.
type Choices = { kind: "choices"; question: string; typed: string | null; routeId: string; category: HireCategoryId; groups: ChoiceGroups; sources: RouteSourceStatus[]; busy: boolean };
type Routed = { kind: "routed"; question: string; routeId: string; pick: RoutePick; alternatives: RoutePick[]; missing: string[]; prompt: string | null; busy: boolean; answers: Record<string, string>; note: string | null; choices?: Choices };
type Mode =
  | { kind: "idle" }
  | { kind: "quoting"; question: string }
  | Choices
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
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [categories, setCategories] = useState<HireCategory[]>([]);
  useEffect(() => { getCategories().then(setCategories).catch(() => setCategories([])); }, []);
  const [mode, setMode] = useState<Mode>(resumeJob ? { kind: "run", jobId: resumeJob, question: null, paying: false, confirmError: null, mainnet: false } : { kind: "idle" });
  // The page follows the address: a job link opens that job, and HIRE in the nav (no job)
  // leaves a finished job for a fresh start. A payment in flight is never left this way.
  useEffect(() => {
    setMode((m) => {
      if (resumeJob) return m.kind === "run" && m.jobId === resumeJob ? m : { kind: "run", jobId: resumeJob, question: null, paying: false, confirmError: null, mainnet: false };
      return m.kind === "run" && !m.paying ? { kind: "idle" } : m;
    });
  }, [resumeJob]);
  const { live, error: liveError } = useLiveJob(mode.kind === "run" ? mode.jobId : null, { active: mode.kind === "run" && mode.paying });

  const canAct = Boolean(me) || Boolean(config?.preview);
  const refreshWallet = useCallback(() => {
    if (!canAct) return;
    getWallet().then(setWallet).catch(() => setWallet(null));
    getHistory(historyPage, 5).then((h) => { setHistory(h.items); setHistoryMore(h.hasMore); }).catch(() => { setHistory([]); setHistoryMore(false); });
  }, [canAct, historyPage]);

  useEffect(() => {
    getStageConfig().then(setConfig).catch(() => setConfig(null));
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
  async function ask(question: string, maxPrice: string | null, category?: HireCategoryId, typed: string | null = question) {
    setMode({ kind: "quoting", question });
    try {
      const routed = agentRef ? await routeDirect(agentRef, question) : await routeRequest(typed, category);
      if (routed.kind === "choices") {
        setMode({ kind: "choices", question, typed, routeId: routed.routeId, category: routed.category, groups: routed.groups, sources: routed.sources, busy: false });
        if (routed.groups.outside.length > 0) refreshMainnet();
      } else if (routed.kind === "pick") {
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

  // Browse a category with nothing typed, or move a typed request to another category.
  function browse(category: HireCategoryId, typed: string | null = null) {
    const label = categories.find((c) => c.id === category)?.label ?? "Agents";
    void ask(typed ?? label, null, category, typed);
  }

  function choose(c: Choices, pick: RoutePick) {
    setMode({ kind: "routed", question: c.question, routeId: c.routeId, pick, alternatives: [], missing: [], prompt: null, busy: false, answers: {}, note: null, choices: c });
    if (pick.network === "arc") refreshMainnet();
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
  // Ask, Choose, Pay, Answer: the price and any top-up or terms are the Pay step.
  const step = mode.kind === "idle" || mode.kind === "quoting" ? 0 : mode.kind === "run" ? phaseStep(shown?.phase ?? "paying") : mode.kind === "quote" || (mode.kind === "refused" && (mode.code === "terms_required" || Boolean(shortOf))) ? 2 : 1;
  // The mainnet wallet strip shows while a mainnet service is on screen.
  const onMainnet = mainnetInView({
    kind: mode.kind,
    ...(mode.kind === "routed" ? { pickNetwork: mode.pick.network } : {}),
    ...(mode.kind === "quote" ? { testnet: mode.quote.testnet } : {}),
    ...(mode.kind === "refused" ? { network: mode.network } : {}),
    ...(mode.kind === "run" ? { mainnet: mode.mainnet || live?.network === "Arc" } : {}),
  });
  const working = mode.kind === "run" && (shown ? shown.phase === "paying" || shown.phase === "working" : true);

  const direct = Boolean(agentRef);
  const backLabel = mode.kind === "routed" && mode.choices ? "Back to choices" : "Cancel";
  const listed = mode.kind === "choices" ? mode : mode.kind === "routed" ? mode.choices ?? null : null;
  const selected = mode.kind === "routed" ? mode.pick.reference : null;
  const start = mode.kind === "idle" || mode.kind === "quoting";
  const hasPanel = mode.kind === "routed" || mode.kind === "quote" || (mode.kind === "refused" && (mode.code === "terms_required" || Boolean(shortOf)));

  return (
    <StageShell network={config?.network ?? null} preview={config?.preview}>
      <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
        {canAct && wallet && !onMainnet ? <WalletStrip wallet={wallet} onChanged={refreshWallet} /> : null}
        {canAct && mainnetWallet && onMainnet ? <WalletStrip wallet={mainnetWallet} onChanged={refreshMainnet} /> : null}
        <div className="mt-6"><PhaseRail step={step} working={working} /></div>

        {start ? (
          <div className="mx-auto mt-16 max-w-[800px] text-center sm:mt-20">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Hire{onMainnet ? " · Arc mainnet" : config ? ` · ${config.network}` : ""}</p>
            <h1 className="mt-5 text-balance text-[clamp(2.4rem,5.4vw,4.25rem)] font-medium leading-[1] tracking-[-.045em] text-ink">
              {agentRef ? `Hire ${agentName ?? "this agent"}` : "What do you need done?"}
            </h1>
            <div className="mt-6 text-left">
              <Composer disabled={mode.kind === "quoting"} signedIn={canAct} categories={agentRef ? [] : categories} onSubmit={(q, max, cat) => void ask(q, max, cat)} agentName={agentRef ? (agentName ?? "this agent") : null} />
            </div>
            {mode.kind === "quoting" ? <p role="status" className="mt-4 text-sm text-ink-2">{CHOICES_COPY.loading}</p> : null}
            {agentRef ? (
              <aside aria-labelledby="chosen-heading" className="mt-8 border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 text-left">
                <h2 id="chosen-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">You chose {agentName ?? "this agent"}</h2>
                <p className="mt-3 text-sm leading-6 text-ink-2">You pay its price and no Agon routing fee. You see the price before anything is paid.</p>
                <a href={`/agents/${encodeURIComponent(agentRef)}`} className="mt-2 inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Back to the agent</a>
              </aside>
            ) : null}
          </div>
        ) : null}
        {start && !agentRef ? <LiveMarkets disabled={mode.kind === "quoting" || !canAct} onPick={(request) => void ask(request, null, "prediction")} /> : null}
        {start && !agentRef ? <CategorySelect categories={categories} disabled={mode.kind === "quoting" || !canAct} onPick={(id) => browse(id)} /> : null}

        {!start && mode.kind !== "run" ? (
          <div className="mt-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">You asked</p>
            <h1 className="mt-2 break-words text-balance text-[clamp(1.5rem,2.6vw,2rem)] font-medium leading-tight tracking-[-.02em] text-ink">
              {heading.title ?? question ?? "Your hire"}
            </h1>
            {heading.lines ? (
              <ul className="mt-3 space-y-1 break-all font-mono text-[13px] leading-6 text-ink-2">
                {heading.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : null}
            <div className={`mt-6 grid gap-6 ${hasPanel ? "lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]" : ""}`}>
              <div className="min-w-0">
                {listed ? (
                  <ChoiceList
                    category={listed.category} categories={categories} groups={listed.groups} sources={listed.sources} busy={listed.busy || (mode.kind === "routed" && mode.busy)} selected={selected}
                    onChoose={(p) => choose(listed, p)} onCategory={(id) => browse(id, listed.typed)} onCancel={reset}
                  />
                ) : null}
                {mode.kind === "refused" && !shortOf && mode.code !== "terms_required" ? (
                  <div role="alert" className="stage-print border border-[color:var(--hairline-strong)] bg-canvas-2 p-5 sm:p-6">
                    <p className="text-base leading-7 text-ink">{askRefusalText(mode.code, mode.amount)}</p>
                    {mode.note ? <p className="mt-2 text-sm leading-6 text-ink-2">{mode.note}</p> : null}
                    {mode.code === "unauthorized" && !me ? <div className="mt-4"><LoginButton /></div> : null}
                    <button type="button" onClick={reset} className="mt-4 min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Describe something else</button>
                  </div>
                ) : null}
                {!listed && hasPanel ? (
                  <button type="button" onClick={reset} className="min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent">Describe something else</button>
                ) : null}
              </div>
              {hasPanel ? (
                <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                  {mode.kind === "routed" ? (
                    <RouteCard
                      pick={mode.pick} alternatives={mode.alternatives} question={mode.prompt} missing={mode.missing} busy={mode.busy} note={mode.note}
                      direct={direct && !hasFee(mode.pick.fee)}
                      onSwap={(p) => swap(mode, p)} onQuote={(answers) => void quoteRouted(mode, answers)}
                      onCancel={() => (mode.choices ? setMode(mode.choices) : reset())}
                      cancelLabel={backLabel}
                    />
                  ) : null}
                  {mode.kind === "quote" ? <QuoteCard quote={mode.quote} nowMs={now} paying={false} direct={direct} onPay={() => void pay(mode.quote, mode.question)} onCancel={reset} /> : null}
                  {mode.kind === "refused" && mode.code === "terms_required" ? <TermsPanel onAccepted={() => retry(mode)} onCancel={reset} /> : null}
                  {shortOf ? <TopUpPanel wallet={shortWallet} price={shortOf} onFunded={shortMainnet ? refreshMainnet : refreshWallet} onCancel={reset} /> : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode.kind === "run" ? (
          <div className="mt-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{shown?.phase === "answered" ? "Answer" : "Your hire"}</p>
            <h1 className="mt-2 break-words text-balance text-[clamp(1.5rem,2.6vw,2rem)] font-medium leading-tight tracking-[-.02em] text-ink">
              {heading.title ?? question ?? "Your hire"}
            </h1>
            {heading.lines && shown?.phase !== "answered" ? (
              <ul className="mt-3 space-y-1 break-all font-mono text-[13px] leading-6 text-ink-2">
                {heading.lines.map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            ) : null}
            {showConfirmError(mode.confirmError, shown?.phase) ? (
              <p role="alert" className="mt-6 border-l-2 border-[color:var(--err)] pl-3 text-sm leading-6 text-ink">{confirmFailureText(mode.confirmError!)}</p>
            ) : null}
            <div className="mt-6">
              {shown ? <RunView live={shown} /> : <p className="text-sm text-ink-3">{liveError ? "Agon could not load this job." : "Loading the job."}</p>}
            </div>
            {live && live.phase === "answered" && !live.preview ? <RatePanel jobId={live.jobId} agent={live.receipt?.label ?? null} /> : null}
            {live ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <TagButton onClick={reset}>Ask something else</TagButton>
                <TagButton variant="ghost" href={`/r/${live.jobId}`}>Full receipt</TagButton>
                {live.answer ? <a href="/arena" className="inline-flex min-h-11 items-center px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">Arena leaderboard →</a> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {canAct && history.length > 0 && start ? (
          <section aria-labelledby="history-heading" className="mt-14">
            <div className="flex items-baseline justify-between gap-4 border-b border-[color:var(--hairline-strong)] pb-3">
              <h2 id="history-heading" className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">Your recent hires</h2>
              <a href="/account#hires" className="inline-flex min-h-11 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-accent">All your hires →</a>
            </div>
            <ul className="divide-y divide-[color:var(--hairline)]">
              {history.map((h) => (
                <li key={h.jobId}>
                  <a href={`/r/${h.jobId}`} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-4 hover:text-accent">
                    <span className="min-w-0 break-words text-sm text-ink">{hireLabel(h)}</span>
                    <span className="flex items-center gap-4 justify-self-end">
                      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                        <span aria-hidden className={`inline-block size-2 ${STATE_DOT[h.state] ?? "border border-[color:var(--ink-3)]"}`} />
                        {hireStateText(h.state)}
                      </span>
                      <span className="font-mono text-[13px] tabular-nums text-ink">{h.price} USDC</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            <Pager page={historyPage} hasMore={historyMore} onPage={setHistoryPage} label="Recent hire pages" />
          </section>
        ) : null}
      </div>
    </StageShell>
  );
}

const STATE_DOT: Record<string, string> = { delivered: "bg-[color:var(--ok)]", refunded: "bg-[color:var(--warn)]", failed: "bg-[color:var(--err)]" };
