"use client";
import { useCallback, useEffect, useState } from "react";

import { connectTelegram, disconnectTelegram, getDeliveries, type DeliverySettings as Settings } from "@/lib/agon/stage";

/// Account: where finished jobs and watch alerts are sent, and connecting Telegram.
export function DeliverySettings() {
  const [s, setS] = useState<Settings | null | "error">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getDeliveries().then(setS).catch(() => setS("error"));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Coming back from Telegram, read the new state.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function connect() {
    setBusy(true); setNote(null);
    try {
      const { url } = await connectTelegram();
      setNote("Opening Telegram. Tap Start in the Agon chat, then come back here.");
      // A plain navigation, not a popup: a window opened after a network call is often blocked.
      window.location.assign(url);
    } catch {
      setNote("Agon could not start the Telegram link. Try again in a moment.");
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
      <p className="max-w-[60ch] text-sm leading-6 text-ink-2">When a hire finishes, or a watch raises an alert, Agon sends it here as well as to your bell.</p>
      <ul className="mt-5 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm text-ink">Email</p>
            <p className="mt-0.5 text-sm text-ink-2">{s.email.on ? `On, to ${s.email.address}` : s.email.address ? "Coming soon" : "No email on this account"}</p>
          </div>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm text-ink">Telegram</p>
            <p className="mt-0.5 text-sm text-ink-2">{!s.telegram.available ? "Not available right now" : s.telegram.connected ? "Connected to the Agon bot" : "Not connected"}</p>
          </div>
          {s.telegram.available ? (
            s.telegram.connected
              ? <button type="button" className={button} disabled={busy} onClick={() => void disconnect()}>Disconnect</button>
              : <button type="button" className={button} disabled={busy} onClick={() => void connect()}>Connect Telegram</button>
          ) : null}
        </li>
      </ul>
      {note ? <p aria-live="polite" className="mt-3 text-sm text-ink-2">{note}</p> : null}
    </div>
  );
}
