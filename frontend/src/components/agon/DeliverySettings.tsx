"use client";
import { useCallback, useEffect, useState } from "react";

import { addDeliveryEmail, connectTelegram, disconnectTelegram, getDeliveries, removeDeliveryEmail, StageApiError, verifyDeliveryEmail, type DeliverySettings as Settings } from "@/lib/agon/stage";
import { emailAddError, telegramStart } from "@/lib/agon/delivery-view";
import { TagButton } from "@/components/redesign/TagButton";

/// Account: where finished jobs and watch alerts are sent, and connecting Telegram.
export function DeliverySettings() {
  const [s, setS] = useState<Settings | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; command: string; bot: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [emailNote, setEmailNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getDeliveries().then(setS).catch(() => setS("error"));
  }, []);
  useEffect(() => { load(); }, [load]);

  // While a link is open, check every few seconds so "Connected" shows without a reload.
  const connected = s !== null && s !== "error" && s.telegram.connected;
  useEffect(() => {
    if (!link || connected) return;
    const timer = window.setInterval(load, 3_000);
    return () => window.clearInterval(timer);
  }, [link, connected, load]);
  useEffect(() => { if (connected) setLink(null); }, [connected]);

  async function connect() {
    setBusy(true); setNote(null);
    // Open the tab during the click, so the browser does not block it as a popup, then point it at Telegram.
    const tab = window.open("about:blank", "_blank");
    // The new tab must not be able to reach back into this page.
    if (tab) tab.opener = null;
    try {
      const { url } = await connectTelegram();
      if (tab) tab.location.href = url;
      setLink(telegramStart(url));
    } catch {
      tab?.close();
      setNote("Agon could not make a Telegram link. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const reason = (e: unknown) => (e instanceof StageApiError ? e.code : "network_unavailable");
  async function sendCode() {
    setBusy(true); setEmailNote(null);
    try { await addDeliveryEmail(emailInput.trim()); setCodeInput(""); load(); } catch (e) { setEmailNote(emailAddError(reason(e))); } finally { setBusy(false); }
  }
  async function confirmCode() {
    setBusy(true); setEmailNote(null);
    try { await verifyDeliveryEmail(codeInput.trim()); setEmailInput(""); setCodeInput(""); load(); } catch (e) { setEmailNote(emailAddError(reason(e))); } finally { setBusy(false); }
  }
  async function removeEmail() {
    setBusy(true); setEmailNote(null);
    try { await removeDeliveryEmail(); load(); } catch (e) { setEmailNote(emailAddError(reason(e))); } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true); setNote(null);
    try { await disconnectTelegram(); load(); } catch { setNote("Agon could not disconnect Telegram. Try again."); } finally { setBusy(false); }
  }

  if (s === null) return <p className="text-sm text-ink-3">Loading where your results go.</p>;
  if (s === "error") return <p role="alert" className="text-sm text-ink">Agon could not load your delivery settings right now.</p>;

  const button = "inline-flex min-h-11 items-center border border-[color:var(--hairline-strong)] px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:border-accent hover:text-accent disabled:opacity-50";
  const status = (on: boolean, text: string) => (
    <span className="inline-flex items-center gap-2 text-sm text-ink"><span aria-hidden className={`inline-block size-1.5 ${on ? "bg-[color:var(--ok)]" : "bg-[color:var(--ink-3)]"}`} />{text}</span>
  );
  const row = "grid gap-4 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center sm:px-6";
  const emailText = s.email.on ? "On" : s.email.address ? "Coming soon" : s.email.pending ? "Code sent" : "Off";
  const telegramText = !s.telegram.available ? "Not available" : s.telegram.connected ? "Connected" : link ? "Waiting for the bot" : "Not connected";
  return (
    <div>
      <ul className="divide-y divide-[color:var(--hairline)] border border-[color:var(--hairline-strong)] bg-canvas-2">
        <li className={row}>
          <div><p className="text-[16px] font-medium text-ink">Bell</p><p className="mt-1 text-[13px] text-ink-2">Every result and alert shows in the bell at the top of each page.</p></div>
          {status(true, "Always on")}
          <span />
        </li>
        <li className={row}>
          <div className="min-w-0">
            <p className="text-[16px] font-medium text-ink">Email</p>
            <p className="mt-1 break-words text-[13px] text-ink-2">
              {s.email.on ? `Sent to ${s.email.address}.` : s.email.pending ? `Enter the code sent to ${s.email.pending}.` : s.email.canAdd ? "Add an email to get your results there." : "No email on this account."}
            </p>
            {!s.email.address && s.email.canAdd ? (
              s.email.pending ? (
                <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void confirmCode(); }}>
                  <label className="grid gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">6-digit code</span>
                    <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="min-h-11 w-36 border border-[color:var(--hairline-strong)] bg-canvas px-3 font-mono text-sm tracking-[0.2em] text-ink focus:border-accent focus:outline-none" />
                  </label>
                  <button type="submit" className={button} disabled={busy || codeInput.length !== 6}>Confirm</button>
                  <button type="button" className="min-h-11 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 underline underline-offset-4 hover:text-accent" disabled={busy} onClick={() => void sendCode()}>Send a new code</button>
                </form>
              ) : (
                <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void sendCode(); }}>
                  <label className="grid min-w-0 flex-1 gap-1">
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">Email</span>
                    <input type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} autoComplete="email" className="min-h-11 w-full max-w-sm border border-[color:var(--hairline-strong)] bg-canvas px-3 text-sm text-ink focus:border-accent focus:outline-none" />
                  </label>
                  <button type="submit" className={button} disabled={busy || !emailInput.includes("@")}>Send code</button>
                </form>
              )
            ) : null}
            {emailNote ? <p role="alert" className="mt-3 text-sm text-ink">{emailNote}</p> : null}
          </div>
          {status(s.email.on, emailText)}
          <span>{s.email.source === "added" ? <button type="button" className={button} disabled={busy} onClick={() => void removeEmail()}>Remove</button> : null}</span>
        </li>
        <li className={row}>
          <div className="min-w-0">
            <p className="text-[16px] font-medium text-ink">Telegram</p>
            <p className="mt-1 text-[13px] text-ink-2">Results from the Agon bot, straight to your chat.</p>
            {!s.telegram.connected && !link && s.telegram.available ? <p className="mt-1 text-xs text-ink-3">Opens Telegram. Tap Start there. The link works once, for 15 minutes.</p> : null}
            {link ? (
              <div className="mt-4 border-l-2 border-accent pl-4">
                <p className="text-sm leading-6 text-ink-2">Telegram opened in a new tab. Tap Start there. <a href={link.url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-accent">Open it again</a></p>
                <p className="mt-3 text-sm leading-6 text-ink-2">No Start button? Send @{link.bot} this message:</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <code className="break-all bg-canvas px-3 py-2 font-mono text-[12px] text-ink">{link.command}</code>
                  <button type="button" className={button} onClick={() => { void navigator.clipboard?.writeText(link.command); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
                </div>
                <p className="mt-3 text-xs text-ink-3">The link works for 15 minutes and once.</p>
              </div>
            ) : null}
          </div>
          {status(s.telegram.connected, telegramText)}
          <span>
            {s.telegram.available ? (
              s.telegram.connected
                ? <button type="button" className={button} disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
                : !link ? <TagButton size="sm" disabled={busy} onClick={() => void connect()}>Connect Telegram</TagButton> : null
            ) : null}
          </span>
        </li>
      </ul>
      {note ? <p aria-live="polite" className="mt-3 text-sm text-ink-2">{note}</p> : null}
    </div>
  );
}
