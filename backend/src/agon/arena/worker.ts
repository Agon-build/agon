import { closeRound, openDueRound, sendRound, type RoundDeps } from "./round.ts";

/// One pass over a track: open the round that is due, send what is owed, close what is sent.
/// Each step stands alone, so a commit that fails does not hold up today's round.
export async function arenaTick(deps: RoundDeps, log: (message: string) => void = () => {}): Promise<void> {
  const id = deps.season.seasonId;
  const guard = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      log(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  await guard("open", async () => {
    const opened = await openDueRound(deps);
    if (opened === "opened") log("round opened");
  });
  for (const r of await deps.store.roundsIn(id, ["open"]).catch(() => [])) await guard(`send round ${r.round}`, () => sendRound(deps, r.round));
  for (const r of await deps.store.roundsIn(id, ["sent", "committing"]).catch(() => [])) {
    await guard(`close round ${r.round}`, async () => {
      const closed = await closeRound(deps, r.round);
      if (closed === "committed" || closed === "skipped") log(`round ${r.round} ${closed}`);
    });
  }
}

/// Runs the track until the signal stops it. The same alert is raised once a day, not once a tick.
export async function arenaWorkerLoop(deps: RoundDeps, opts: { tickMs: number; signal?: AbortSignal; log?: (message: string) => void; sleep?: (ms: number) => Promise<void> }): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.(); }));
  const raised = new Set<string>();
  const once: RoundDeps = {
    ...deps,
    alert: (message) => {
      const key = `${deps.now().toISOString().slice(0, 10)}|${message}`;
      if (raised.has(key)) return;
      if (raised.size > 500) raised.clear();
      raised.add(key);
      deps.alert(message);
    },
  };
  while (!opts.signal?.aborted) {
    await arenaTick(once, opts.log);
    await sleep(opts.tickMs);
  }
}
