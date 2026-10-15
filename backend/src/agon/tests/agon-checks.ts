import { TESTABLE_CATEGORIES } from "./tasks.ts";

export const AGON_CHECK_INTERVAL_MS = 6 * 3_600_000;

type ChecksDeps = {
  listListed(): Promise<{ listingReference: string; category: string }[]>;
  lastCheckAt(listingReference: string): Promise<Date | null>;
  check(listingReference: string): Promise<unknown>;
  intervalMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
};

/// One pass: tests every listed agent in a testable category that was not checked within the interval.
export async function runAgonChecksOnce(deps: ChecksDeps): Promise<number> {
  const interval = deps.intervalMs ?? AGON_CHECK_INTERVAL_MS;
  const now = (deps.now ?? (() => new Date()))();
  let ran = 0;
  for (const listing of await deps.listListed()) {
    if (!(TESTABLE_CATEGORIES as readonly string[]).includes(listing.category)) continue;
    try {
      const last = await deps.lastCheckAt(listing.listingReference);
      if (last && now.getTime() - last.getTime() < interval) continue;
      await deps.check(listing.listingReference);
      ran += 1;
    } catch (error) {
      deps.log?.(`check failed for ${listing.listingReference}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return ran;
}

/// Runs a pass every few minutes; each listing is still checked only once per interval. Returns a stop function.
export function startAgonChecks(deps: ChecksDeps & { tickMs?: number }): () => void {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await runAgonChecksOnce(deps); } catch (error) { deps.log?.(`pass failed: ${error instanceof Error ? error.message : String(error)}`); } finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, deps.tickMs ?? 10 * 60_000);
  void tick();
  return () => { stopped = true; clearInterval(timer); };
}
