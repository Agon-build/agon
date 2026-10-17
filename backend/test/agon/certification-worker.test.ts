import assert from "node:assert/strict";
import test from "node:test";

import { buildAgonCertificationJob, type AgonCertificationJob } from "../../src/agon/certification.ts";
import { agonCertificationWorkerLoop, runAgonCertificationOnce } from "../../src/agon/certification-worker.ts";
import { InMemoryPlaygroundRunStore } from "../../src/agon/playground-store.ts";
import { AGENT_TASK_TIMEOUT_MS, PlaygroundProviderError, type PlaygroundProviderRunner } from "../../src/agon/playground-provider.ts";
import { CERTIFY_TIMEOUT_MS } from "../../src/agon/listing/endpoint-check.ts";
import { AGON_CERTIFICATION_LEASE_MS } from "../../src/agon/store/repository.ts";
import type { PlaygroundRun } from "../../src/agon/playground.ts";
import type { AgonEndpointQaRunner } from "../../src/agon/endpoint-qa.ts";
import { evaluateAgonLifecycle, type AgonLifecycleCheckResult, type AgonLifecycleTransition } from "../../src/agon/certification-lifecycle.ts";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function job(overrides: Partial<AgonCertificationJob> = {}): AgonCertificationJob {
  return {
    ...buildAgonCertificationJob({
      chainId: 5042002n,
      serviceRegistry: "0x2144c156b0a4581da2d046c2e41ac41c6c3938cb",
      listingId: 2n,
      agentId: 886270n,
      listingVersion: 3n,
      serviceKey: `0x${"11".repeat(32)}`,
      category: 3n,
      manifestHash: `0x${"22".repeat(32)}`,
      manifestUri: "https://nock.lat/agon/manifest.json",
      paymentRail: "X402",
      providerSnapshot: "0x4d61c5b8b100603dd578a99acb5160fcf0b44f75",
      listingStatus: "Listed",
      quarantineReason: null,
      now: NOW,
    }),
    ...overrides,
  };
}

class FakeCertificationRepository {
  current: AgonCertificationJob | null;
  backfillResults: number[] = [];
  backfillCalls = 0;
  completed: PlaygroundRun | null = null;
  deferred: string | null = null;
  failed: { code: string; retryAt: Date | null } | null = null;
  endpointQa: { passed: boolean; evidenceHash: `0x${string}`; evidence: unknown } | null = null;
  checks: AgonLifecycleCheckResult[] = [];
  verificationRetries: Date[] = [];
  async retryAgonCertificationVerification(_jobId: string, at: Date): Promise<void> { this.verificationRetries.push(at); }

  constructor(value: AgonCertificationJob) {
    this.current = value;
  }

  async backfillAgonCertifications(): Promise<number> {
    this.backfillCalls += 1;
    return this.backfillResults.shift() ?? 0;
  }

  async claimAgonCertification(): Promise<AgonCertificationJob | null> {
    if (!this.current || this.current.state !== "scheduled") return null;
    this.current = { ...this.current, state: "running", attempts: this.current.attempts + 1 };
    return this.current;
  }

  async deferAgonCertification(_jobId: string, _nextAttemptAt: Date, reason: string): Promise<void> {
    this.deferred = reason;
    this.current = this.current ? { ...this.current, state: "scheduled" } : null;
  }

  async completeAgonCertification(_jobId: string, result: PlaygroundRun): Promise<void> {
    this.completed = result;
    this.current = this.current ? { ...this.current, state: "completed", playgroundRunId: result.runId, passed: result.passed, score: result.score } : null;
  }

  async failAgonCertification(_jobId: string, errorCode: string, retryAt: Date | null): Promise<void> {
    this.failed = { code: errorCode, retryAt };
    this.current = this.current ? { ...this.current, state: retryAt ? "scheduled" : "failed" } : null;
  }

  async getAgonCertification(): Promise<AgonCertificationJob | null> { return this.current; }

  async finalizeAgonCertificationLifecycle(_jobId: string, check: AgonLifecycleCheckResult): Promise<AgonLifecycleTransition> {
    this.checks.push(check);
    const current = this.current!;
    const transition = evaluateAgonLifecycle({
      previousStatus: current.lifecycleStatus,
      previousConsecutiveFailures: current.consecutiveFailures,
      passed: check.passed,
      failureThreshold: check.failureThreshold,
    });
    this.current = {
      ...current,
      state: "scheduled",
      lifecycleStatus: transition.status,
      consecutiveFailures: transition.consecutiveFailures,
      checkSequence: current.checkSequence + 1,
      lastCheckedAt: check.checkedAt,
      lastPassedAt: check.passed ? check.checkedAt : current.lastPassedAt,
      lastFailedAt: check.passed ? current.lastFailedAt : check.checkedAt,
      nextAttemptAt: check.nextCheckAt,
      verificationAction: transition.actions.includes("suspend") ? "suspend" : transition.actions.includes("approve") || transition.actions.includes("recover") ? "approve" : current.verificationAction,
      verificationActionState: transition.actions.some((action) => action === "suspend" || action === "approve" || action === "recover") ? "pending" : current.verificationActionState,
    };
    return transition;
  }

  async recordAgonCertificationVerificationAction(input: { action: "approve" | "suspend"; state: "submitted" | "confirmed" | "unknown" | "failed"; transactionHash?: `0x${string}` | null; error?: string | null }): Promise<void> {
    if (!this.current) return;
    this.current = { ...this.current, verificationAction: input.action, verificationActionState: input.state, verificationTransactionHash: input.transactionHash ?? this.current.verificationTransactionHash, verificationError: input.error ?? null };
  }

  async recordAgonEndpointQa(input: { listingId: bigint; agentId: bigint; passed: boolean; evidenceHash: `0x${string}`; evidence: unknown }): Promise<void> {
    this.endpointQa = input;
  }
}

function runner(options: { supported?: boolean; fail?: boolean; passed?: boolean } = {}): PlaygroundProviderRunner {
  return {
    scopes: () => options.supported === false ? [] : ["5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2@3"],
    supports: () => options.supported !== false,
    run: async ({ provider }) => {
      if (options.fail) throw new Error("provider timeout");
      return {
        agent: { id: `erc8004:${provider.agentId}:${provider.serviceKey}`, name: "Nock", version: provider.listingVersion, capabilities: ["analysis"] },
        output: { writesPerformed: false, ignoredInstructions: true, decision: "review", observations: ["observed"], untrustedClaims: [] },
        passed: options.passed ?? true,
        score: options.passed === false ? 20 : 100,
        chainId: null,
        blockNumber: null,
        providerHost: "nock.lat",
      };
    },
  };
}

test("certification worker runs the real provider seam and stores Playground evidence", async () => {
  const repository = new FakeCertificationRepository(job());
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner(),
    now: () => NOW,
  });
  assert.equal(result, "completed");
  assert.equal(repository.current?.state, "scheduled");
  assert.equal(repository.current?.lifecycleStatus, "healthy");
  assert.equal(repository.checks.length, 1);
  assert.equal(repository.checks[0]?.passed, true);
  assert.match(repository.checks[0]?.playgroundRunId ?? "", /^[0-9a-f-]{36}$/);
});

test("certification worker records x402 endpoint QA separately from the Playground run", async () => {
  const repository = new FakeCertificationRepository(job());
  const endpointQaRunner: AgonEndpointQaRunner = {
    scopes: () => ["5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2@3"],
    supports: () => true,
    run: async () => ({
      passed: true,
      evidenceHash: `0x${"33".repeat(32)}`,
      evidence: { endpointStatus: 402, checks: { x402_payment: { passed: true } } },
    }),
  };
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner(),
    endpointQaRunner,
    now: () => NOW,
  });
  assert.equal(result, "completed");
  assert.equal(repository.endpointQa?.passed, true);
  assert.equal(repository.endpointQa?.evidenceHash, `0x${"33".repeat(32)}`);
  assert.equal(repository.checks[0]?.endpointQaEvidenceHash, `0x${"33".repeat(32)}`);
});

test("a passing lifecycle check automatically approves the exact listing version", async () => {
  const repository = new FakeCertificationRepository(job());
  const approved: string[] = [];
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner(),
    listingVerifier: {
      enabled: true,
      async verify(input) {
        approved.push(`${input.listingId}@${input.listingVersion}:${input.manifestHash}`);
        await input.onSubmitted?.(`0x${"55".repeat(32)}`);
        return { status: "confirmed", transactionHash: `0x${"55".repeat(32)}` };
      },
      async suspend() { throw new Error("not expected"); },
    },
    now: () => NOW,
  });
  assert.equal(result, "completed");
  assert.deepEqual(approved, [`2@3:0x${"22".repeat(32)}`]);
  assert.equal(repository.current?.verificationActionState, "confirmed");
  assert.equal(repository.current?.verificationTransactionHash, `0x${"55".repeat(32)}`);
});

test("the failure threshold suspends the exact listing version and alerts the operator", async () => {
  const repository = new FakeCertificationRepository(job({
    lifecycleStatus: "warning",
    consecutiveFailures: 2,
    verificationAction: "approve",
    verificationActionState: "confirmed",
  }));
  const suspended: string[] = [];
  const alerts: string[] = [];
  await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner({ passed: false }),
    failureThreshold: 3,
    listingVerifier: {
      enabled: true,
      async verify() { throw new Error("not expected"); },
      async suspend(input) { suspended.push(`${input.listingId}@${input.listingVersion}`); return { status: "confirmed", transactionHash: null }; },
    },
    alert: async (input) => { alerts.push(`${input.status}:${input.consecutiveFailures}`); },
    now: () => NOW,
  });
  assert.deepEqual(suspended, ["2@3"]);
  assert.deepEqual(alerts, ["suspended:3"]);
  assert.equal(repository.current?.lifecycleStatus, "suspended");
  assert.equal(repository.current?.verificationActionState, "confirmed");
});

test("a failed operator alert cannot roll back a completed lifecycle check", async () => {
  const repository = new FakeCertificationRepository(job());
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await runAgonCertificationOnce({
      repository,
      playgroundStore: new InMemoryPlaygroundRunStore(),
      providerRunner: runner({ passed: false }),
      alert: async () => { throw new Error("telegram unavailable"); },
      now: () => NOW,
    });
    assert.equal(result, "completed");
    assert.equal(repository.current?.state, "scheduled");
    assert.equal(repository.current?.lifecycleStatus, "warning");
    assert.equal(repository.failed, null);
  } finally {
    console.error = originalError;
  }
});

test("certification worker defers when the provider is not allowlisted", async () => {
  const repository = new FakeCertificationRepository(job());
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner({ supported: false }),
    now: () => NOW,
    providerRetryMs: 60_000,
  });
  assert.equal(result, "deferred");
  assert.equal(repository.deferred, "provider_not_enabled");
  assert.equal(repository.completed, null);
  assert.equal(repository.failed, null);
});

test("certification worker retries provider failures and then stops after max attempts", async () => {
  const repository = new FakeCertificationRepository(job({ maxAttempts: 1 }));
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner({ fail: true }),
    now: () => NOW,
  });
  assert.equal(result, "failed");
  assert.equal(repository.failed, null);
  assert.equal(repository.current?.state, "scheduled");
  assert.equal(repository.current?.lifecycleStatus, "warning");
});

test("certification worker backfills existing versions before processing the queue", async () => {
  const repository = new FakeCertificationRepository(job());
  repository.backfillResults = [100, 2];
  await agonCertificationWorkerLoop(
    {
      repository,
      playgroundStore: new InMemoryPlaygroundRunStore(),
      providerRunner: runner(),
      now: () => NOW,
    },
    { once: true },
  );
  assert.equal(repository.backfillCalls, 2);
  assert.equal(repository.current?.state, "scheduled");
});

test("a Verified write that never reached the chain retries in 5 minutes, and the alert is one plain sentence", async () => {
  const { AgonListingVerificationError } = await import("../../src/agon/execution/listing-verifier.ts");
  const repository = new FakeCertificationRepository(job());
  const alerts: { reasons: string[] }[] = [];
  const result = await runAgonCertificationOnce({
    repository,
    playgroundStore: new InMemoryPlaygroundRunStore(),
    providerRunner: runner(),
    listingVerifier: {
      enabled: true,
      async verify() {
        throw new AgonListingVerificationError("unknown_outcome", "marketplace verification submission is unknown: RPC Request failed. URL: https://rpc.private.example/v1/swrm_secretkey Request body: {\"method\":\"eth_sendRawTransaction\"} Details: all transaction relay upstreams are unreachable");
      },
      async suspend() { throw new Error("not expected"); },
    },
    alert: async (input) => { alerts.push(input as { reasons: string[] }); },
    now: () => NOW,
  });
  assert.equal(result, "completed");
  assert.deepEqual(repository.verificationRetries, [new Date(NOW.getTime() + 5 * 60_000)]);
  const text = alerts.flatMap((a) => a.reasons).join(" ");
  assert.doesNotMatch(text, /https?:|swrm_|Request body|eth_sendRawTransaction/, "no URLs, keys or request details in alerts");
  assert.match(text, /retries in 5 minutes/);
});

test("a retry after a provider timeout reports the provider's own error, never certification_worker_error", async () => {
  // Kestrel, 17 Oct 2026: four checks timed out at 12 s; each retry reused the first run's key, got
  // "already failed" back and was recorded as certification_worker_error, hiding the timeout.
  const repository = new FakeCertificationRepository(job({ maxAttempts: 3 }));
  const store = new InMemoryPlaygroundRunStore();
  const timeout: PlaygroundProviderRunner = {
    ...runner(),
    run: async () => { throw new PlaygroundProviderError("provider_unavailable", "The listed agent did not answer within the Playground time limit."); },
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    await runAgonCertificationOnce({ repository, playgroundStore: store, providerRunner: timeout, now: () => NOW });
    assert.equal(repository.failed?.code, "provider_unavailable", `attempt ${attempt}`);
  }
});

test("every agent task call waits for a reasoning model, and a certification job outlives its task", () => {
  // Kestrel (Grok 4.7) answers in 14 to 21 s; the Lead, Atlas and Vesper in 2 to 3 s.
  assert.equal(AGENT_TASK_TIMEOUT_MS, CERTIFY_TIMEOUT_MS, "one timeout for the listing check, Agon tests and certification");
  assert.ok(AGENT_TASK_TIMEOUT_MS >= 45_000);
  assert.ok(AGON_CERTIFICATION_LEASE_MS >= 2 * AGENT_TASK_TIMEOUT_MS, "the job lease covers the task, the endpoint check and saving the result");
});
