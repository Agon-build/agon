import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { checkStage, startStageMonitor, type MonitorStore, type StageAlert } from "../../src/agon/stage/monitor.ts";
import type { Job, JobPayment } from "../../src/agon/payments/types.ts";

const NOW = new Date("2026-11-03T08:00:00Z");
const job = (id: string): Job => ({
  jobId: id, parentId: null, rootId: id, depth: 0, buyerRef: "budget:op:x", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc",
  priceAtomic: 300_000n, budgetAtomic: 0n, state: "paying", traceId: "trace-1", request: {}, result: null, createdAt: NOW, updatedAt: new Date(NOW.getTime() - 6 * 60_000),
});
const refund: JobPayment = {
  idempotencyKey: "refund:r1", jobId: "r1", kind: "refund", payer: `0x${"c".repeat(40)}` as Address, payee: `0x${"9".repeat(40)}` as Address, amount: 300_000n, network: "arc",
  status: "failed", txHash: null, detail: "no matching market", authNonce: null, authValidBefore: null, createdAt: NOW, updatedAt: NOW,
};

function deps(over: Partial<Parameters<typeof checkStage>[0]> = {}) {
  const store: MonitorStore = { stuckPaying: async () => [job("j1")], failedRefunds: async () => [refund], recentJobs: async () => [] };
  return {
    store, siteUrl: "https://agon.surf", now: () => NOW,
    wallets: [{ label: "Lead agent", address: `0x${"c".repeat(40)}` as Address, floor: 500_000n }, { label: "Atlas seller", address: `0x${"a".repeat(40)}` as Address, floor: 20_000n }],
    balanceOf: async (a: Address) => (a.startsWith("0xc") ? 400_000n : null),
    lastCommitAt: async () => new Date(NOW.getTime() - 7 * 3_600_000),
    ...over,
  };
}

test("every stage alert rule fires with a stable fingerprint", async () => {
  const alerts = await checkStage(deps());
  assert.deepEqual(alerts.map((a) => [a.fingerprint, a.severity]), [
    ["stage:payment-unknown:j1", "warning"],
    ["stage:refund-failed:refund:r1", "critical"],
    ["stage:low-balance:Lead agent", "warning"],
    ["stage:balance-unreadable:Atlas seller", "warning"],
    ["stage:leaderboard-stale", "warning"],
  ]);
  assert.match(alerts[1]!.body, /0\.30 USDC/);
  assert.equal(alerts[0]!.href, "https://agon.surf/r/j1");
});

test("a healthy stage raises nothing", async () => {
  const alerts = await checkStage(deps({
    store: { stuckPaying: async () => [], failedRefunds: async () => [], recentJobs: async () => [] },
    balanceOf: async () => 5_000_000n,
    lastCommitAt: async () => new Date(NOW.getTime() - 3_600_000),
  }));
  assert.deepEqual(alerts, []);
  assert.deepEqual(await checkStage(deps({ store: { stuckPaying: async () => [], failedRefunds: async () => [], recentJobs: async () => [] }, balanceOf: async () => 5_000_000n, lastCommitAt: async () => null })), []);
});

test("the monitor raises an alert once and resolves it when it clears", async () => {
  const raised: string[] = [];
  const resolved: string[] = [];
  let current: StageAlert[] = [{ fingerprint: "a", severity: "warning", title: "t", body: "b" }];
  const monitor = startStageMonitor({ check: async () => current, raise: async (a) => { raised.push(a.fingerprint); }, resolve: async (f) => { resolved.push(f); }, intervalMs: 3_600_000 });
  await monitor.tick();
  await monitor.tick();
  assert.deepEqual(raised, ["a"]);
  current = [];
  await monitor.tick();
  assert.deepEqual(resolved, ["a"]);
  monitor.stop();
});
