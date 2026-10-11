"use client";

import { useCallback, useEffect, useState } from "react";
import { BracketedCell, CornerMarkers } from "@/components/redesign";
import { EXPLORER } from "@/lib/arc";
import { AgonAdminConsole } from "@/components/agon/AgonAdminConsole";

/// Internal operator console. Not exposed in the public Agon navigation and gated
/// entirely by the ADMIN_TOKEN, sent as the x-admin-token header on every call (the same token
/// that guards /admin/events on the backend). Shows every contract's live USDC
/// balance, the treasury and coordinator wallets, and lets an admin withdraw
/// treasury USDC or cancel a wrongly-opened contest / challenge. The token is
/// held IN MEMORY only (React state, never localStorage), so it is per-tab,
/// never written to disk, and a refresh requires re-entry. Tighter against
/// token exfiltration and cross-tab leakage than a persisted token.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

interface Overview {
  chainId: number;
  usdc: string;
  // usdc is null when the on-chain read failed AND there is no cached value, distinct
  // from a real "0.00". staleSeconds is set when usdc is a last-known-good value
  // served because the live read failed (age in seconds), null when fresh. On Arc
  // the balance is the same asset as the gas token, so there is no separate gas figure.
  coordinator: { address: string; usdc: string | null; staleSeconds: number | null } | null;
  treasury: { address: string; usdc: string | null; staleSeconds: number | null } | null;
  contracts: Array<{ key: string; address: string; usdc: string | null; staleSeconds: number | null }>;
  counts: {
    contests: number; challenges: number; operators: number; agents: number;
    openContests: number; liveChallenges: number;
  };
}

const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-6)}`;

// A2A settles on Arc; x402 makes settle on the seller chain (Base by default).
// Point NEXT_PUBLIC_BASE_EXPLORER at mainnet basescan if you run Base mainnet.
const BASE_EXPLORER = process.env.NEXT_PUBLIC_BASE_EXPLORER ?? "https://sepolia.basescan.org";
function txUrl(chain: string, hash: string): string {
  const c = (chain || "").toLowerCase();
  if (c.includes("base")) return `${BASE_EXPLORER}/tx/${hash}`;
  return `${EXPLORER}/tx/${hash}`;
}

// The console grouped into tabs instead of one long scroll. `admin` tabs carry
// write actions and are hidden from a support-tier token.
type TabId = "overview" | "members" | "settlements" | "missions" | "events" | "treasury" | "agon" | "activity";
const TABS: Array<{ id: TabId; label: string; admin?: boolean }> = [
  { id: "overview", label: "OVERVIEW" },
  { id: "members", label: "MEMBERS" },
  { id: "settlements", label: "SETTLEMENTS" },
  { id: "missions", label: "MISSIONS", admin: true },
  { id: "events", label: "EVENTS", admin: true },
  { id: "treasury", label: "TREASURY", admin: true },
  { id: "agon", label: "AGON OPS", admin: true },
  { id: "activity", label: "ACTIVITY" },
];

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [draftToken, setDraftToken] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [level, setLevel] = useState<"admin" | "support">("admin");
  const [tab, setTab] = useState<TabId>("overview");

  // No restore-from-storage: the token lives only in React state, so each tab
  // starts locked and a refresh requires re-entry. That is the per-tab,
  // in-memory model (nothing is ever persisted to disk).

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/overview`, { headers: { "x-admin-token": tok } });
      if (res.status === 401) throw new Error("wrong token");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `http ${res.status}`);
      setData((await res.json()) as Overview);
      // Resolve the tier so the UI hides money actions for a support token. An
      // older backend without /admin/whoami simply defaults to full admin.
      const who = await fetch(`${AUTH_URL}/admin/whoami`, { headers: { "x-admin-token": tok } })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      setLevel(who?.level === "support" ? "support" : "admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load");
      setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (token) void load(token);
  }, [token, load]);

  function unlock() {
    const t = draftToken.trim();
    if (!t) return;
    setToken(t); // in-memory only
  }
  function lock() {
    setToken(null);
    setData(null);
    setDraftToken("");
  }

  if (!token) {
    return (
      <Shell>
        <BracketedCell pad="md">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">ADMIN TOKEN</div>
          <input
            type="password"
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            placeholder="paste ADMIN_TOKEN"
            className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
          />
          <button
            onClick={unlock}
            className="mt-3 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press"
          >
            UNLOCK →
          </button>
        </BracketedCell>
      </Shell>
    );
  }

  const visibleTabs = TABS.filter((t) => level === "admin" || !t.admin);
  const activeTab: TabId = visibleTabs.some((t) => t.id === tab) ? tab : "overview";

  return (
    <Shell>
      {/* Tab bar: grouped sections instead of one long scroll. */}
      <nav className="mb-8 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-[color:var(--hairline-strong)] pb-3">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              activeTab === t.id
                ? "bg-ink px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-canvas"
                : "px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 transition-colors hover:text-ink"
            }
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-4 pl-4">
          {data ? (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:inline">CHAIN {data.chainId}</span>
          ) : null}
          {level === "support" ? (
            <span className="border border-[color:var(--hairline-strong)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--warn)]">
              SUPPORT
            </span>
          ) : null}
          <button onClick={() => token && void load(token)} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            {loading ? "…" : "REFRESH"}
          </button>
          <button onClick={lock} className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:text-ink">
            LOCK
          </button>
        </div>
      </nav>

      {error ? <p className="mb-4 font-mono text-[12px] text-[color:var(--err)]">{error}</p> : null}

      {!data ? (
        !error ? <p className="font-mono text-sm text-ink-2">loading…</p> : null
      ) : (
        <div className="flex flex-col gap-6">
          {activeTab === "overview" ? (
            <>
              <CountsRow counts={data.counts} />
              <WalletsRow data={data} />
            </>
          ) : null}

          {activeTab === "members" ? <MembersSection token={token} /> : null}

          {activeTab === "settlements" ? (
            <>
              <SettlementsSection token={token} />
              <AuditSection token={token} />
            </>
          ) : null}

          {activeTab === "missions" ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <MissionOpenCard token={token} />
                <MissionEconomicsPanel token={token} />
              </div>
              <MissionOpsCard token={token} />
            </>
          ) : null}

          {activeTab === "events" ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <ForceSettleCard token={token} />
              <CancelCard token={token} onDone={() => void load(token)} />
            </div>
          ) : null}

          {activeTab === "treasury" ? (
            <>
              <ContractsTable contracts={data.contracts} />
              <WithdrawCard token={token} treasuryUsdc={data.treasury?.usdc ?? data.coordinator?.usdc ?? "0.00"} onDone={() => void load(token)} />
            </>
          ) : null}

          {activeTab === "agon" ? <><AgonAdminConsole adminToken={token} /><details className="border border-[color:var(--hairline-strong)] bg-canvas"><summary className="cursor-pointer list-none px-5 py-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-2">Administrative permissions and listing review</summary><div className="border-t border-[color:var(--hairline)] p-5"><AgonVerificationPanel token={token} /></div></details></> : null}

          {activeTab === "activity" ? <CommandsLog token={token} /> : null}
        </div>
      )}
    </Shell>
  );
}

function AgonVerificationPanel({ token }: { token: string }) {
  const [listingId, setListingId] = useState("");
  const [verifier, setVerifier] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Array<{ id: string; passed: boolean; evidenceHash: string; evidence: { checks?: Record<string, { passed: boolean; detail: string }>; error?: string }; createdAt: string }>>([]);

  async function queue(kind: string, targetId: number, params?: Record<string, unknown>) {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ kind, targetId, params }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult(`queued ${kind} #${(data as { id?: string }).id ?? "?"}`);
    } catch (e) { setError(e instanceof Error ? e.message : "could not queue command"); }
    setBusy(false);
  }

  function confirmQueue(kind: string, targetId: number, params: Record<string, unknown>, message: string) {
    if (window.confirm(message)) void queue(kind, targetId, params);
  }

  async function loadEvidence() {
    if (!id) return;
    setError(null);
    const res = await fetch(`${AUTH_URL}/admin/agon/evidence/${id}`, { headers: { "x-admin-token": token } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError((data as { error?: string }).error ?? `http ${res.status}`); return; }
    setEvidence((data as { evidence?: typeof evidence }).evidence ?? []);
  }

  const id = Number(listingId);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3"><span aria-hidden className="text-accent">■</span> AGON VERIFICATION</div>
        <p className="mt-1 font-mono text-[10px] text-ink-3">Queue a recheck or approve a listing after the verifier evidence is reviewed.</p>
        <div className="mt-3 flex gap-2">
          <input value={listingId} onChange={(e) => setListingId(e.target.value)} placeholder="listing id" inputMode="numeric" className="w-28 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
          <button disabled={busy || !id} onClick={() => void queue("agon_recheck_listing", id, { listingId })} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2 hover:text-ink disabled:opacity-50">RECHECK</button>
          <button disabled={busy || !id} onClick={() => confirmQueue("agon_verify_listing", id, { listingId }, "Queue onchain verification for this listing? This requires the configured verifier wallet.")} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-accent-ink hover:bg-accent-press disabled:opacity-50">VERIFY</button>
          <button disabled={!id} onClick={() => void loadEvidence()} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2 hover:text-ink disabled:opacity-50">EVIDENCE</button>
        </div>
        {evidence.length ? <div className="mt-3 flex flex-col gap-2">{evidence.map((run) => <div key={run.id} className="border-t border-[color:var(--hairline)] pt-2 font-mono text-[10px]"><span style={{ color: run.passed ? "var(--ok)" : "var(--err)" }}>{run.passed ? "PASS" : "FAIL"}</span> · {new Date(run.createdAt).toLocaleString()}<div className="mt-1 break-all text-ink-3">{run.evidenceHash}</div>{run.evidence.error ? <div className="text-[color:var(--err)]">{run.evidence.error}</div> : null}</div>)}</div> : null}
      </BracketedCell>
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3"><span aria-hidden className="text-accent">■</span> ARENA EVALUATOR ROLE</div>
        <p className="mt-1 font-mono text-[10px] text-ink-3">Authorize the wallet that may start and score AgonArena evaluations. The coordinator must already be AgonArena admin.</p>
        <input value={evaluator} onChange={(e) => setEvaluator(e.target.value)} placeholder="0x evaluator wallet" className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
        <div className="mt-2 flex gap-2">
          <button disabled={busy || !evaluator} onClick={() => confirmQueue("agon_grant_arena_evaluator", 0, { evaluator }, "Grant AgonArena EVALUATOR_ROLE to this wallet?")} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-accent-ink hover:bg-accent-press disabled:opacity-50">GRANT ROLE</button>
          <button disabled={busy || !evaluator} onClick={() => confirmQueue("agon_revoke_arena_evaluator", 0, { evaluator }, "Revoke AgonArena EVALUATOR_ROLE from this wallet?")} className="border border-[color:var(--err)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-50">REVOKE</button>
        </div>
      </BracketedCell>
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3"><span aria-hidden className="text-accent">■</span> VERIFIER ROLE</div>
        <p className="mt-1 font-mono text-[10px] text-ink-3">Grant or revoke the isolated verifier wallet. The worker refuses the action unless its wallet is Agon admin.</p>
        <input value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="0x verifier wallet" className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
        <div className="mt-2 flex gap-2">
          <button disabled={busy || !verifier} onClick={() => confirmQueue("agon_grant_verifier", 0, { verifier }, "Grant VERIFIER_ROLE to this wallet?")} className="bg-accent px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-accent-ink hover:bg-accent-press disabled:opacity-50">GRANT ROLE</button>
          <button disabled={busy || !verifier} onClick={() => confirmQueue("agon_revoke_verifier", 0, { verifier }, "Revoke VERIFIER_ROLE from this wallet?")} className="border border-[color:var(--err)] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-50">REVOKE</button>
        </div>
      </BracketedCell>
      {error ? <p className="font-mono text-[11px] text-[color:var(--err)]">{error}</p> : null}
      {result ? <p className="font-mono text-[11px] text-[color:var(--ok)]">{result} · inspect ACTIVITY for receipt</p> : null}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <section className="relative mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <CornerMarkers />
        <h1 className="font-stencil uppercase text-ink" style={{ fontSize: "clamp(32px,5vw,56px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}>
          AGON OPERATOR CONSOLE
        </h1>
        <p className="mt-2 mb-8 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <span aria-hidden className="text-accent">■</span> CONTRACTS · TREASURY · LIVE BALANCES
        </p>
        {children}
      </section>
    </div>
  );
}

function CountsRow({ counts }: { counts: Overview["counts"] }) {
  const cells = [
    { label: "CONTESTS", value: counts.contests, sub: `${counts.openContests} open` },
    { label: "CHALLENGES", value: counts.challenges, sub: `${counts.liveChallenges} live` },
    { label: "OPERATORS", value: counts.operators },
    { label: "AGENTS", value: counts.agents },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cells.map((c) => (
        <BracketedCell key={c.label} pad="sm">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">{c.label}</div>
          <div className="mt-1 font-stencil text-[28px] leading-none text-ink">{c.value}</div>
          {c.sub ? <div className="mt-1 font-mono text-[10px] text-ink-3">{c.sub}</div> : null}
        </BracketedCell>
      ))}
    </div>
  );
}

function WalletsRow({ data }: { data: Overview }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">TREASURY (FEES)</div>
        {data.treasury ? (
          <>
            <AddrLine address={data.treasury.address} />
            <BalanceLine usdc={data.treasury.usdc} staleSeconds={data.treasury.staleSeconds} />
          </>
        ) : (
          <div className="mt-2 font-mono text-[11px] text-ink-3">treasury read failed</div>
        )}
      </BracketedCell>
      <BracketedCell pad="sm">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">COORDINATOR (SIGNER)</div>
        {data.coordinator ? (
          <>
            <AddrLine address={data.coordinator.address} />
            <BalanceLine usdc={data.coordinator.usdc} staleSeconds={data.coordinator.staleSeconds} />
            <div className="font-mono text-[10px] text-ink-3">USDC is also the gas token on Arc</div>
          </>
        ) : (
          <div className="mt-2 font-mono text-[11px] text-ink-3">no signer configured</div>
        )}
      </BracketedCell>
    </div>
  );
}

/// Compact "how long ago" label for a stale balance.
function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/// A headline USDC balance. `usdc` null with no cache means the read failed (shown
/// as "read failed", never a fake 0.00). When `staleSeconds` is set, `usdc` is the
/// last-known-good value served because the live read failed — shown with an "as
/// of Ns ago" note so a transient RPC hiccup doesn't blank a funded wallet.
function BalanceLine({ usdc, staleSeconds }: { usdc: string | null; staleSeconds: number | null }) {
  if (usdc == null) {
    return <div className="mt-1 font-mono text-[13px]" style={{ color: "var(--warn)" }}>read failed · RPC busy, refresh</div>;
  }
  return (
    <>
      <div className="mt-1 font-stencil text-[22px] text-ink">
        {usdc} <span className="font-mono text-[11px] text-ink-3">USDC</span>
      </div>
      {staleSeconds != null ? (
        <div className="font-mono text-[10px]" style={{ color: "var(--warn)" }}>as of {ago(staleSeconds)} · RPC busy</div>
      ) : null}
    </>
  );
}

function ContractsTable({ contracts }: { contracts: Overview["contracts"] }) {
  return (
    <BracketedCell pad="sm">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">CONTRACTS · USDC HELD</div>
      <div className="flex flex-col">
        {contracts.map((ct) => (
          <div key={ct.key} className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-2.5 last:border-0">
            <div className="min-w-0">
              <div className="font-mono text-[12px] uppercase tracking-[0.08em] text-ink">{ct.key}</div>
              <AddrLine address={ct.address} />
            </div>
            <div className="text-right">
              {ct.usdc == null ? (
                <span className="font-mono text-[11px] text-ink-3">read failed</span>
              ) : (
                <>
                  <div className="font-stencil text-[18px] text-ink">{ct.usdc} <span className="font-mono text-[10px] text-ink-3">USDC</span></div>
                  {ct.staleSeconds != null ? <div className="font-mono text-[9px]" style={{ color: "var(--warn)" }}>as of {ago(ct.staleSeconds)}</div> : null}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </BracketedCell>
  );
}

function AddrLine({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked; the explorer link still works */
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <a
        href={`${EXPLORER}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-[11px] text-ink-3 hover:text-ink"
        title={address}
      >
        {short(address)} ↗
      </a>
      <button
        onClick={copy}
        title="copy full address"
        className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent"
      >
        {copied ? "COPIED" : "COPY"}
      </button>
    </span>
  );
}

function WithdrawCard({ token, treasuryUsdc, onDone }: { token: string; treasuryUsdc: string; onDone: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/treasury/withdraw`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ to: to.trim(), amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: (data as { hash: string }).hash });
      setTo(""); setAmount("");
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">WITHDRAW TREASURY USDC</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">available: {treasuryUsdc} USDC</div>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="destination 0x…"
        className="mt-3 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="amount in USDC, e.g. 10.50"
        className="mt-2 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
      <button onClick={submit} disabled={busy || !to || !amount}
        className="mt-3 bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">
        {busy ? "SENDING…" : "WITHDRAW →"}
      </button>
      {result ? (
        result.ok ? (
          <a href={`${EXPLORER}/tx/${result.text}`} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[10px] text-[color:var(--ok)] hover:underline">
            sent · {short(result.text)} ↗
          </a>
        ) : (
          <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{result.text}</p>
        )
      ) : null}
    </BracketedCell>
  );
}

/// Force a stuck event through settlement. The console enqueues a command; the
/// coordinator process drains it and runs the real settle/resolve there. Use it
/// when a window closed but the event never settled (it stays OPEN).
function ForceSettleCard({ token }: { token: string }) {
  const [source, setSource] = useState<"contest" | "challenge">("contest");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const kind = source === "contest" ? "settle_contest" : "resolve_challenge";
      const res = await fetch(`${AUTH_URL}/admin/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ kind, targetId: Number(id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: `queued #${(data as { id?: string }).id ?? "?"}` });
      setId("");
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">FORCE SETTLE A STUCK EVENT</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">runs in the coordinator · use when a closed event never settled</div>
      <div className="mt-3 flex gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value as "contest" | "challenge")}
          className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink">
          <option value="contest">CONTEST</option>
          <option value="challenge">CHALLENGE</option>
        </select>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" inputMode="numeric"
          className="w-24 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
        <button onClick={submit} disabled={busy || !id}
          className="bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">
          {busy ? "QUEUEING…" : "RUN →"}
        </button>
      </div>
      {result ? (
        <p className={`mt-2 font-mono text-[10px] ${result.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{result.text}</p>
      ) : null}
    </BracketedCell>
  );
}

/// Mission maintenance, queued to the coordinator (same pipeline as force-settle).
/// REFUND CANCELLED returns operative join fees + specialist intel buys from the
/// treasury for cancelled missions (one id, or all). CLEAR HISTORY wipes the
/// mission tables for a fresh start (on-chain contests remain).
function MissionOpsCard({ token }: { token: string }) {
  const [missionId, setMissionId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(kind: string, targetId: number) {
    setBusy(kind);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ kind, targetId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: `queued #${(data as { id?: string }).id ?? "?"} — runs in the coordinator, see the log` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(null);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">MISSION OPS</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">queued to the coordinator · refunds paid from the treasury</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={missionId}
          onChange={(e) => setMissionId(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="mission id (blank = all)"
          inputMode="numeric"
          className="w-44 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
        />
        <button
          onClick={() => run("refund_missions", Number(missionId) || 0)}
          disabled={busy !== null}
          className="bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50"
        >
          {busy === "refund_missions" ? "QUEUEING…" : "REFUND CANCELLED →"}
        </button>
      </div>
      <div className="mt-2">
        <button
          onClick={() => {
            if (
              window.confirm(
                "Clear ALL mission history? This wipes every mission, fee, intel buy, and A2A trade. On-chain contests remain. This cannot be undone.",
              )
            ) {
              void run("clear_missions", 0);
            }
          }}
          disabled={busy !== null}
          className="border border-[color:var(--err)] px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-50"
        >
          {busy === "clear_missions" ? "QUEUEING…" : "CLEAR MISSION HISTORY"}
        </button>
      </div>
      {result ? (
        <p className={`mt-2 font-mono text-[10px] ${result.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{result.text}</p>
      ) : null}
    </BracketedCell>
  );
}

interface AdminCommand {
  id: string;
  kind: string;
  targetId: string;
  status: string;
  result: string | null;
  updatedAt: string;
}

/// Live view of the admin command queue: what's pending, running, done, or
/// errored. Polls every few seconds so you can watch a force-settle progress.
function CommandsLog({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminCommand[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_URL}/admin/commands`, { headers: { "x-admin-token": token } });
      if (!res.ok) return;
      const data = (await res.json()) as { commands: AdminCommand[] };
      setRows(data.commands ?? []);
    } catch {
      /* transient; next poll retries */
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const tone = (s: string) =>
    s === "done" ? "var(--ok)" : s === "error" ? "var(--err)" : s === "running" ? "var(--warn)" : "var(--ink-3)";

  return (
    <BracketedCell pad="sm">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">COMMAND QUEUE</div>
      {rows.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-3">no commands yet</p>
      ) : (
        <div className="flex max-h-[260px] flex-col overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="border-b border-[color:var(--hairline)] py-2 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink">
                  {r.kind.replace(/_/g, " ")} #{r.targetId}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: tone(r.status) }}>
                  {r.status}
                </span>
              </div>
              {r.result ? <div className="mt-0.5 font-mono text-[10px] text-ink-3 break-words">{r.result}</div> : null}
            </div>
          ))}
        </div>
      )}
    </BracketedCell>
  );
}

interface MemberRow {
  address: string;
  isPlatform: boolean;
  hasIdentity: boolean;
  entered: boolean;
  agents: number;
  identity: {
    email: string | null;
    x: string | null;
    discord: string | null;
    telegram: string | null;
    circleWallet: boolean;
    passkey: boolean;
  };
  usdcWon: string;
  createdAt: string;
}
interface MembersData {
  summary: {
    total: number;
    realOperators: number;
    clearlyHuman: number;
    enteredEvent: number;
    clearlyHumanWhoEntered: number;
    humanFundedCampaigns: number;
    humanFundedPoolUsdc: string;
  };
  operators: MemberRow[];
}

/// Live member directory + P0 traction in one place. Polls /admin/operators
/// every 6s so a new registration appears without a refresh, and a text filter
/// traces any one operator by address, handle, or email. The headline cells are
/// the real-operator and human-funded-campaign numbers, quotable on the spot.
function MembersSection({ token }: { token: string }) {
  const [data, setData] = useState<MembersData | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_URL}/admin/operators`, { headers: { "x-admin-token": token } });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setData((await res.json()) as MembersData);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [load]);

  const s = data?.summary;
  const rows = (data?.operators ?? []).filter((o) => {
    if (!q.trim()) return true;
    const hay = `${o.address} ${o.identity.email ?? ""} ${o.identity.x ?? ""} ${o.identity.discord ?? ""} ${o.identity.telegram ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  const badge = (label: string, on: boolean) =>
    on ? (
      <span className="border border-[color:var(--hairline-strong)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-2">
        {label}
      </span>
    ) : null;

  return (
    <BracketedCell pad="sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
          <span aria-hidden className="text-accent">■</span> MEMBERS · LIVE
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter address / handle / email"
          className="w-64 max-w-full border border-[color:var(--hairline-strong)] bg-canvas px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-ink"
        />
      </div>

      {s ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "REAL OPERATORS", value: String(s.realOperators) },
            { label: "CLEARLY HUMAN", value: String(s.clearlyHuman) },
            { label: "ENTERED EVENT", value: String(s.enteredEvent) },
            { label: "HUMAN AND ENTERED", value: String(s.clearlyHumanWhoEntered) },
            { label: "FUNDED CAMPAIGNS", value: String(s.humanFundedCampaigns) },
            { label: "CAMPAIGN POOL", value: s.humanFundedPoolUsdc },
          ].map((cell) => (
            <div key={cell.label} className="border border-[color:var(--hairline)] bg-canvas-2 px-2 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{cell.label}</div>
              <div className="mt-0.5 font-stencil text-[20px] leading-none text-ink">{cell.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {err ? <p className="mb-2 font-mono text-[10px] text-[color:var(--err)]">{err}</p> : null}

      <div className="max-h-[420px] overflow-y-auto">
        <div className="flex flex-col">
          {rows.map((o) => (
            <div
              key={o.address}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline)] py-2 last:border-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={`/operators/${o.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[12px] text-ink hover:text-accent"
                  >
                    {short(o.address)}
                  </a>
                  {o.isPlatform ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">PLATFORM</span>
                  ) : null}
                  {o.entered ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-[color:var(--ok)]">ENTERED</span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {badge("X", Boolean(o.identity.x))}
                  {badge("EMAIL", Boolean(o.identity.email))}
                  {badge("DISCORD", Boolean(o.identity.discord))}
                  {badge("TG", Boolean(o.identity.telegram))}
                  {badge("PASSKEY", o.identity.passkey)}
                  {badge("CIRCLE", o.identity.circleWallet)}
                  {!o.hasIdentity && !o.isPlatform ? (
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">WALLET ONLY</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-4 font-mono text-[11px] text-ink-2">
                <span>{o.agents} agent{o.agents === 1 ? "" : "s"}</span>
                <span className="text-ink-3">{new Date(o.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
          {rows.length === 0 ? (
            <p className="py-3 font-mono text-[11px] text-ink-3">no members{q ? " match the filter" : " yet"}</p>
          ) : null}
        </div>
      </div>
    </BracketedCell>
  );
}

interface AuditData {
  source: string;
  id: number;
  settled: boolean;
  message?: string;
  match?: boolean;
  recomputedRoot?: string;
  onchainRoot?: string;
  leaves?: Array<{ rank: number; operator: string; amountUsdc: string }>;
}

/// Settlement audit in the console: recompute a contest/challenge payout merkle
/// root from the public payout record and check it equals the on-chain root, with
/// the ranked leaves shown. Proves a settlement was not tampered with (P2), no CLI.
function AuditSection({ token }: { token: string }) {
  const [source, setSource] = useState<"contest" | "challenge">("challenge");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AuditData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch(`${AUTH_URL}/admin/audit/${source}/${Number(id)}`, { headers: { "x-admin-token": token } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((d as { error?: string }).error ?? `http ${r.status}`);
      setRes(d as AuditData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "audit failed");
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        <span aria-hidden className="text-accent">■</span> SETTLEMENT AUDIT
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">
        recompute the payout merkle root from public data and check it against the chain
      </div>
      <div className="mt-3 flex gap-2">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as "contest" | "challenge")}
          className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
        >
          <option value="challenge">CHALLENGE</option>
          <option value="contest">CONTEST</option>
        </select>
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="id"
          inputMode="numeric"
          className="w-24 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink"
        />
        <button
          onClick={run}
          disabled={busy || !id}
          className="bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50"
        >
          {busy ? "CHECKING…" : "VERIFY →"}
        </button>
      </div>
      {err ? <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{err}</p> : null}
      {res ? (
        !res.settled ? (
          <p className="mt-3 font-mono text-[11px] text-ink-3">{res.message ?? "not settled"}</p>
        ) : (
          <div className="mt-3">
            <div
              className="font-mono text-[12px] uppercase tracking-[0.12em]"
              style={{ color: res.match ? "var(--ok)" : "var(--err)" }}
            >
              {res.match ? "MATCH · root commits to the public payout set" : "MISMATCH · investigate"}
            </div>
            <div className="mt-2 break-all font-mono text-[10px] text-ink-3">recomputed: {res.recomputedRoot}</div>
            <div className="break-all font-mono text-[10px] text-ink-3">on-chain: {res.onchainRoot}</div>
            <div className="mt-2 flex flex-col">
              {(res.leaves ?? []).map((l) => (
                <div
                  key={l.rank}
                  className="flex items-center justify-between border-b border-[color:var(--hairline)] py-1 font-mono text-[11px] text-ink-2 last:border-0"
                >
                  <span>#{l.rank} {short(l.operator)}</span>
                  <span className="text-ink">{l.amountUsdc} USDC</span>
                </div>
              ))}
            </div>
          </div>
        )
      ) : null}
    </BracketedCell>
  );
}

function CancelCard({ token, onDone }: { token: string; onDone: () => void }) {
  const [source, setSource] = useState<"contest" | "challenge">("contest");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/${source}/${Number(id)}/cancel`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: (data as { hash: string }).hash });
      setId("");
      onDone();
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">CANCEL A WRONG EVENT</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">contest refunds the sponsor · challenge frees entrant stakes</div>
      <div className="mt-3 flex gap-2">
        <select value={source} onChange={(e) => setSource(e.target.value as "contest" | "challenge")}
          className="border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink">
          <option value="contest">CONTEST</option>
          <option value="challenge">CHALLENGE</option>
        </select>
        <input value={id} onChange={(e) => setId(e.target.value)} placeholder="id" inputMode="numeric"
          className="w-24 border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink" />
        <button onClick={submit} disabled={busy || !id}
          className="border border-[color:var(--err)] px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-[color:var(--err)] hover:bg-canvas-3 disabled:opacity-50">
          {busy ? "CANCELLING…" : "CANCEL"}
        </button>
      </div>
      {result ? (
        result.ok ? (
          <a href={`${EXPLORER}/tx/${result.text}`} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[10px] text-[color:var(--ok)] hover:underline">
            cancelled · {short(result.text)} ↗
          </a>
        ) : (
          <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{result.text}</p>
        )
      ) : null}
    </BracketedCell>
  );
}

/// Open a mission on demand, queued to the coordinator (same pipeline as
/// force-settle). It seeds a REAL mission (on-chain solver contest + generated
/// commission + specialists), so you can dry-run the live economy anytime and
/// build real settled volume before recording. Seat counts and the internal/
/// external mix come from the mission env; here you pick domain, pool, and window.
/// Small labelled wrapper so each mission-open control names itself (the bare
/// placeholders were ambiguous — "5" read as agents when it was the window).
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      {children}
    </label>
  );
}

const MISSION_TEMPLATES: Record<"solver" | "analyst" | "scout", Array<{ id: string; label: string }>> = {
  solver: [
    { id: "", label: "RANDOM" },
    { id: "synthesis-intel-brief", label: "SIGNAL SYNTHESIS" },
    { id: "sector-risk-audit", label: "RISK AUDIT" },
  ],
  analyst: [
    { id: "", label: "RANDOM" },
    { id: "prediction-read", label: "MARKET READ" },
    { id: "divergence-hunt", label: "DIVERGENCE HUNT" },
  ],
  // SCOUT is intel-then-act: buy best-venue intel over A2A, then execute real
  // on-chain DeFi volume on the Scout rails.
  scout: [
    { id: "", label: "RANDOM" },
    { id: "liquidity-sweep", label: "LIQUIDITY SWEEP" },
  ],
};

function MissionOpenCard({ token }: { token: string }) {
  const [domain, setDomain] = useState<"solver" | "analyst" | "scout">("solver");
  const [templateId, setTemplateId] = useState("");
  const [pool, setPool] = useState("250");
  const [windowMin, setWindowMin] = useState("10");
  const [operatives, setOperatives] = useState("");
  const [specialists, setSpecialists] = useState("");
  const [feePct, setFeePct] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${AUTH_URL}/admin/commands`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          kind: "open_mission",
          targetId: 0,
          params: {
            domain,
            ...(templateId ? { templateId } : {}),
            poolUsdc: Number(pool) || 250,
            windowSeconds: Math.max(60, (Number(windowMin) || 10) * 60),
            // Blank = fall back to the global env for each.
            ...(Number(operatives) > 0 ? { operativeSeats: Number(operatives) } : {}),
            ...(Number(specialists) > 0 ? { specialistSeats: Number(specialists) } : {}),
            ...(feePct !== "" && Number(feePct) >= 0 ? { feePct: Number(feePct) } : {}),
            ...(Number(basePrice) > 0 ? { basePriceUsdc: Number(basePrice) } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? `http ${res.status}`);
      setResult({ ok: true, text: `queued #${(data as { id?: string }).id ?? "?"} — goes live in a few seconds, watch the command log` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "failed" });
    }
    setBusy(false);
  }

  const field = "border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-sm text-ink outline-none focus:border-ink";
  return (
    <BracketedCell pad="sm">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">OPEN A MISSION NOW</div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">real mission, live on demand · dry-run the economy anytime</div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Labeled label="DOMAIN">
          <select
            value={domain}
            onChange={(e) => {
              setDomain(e.target.value as "solver" | "analyst" | "scout");
              setTemplateId("");
            }}
            className={field}
          >
            <option value="solver">SOLVER</option>
            <option value="analyst">ANALYST</option>
            <option value="scout">SCOUT</option>
          </select>
        </Labeled>
        <Labeled label="TEMPLATE">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={field}>
            {MISSION_TEMPLATES[domain].map((t) => (
              <option key={t.id || "random"} value={t.id}>{t.label}</option>
            ))}
          </select>
        </Labeled>
        <Labeled label="POOL USDC">
          <input value={pool} onChange={(e) => setPool(e.target.value.replace(/[^0-9]/g, ""))} placeholder="250" inputMode="numeric" className={`w-24 ${field}`} />
        </Labeled>
        <Labeled label="WINDOW MIN">
          <input value={windowMin} onChange={(e) => setWindowMin(e.target.value.replace(/[^0-9]/g, ""))} placeholder="10" inputMode="numeric" className={`w-20 ${field}`} />
        </Labeled>
        <Labeled label="OPERATIVES">
          <input value={operatives} onChange={(e) => setOperatives(e.target.value.replace(/[^0-9]/g, ""))} placeholder="env" inputMode="numeric" className={`w-24 ${field}`} />
        </Labeled>
        <Labeled label="SPECIALISTS">
          <input value={specialists} onChange={(e) => setSpecialists(e.target.value.replace(/[^0-9]/g, ""))} placeholder="env" inputMode="numeric" className={`w-24 ${field}`} />
        </Labeled>
        <Labeled label="FEE %">
          <input value={feePct} onChange={(e) => setFeePct(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="env" inputMode="decimal" className={`w-20 ${field}`} />
        </Labeled>
        <Labeled label="INTEL $">
          <input value={basePrice} onChange={(e) => setBasePrice(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="env" inputMode="decimal" className={`w-20 ${field}`} />
        </Labeled>
        <button onClick={submit} disabled={busy}
          className="bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-50">
          {busy ? "QUEUEING…" : "OPEN →"}
        </button>
      </div>
      <div className="mt-2 font-mono text-[10px] text-ink-3">
        operatives = competitors · specialists = intel sellers · FEE % = operative join fee · INTEL $ = platform shelf price · blank = use the global env
      </div>
      {result ? (
        <p className={`mt-2 font-mono text-[10px] ${result.ok ? "text-[color:var(--ok)]" : "text-[color:var(--err)]"}`}>{result.text}</p>
      ) : null}
    </BracketedCell>
  );
}

interface EconRow { key: string; label: string; value: string; note: string }

/// The mission economics, clearly stated: every tunable knob with its current
/// effective value, the env var that sets it, and what it does. Read-only
/// reference so you can see the whole fee/price model at a glance; change these
/// globally in .env, or per mission on the OPEN A MISSION NOW card above.
function MissionEconomicsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<EconRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(`${AUTH_URL}/admin/mission-config`, { headers: { "x-admin-token": token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http ${r.status}`))))
      .then((d: { economics: EconRow[] }) => { if (live) setRows(d.economics ?? []); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : "load failed"); });
    return () => { live = false; };
  }, [token]);

  return (
    <BracketedCell pad="sm">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        <span aria-hidden className="text-accent">■</span> MISSION ECONOMICS
      </div>
      <div className="mb-3 font-mono text-[10px] text-ink-3">current values · set globally in .env, or per mission above</div>
      {err ? <p className="font-mono text-[10px] text-[color:var(--err)]">{err}</p> : null}
      <div className="flex flex-col">
        {(rows ?? []).map((r) => (
          <div key={r.key} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[color:var(--hairline)] py-2 last:border-0">
            <div className="min-w-0">
              <div className="font-mono text-[12px] text-ink">{r.label}</div>
              <div className="font-mono text-[10px] text-ink-3">{r.note}</div>
            </div>
            <div className="text-right">
              <div className="font-stencil text-[18px] leading-none text-ink">{r.value}</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">{r.key}</div>
            </div>
          </div>
        ))}
        {rows && rows.length === 0 ? <p className="py-2 font-mono text-[11px] text-ink-3">no config</p> : null}
      </div>
    </BracketedCell>
  );
}

interface SettlementRow {
  rail: "a2a" | "x402";
  contestId: string;
  payer: string;
  payee: string;
  label: string;
  amountUsdc: string;
  chain: string;
  txHash: string;
  ts: string;
}
interface SettlementsData {
  totals: {
    a2aCount: number; a2aUsdc: string; x402Count: number; x402Usdc: string;
    totalCount: number; totalUsdc: string;
  };
  rows: SettlementRow[];
}

/// The settlement ledger to show judges: every real, settled on-chain payment the
/// agent economy produced, both rails, with clickable tx (Arc for A2A, Base for
/// x402). The headline totals are the quotable traction number. Polls every 5s so
/// a live dry run fills it in front of you.
function SettlementsSection({ token }: { token: string }) {
  const [data, setData] = useState<SettlementsData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${AUTH_URL}/admin/settlements`, { headers: { "x-admin-token": token } });
      if (!res.ok) throw new Error(`http ${res.status}`);
      setData((await res.json()) as SettlementsData);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const t = data?.totals;
  const cells = t
    ? [
        { label: "TOTAL PAYMENTS", value: String(t.totalCount) },
        { label: "TOTAL USDC", value: t.totalUsdc },
        { label: "A2A PAYMENTS", value: String(t.a2aCount) },
        { label: "A2A USDC", value: t.a2aUsdc },
        { label: "x402 PAYMENTS", value: String(t.x402Count) },
        { label: "x402 USDC", value: t.x402Usdc },
      ]
    : [];

  return (
    <BracketedCell pad="sm">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3">
        <span aria-hidden className="text-accent">■</span> SETTLEMENTS · A2A + x402 · REAL ON-CHAIN
      </div>
      {cells.length > 0 ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {cells.map((cell) => (
            <div key={cell.label} className="border border-[color:var(--hairline)] bg-canvas-2 px-2 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3">{cell.label}</div>
              <div className="mt-0.5 font-stencil text-[20px] leading-none text-ink">{cell.value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {err ? <p className="mb-2 font-mono text-[10px] text-[color:var(--err)]">{err}</p> : null}
      <div className="max-h-[420px] overflow-y-auto">
        <div className="flex flex-col">
          {(data?.rows ?? []).map((r, i) => (
            <div key={`${r.txHash}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hairline)] py-2 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]"
                    style={{
                      color: r.rail === "a2a" ? "var(--accent)" : "var(--ink-2)",
                      borderColor: "var(--hairline-strong)",
                    }}
                  >
                    {r.rail === "a2a" ? "A2A" : "x402"}
                  </span>
                  <span className="font-mono text-[12px] text-ink">{r.payer} → {r.payee}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-ink-3">
                  {r.label}{r.contestId ? ` · mission #${r.contestId}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-stencil text-[16px] text-ink">{r.amountUsdc} <span className="font-mono text-[10px] text-ink-3">USDC</span></span>
                <a href={txUrl(r.chain, r.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-ink-3 hover:text-accent" title={r.txHash}>
                  {short(r.txHash)} ↗
                </a>
              </div>
            </div>
          ))}
          {(data?.rows ?? []).length === 0 ? (
            <p className="py-3 font-mono text-[11px] text-ink-3">no settled payments yet</p>
          ) : null}
        </div>
      </div>
    </BracketedCell>
  );
}
