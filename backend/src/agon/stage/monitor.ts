import type { Address } from "viem";

import { formatUsdc } from "../payments/bargain.ts";
import type { Job, JobPayment } from "../payments/types.ts";

export type StageAlert = { fingerprint: string; severity: "warning" | "critical"; title: string; body: string; href?: string };
export interface MonitorStore {
  stuckPaying(olderThan: Date): Promise<Job[]>;
  failedRefunds(since: Date): Promise<JobPayment[]>;
  recentJobs(limit: number): Promise<Job[]>;
}

const MINUTE = 60_000;

export async function checkStage(deps: {
  store: MonitorStore;
  wallets: { label: string; address: Address; floor: bigint }[];
  balanceOf: (a: Address) => Promise<bigint | null>;
  lastCommitAt: () => Promise<Date | null>;
  /** When the running Arena season ends; past it, commits stop by design. */
  seasonEndsAt?: Date | null;
  siteUrl: string;
  now: () => Date;
}): Promise<StageAlert[]> {
  const now = deps.now().getTime();
  const alerts: StageAlert[] = [];
  for (const job of await deps.store.stuckPaying(new Date(now - 5 * MINUTE))) {
    alerts.push({
      fingerprint: `stage:payment-unknown:${job.jobId}`, severity: "warning", title: "Payment outcome unknown for over 5 minutes",
      body: `${job.providerLabel} job ${job.jobId} is still paying (trace ${job.traceId}). Reconciliation checks the chain every 5 minutes.`, href: `${deps.siteUrl}/r/${job.rootId}`,
    });
  }
  for (const p of await deps.store.failedRefunds(new Date(now - 24 * 60 * MINUTE))) {
    alerts.push({
      fingerprint: `stage:refund-failed:${p.idempotencyKey}`, severity: "critical", title: "A refund failed",
      body: `Refund of ${formatUsdc(p.amount)} USDC to ${p.payee} for job ${p.jobId} did not go through. Send it by hand from the lead wallet and record the transaction.`,
      href: `${deps.siteUrl}/r/${p.jobId}`,
    });
  }
  for (const w of deps.wallets) {
    const balance = await deps.balanceOf(w.address).catch(() => null);
    if (balance === null) alerts.push({ fingerprint: `stage:balance-unreadable:${w.label}`, severity: "warning", title: `Cannot read the ${w.label} balance`, body: `Balance read failed for ${w.address}. Check the Arc RPC.` });
    else if (balance < w.floor) alerts.push({ fingerprint: `stage:low-balance:${w.label}`, severity: "warning", title: `${w.label} wallet is below its floor`, body: `${formatUsdc(balance)} USDC left at ${w.address}; the floor is ${formatUsdc(w.floor)} USDC.` });
  }
  if (deps.seasonEndsAt && now > deps.seasonEndsAt.getTime()) {
    alerts.push({
      fingerprint: "stage:season-ended", severity: "warning", title: "The Arena season has ended",
      body: `It ended at ${deps.seasonEndsAt.toISOString()} and no new season is running. Set the next one with AGON_SEASON_ID, AGON_SEASON_STARTS_AT and AGON_SEASON_ENDS_AT.`,
      href: `${deps.siteUrl}/arena/season-1`,
    });
    return alerts;
  }
  const last = await deps.lastCommitAt().catch(() => null);
  if (last && now - last.getTime() > 6 * 60 * MINUTE) {
    alerts.push({ fingerprint: "stage:leaderboard-stale", severity: "warning", title: "Season 1 leaderboard is older than 6 hours", body: `The last Season commit on Arc was at ${last.toISOString()}.`, href: `${deps.siteUrl}/arena/season-1` });
  }
  return alerts;
}

export function startStageMonitor(deps: {
  check: () => Promise<StageAlert[]>;
  raise: (a: StageAlert) => Promise<void>;
  resolve: (fingerprint: string) => Promise<void>;
  intervalMs: number;
  log?: (m: string) => void;
}): { tick(): Promise<void>; stop(): void } {
  let active = new Set<string>();
  const tick = async () => {
    try {
      const alerts = await deps.check();
      const current = new Set(alerts.map((a) => a.fingerprint));
      for (const a of alerts) if (!active.has(a.fingerprint)) await deps.raise(a);
      for (const f of active) if (!current.has(f)) await deps.resolve(f);
      active = current;
    } catch (error) {
      deps.log?.(`stage monitor failed: ${(error as Error).message}`);
    }
  };
  const timer = setInterval(() => void tick(), deps.intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
