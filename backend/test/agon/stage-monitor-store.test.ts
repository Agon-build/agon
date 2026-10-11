import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Address } from "viem";

import { PostgresPaymentsStore } from "../../src/agon/payments/store.ts";
import type { Job } from "../../src/agon/payments/types.ts";
import { PostgresMonitorStore } from "../../src/agon/stage/monitor-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let payments: PostgresPaymentsStore;
let monitor: PostgresMonitorStore;
before(async () => {
  db = await createAgonTestDatabase("monitor");
  payments = new PostgresPaymentsStore(db.pool);
  monitor = new PostgresMonitorStore(db.pool);
});
after(async () => db.close());

const base = (over: Partial<Job>): Job => ({
  jobId: randomUUID(), parentId: null, rootId: "", depth: 0, buyerRef: "budget:op:x", providerRef: "agent:lead", providerLabel: "Agon Lead Agent", network: "arc",
  priceAtomic: 300_000n, budgetAtomic: 0n, state: "paying", traceId: "t", request: {}, result: null, createdAt: new Date(), updatedAt: new Date(), ...over,
});

test("stuck payments, failed refunds and recent jobs are read for operations", async () => {
  const old = base({ updatedAt: new Date(Date.now() - 10 * 60_000) });
  old.rootId = old.jobId;
  const fresh = base({});
  fresh.rootId = fresh.jobId;
  await payments.insertJob(old);
  await payments.insertJob(fresh);
  await db.pool.query("update agon_jobs set updated_at = $2 where job_id = $1", [old.jobId, old.updatedAt]);
  assert.deepEqual((await monitor.stuckPaying(new Date(Date.now() - 5 * 60_000))).map((j) => j.jobId), [old.jobId]);

  await payments.upsertJobPayment({
    idempotencyKey: `refund:${old.jobId}`, jobId: old.jobId, kind: "refund", payer: `0x${"c".repeat(40)}` as Address, payee: `0x${"9".repeat(40)}` as Address, amount: 300_000n,
    network: "arc", status: "failed", txHash: null, detail: "no matching market", authNonce: null, authValidBefore: null, createdAt: new Date(), updatedAt: new Date(),
  });
  assert.deepEqual((await monitor.failedRefunds(new Date(Date.now() - 3_600_000))).map((p) => p.idempotencyKey), [`refund:${old.jobId}`]);
  assert.equal((await monitor.recentJobs(10)).length, 2);
});
