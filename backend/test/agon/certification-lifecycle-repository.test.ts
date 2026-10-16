import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PostgresAgonRepository } from "../../src/agon/store/repository.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const REGISTRY = `0x${"11".repeat(20)}`;
const PROVIDER = `0x${"22".repeat(20)}`;
const HASH = `0x${"33".repeat(32)}` as `0x${string}`;
const RUN_ID = "00000000-0000-4000-8000-000000000301";
let database: AgonTestDatabase;
let repository: PostgresAgonRepository;

before(async () => {
  database = await createAgonTestDatabase("certificationlifecycle");
  repository = new PostgresAgonRepository(database.pool);
});

after(async () => database.close());

test("persists every lifecycle check and recovers a suspended version only after a pass", async () => {
  const start = new Date("2026-09-21T12:00:00.000Z");
  const scheduled = await repository.withTransaction((transaction) => transaction.scheduleAgonCertification({
    chainId: 5042002n,
    serviceRegistry: REGISTRY,
    listingId: 7n,
    agentId: 42n,
    listingVersion: 3n,
    serviceKey: `0x${"44".repeat(32)}`,
    category: 3n,
    manifestHash: HASH,
    manifestUri: "https://provider.example/agon/manifest.json",
    paymentRail: "X402",
    providerSnapshot: PROVIDER,
    listingStatus: "Listed",
    quarantineReason: null,
    now: start,
  }));

  let at = start;
  for (let index = 1; index <= 3; index += 1) {
    const claimed = await repository.claimAgonCertification(at);
    assert.equal(claimed?.jobId, scheduled.jobId);
    const transition = await repository.finalizeAgonCertificationLifecycle(scheduled.jobId, {
      checkId: `00000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`,
      passed: false,
      reasons: ["endpoint_qa_failed"],
      playgroundRunId: null,
      score: null,
      evidenceRoot: null,
      responseHash: null,
      taskCommitment: null,
      validationRequestHash: null,
      evaluatorVersionHash: null,
      providerHost: null,
      endpointQaEvidenceHash: null,
      checkedAt: at,
      nextCheckAt: new Date(at.getTime() + 60_000),
      failureThreshold: 3,
    });
    assert.equal(transition.status, index === 3 ? "suspended" : "warning");
    at = new Date(at.getTime() + 60_000);
  }

  await database.pool.query(
    `insert into agon_playground_runs (run_id, actor_address, request_id, idempotency_key, category, task_id, input_hash, input, scope, state, result, completed_at, lease_expires_at)
     values ($1, $2, $3, $4, 'analysis', 'evidence-under-pressure', $5, '{}'::jsonb, $6::jsonb, 'completed', '{}'::jsonb, $7, $7)`,
    [RUN_ID, PROVIDER, "00000000-0000-4000-8000-000000000305", "certification-lifecycle-recovery", HASH, JSON.stringify({ listingReference: `5042002:${REGISTRY}:7`, listingVersion: "3" }), at],
  );
  await repository.claimAgonCertification(at);
  const recovered = await repository.finalizeAgonCertificationLifecycle(scheduled.jobId, {
    checkId: "00000000-0000-4000-8000-000000000306",
    passed: true,
    reasons: [],
    playgroundRunId: RUN_ID,
    score: 100,
    evidenceRoot: HASH,
    responseHash: HASH,
    taskCommitment: HASH,
    validationRequestHash: HASH,
    evaluatorVersionHash: HASH,
    providerHost: "provider.example",
    endpointQaEvidenceHash: HASH,
    checkedAt: at,
    nextCheckAt: new Date(at.getTime() + 21_600_000),
    failureThreshold: 3,
  });
  assert.deepEqual(recovered, { status: "healthy", consecutiveFailures: 0, actions: ["recover"] });
  const job = await repository.getAgonCertification(scheduled.jobId);
  assert.equal(job?.state, "scheduled");
  assert.equal(job?.lifecycleStatus, "healthy");
  assert.equal(job?.checkSequence, 4);
  assert.equal(job?.playgroundRunId, RUN_ID);
  const history = await database.pool.query<{ outcome: string }>(
    "select outcome from agon_certification_checks where job_id = $1 order by sequence",
    [scheduled.jobId],
  );
  assert.deepEqual(history.rows.map((row) => row.outcome), ["failed", "failed", "failed", "passed"]);

  await repository.recordAgonCertificationVerificationAction({
    jobId: scheduled.jobId,
    action: "approve",
    state: "confirmed",
    transactionHash: HASH,
  });
  await assert.rejects(
    repository.recordAgonCertificationVerificationAction({
      jobId: scheduled.jobId,
      action: "approve",
      state: "failed",
      error: "late provider timeout",
    }),
    /not pending/,
  );
  const confirmed = await repository.getAgonCertification(scheduled.jobId);
  assert.equal(confirmed?.verificationActionState, "confirmed");
  assert.equal(confirmed?.verificationTransactionHash, HASH);
});

test("a certification job blocked only because the listing was briefly quarantined runs once the quarantine lifts", async () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  const job = await repository.withTransaction((transaction) => transaction.scheduleAgonCertification({
    chainId: 5042002n, serviceRegistry: REGISTRY, listingId: 21n, agentId: 897358n, listingVersion: 1n,
    serviceKey: `0x${"55".repeat(32)}`, category: 3n, manifestHash: HASH, manifestUri: "https://provider.example/agon/m.json",
    paymentRail: "X402", providerSnapshot: PROVIDER, listingStatus: "Listed", quarantineReason: "missing_validated_version", now,
  }));
  assert.equal(job.state, "blocked");
  const stateOf = async () => (await database.pool.query<{ state: string; blocked_reason: string | null }>("select state, blocked_reason from agon_certification_jobs where job_id = $1", [job.jobId])).rows[0];
  await repository.reconcileListingAnchor({
    chainId: 5042002n, serviceRegistry: REGISTRY, listingId: 21n, version: 1n, manifestHash: HASH,
    manifestUri: "https://provider.example/agon/m.json", paymentRail: "X402", providerSnapshot: PROVIDER as `0x${string}`, validatedAt: now,
  });
  assert.deepEqual(await stateOf(), { state: "scheduled", blocked_reason: null });
});

test("the worker's start-up pass queues jobs left blocked by a quarantine that has since lifted, and leaves real quarantines alone", async () => {
  const now = new Date("2026-10-16T13:00:00.000Z");
  const schedule = (listingId: bigint) => repository.withTransaction((transaction) => transaction.scheduleAgonCertification({
    chainId: 5042002n, serviceRegistry: REGISTRY, listingId, agentId: 900000n + listingId, listingVersion: 1n,
    serviceKey: `0x${"66".repeat(32)}`, category: 3n, manifestHash: HASH, manifestUri: "https://provider.example/agon/x.json",
    paymentRail: "X402", providerSnapshot: PROVIDER, listingStatus: "Listed", quarantineReason: "missing_validated_version", now,
  }));
  const listing = (listingId: bigint, quarantine: string | null) => database.pool.query(
    `insert into agon_listings (chain_id, service_registry_address, listing_id, agent_id, service_key, category, current_version, manifest_hash, manifest_uri,
       payment_rail, provider_snapshot, chain_status, status, verification, quarantine_reason, source_block_number, source_tx_hash, source_log_index, created_at, updated_at)
     values (5042002, $1, $2, $3, $4, 3, 1, $5, 'https://provider.example/agon/x.json', 'X402', $6, 'Listed', $7, 'Unverified', $8, 1, $9, 0, now(), now())`,
    [REGISTRY, listingId.toString(), (900000n + listingId).toString(), `0x${"66".repeat(32)}`, HASH, PROVIDER, quarantine ? "Suspended" : "Listed", quarantine, `0x${"77".repeat(32)}`],
  );
  const lifted = await schedule(31n);
  const stillQuarantined = await schedule(32n);
  await listing(31n, null);
  await listing(32n, "manifest_hash_mismatch");
  await repository.backfillAgonCertifications(100, now);
  const stateOf = async (jobId: string) => (await database.pool.query<{ state: string }>("select state from agon_certification_jobs where job_id = $1", [jobId])).rows[0]!.state;
  assert.equal(await stateOf(lifted.jobId), "scheduled");
  assert.equal(await stateOf(stillQuarantined.jobId), "blocked");
});
