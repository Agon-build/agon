import { randomUUID } from "node:crypto";

import type { PaymentRail, ListingStatus } from "./store/repository.ts";
import type { AgonLifecycleStatus } from "./certification-lifecycle.ts";

export type AgonCertificationState = "scheduled" | "running" | "completed" | "failed" | "blocked";

export type AgonCertificationJob = {
  jobId: string;
  chainId: bigint;
  serviceRegistry: string;
  listingId: string;
  agentId: string;
  listingVersion: string;
  serviceKey: string;
  category: string;
  taskId: string | null;
  listingReference: string;
  manifestHash: `0x${string}`;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: `0x${string}`;
  state: AgonCertificationState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  leaseExpiresAt: Date | null;
  blockedReason: string | null;
  lastErrorCode: string | null;
  playgroundRunId: string | null;
  passed: boolean | null;
  score: number | null;
  evidenceRoot: `0x${string}` | null;
  responseHash: `0x${string}` | null;
  taskCommitment: `0x${string}` | null;
  validationRequestHash: `0x${string}` | null;
  evaluatorVersionHash: `0x${string}` | null;
  providerHost: string | null;
  lifecycleStatus: AgonLifecycleStatus;
  consecutiveFailures: number;
  checkSequence: number;
  lastCheckedAt: Date | null;
  lastPassedAt: Date | null;
  lastFailedAt: Date | null;
  verificationAction: "approve" | "suspend" | null;
  verificationActionState: "idle" | "pending" | "submitted" | "confirmed" | "unknown" | "failed";
  verificationTransactionHash: `0x${string}` | null;
  verificationError: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

export type AgonCertificationScheduleInput = {
  jobId?: string;
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
  agentId: bigint;
  listingVersion: bigint;
  serviceKey: string;
  category: bigint;
  manifestHash: string;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: string;
  listingStatus: ListingStatus;
  quarantineReason: string | null;
  maxAttempts?: number;
  now?: Date;
};

export type AgonCertificationScheduleDecision = {
  category: string;
  taskId: string | null;
  state: AgonCertificationState;
  blockedReason: string | null;
};

export const CATEGORY_SLUGS: Readonly<Record<string, string>> = {
  "1": "research",
  "2": "market-data",
  "3": "analysis",
  "4": "prediction",
  "5": "execution",
  "6": "content",
  "7": "development",
  "8": "verification",
  "9": "general",
};

const CERTIFIABLE_TASKS: Readonly<Record<string, string>> = {
  research: "arc-live-fact",
  analysis: "evidence-under-pressure",
  execution: "transaction-safety",
  development: "selector-guard",
  verification: "manifest-anchor",
};

function canonicalAddress(value: string, label: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} must be an address`);
  return value.toLowerCase();
}

function canonicalHash(value: string, label: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a bytes32 value`);
  return value.toLowerCase() as `0x${string}`;
}

function positive(value: bigint, label: string): string {
  if (value <= 0n) throw new Error(`${label} must be positive`);
  return value.toString();
}

export function certificationListingReference(chainId: bigint, serviceRegistry: string, listingId: bigint): string {
  if (chainId <= 0n) throw new Error("chain id must be positive");
  return `${chainId}:${canonicalAddress(serviceRegistry, "service registry")}:${positive(listingId, "listing id")}`;
}

export function certificationDecision(input: Pick<AgonCertificationScheduleInput, "category" | "listingStatus" | "quarantineReason">): AgonCertificationScheduleDecision {
  const category = CATEGORY_SLUGS[input.category.toString()] ?? `category-${input.category.toString()}`;
  const taskId = CERTIFIABLE_TASKS[category] ?? null;
  if (input.quarantineReason) {
    return { category, taskId, state: "blocked", blockedReason: "listing_quarantined" };
  }
  if (input.listingStatus !== "Listed") {
    return { category, taskId, state: "blocked", blockedReason: "listing_not_active" };
  }
  if (!taskId) {
    return { category, taskId: null, state: "blocked", blockedReason: "category_not_supported" };
  }
  return { category, taskId, state: "scheduled", blockedReason: null };
}

export function buildAgonCertificationJob(input: AgonCertificationScheduleInput): AgonCertificationJob {
  const serviceRegistry = canonicalAddress(input.serviceRegistry, "service registry");
  const providerSnapshot = canonicalAddress(input.providerSnapshot, "provider snapshot") as `0x${string}`;
  const decision = certificationDecision(input);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("certification time is invalid");
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("certification max attempts must be between 1 and 10");
  return {
    jobId: input.jobId ?? randomUUID(),
    chainId: input.chainId,
    serviceRegistry,
    listingId: positive(input.listingId, "listing id"),
    agentId: positive(input.agentId, "agent id"),
    listingVersion: positive(input.listingVersion, "listing version"),
    serviceKey: canonicalHash(input.serviceKey, "service key"),
    category: decision.category,
    taskId: decision.taskId,
    listingReference: certificationListingReference(input.chainId, serviceRegistry, input.listingId),
    manifestHash: canonicalHash(input.manifestHash, "manifest hash"),
    manifestUri: input.manifestUri,
    paymentRail: input.paymentRail,
    providerSnapshot,
    state: decision.state,
    attempts: 0,
    maxAttempts,
    nextAttemptAt: now,
    leaseExpiresAt: null,
    blockedReason: decision.blockedReason,
    lastErrorCode: null,
    playgroundRunId: null,
    passed: null,
    score: null,
    evidenceRoot: null,
    responseHash: null,
    taskCommitment: null,
    validationRequestHash: null,
    evaluatorVersionHash: null,
    providerHost: null,
    lifecycleStatus: "pending",
    consecutiveFailures: 0,
    checkSequence: 0,
    lastCheckedAt: null,
    lastPassedAt: null,
    lastFailedAt: null,
    verificationAction: null,
    verificationActionState: "idle",
    verificationTransactionHash: null,
    verificationError: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
  };
}

export function certificationBackoffMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("certification attempt must be positive");
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 8));
}
