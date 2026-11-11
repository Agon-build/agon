export type AgonLifecycleStatus = "pending" | "healthy" | "warning" | "suspended";
export type AgonLifecycleAction = "approve" | "alert" | "suspend" | "recover";

export type AgonLifecycleTransition = {
  status: AgonLifecycleStatus;
  consecutiveFailures: number;
  actions: AgonLifecycleAction[];
};

export type AgonLifecycleCheckResult = {
  checkId: string;
  passed: boolean;
  reasons: readonly string[];
  playgroundRunId: string | null;
  score: number | null;
  evidenceRoot: `0x${string}` | null;
  responseHash: `0x${string}` | null;
  taskCommitment: `0x${string}` | null;
  validationRequestHash: `0x${string}` | null;
  evaluatorVersionHash: `0x${string}` | null;
  providerHost: string | null;
  endpointQaEvidenceHash: `0x${string}` | null;
  checkedAt: Date;
  nextCheckAt: Date;
  failureThreshold: number;
};

export function evaluateAgonLifecycle(input: {
  previousStatus: AgonLifecycleStatus;
  previousConsecutiveFailures: number;
  passed: boolean;
  failureThreshold: number;
}): AgonLifecycleTransition {
  if (!Number.isSafeInteger(input.previousConsecutiveFailures) || input.previousConsecutiveFailures < 0) {
    throw new Error("previous lifecycle failures must be a non-negative integer");
  }
  if (!Number.isSafeInteger(input.failureThreshold) || input.failureThreshold < 1 || input.failureThreshold > 10) {
    throw new Error("lifecycle failure threshold must be between 1 and 10");
  }
  if (input.passed) {
    // A suspended listing comes back after two passes in a row (owner decision 2026-11-11): the
    // first pass moves it to warning and writes nothing; the second recovers it. One more
    // failure in between suspends it again, because the failure count is kept.
    if (input.previousStatus === "suspended") {
      return { status: "warning", consecutiveFailures: input.previousConsecutiveFailures, actions: [] };
    }
    return {
      status: "healthy",
      consecutiveFailures: 0,
      actions: [input.previousStatus === "warning" ? "recover" : "approve"],
    };
  }
  const consecutiveFailures = input.previousConsecutiveFailures + 1;
  if (consecutiveFailures >= input.failureThreshold) {
    return { status: "suspended", consecutiveFailures, actions: ["alert", "suspend"] };
  }
  return { status: "warning", consecutiveFailures, actions: ["alert"] };
}

export function nextAgonLifecycleCheck(input: {
  now: Date;
  passed: boolean;
  checkIntervalMs: number;
  warningRetryMs: number;
  /** A number from 0 to 1. With it, the next check after a pass comes between half and one and a half intervals away, so a listing cannot tell when it is being checked. */
  random?: () => number;
}): Date {
  if (!Number.isFinite(input.now.getTime())) throw new Error("lifecycle time is invalid");
  const spread = input.random ? 0.5 + Math.min(1, Math.max(0, input.random())) : 1;
  const delay = input.passed ? Math.max(60_000, Math.round(input.checkIntervalMs * spread)) : input.warningRetryMs;
  if (!Number.isSafeInteger(delay) || delay < 60_000) throw new Error("lifecycle interval must be at least one minute");
  return new Date(input.now.getTime() + delay);
}
