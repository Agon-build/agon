import assert from "node:assert/strict";
import test from "node:test";

import { createGammaWatchReader, runWatchTick } from "../../src/agon/agents/watch-worker.ts";
import type { WatchAlertRow, WatchMarket, WatchRecord, WatchStore } from "../../src/agon/agents/watch-store.ts";
import { stateFromGamma } from "../../src/agon/agents/resolution-watch.ts";

const A = `0x${"aa".repeat(32)}`;
const OWNER = `0x${"1".repeat(40)}`;
const now = new Date("2026-10-22T08:00:00Z");
const gamma = (over: Record<string, unknown> = {}) => ({ conditionId: A, question: "qa", closed: false, outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', description: "rules", ...over });

function memoryStore(owner: string | null) {
  const watches = new Map<string, WatchRecord>([["w1", { watchId: "w1", ownerAddress: owner, payer: "0xp", network: "arc-testnet", status: "active", createdAt: now, endsAt: new Date(now.getTime() + 86_400_000) }]]);
  const markets: WatchMarket[] = [{ watchId: "w1", conditionId: A, question: "qa", url: "https://polymarket.com/market/a", state: stateFromGamma(gamma()), updatedAt: now }];
  const alerts: WatchAlertRow[] = [];
  const store: WatchStore = {
    createWatch: async () => {},
    getWatch: async (id) => (watches.get(id) ? { watch: watches.get(id)!, markets: markets.filter((m) => m.watchId === id), alerts } : null),
    activeMarkets: async () => markets.filter((m) => watches.get(m.watchId)!.status === "active" && m.state.status !== "settled"),
    saveState: async (w, c, s) => { markets.find((m) => m.watchId === w && m.conditionId === c)!.state = s; },
    recordAlert: async (a) => {
      if (alerts.some((x) => x.watchId === a.watchId && x.conditionId === a.conditionId && x.stateKey === a.stateKey)) return false;
      alerts.push({ ...a, createdAt: now });
      return true;
    },
    finishWatches: async () => {
      let n = 0;
      for (const w of watches.values()) if (w.status === "active" && markets.filter((m) => m.watchId === w.watchId).every((m) => m.state.status === "settled")) { w.status = "done"; n += 1; }
      return n;
    },
  };
  return { store, alerts, watches };
}

test("a state change raises one alert, notifies the owner once, and a settled watch ends", async () => {
  const { store, alerts, watches } = memoryStore(OWNER);
  const sent: { owner: string; title: string; href: string }[] = [];
  let reading = gamma({ umaResolutionStatus: "proposed", outcomePrices: '["0.98","0.02"]' });
  const deps = { store, readMarkets: async () => new Map([[A, reading]]), notify: async (owner: string, a: { title: string; href: string }) => { sent.push({ owner, title: a.title, href: a.href }); }, now: () => now };
  assert.deepEqual(await runWatchTick(deps), { alerts: 1, finished: 0 });
  assert.deepEqual(await runWatchTick(deps), { alerts: 0, finished: 0 }, "same state, nothing new");
  reading = gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1","0"]' });
  assert.deepEqual(await runWatchTick(deps), { alerts: 1, finished: 1 });
  assert.deepEqual(alerts.map((a) => a.kind), ["settlement_started", "settled"]);
  assert.deepEqual(sent.map((s) => [s.owner, s.href]), [[OWNER, "https://polymarket.com/market/a"], [OWNER, "https://polymarket.com/market/a"]]);
  assert.equal(watches.get("w1")!.status, "done");
});

test("a watch with no Agon account records alerts for its status page without notifying anyone; a missing reading is skipped", async () => {
  const { store, alerts } = memoryStore(null);
  let notified = 0;
  const deps = { store, readMarkets: async () => new Map([[A, gamma({ umaResolutionStatus: "disputed" })]]), notify: async () => { notified += 1; }, now: () => now };
  await runWatchTick(deps);
  assert.deepEqual([alerts.length, notified], [1, 0]);
  const empty = { ...deps, readMarkets: async () => new Map() };
  assert.deepEqual(await runWatchTick(empty), { alerts: 0, finished: 0 });
});

test("the Gamma reader asks for open and closed markets in batches and keys them by condition id", async () => {
  const urls: string[] = [];
  const read = createGammaWatchReader({ baseUrl: "https://gamma.test", fetchImpl: (async (url: string) => {
    urls.push(url);
    const closed = new URL(url).searchParams.get("closed") === "true";
    return Response.json(closed ? [gamma({ conditionId: A.toUpperCase().replace("0X", "0x"), closed: true })] : []);
  }) as unknown as typeof fetch });
  const out = await read([A, ...Array.from({ length: 20 }, (_, i) => `0x${String(i).padStart(64, "0")}`)]);
  assert.equal(out.get(A)!.closed, true);
  assert.equal(urls.length, 4, "21 ids in two batches, each asked open and closed");
  assert.ok(urls.every((u) => ["true", "false"].includes(new URL(u).searchParams.get("closed")!)));
});
