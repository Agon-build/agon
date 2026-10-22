import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { WatchState } from "../../src/agon/agents/resolution-watch.ts";
import { PostgresWatchStore } from "../../src/agon/agents/watch-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresWatchStore;
const now = new Date("2026-10-22T08:00:00Z");
const OWNER = `0x${"1".repeat(40)}`;
const A = `0x${"aa".repeat(32)}`;
const B = `0x${"bb".repeat(32)}`;
const state = (status: WatchState["status"], outcome: WatchState["outcome"] = null): WatchState => ({ status, outcome, yesBps: 4000, rules: "r" });

before(async () => {
  db = await createAgonTestDatabase("watch");
  store = new PostgresWatchStore(db.pool);
});
after(async () => db.close());

test("a watch keeps its markets, states and alerts, and an alert is recorded once", async () => {
  await store.createWatch({ watchId: "w1", ownerAddress: OWNER, payer: "0xpayer", network: "arc-testnet", endsAt: new Date(now.getTime() + 60 * 86_400_000) }, [
    { conditionId: A, question: "qa", url: "https://polymarket.com/market/a", state: state("open") },
    { conditionId: B, question: "qb", url: "https://polymarket.com/market/b", state: state("open") },
  ], now);
  assert.deepEqual((await store.activeMarkets(now)).map((m) => m.conditionId).sort(), [A, B]);
  await store.saveState("w1", A, state("proposed"), now);
  const alert = { watchId: "w1", conditionId: A, kind: "settlement_started" as const, stateKey: "k1", title: "t", body: "b" };
  assert.equal(await store.recordAlert(alert, now), true);
  assert.equal(await store.recordAlert(alert, now), false, "a restart never repeats an alert");
  const view = (await store.getWatch("w1"))!;
  assert.equal(view.watch.ownerAddress, OWNER);
  assert.equal(view.markets.find((m) => m.conditionId === A)!.state.status, "proposed");
  assert.deepEqual(view.alerts.map((a) => a.kind), ["settlement_started"]);
  assert.equal(await store.getWatch("nope"), null);
});

test("a watch ends when every market settled or its end date passed, and drops out of the worker", async () => {
  await store.createWatch({ watchId: "w2", ownerAddress: null, payer: "0xp2", network: "arc-testnet", endsAt: new Date(now.getTime() + 86_400_000) }, [
    { conditionId: A, question: "qa", url: "u", state: state("open") },
  ], now);
  await store.saveState("w2", A, state("settled", "yes"), now);
  await store.saveState("w1", A, state("settled", "no"), now);
  assert.equal(await store.finishWatches(now), 1, "w2 has every market settled; w1 still has B open");
  assert.equal((await store.getWatch("w2"))!.watch.status, "done");
  assert.deepEqual((await store.activeMarkets(now)).map((m) => [m.watchId, m.conditionId]), [["w1", B]]);
  assert.equal(await store.finishWatches(new Date(now.getTime() + 61 * 86_400_000)), 1, "w1 ends at its end date");
  assert.deepEqual(await store.activeMarkets(now), []);
});
