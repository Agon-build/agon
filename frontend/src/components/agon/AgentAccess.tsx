"use client";
import { useCallback, useEffect, useState } from "react";

import { TagButton } from "@/components/redesign/TagButton";
import { ACCESS_LEVELS, EXPIRY_DAYS, setupSnippets, tokenSnippets } from "@/lib/agon/access-setup";
import { disconnectConnection, listConnections, type Connection } from "@/lib/agon/connect-api";
import { LEVELS } from "@/lib/agon/connect-view";
import { createToken, listTokens, revokeToken, type TokenRow } from "@/lib/agon/builder-api";
import { MCP_URL } from "@/lib/agon/docs-content";
import { StageApiError } from "@/lib/agon/stage";

const INPUT = "min-h-11 w-full border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm text-ink";
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never");

const TAB = (on: boolean) => `min-h-11 border px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${on ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink-2"}`;

/// Account, Connected agents: one-line setup, the apps you approved on the
/// Connect page with Disconnect, and personal tokens for agents without a browser.
export function AgentAccess() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { void listConnections().then((r) => setConnections(r.connections)).catch(() => setConnections([])); }, []);
  useEffect(load, [load]);
  const snippets = setupSnippets(MCP_URL);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Add Agon to your agent</p>
        <div role="tablist" aria-label="Client" className="flex flex-wrap gap-2">
          {snippets.map((s, i) => <button key={s.label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={TAB(tab === i)}>{s.label}</button>)}
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <pre className="min-w-0 flex-1 overflow-x-auto bg-canvas-2 p-3 font-mono text-xs leading-5 text-ink">{snippets[tab]!.code}</pre>
          <TagButton size="sm" variant="ghost" arrow={false} onClick={() => { void navigator.clipboard?.writeText(snippets[tab]!.code); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</TagButton>
        </div>
        <p className="text-sm leading-6 text-ink-2">The first time your agent uses Agon, a page opens here to confirm what it may do.</p>
      </div>

      <div className="overflow-x-auto">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Connected agents</p>
        {connections === null ? <p className="text-sm text-ink-3">Loading</p> : connections.length === 0 ? <p className="text-sm text-ink-2">No agents connected yet.</p> : (
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"><tr><th className="py-2">Agent</th><th>Access</th><th>Connected</th><th>Last used</th><th /></tr></thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {connections.map((c) => (
                <tr key={c.id}>
                  <td className="py-3 text-ink">{c.clientName}</td>
                  <td className="text-ink-2">{LEVELS.find((l) => l.level === c.level)?.label}</td>
                  <td className="text-ink-2">{day(c.createdAt)}</td>
                  <td className="text-ink-2">{day(c.lastUsedAt)}</td>
                  <td className="text-right">
                    <button type="button" className="min-h-11 px-2 text-sm underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-[color:var(--err)]"
                      onClick={() => {
                        if (confirming !== c.id) { setConfirming(c.id); return; }
                        setConfirming(null);
                        void disconnectConnection(c.id).then(load).catch(() => setError("That did not go through. Try again."));
                      }}>{confirming === c.id ? "Disconnect now?" : "Disconnect"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error ? <p role="alert" className="mt-2 text-sm text-[color:var(--err)]">{error}</p> : null}
      </div>

      <details className="border-t border-[color:var(--hairline)] pt-4">
        <summary className="min-h-11 cursor-pointer font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 hover:text-ink">Advanced: no browser</summary>
        <p className="mt-3 text-sm leading-6 text-ink-2">For agents that run where no browser can open, such as a server or CI. Create a token and store it in the AGON_TOKEN environment variable.</p>
        <div className="mt-4"><TokenAccess /></div>
      </details>
    </div>
  );
}

/// Personal tokens: named, shown once, revocable.
function TokenAccess() {
  const [tokens, setTokens] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<TokenRow["level"]>("listing");
  const [days, setDays] = useState<30 | 90>(30);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { void listTokens().then((r) => setTokens(r.tokens)).catch(() => setTokens([])); }, []);
  useEffect(load, [load]);

  const copy = (label: string, text: string) => { void navigator.clipboard?.writeText(text); setCopied(label); window.setTimeout(() => setCopied(null), 1500); };
  const snippets = tokenSnippets(MCP_URL);

  return (
    <div className="grid gap-6">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) { setError("Give the token a name, for example Claude Code on laptop."); return; }
          setBusy(true);
          setError(null);
          void createToken({ name: name.trim(), level, days })
            .then((out) => { setFresh(out.token); setName(""); setTab(0); load(); })
            .catch((err) => setError(err instanceof StageApiError && err.code === "too_many_tokens" ? "You have 10 active tokens. Revoke one first." : "The token could not be created. Try again."))
            .finally(() => setBusy(false));
        }}
      >
        <label className="grid gap-1 sm:max-w-sm">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Name</span>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Claude Code on laptop" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Access</legend>
          {ACCESS_LEVELS.map((l) => (
            <label key={l.level} className="flex min-h-11 items-start gap-3 text-sm text-ink">
              <input type="radio" name="level" className="mt-1" checked={level === l.level} onChange={() => setLevel(l.level)} />
              <span><span className="font-semibold">{l.label}</span> <span className="text-ink-2">{l.detail}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">Expires after</legend>
          {EXPIRY_DAYS.map((d) => (
            <label key={d} className="flex min-h-11 items-center gap-2 text-sm text-ink"><input type="radio" name="days" checked={days === d} onChange={() => setDays(d)} />{d} days</label>
          ))}
        </fieldset>
        <div><TagButton type="submit" disabled={busy}>{busy ? "Creating" : "Create token"}</TagButton></div>
        {error ? <p role="alert" className="text-sm text-[color:var(--err)]">{error}</p> : null}
      </form>

      {fresh ? (
        <div className="grid gap-4 border border-[color:var(--hairline-strong)] bg-canvas-2 p-4">
          <p className="text-sm text-ink">Shown once. Store it in the AGON_TOKEN environment variable, never in a chat.</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 break-all font-mono text-sm text-ink">{fresh}</code>
            <TagButton size="sm" variant="ghost" arrow={false} onClick={() => copy("token", fresh)}>{copied === "token" ? "Copied" : "Copy token"}</TagButton>
          </div>
          <div role="tablist" aria-label="Setup" className="flex flex-wrap gap-2">
            {snippets.map((s, i) => <button key={s.label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={`min-h-11 border px-3 font-mono text-[10px] uppercase tracking-[0.12em] ${tab === i ? "border-ink bg-ink text-[color:var(--canvas)]" : "border-[color:var(--hairline-strong)] text-ink-2"}`}>{s.label}</button>)}
          </div>
          <pre className="overflow-x-auto bg-canvas p-3 font-mono text-xs leading-5 text-ink">{snippets[tab]!.code}</pre>
          <div className="flex flex-wrap gap-2">
            <TagButton size="sm" variant="ghost" arrow={false} onClick={() => copy("setup", snippets[tab]!.code)}>{copied === "setup" ? "Copied" : "Copy setup"}</TagButton>
            <TagButton size="sm" variant="ghost" arrow={false} onClick={() => setFresh(null)}>Done</TagButton>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        {tokens === null ? <p className="text-sm text-ink-3">Loading tokens</p> : tokens.length === 0 ? <p className="text-sm text-ink-2">No tokens yet.</p> : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3"><tr><th className="py-2">Name</th><th>Access</th><th>Created</th><th>Last used</th><th>Expires</th><th>Status</th><th /></tr></thead>
            <tbody className="divide-y divide-[color:var(--hairline)]">
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td className="py-3 text-ink">{t.name}</td>
                  <td className="text-ink-2">{ACCESS_LEVELS.find((l) => l.level === t.level)?.label}</td>
                  <td className="text-ink-2">{day(t.createdAt)}</td>
                  <td className="text-ink-2">{day(t.lastUsedAt)}</td>
                  <td className="text-ink-2">{day(t.expiresAt)}</td>
                  <td className={t.active ? "text-ink" : "text-ink-3"}>{t.active ? "Active" : t.revokedAt ? "Revoked" : "Expired"}</td>
                  <td className="text-right">
                    {t.active ? (
                      <button type="button" className="min-h-11 px-2 text-sm underline decoration-[color:var(--hairline-strong)] underline-offset-4 hover:text-[color:var(--err)]"
                        onClick={() => {
                          if (confirming !== t.id) { setConfirming(t.id); return; }
                          setConfirming(null);
                          void revokeToken(t.id).then(load).catch(() => setError("The token could not be revoked. Try again."));
                        }}>{confirming === t.id ? "Revoke now?" : "Revoke"}</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
