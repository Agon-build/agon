"use client";

import { useEffect, useState } from "react";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

type Subscription = {
  subscriptionId: string;
  scopeReference: string | null;
  source: "any" | "certification" | "arena";
  minimumSeverity: "info" | "warning" | "critical";
  inApp: boolean;
  telegram: boolean;
  enabled: boolean;
};

export function AgonAlertSubscriptionPanel() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [listings, setListings] = useState<string[]>([]);
  const [listingReference, setListingReference] = useState("");
  const [minimumSeverity, setMinimumSeverity] = useState<Subscription["minimumSeverity"]>("warning");
  const [telegram, setTelegram] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    try {
      const response = await fetch(`${AUTH_URL}/agon/alert-subscriptions`, { credentials: "include", cache: "no-store" });
      const body = await response.json() as { subscriptions?: Subscription[]; ownedListings?: string[]; telegramLinked?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load service alerts.");
      setSubscriptions(body.subscriptions ?? []);
      setListings(body.ownedListings ?? []);
      setListingReference((current) => current || body.ownedListings?.[0] || "");
      setTelegramLinked(body.telegramLinked === true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load service alerts.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function save() {
    if (!listingReference) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${AUTH_URL}/agon/alert-subscriptions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingReference, source: "any", minimumSeverity, inApp: true, telegram, enabled: true }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save service alerts.");
      setMessage("Alert preferences saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save service alerts.");
      setBusy(false);
    }
  }

  async function remove(subscriptionId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${AUTH_URL}/agon/alert-subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE", credentials: "include" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not remove service alerts.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove service alerts.");
      setBusy(false);
    }
  }

  return <section className="mt-6 border border-[color:var(--hairline-strong)] bg-canvas p-5">
    <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">SERVICE ALERTS</div>
    <h2 className="mt-3 font-stencil text-3xl uppercase">Know when your service needs attention</h2>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">AGON sends in-app alerts for services you own. Add Telegram for immediate certification and Arena updates.</p>
    {listings.length === 0 ? <p className="mt-5 border border-[color:var(--hairline)] p-4 text-sm text-ink-2">Publish or connect a service before configuring its alerts.</p> : <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_180px_auto] lg:items-end">
      <label className="grid gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Service<select value={listingReference} onChange={(event) => setListingReference(event.target.value)} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 text-xs normal-case tracking-normal text-ink">{listings.map((listing) => <option key={listing} value={listing}>{listing}</option>)}</select></label>
      <label className="grid gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">Alert from<select value={minimumSeverity} onChange={(event) => setMinimumSeverity(event.target.value as Subscription["minimumSeverity"])} className="min-h-11 border border-[color:var(--hairline-strong)] bg-canvas px-3 text-xs text-ink"><option value="info">ALL UPDATES</option><option value="warning">WARNINGS</option><option value="critical">CRITICAL ONLY</option></select></label>
      <button type="button" onClick={() => void save()} disabled={busy || !listingReference} className="min-h-11 border border-accent bg-accent px-5 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-ink disabled:opacity-50">{busy ? "SAVING" : "SAVE ALERTS"}</button>
      <label className="flex min-h-11 items-center gap-3 text-sm text-ink-2 lg:col-span-3"><input type="checkbox" checked={telegram} disabled={!telegramLinked} onChange={(event) => setTelegram(event.target.checked)} />Send these alerts to Telegram{telegramLinked ? "" : " · link Telegram from your account first"}</label>
    </div>}
    {message ? <p className="mt-4 border-l-2 border-accent px-3 text-sm text-ink-2">{message}</p> : null}
    {subscriptions.length > 0 ? <div className="mt-6 grid gap-2">{subscriptions.map((subscription) => <div key={subscription.subscriptionId} className="flex flex-wrap items-center justify-between gap-3 border border-[color:var(--hairline)] p-3"><div className="min-w-0"><p className="truncate font-mono text-xs text-ink">{subscription.scopeReference}</p><p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{subscription.minimumSeverity} AND ABOVE · IN APP{subscription.telegram ? " AND TELEGRAM" : ""}</p></div><button type="button" disabled={busy} onClick={() => void remove(subscription.subscriptionId)} className="min-h-11 border border-[color:var(--hairline-strong)] px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 disabled:opacity-50">REMOVE</button></div>)}</div> : null}
  </section>;
}
