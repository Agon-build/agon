"use client";
import { useCallback, useEffect, useState } from "react";

import { connectTelegram, disconnectTelegram, getDeliveries, type DeliverySettings as Settings } from "@/lib/agon/stage";
import { telegramStart } from "@/lib/agon/delivery-view";

/// Account: where finished jobs and watch alerts are sent, and connecting Telegram.
export function DeliverySettings() {
  const [s, setS] = useState<Settings | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; command: string; bot: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function disconnect() {
    setBusy(true); setNote(null);
    try { await disconnectTelegram(); load(); } catch { setNote("Agon could not disconnect Telegram. Try again."); } finally { setBusy(false); }
  }

  if (s === null) return <p className="text-sm text-ink-3">Loading where your results go.</p>;
  if (s === "error") return <p role="alert" className="text-sm text-ink">Agon could not load your delivery settings right now.</p>;

  const button = "inline-flex min-h-11 items-center border border-[color:var(--hairline-strong)] px-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink hover:border-accent hover:text-accent disabled:opacity-50";
  return (
    <div>
      <p className="text-sm leading-6 text-ink-2">Finished hires and watch alerts go here and to your bell.</p>
      <ul className="mt-5 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm text-ink">Email</p>
            <p className="mt-0.5 text-sm text-ink-2">{s.email.on ? `On, to ${s.email.address}` : s.email.address ? "Coming soon" : "No email on this account"}</p>
          </div>
        </li>
        <li className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink">Telegram</p>
              <p className="mt-0.5 text-sm text-ink-2">{!s.telegram.available ? "Not available right now" : s.telegram.connected ? "Connected to the Agon bot" : link ? "Waiting for the Agon bot" : "Not connected"}</p>
            </div>
            {s.telegram.available ? (
              s.telegram.connected
                ? <button type="button" className={button} disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
                : !link ? <button type="button" className={button} disabled={busy} onClick={() => void connect()}>Connect Telegram</button> : null
            ) : null}
          </div>
          {link ? (
            <div className="mt-4 border-l-2 border-accent pl-4">
              <p className="text-sm leading-6 text-ink-2">Telegram opened in a new tab. Tap Start there. <a href={link.url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-accent">Open it again</a></p>
              <p className="mt-3 text-sm leading-6 text-ink-2">No Start button? Send @{link.bot} this message:</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <code className="break-all bg-canvas-2 px-3 py-2 font-mono text-[12px] text-ink">{link.command}</code>
                <button type="button" className={button} onClick={() => { void navigator.clipboard?.writeText(link.command); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <p className="mt-3 text-xs text-ink-3">The link works for 15 minutes and once.</p>
            </div>
          ) : null}
        </li>
      </ul>
      {note ? <p aria-live="polite" className="mt-3 text-sm text-ink-2">{note}</p> : null}
    </div>
  );
}
