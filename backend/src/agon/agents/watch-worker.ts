import { createHash } from "node:crypto";

import { alertsBetween, stateFromGamma, type WatchAlert } from "./resolution-watch.ts";
import type { WatchStore } from "./watch-store.ts";

export const WATCH_TICK_MS = 2 * 60_000;
const BATCH = 20;

export type WatchWorkerDeps = {
  store: WatchStore;
  readMarkets: (conditionIds: string[]) => Promise<Map<string, Record<string, unknown>>>;
  /// Bell and Telegram for a watcher with an Agon account.
  notify: (ownerAddress: string, alert: WatchAlert & { href: string; watchId: string }) => Promise<void>;
  now: () => Date;
  log?: (m: string) => void;
};

/// Reads Gamma by condition id. Closed markets are left out unless asked for
/// (found 2026-10-20), so each batch is read both ways.
export function createGammaWatchReader(opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}) {
  const base = opts.baseUrl ?? "https://gamma-api.polymarket.com";
  const fetchImpl = opts.fetchImpl ?? fetch;
  return async (conditionIds: string[]): Promise<Map<string, Record<string, unknown>>> => {
    const out = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < conditionIds.length; i += BATCH) {
      for (const closed of ["false", "true"]) {
        const params = new URLSearchParams({ closed });
        for (const id of conditionIds.slice(i, i + BATCH)) params.append("condition_ids", id);
        const res = await fetchImpl(`${base}/markets?${params}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`gamma ${res.status}`);
        for (const m of (await res.json()) as Record<string, unknown>[]) {
          if (typeof m.conditionId === "string") out.set(m.conditionId.toLowerCase(), m);
        }
      }
    }
    return out;
  };
}

/// One pass: compare each watched market with its last reading, record each new
/// alert once, tell the owner, then end finished watches.
export async function runWatchTick(deps: WatchWorkerDeps): Promise<{ alerts: number; finished: number }> {
  const now = deps.now();
  const markets = await deps.store.activeMarkets(now);
  if (markets.length === 0) return { alerts: 0, finished: await deps.store.finishWatches(now) };
  const readings = await deps.readMarkets([...new Set(markets.map((m) => m.conditionId))]);
  const owners = new Map<string, string | null>();
  let alerts = 0;
  for (const m of markets) {
    const raw = readings.get(m.conditionId.toLowerCase());
    if (!raw) continue;
    const next = stateFromGamma(raw);
    for (const alert of alertsBetween(m.question, m.state, next)) {
      const stateKey = `${alert.kind}:${createHash("sha256").update(JSON.stringify(next)).digest("hex").slice(0, 16)}`;
      if (!(await deps.store.recordAlert({ watchId: m.watchId, conditionId: m.conditionId, kind: alert.kind, stateKey, title: alert.title, body: alert.body }, now))) continue;
      alerts += 1;
      if (!owners.has(m.watchId)) owners.set(m.watchId, (await deps.store.getWatch(m.watchId))?.watch.ownerAddress ?? null);
      const owner = owners.get(m.watchId);
      if (owner) await deps.notify(owner, { ...alert, href: m.url, watchId: m.watchId }).catch((e) => deps.log?.(`watch notify failed: ${(e as Error).message}`));
    }
    await deps.store.saveState(m.watchId, m.conditionId, next, now);
  }
  return { alerts, finished: await deps.store.finishWatches(now) };
}

/// Runs a tick every 2 minutes; a failed tick is logged and the next one runs. Returns a stop function.
export function startWatchWorker(deps: WatchWorkerDeps & { tickMs?: number }): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const out = await runWatchTick(deps);
      if (out.alerts || out.finished) deps.log?.(`watch tick: ${JSON.stringify(out)}`);
    } catch (error) {
      deps.log?.(`watch tick failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, deps.tickMs ?? WATCH_TICK_MS);
  void tick();
  return () => clearInterval(timer);
}
