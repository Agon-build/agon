"use client";

import { useEffect, useState } from "react";

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";

type OperationsAlert = {
  alertId: string;
  source: "certification" | "arena" | "stage";
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "resolved";
  title: string;
  body: string | null;
  href: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
};

export function AgonOperationsAlertsPanel({ adminToken }: { adminToken: string }) {
  const [alerts, setAlerts] = useState<OperationsAlert[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${AUTH_URL}/admin/agon/alerts?limit=100`, {
        headers: { "x-admin-token": adminToken },
        cache: "no-store",
      });
      const body = await response.json() as { alerts?: OperationsAlert[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not load operations alerts.");
      setAlerts(body.alerts ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load operations alerts.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [adminToken]);

  async function acknowledge(alertId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${AUTH_URL}/admin/agon/alerts/${encodeURIComponent(alertId)}/acknowledge`, {
        method: "POST",
        headers: { "x-admin-token": adminToken },
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not acknowledge this alert.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not acknowledge this alert.");
      setBusy(false);
    }
  }

  const open = alerts.filter((alert) => alert.status === "open");
  const history = alerts.filter((alert) => alert.status !== "open").slice(0, 20);
  return (
    <section className="border border-[color:var(--hairline-strong)] bg-canvas">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--hairline)] p-5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">OPERATIONS ALERTS</div>
          <h3 className="mt-2 font-stencil text-3xl uppercase leading-none">What needs attention</h3>
          <p className="mt-2 max-w-2xl text-sm leading-5 text-ink-2">Certification and Arena incidents share this inbox and Telegram delivery. Repeated failures collapse into one incident.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-2 disabled:opacity-50">{busy ? "READING" : "REFRESH"}</button>
      </div>
      {error ? <p className="m-5 border-l-2 border-[color:var(--err)] p-3 font-mono text-xs text-[color:var(--err)]">{error}</p> : null}
      <div className="grid gap-3 p-5">
        {open.length === 0 ? <p className="border border-[color:var(--hairline)] p-4 text-sm text-ink-2">No open AGON incidents.</p> : open.map((alert) => (
          <AlertRow key={alert.alertId} alert={alert} onAcknowledge={alert.severity === "critical" ? () => void acknowledge(alert.alertId) : undefined} busy={busy} />
        ))}
      </div>
      {history.length > 0 ? <details className="border-t border-[color:var(--hairline)]"><summary className="cursor-pointer list-none p-5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">RECENT ACKNOWLEDGED AND RESOLVED</summary><div className="grid gap-3 border-t border-[color:var(--hairline)] p-5">{history.map((alert) => <AlertRow key={alert.alertId} alert={alert} busy={busy} />)}</div></details> : null}
    </section>
  );
}

function AlertRow({ alert, onAcknowledge, busy }: { alert: OperationsAlert; onAcknowledge?: () => void; busy: boolean }) {
  const tone = alert.severity === "critical" ? "var(--err)" : alert.severity === "warning" ? "var(--warn)" : "var(--ok)";
  return <article className="grid gap-3 border border-[color:var(--hairline-strong)] p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: tone }}>{alert.severity}</span><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{alert.source} · {alert.status}{alert.occurrenceCount > 1 ? ` · ${alert.occurrenceCount} occurrences` : ""}</span></div><h4 className="mt-2 text-base text-ink">{alert.title}</h4>{alert.body ? <p className="mt-1 text-sm leading-5 text-ink-2">{alert.body}</p> : null}<p className="mt-2 font-mono text-[10px] text-ink-3">LAST SEEN {new Date(alert.lastSeenAt).toLocaleString()}</p></div><div className="flex gap-2">{alert.href ? <a href={alert.href} className="border border-[color:var(--hairline-strong)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink">OPEN</a> : null}{onAcknowledge ? <button type="button" onClick={onAcknowledge} disabled={busy} className="border border-accent bg-accent px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-accent-ink disabled:opacity-50">ACKNOWLEDGE</button> : null}</div></article>;
}
