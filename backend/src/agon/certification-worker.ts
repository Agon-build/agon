import { randomUUID } from "node:crypto";
import { keccak256, stringToHex } from "viem";

import {
  defaultPlaygroundInput,
  runPlaygroundTask,
  type PlaygroundCategory,
  type PlaygroundRun,
} from "./playground.ts";
import type { PlaygroundRunStore } from "./playground-store.ts";
import {
  PlaygroundProviderError,
  type PlaygroundProviderRunner,
} from "./playground-provider.ts";
import {
  AgonEndpointQaError,
  type AgonEndpointQaRunner,
} from "./endpoint-qa.ts";
import { certificationBackoffMs, type AgonCertificationJob } from "./certification.ts";
import { nextAgonLifecycleCheck, type AgonLifecycleCheckResult, type AgonLifecycleTransition } from "./certification-lifecycle.ts";
import { AgonListingVerificationError, type AgonListingVerifierAdapter } from "./execution/listing-verifier.ts";

export type CertificationWorkerRepository = {
  getAgonCertification(jobId: string): Promise<AgonCertificationJob | null>;
  backfillAgonCertifications?: (limit?: number, now?: Date) => Promise<number>;
  claimAgonCertification(now?: Date): Promise<AgonCertificationJob | null>;
  deferAgonCertification(jobId: string, nextAttemptAt: Date, reason: string): Promise<void>;
  /** Brings the next check forward so a Verified write that never reached the chain is retried soon. */
  retryAgonCertificationVerification?: (jobId: string, at: Date) => Promise<void>;
  completeAgonCertification(jobId: string, result: PlaygroundRun): Promise<void>;
  finalizeAgonCertificationLifecycle(jobId: string, check: AgonLifecycleCheckResult): Promise<AgonLifecycleTransition>;
  recordAgonCertificationVerificationAction(input: {
    jobId: string;
    action: "approve" | "suspend";
    state: "submitted" | "confirmed" | "unknown" | "failed";
    transactionHash?: `0x${string}` | null;
    error?: string | null;
  }): Promise<void>;
  recordAgonEndpointQa?: (input: {
    listingId: bigint;
    agentId: bigint;
    passed: boolean;
    evidenceHash: `0x${string}`;
    evidence: unknown;
  }) => Promise<void>;
  failAgonCertification(jobId: string, errorCode: string, nextAttemptAt: Date | null): Promise<void>;
};

export type CertificationWorkerOptions = {
  repository: CertificationWorkerRepository;
  playgroundStore: PlaygroundRunStore;
  providerRunner: PlaygroundProviderRunner;
  endpointQaRunner?: AgonEndpointQaRunner;
  now?: () => Date;
  providerRetryMs?: number;
  checkIntervalMs?: number;
  warningRetryMs?: number;
  failureThreshold?: number;
  requireEndpointQa?: boolean;
  alertOperator?: string;
  listingVerifier?: AgonListingVerifierAdapter;
  alert?: (input: {
    operator: string;
    listingReference: string;
    listingVersion: string;
    status: "warning" | "suspended" | "recovered";
    reasons: readonly string[];
    consecutiveFailures: number;
  }) => Promise<void>;
};

export type CertificationWorkerResult = "idle" | "completed" | "deferred" | "failed";

type CertificationAlert = Parameters<NonNullable<CertificationWorkerOptions["alert"]>>[0];

const VERIFICATION_RETRY_MS = 5 * 60_000;

/// One sentence for people: never the raw RPC error, which can carry a private URL or a request body.
function plainVerificationFailure(error: unknown, sent: boolean): string {
  const message = error instanceof Error ? error.message : "";
  const network = /unreachable|RPC|fetch failed|timeout|ECONN|socket|upstream/i.test(message);
  if (sent) return "marketplace_state_write_failed: The Verified record was sent to Arc but not yet confirmed. Agon keeps checking it.";
  return network
    ? "marketplace_state_write_failed: Agon could not reach the Arc network to record Verified. It retries in 5 minutes."
    : "marketplace_state_write_failed: Agon could not record Verified on Arc. It retries in 5 minutes.";
}

async function sendCertificationAlert(options: CertificationWorkerOptions, input: CertificationAlert): Promise<void> {
  if (!options.alert) return;
  try {
    await options.alert(input);
  } catch (error) {
    console.error("agon certification alert failed", error);
  }
}

function nextRetryAt(job: AgonCertificationJob, now: Date): Date | null {
  return job.attempts < job.maxAttempts
    ? new Date(now.getTime() + certificationBackoffMs(job.attempts))
    : null;
}

function assertCertificationJob(job: AgonCertificationJob): asserts job is AgonCertificationJob & {
  category: PlaygroundCategory;
  taskId: string;
} {
  const supported: Readonly<Record<string, string>> = {
    research: "arc-live-fact",
    analysis: "evidence-under-pressure",
    execution: "transaction-safety",
    development: "selector-guard",
    verification: "manifest-anchor",
  };
  if (supported[job.category] !== job.taskId) {
    throw new PlaygroundProviderError("provider_task_unsupported", "This certification task is not available.");
  }
}

const CERTIFICATION_BACKFILL_BATCH_SIZE = 100;

async function backfillCertificationQueue(repository: CertificationWorkerRepository, now: Date): Promise<number> {
  if (!repository.backfillAgonCertifications) return 0;
  let processed = 0;
  for (;;) {
    const batch = await repository.backfillAgonCertifications(CERTIFICATION_BACKFILL_BATCH_SIZE, now);
    if (!Number.isSafeInteger(batch) || batch < 0 || batch > CERTIFICATION_BACKFILL_BATCH_SIZE) {
      throw new Error("certification backfill returned an invalid batch size");
    }
    processed += batch;
    if (batch < CERTIFICATION_BACKFILL_BATCH_SIZE) return processed;
  }
}

export async function runAgonCertificationOnce(options: CertificationWorkerOptions): Promise<CertificationWorkerResult> {
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("certification worker time is invalid");
  const job = await options.repository.claimAgonCertification(now);
  if (!job) return "idle";
  let lifecycleFinalized = false;

  try {
    assertCertificationJob(job);
    const provider = {
      agentId: job.agentId,
      serviceKey: job.serviceKey,
      listingReference: job.listingReference,
      listingVersion: job.listingVersion,
      manifestUri: job.manifestUri,
      manifestHash: job.manifestHash,
    };
    if (!options.providerRunner.supports(provider)) {
      const wait = options.providerRetryMs ?? 5 * 60_000;
      await options.repository.deferAgonCertification(job.jobId, new Date(now.getTime() + wait), "provider_not_enabled");
      return "deferred";
    }

    const result = await runPlaygroundTask(
      {
        category: job.category as PlaygroundCategory,
        taskId: job.taskId,
        input: defaultPlaygroundInput(job.taskId),
      },
      {
        actorAddress: job.providerSnapshot,
        requestId: randomUUID(),
        // One run per attempt: reusing a failed run's key returns "already failed" and hides the real error.
        idempotencyKey: `certification-${job.jobId}-${job.checkSequence + 1}-${job.attempts}`,
        scope: { listingReference: job.listingReference, listingVersion: job.listingVersion },
        store: options.playgroundStore,
        execute: (task, input) => options.providerRunner.run({ provider, task, taskInput: input }),
      },
    );
    let endpointQa: { passed: boolean; evidenceHash: `0x${string}`; evidence: unknown } | null = null;
    if (options.endpointQaRunner?.supports(provider) && options.repository.recordAgonEndpointQa) {
      let qa;
      try {
        qa = await options.endpointQaRunner.run({ provider });
      } catch (error) {
        const code = error instanceof AgonEndpointQaError ? error.code : "endpoint_qa_error";
        const evidence = {
          endpointUrl: null,
          endpointStatus: null,
          checkedAt: now.toISOString(),
          checks: { x402_payment: { passed: false, detail: error instanceof Error ? error.message : "endpoint QA failed", header: null } },
          error: code,
        };
        qa = {
          passed: false,
          evidenceHash: keccak256(stringToHex(JSON.stringify(evidence))) as `0x${string}`,
          evidence,
        };
      }
      await options.repository.recordAgonEndpointQa({
        listingId: BigInt(job.listingId),
        agentId: BigInt(job.agentId),
        passed: qa.passed,
        evidenceHash: qa.evidenceHash,
        evidence: qa.evidence,
      });
      endpointQa = qa;
    }
    const reasons: string[] = [];
    if (!result.passed) reasons.push("playground_task_failed");
    if (endpointQa && !endpointQa.passed) reasons.push("endpoint_qa_failed");
    if (options.requireEndpointQa && !endpointQa) reasons.push("endpoint_qa_unavailable");
    const passed = reasons.length === 0;
    const nextCheckAt = nextAgonLifecycleCheck({
      now,
      passed,
      checkIntervalMs: options.checkIntervalMs ?? 6 * 60 * 60_000,
      warningRetryMs: options.warningRetryMs ?? 15 * 60_000,
    });
    const transition = await options.repository.finalizeAgonCertificationLifecycle(job.jobId, {
      checkId: randomUUID(),
      passed,
      reasons,
      playgroundRunId: result.runId,
      score: result.score,
      evidenceRoot: result.evidence.evidenceRoot,
      responseHash: result.evidence.responseHash,
      taskCommitment: result.evidence.taskCommitment,
      validationRequestHash: result.evidence.validationRequestHash,
      evaluatorVersionHash: result.evidence.evaluatorVersionHash,
      providerHost: result.provenance.providerHost,
      endpointQaEvidenceHash: endpointQa?.evidenceHash ?? null,
      checkedAt: now,
      nextCheckAt,
      failureThreshold: options.failureThreshold ?? 3,
    });
    lifecycleFinalized = true;
    const persisted = await options.repository.getAgonCertification(job.jobId);
    const action = persisted?.verificationAction;
    const shouldWrite = action && persisted.verificationActionState !== "confirmed" && options.listingVerifier?.enabled;
    try {
      if (shouldWrite && action) {
        const request = {
          listingId: job.listingId,
          agentId: job.agentId,
          listingVersion: job.listingVersion,
          manifestHash: job.manifestHash,
          priorTransactionHash: persisted?.verificationTransactionHash ?? undefined,
          onSubmitted: async (transactionHash: `0x${string}`) => options.repository.recordAgonCertificationVerificationAction({
            jobId: job.jobId,
            action,
            state: "submitted",
            transactionHash,
          }),
        };
        const result = action === "approve"
          ? await options.listingVerifier!.verify(request)
          : await options.listingVerifier!.suspend(request);
        await options.repository.recordAgonCertificationVerificationAction({
          jobId: job.jobId,
          action,
          state: "confirmed",
          transactionHash: result.transactionHash,
        });
      }
    } catch (error) {
      if (action) {
        const transactionHash = error instanceof AgonListingVerificationError ? error.transactionHash : null;
        await options.repository.recordAgonCertificationVerificationAction({
          jobId: job.jobId,
          action,
          state: transactionHash || error instanceof AgonListingVerificationError && error.code === "unknown_outcome" ? "unknown" : "failed",
          transactionHash,
          error: error instanceof Error ? error.message : "marketplace state write failed",
        });
      }
      // Nothing reached the chain, so the write is safe to try again soon rather than at the next 6-hourly check.
      const sent = error instanceof AgonListingVerificationError && Boolean(error.transactionHash);
      if (!sent) await options.repository.retryAgonCertificationVerification?.(job.jobId, new Date(now.getTime() + VERIFICATION_RETRY_MS));
      console.warn(`[agon-certification] verification write failed for ${job.listingReference}: ${error instanceof Error ? error.message.slice(0, 300) : "unknown"}`);
      await sendCertificationAlert(options, {
        operator: options.alertOperator ?? job.providerSnapshot,
        listingReference: job.listingReference,
        listingVersion: job.listingVersion,
        status: transition.status === "suspended" ? "suspended" : "warning",
        reasons: [plainVerificationFailure(error, sent)],
        consecutiveFailures: transition.consecutiveFailures,
      });
    }
    if (transition.actions.includes("alert")) {
      await sendCertificationAlert(options, {
        operator: options.alertOperator ?? job.providerSnapshot,
        listingReference: job.listingReference,
        listingVersion: job.listingVersion,
        status: transition.status === "suspended" ? "suspended" : "warning",
        reasons,
        consecutiveFailures: transition.consecutiveFailures,
      });
    } else if (transition.actions.includes("recover")) {
      await sendCertificationAlert(options, {
        operator: options.alertOperator ?? job.providerSnapshot,
        listingReference: job.listingReference,
        listingVersion: job.listingVersion,
        status: "recovered",
        reasons: [],
        consecutiveFailures: 0,
      });
    }
    return "completed";
  } catch (error) {
    if (lifecycleFinalized) {
      console.error("agon certification post-check action failed", error);
      return "completed";
    }
    const errorCode = error instanceof PlaygroundProviderError ? error.code : "certification_worker_error";
    if (errorCode === "certification_worker_error") {
      console.warn(`[agon-certification] ${job.listingReference} v${job.listingVersion} failed: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`);
    }
    const retryAt = nextRetryAt(job, now);
    if (retryAt) {
      await options.repository.failAgonCertification(job.jobId, errorCode, retryAt);
    } else {
      const nextCheckAt = nextAgonLifecycleCheck({
        now,
        passed: false,
        checkIntervalMs: options.checkIntervalMs ?? 6 * 60 * 60_000,
        warningRetryMs: options.warningRetryMs ?? 15 * 60_000,
      });
      const transition = await options.repository.finalizeAgonCertificationLifecycle(job.jobId, {
        checkId: randomUUID(),
        passed: false,
        reasons: [errorCode],
        playgroundRunId: null,
        score: null,
        evidenceRoot: null,
        responseHash: null,
        taskCommitment: null,
        validationRequestHash: null,
        evaluatorVersionHash: null,
        providerHost: null,
        endpointQaEvidenceHash: null,
        checkedAt: now,
        nextCheckAt,
        failureThreshold: options.failureThreshold ?? 3,
      });
      await sendCertificationAlert(options, {
        operator: options.alertOperator ?? job.providerSnapshot,
        listingReference: job.listingReference,
        listingVersion: job.listingVersion,
        status: transition.status === "suspended" ? "suspended" : "warning",
        reasons: [errorCode],
        consecutiveFailures: transition.consecutiveFailures,
      });
    }
    return "failed";
  }
}

export async function agonCertificationWorkerLoop(
  options: CertificationWorkerOptions,
  config: { pollMs?: number; once?: boolean } = {},
): Promise<void> {
  const pollMs = config.pollMs ?? 5_000;
  if (!Number.isInteger(pollMs) || pollMs < 100) throw new Error("certification worker poll must be at least 100ms");
  let consecutiveFailures = 0;
  let backfillCompleted = false;
  for (;;) {
    let result: CertificationWorkerResult;
    try {
      if (!backfillCompleted) {
        const processed = await backfillCertificationQueue(options.repository, options.now?.() ?? new Date());
        backfillCompleted = true;
        if (processed > 0) console.log(`agon certification backfill processed ${processed} listing version(s)`);
      }
      result = await runAgonCertificationOnce(options);
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      console.error("agon certification worker error", error);
      if (config.once) throw error;
      const backoff = Math.min(60_000, pollMs * 2 ** Math.min(consecutiveFailures - 1, 6));
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }
    if (config.once) return;
    if (result === "idle") await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
