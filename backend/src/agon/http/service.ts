import { isFirstParty, type FirstPartyAgent } from "../first-party.ts";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, keccak256, stringToHex } from "viem";
import type { Result } from "../core/result.ts";
import {
  PostgresAgonRepository,
  AgonStoreInvariantError,
  type ListingCursor,
  type StoredListing,
  type StoredVerificationEvidence,
  type StoredX402FacilitatorVerification,
  type StoredAgonEscrowIntent,
  type StoredAgonJobEscrowIntent,
  type StoredAgonArenaEvaluation,
  type StoredAgonSyndicateContribution,
  type StoredAgonPrizeClaim,
} from "../store/repository.ts";
import { callIntentView, prepareX402Call } from "../execution/x402-intent.ts";
import { validateX402Approval } from "../execution/x402-approval.ts";
import { parsePaymentRequiredHeader, type X402QuoteSnapshot } from "../execution/x402-quote.ts";
import { buildX402Authorization, validateX402AuthorizationSignature, type X402AuthorizationPayload } from "../execution/x402-authorization.ts";
import { buildX402ExecutionPlan } from "../execution/x402-facilitator.ts";
import { createX402SettlementOrchestrator, type X402SettlementAdapter } from "../execution/x402-orchestrator.ts";
import { createX402ExecutionPolicy } from "../execution/x402-policy.ts";
import { isX402ProviderTransferId, isX402Transaction, validateX402ReceiptLookupResult, type X402ReceiptLookupAdapter } from "../execution/x402-reconciliation.ts";
import { probeX402RecoveryCandidate as inspectX402RecoveryCandidate } from "../execution/x402-recovery.ts";
import { validateX402DeliveryEvidence, type X402DeliveryEvidenceInput } from "../execution/x402-delivery.ts";
import type { X402FacilitatorVerificationRequest as X402FacilitatorVerificationInput, X402FacilitatorVerificationResult, X402SettlementRequest as X402SettlementInput } from "../execution/x402-settlement.ts";
import { buildX402ExecutionApproval, type X402ExecutionApprovalRequest } from "../execution/x402-execution-approval.ts";
import { validateAgonPrizeEscrowPoolBinding, type AgonPrizeEscrowPoolBinding, type AgonPrizeEscrowReadAdapter } from "../execution/escrow-reconciliation.ts";
import { buildAgonEscrowTransactionApproval, type AgonEscrowTransactionApprovalRequest } from "../execution/escrow-transaction-approval.ts";
import type { AgonEscrowWriteOperation, AgonPrizeEscrowWritePreflightAdapter } from "../execution/escrow-write-preflight.ts";
import { createApprovalBoundAgonEscrowTransactionAdapter } from "../execution/escrow-transaction-adapter.ts";
import type { AgonEscrowTransactionWriter } from "../execution/escrow-transaction-writer.ts";
import { createAgonEscrowLifecycleOrchestrator, type AgonEscrowLifecycleAction } from "../execution/escrow-orchestrator.ts";
import { createDisabledAgonEscrowAdapter, evaluateAgonEscrowTerms, hashAgonEscrowTerms, type AgonEscrowAdapter, type AgonEscrowListing } from "../escrow-policy.ts";
import { inspectManifest, verifyHostedManifestHash, type ManifestInspection } from "../manifest-inspector.ts";
import { normalizeManifestV2 } from "../core/manifest.ts";
import type {
  AgonCapabilities,
  AgonEndpointQa,
  AgonListingView,
  X402ApprovalRequest,
  X402ApprovalView,
  BindProfileRequest,
  PauseListingRequest,
  ListingPage,
  ListingQuery,
  PublishListingRequest,
  PublishListingVersionRequest,
  SubmittedOperation,
  X402CallIntentRequest,
  X402CallIntentView,
  X402QuoteView,
  X402AuthorizationView,
  X402AuthorizationSignatureRequest,
  X402AuthorizationSubmittedView,
  X402ExecutionPlanView,
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402SettlementReadinessView,
  X402ReconciliationReadinessView,
  X402ReconciliationRequest,
  X402RecoveryProbeRequest,
  X402RecoveryProbeView,
  X402AgentSpendRequest,
  X402AgentSpendView,
  X402DeliveryEvidenceRequest,
  X402DeliveryEvidenceView,
  X402ReconciliationView,
  X402SettlementRequest,
  X402SettlementView,
  X402FacilitatorVerificationView,
  X402FacilitatorVerificationRequest,
  AgonEscrowIntentRequest,
  AgonEscrowIntentView,
  AgonEscrowReadinessView,
  AgonEscrowTransactionView,
  AgonEscrowTransactionApprovalView,
  AgonEscrowTransactionApprovalReadinessView,
  AgonJobEscrowJobView,
  AgonJobEscrowIntentRequest,
  AgonJobEscrowIntentView,
  AgonJobEscrowTransactionView,
  AgonJobEscrowReconcileRequest,
  AgonJobEscrowSubmittedRequest,
  AgonJobEscrowExecuteRequest,
  AgonArenaEvaluationRequest,
  AgonArenaEvaluationView,
  AgonArenaTransactionView,
  AgonArenaEvaluationSubmittedRequest,
  AgonArenaEvaluationStartedRequest,
  AgonArenaEvidenceSubmittedRequest,
  AgonSyndicateContributionRequest,
  AgonSyndicateContributionView,
  AgonPrizeClaimRequest,
  AgonPrizeClaimView,
  AgonSyndicatePrizeTransactionView,
  AgonSyndicatePrizeSubmittedRequest,
} from "./api-types.ts";
import { buildAgonJobEscrowWritePlan, type AgonJobEscrowJob, type AgonJobEscrowReadAdapter } from "../execution/agon-job-escrow.ts";
import { clientReferenceForJobEscrow, hashAgonJobEscrowTerms } from "../execution/job-escrow-state.ts";
import type { AgonEscrowProductionReadiness } from "../execution/escrow-production-readiness.ts";
import type { AgonMarketService, AgonServiceError } from "./routes.ts";
import type { AgonReadiness } from "../write/readiness.ts";
import type { AgonProtocolReadiness } from "../protocol-readiness.ts";
import type { PlaygroundRunStore } from "../playground-store.ts";
import { buildAgonArenaEvaluationInput, buildAgonArenaEvidencePlan, buildAgonArenaRequestPlan, type AgonArenaEvaluation } from "../execution/arena-verification.ts";
import { buildAgonPrizeClaimPlan, buildAgonSyndicateContributionPlan, prizeClaimLeaf } from "../execution/syndicate-prize.ts";
import type { AgonProtocolFinalityReader } from "../execution/protocol-finality.ts";
import { AGON_ARENA_EVALUATOR_ROLE, type AgonArenaEvaluatorReadiness } from "../execution/arena-readiness.ts";
import type { AgonArenaEvaluatorAdapter } from "../execution/arena-evaluator.ts";
import { AgonListingVerificationError, type AgonListingVerifierAdapter, type AgonListingVerifierReadiness } from "../execution/listing-verifier.ts";
import type { X402AgentSpendExecutor } from "../execution/x402-agent-executor.ts";
import type { AgonJobEscrowTransactionAdapter } from "../execution/agon-job-escrow-adapter.ts";
import type { ProviderDraftInput } from "../mcp/contract.ts";
import { verifyHostedProviderManifest, type CompiledProviderManifest } from "../mcp/provider-manifest.ts";

const cursorSchema = z.object({
  updatedAt: z.string().datetime(),
  chainId: z.string().regex(/^[1-9]\d*$/),
  serviceRegistry: z.string().regex(/^0x[0-9a-f]{40}$/),
  listingId: z.string().regex(/^[1-9]\d*$/),
});

export type AgonWriteAdapter = {
  getReadiness(force?: boolean): Promise<AgonReadiness>;
  bindProfile(
    actor: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  publishListing(
    actor: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  publishListingVersion(
    actor: string,
    request: PublishListingVersionRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  pauseListing?(
    actor: string,
    request: PauseListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
  confirmOperation(
    actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>>;
};

export type PostgresAgonMarketServiceOptions = {
  writer?: AgonWriteAdapter;
  /** Agon's own agents (id and publishing wallet); their listings are marked firstParty. */
  firstPartyAgents?: readonly FirstPartyAgent[];
  /** Active catalog registry. Older registry rows remain available by exact reference for reconciliation. */
  activeServiceRegistryAddress?: `0x${string}`;
  /** Test seam for the public hosted-file check before any publication. */
  inspectProviderManifest?: (uri: string) => Promise<ManifestInspection>;
  identityReads?: boolean;
  endpointQa?: boolean | (() => Promise<boolean>);
  certificationLifecycle?: AgonCapabilities["certificationLifecycle"];
  operationsAlertReadiness?: () => Promise<AgonCapabilities["operationsAlerts"]>;
  directX402?: boolean;
  x402ExecutionEnabled?: boolean;
  x402ExecutionPolicy?: import("../execution/x402-policy.ts").X402ExecutionPolicy;
  x402SettlementAdapter?: X402SettlementAdapter;
  x402FacilitatorVerifier?: {
    verify(input: X402FacilitatorVerificationInput): Promise<X402FacilitatorVerificationResult>;
  };
  /** Server-side provider lookup only. Undefined keeps reconciliation disabled. */
  x402ReceiptLookup?: X402ReceiptLookupAdapter;
  /** Durable reserve-before-execute agent wallet path. Disabled unless the executor and flags are enabled. */
  x402AgentSpendExecutor?: X402AgentSpendExecutor;
  /** Server-side PrizeEscrow view lookup only. Undefined keeps pool reads disabled. */
  escrowReadAdapter?: AgonPrizeEscrowReadAdapter;
  /** Configured PrizeEscrow address used to pin any durable pool binding. */
  escrowPoolContract?: `0x${string}`;
  /** Explicitly enabled lifecycle adapter; undefined keeps escrow disabled. */
  escrowExecutionAdapter?: AgonEscrowAdapter;
  escrowExecutionEnabled?: boolean;
  /** Read-only contract preflight used before durable transaction approval. */
  escrowWritePreflightAdapter?: AgonPrizeEscrowWritePreflightAdapter;
  /** Injected writer seam; runtime remains disabled unless both this and the execution flag are enabled. */
  escrowTransactionWriter?: AgonEscrowTransactionWriter;
  /** Pure release-gate snapshot; no provider or wallet work is performed. */
  escrowProductionReadiness?: () => AgonEscrowProductionReadiness;
  /** Receipt-only protocol release gate; never enables writes. */
  protocolReadiness?: () => AgonProtocolReadiness;
  /** Read-only deployed AgonJobEscrow inspection; never submits transactions. */
  jobEscrowReadAdapter?: AgonJobEscrowReadAdapter;
  /** Server-side deployed AgonJobEscrow lifecycle writer; disabled unless explicitly enabled. */
  jobEscrowTransactionAdapter?: AgonJobEscrowTransactionAdapter;
  /** True only when the configured deployment interface matches generated calldata. */
  jobEscrowCalldataSupported?: boolean;
  /** Stable operator-facing reason when job escrow execution is unavailable. */
  jobEscrowExecutionReason?: string | null;
  agonJobEscrowAddress?: `0x${string}`;
  agonArenaAddress?: `0x${string}`;
  /** Read-only evaluator-role readiness. This never grants the role or submits a transaction. */
  arenaEvaluatorReadiness?: () => Promise<AgonArenaEvaluatorReadiness> | AgonArenaEvaluatorReadiness;
  /** Guarded evaluator writer. Provider actions remain wallet-signed by the provider. */
  arenaEvaluatorAdapter?: AgonArenaEvaluatorAdapter;
  arenaEscalation?: (input: { intentId: string; listingReference: string; reasons: readonly string[] }) => Promise<void>;
  listingVerifierAdapter?: AgonListingVerifierAdapter;
  listingVerifierReadiness?: () => Promise<AgonListingVerifierReadiness>;
  validationRegistryAddress?: `0x${string}`;
  playgroundStore?: PlaygroundRunStore;
  agonSyndicateRegistryAddress?: `0x${string}`;
  agonPrizeVaultAddress?: `0x${string}`;
  protocolFinalityReader?: AgonProtocolFinalityReader;
  fetchImpl?: typeof fetch;
};

function parsePositive(value: string, label: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive decimal string`);
  return BigInt(value);
}

function encodeCursor(listing: StoredListing): string {
  return Buffer.from(
    JSON.stringify({
      updatedAt: listing.updatedAt.toISOString(),
      chainId: listing.chainId.toString(),
      serviceRegistry: listing.serviceRegistry,
      listingId: listing.listingId.toString(),
    }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(value: string | null): ListingCursor | null {
  if (value === null) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success) throw new Error("invalid cursor payload");
    return {
      updatedAt: new Date(parsed.data.updatedAt),
      chainId: BigInt(parsed.data.chainId),
      serviceRegistry: parsed.data.serviceRegistry,
      listingId: BigInt(parsed.data.listingId),
    };
  } catch {
    throw new Error("cursor is invalid or expired");
  }
}

function parseReference(reference: string) {
  const parts = reference.split(":");
  if (parts.length !== 3) return null;
  const [chainId, serviceRegistry, listingId] = parts;
  if (!chainId || !serviceRegistry || !listingId) return null;
  if (!/^[1-9]\d*$/.test(chainId) || !/^0x[0-9a-fA-F]{40}$/.test(serviceRegistry)) return null;
  if (!/^[1-9]\d*$/.test(listingId)) return null;
  return { chainId: BigInt(chainId), serviceRegistry, listingId: BigInt(listingId) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function endpointQa(evidence: StoredVerificationEvidence | undefined): AgonEndpointQa {
  if (!evidence) {
    return {
      status: "not_checked",
      checkedAt: null,
      endpointStatus: null,
      evidenceHash: null,
      reason: "Agon has not run endpoint verification for this listing yet.",
      attempts: 0,
      passedAttempts: 0,
      successRate: null,
    };
  }
  const body = record(evidence.evidence);
  const checks = record(body?.checks);
  const x402 = record(checks?.x402_payment);
  const endpointStatus = typeof body?.endpointStatus === "number" && Number.isInteger(body.endpointStatus)
    ? body.endpointStatus
    : null;
  const checkedAt = typeof body?.checkedAt === "string" && !Number.isNaN(Date.parse(body.checkedAt))
    ? new Date(body.checkedAt).toISOString()
    : evidence.createdAt.toISOString();
  const passed = evidence.passed && x402?.passed === true;
  const endpointUrl = typeof body?.endpointUrl === "string" ? body.endpointUrl : undefined;
  const attempts = Number.isSafeInteger(evidence.attempts) && evidence.attempts > 0 ? evidence.attempts : 1;
  const passedAttempts = Number.isSafeInteger(evidence.passedAttempts) && evidence.passedAttempts >= 0
    ? Math.min(evidence.passedAttempts, attempts)
    : (evidence.passed ? 1 : 0);
  const reason = passed
    ? "Agon observed the service endpoint returning HTTP 402."
    : typeof body?.error === "string" && body.error
      ? body.error
      : typeof x402?.detail === "string" && x402.detail
        ? x402.detail
        : "The latest Agon endpoint verification did not pass.";
  return {
    status: passed ? "passed" : "failed",
    checkedAt,
    endpointStatus,
    evidenceHash: evidence.evidenceHash,
    reason,
    attempts,
    passedAttempts,
    successRate: Math.round((passedAttempts / attempts) * 100),
    ...(endpointUrl ? { endpointUrl } : {}),
  };
}

type CachedManifest = { expiresAt: number; body: unknown };

const MANIFEST_CACHE_TTL_MS = 60_000;
const MAX_CACHED_MANIFESTS = 100;
const manifestCache = new Map<string, CachedManifest>();
const manifestRequests = new Map<string, Promise<unknown | undefined>>();

function pruneManifestCache(now: number): void {
  for (const [key, value] of manifestCache) {
    if (value.expiresAt <= now) manifestCache.delete(key);
  }
  while (manifestCache.size > MAX_CACHED_MANIFESTS) {
    const oldest = manifestCache.keys().next().value;
    if (oldest === undefined) return;
    manifestCache.delete(oldest);
  }
}

async function readValidatedManifest(listing: StoredListing): Promise<unknown | undefined> {
  if (listing.status !== "Listed" || listing.quarantineReason) return undefined;
  const cacheKey = `${listing.manifestUri}\n${listing.manifestHash.toLowerCase()}`;
  pruneManifestCache(Date.now());
  const cached = manifestCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.body;

  const inFlight = manifestRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = inspectManifest(listing.manifestUri)
    .then((inspection) => {
      if (!inspection.validation.ok || inspection.manifestHash.toLowerCase() !== listing.manifestHash.toLowerCase()) return undefined;
      manifestCache.set(cacheKey, { expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS, body: inspection.body });
      pruneManifestCache(Date.now());
      return inspection.body;
    })
    .catch(() => undefined)
    .finally(() => { manifestRequests.delete(cacheKey); });
  manifestRequests.set(cacheKey, request);
  return request;
}

function listingView(listing: StoredListing, firstParty: readonly FirstPartyAgent[], evidence?: StoredVerificationEvidence, manifestBody?: unknown): AgonListingView {
  const unverified = listing.verification !== "Verified";
  const warning = listing.quarantineReason
    ? `This listing is quarantined because its indexed anchor failed validation: ${listing.quarantineReason}.`
    : unverified
      ? "Marketplace verification is not confirmed for this version. Arena test evidence may exist separately."
      : null;
  return {
    id: `${listing.chainId}:${listing.serviceRegistry}:${listing.listingId}`,
    chainId: listing.chainId.toString(),
    serviceRegistry: listing.serviceRegistry,
    listingId: listing.listingId.toString(),
    agentId: listing.agentId.toString(),
    serviceKey: listing.serviceKey,
    category: listing.category.toString(),
    version: listing.currentVersion.toString(),
    manifest: {
      hash: listing.manifestHash,
      uri: listing.manifestUri,
      ...(manifestBody === undefined ? {} : { body: manifestBody }),
    },
    providerSnapshot: listing.providerSnapshot,
    status: listing.status,
    verification: {
      status: listing.verification,
      scope: {
        agentId: listing.agentId.toString(),
        listingId: listing.listingId.toString(),
        version: listing.currentVersion.toString(),
        category: listing.category.toString(),
      },
    },
    risk: {
      unverified,
      warning,
      quarantineReason: listing.quarantineReason,
    },
    endpointQa: endpointQa(evidence),
    payment: {
      rail: listing.paymentRail,
      directX402: listing.paymentRail === "X402" && listing.status === "Listed",
      escrowEligible:
        listing.paymentRail === "Escrow" &&
        listing.status === "Listed" &&
        listing.verification === "Verified" &&
        listing.quarantineReason === null,
    },
    provenance: {
      sourceBlockNumber: listing.sourceBlockNumber.toString(),
      sourceTxHash: listing.sourceTxHash,
      sourceLogIndex: listing.sourceLogIndex,
    },
    firstParty: isFirstParty(listing, firstParty),
  };
}

function escrowIntentView(intent: StoredAgonEscrowIntent, listingReference: string): AgonEscrowIntentView {
  const terminal = intent.state === "released" || intent.state === "refunded" || intent.state === "failed";
  return {
    intentId: intent.intentId,
    actor: intent.actor as `0x${string}`,
    idempotencyKey: intent.idempotencyKey,
    listingReference,
    termsHash: intent.termsHash,
    network: intent.terms.network,
    asset: intent.terms.asset,
    buyer: intent.terms.buyer,
    beneficiary: intent.terms.beneficiary,
    listing: intent.terms.listing,
    amountBaseUnits: intent.terms.amountBaseUnits.toString(),
    feeBps: intent.terms.feeBps,
    expiresAt: intent.terms.expiresAt.toISOString(),
    state: intent.state,
    providerReference: intent.providerReference,
    transaction: intent.transaction,
    poolBinding: intent.poolBinding ?? null,
    executionEnabled: false,
    nextAction: intent.state === "unknown"
      ? "reconcile_unknown_outcome"
      : terminal
        ? "none"
        : "escrow_adapter_not_enabled",
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function jobEscrowIntentView(intent: StoredAgonJobEscrowIntent, executionEnabled = false): AgonJobEscrowIntentView {
  const terminal = intent.state === "complete" || intent.state === "rejected" || intent.state === "failed";
  return {
    intentId: intent.intentId,
    actor: intent.actor,
    idempotencyKey: intent.idempotencyKey,
    listingReference: intent.listingReference,
    network: intent.network,
    asset: intent.asset,
    escrowContract: intent.escrowContract,
    buyer: intent.buyer,
    provider: intent.provider,
    listing: {
      serviceRegistry: intent.serviceRegistry,
      listingId: intent.listingId,
      agentId: intent.agentId,
      version: intent.listingVersion,
      manifestHash: intent.manifestHash,
    },
    termsHash: intent.termsHash,
    amountBaseUnits: intent.amountBaseUnits.toString(),
    feeBps: intent.feeBps,
    reviewHours: intent.reviewHours,
    expiresAt: intent.expiresAt.toISOString(),
    clientReference: intent.clientReference,
    state: intent.state,
    settlement: intent.settlement,
    onchainJobId: intent.onchainJobId,
    transactionHash: intent.transactionHash,
    deliverableHash: intent.deliverableHash,
    lastReconciledAt: intent.lastReconciledAt?.toISOString() ?? null,
    executionEnabled,
    nextAction: terminal ? "none" : intent.state === "unknown" ? "manual_reconciliation" : executionEnabled ? "execute_lifecycle" : intent.state === "prepared" ? "prepare_transaction" : "inspect_chain",
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

function arenaEvaluationView(evaluation: StoredAgonArenaEvaluation): AgonArenaEvaluationView {
  const terminal = ["rejected", "expired", "revoked"].includes(evaluation.state)
    || (evaluation.state === "verified" && evaluation.marketplaceVerificationState === "confirmed");
  const verificationStatus: AgonArenaEvaluationView["verificationStatus"] = evaluation.state === "verified" && evaluation.marketplaceVerificationState !== "confirmed"
    ? "publishing_to_market"
    : terminal
    ? evaluation.state as "verified" | "rejected" | "expired" | "revoked"
    : evaluation.state === "prepared"
      ? "prepared"
      : evaluation.state === "request_submitted"
        ? "user_submitted"
        : evaluation.state === "evidence_submitted"
          ? "evidence_submitted"
          : "chain_reconciliation_required";
  const nextAction: AgonArenaEvaluationView["nextAction"] = evaluation.state === "verified" && evaluation.marketplaceVerificationState !== "confirmed"
    ? "reconcile_marketplace"
    : terminal
    ? "none"
    : evaluation.state === "prepared"
    ? "prepare_request_transaction"
    : evaluation.state === "request_submitted"
      ? "record_start_submission"
      : evaluation.state === "evidence_ready"
        ? "prepare_evidence_transaction"
      : evaluation.state === "evidence_submitted"
        ? "reconcile_chain"
        : "reconcile_chain";
  return {
    intentId: evaluation.intentId,
    actor: evaluation.actor,
    idempotencyKey: evaluation.idempotencyKey,
    listingReference: evaluation.listingReference,
    network: evaluation.network,
    arenaContract: evaluation.arenaContract,
    validationRegistry: evaluation.validationRegistry,
    participant: evaluation.participant,
    listing: {
      serviceRegistry: evaluation.serviceRegistry,
      listingId: evaluation.listingId,
      agentId: evaluation.agentId,
      version: evaluation.listingVersion,
      category: evaluation.category,
      manifestHash: evaluation.manifestHash,
    },
    capabilityHash: evaluation.capabilityHash,
    evaluatorVersionHash: evaluation.evaluatorVersionHash,
    taskCommitment: evaluation.taskCommitment,
    validationRequestHash: evaluation.validationRequestHash,
    evidenceRoot: evaluation.evidenceRoot,
    playgroundRunId: evaluation.playgroundRunId,
    expiresAt: evaluation.expiresAt.toISOString(),
    state: evaluation.state,
    evaluationId: evaluation.evaluationId,
    requestTransactionHash: evaluation.requestTransactionHash,
    startTransactionHash: evaluation.startTransactionHash,
    evidenceTransactionHash: evaluation.evidenceTransactionHash,
    marketplaceVerification: {
      state: evaluation.marketplaceVerificationState,
      transactionHash: evaluation.marketplaceVerificationTransactionHash,
      error: evaluation.marketplaceVerificationError,
      verifiedAt: evaluation.marketplaceVerifiedAt?.toISOString() ?? null,
    },
    executionEnabled: false,
    verificationStatus,
    nextAction,
    createdAt: evaluation.createdAt.toISOString(),
    updatedAt: evaluation.updatedAt.toISOString(),
  };
}

function syndicateContributionView(value: StoredAgonSyndicateContribution): AgonSyndicateContributionView {
  return {
    intentId: value.intentId,
    actor: value.actor,
    idempotencyKey: value.idempotencyKey,
    network: "eip155:5042002",
    registryContract: value.registryContract,
    syndicateId: value.syndicateId,
    agentId: value.agentId,
    contributionKey: value.contributionKey,
    score: value.score,
    evidenceHash: value.evidenceHash,
    state: value.state,
    transactionHash: value.transactionHash,
    executionEnabled: false,
    nextAction: value.state === "prepared" ? "prepare_transaction" : value.state === "confirmed" ? "none" : "reconcile_chain",
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function prizeClaimView(value: StoredAgonPrizeClaim): AgonPrizeClaimView {
  return {
    intentId: value.intentId,
    actor: value.actor,
    idempotencyKey: value.idempotencyKey,
    network: "eip155:5042002",
    vaultContract: value.vaultContract,
    poolKey: value.poolKey,
    index: value.index,
    beneficiary: value.beneficiary,
    amount: value.amount,
    proof: value.proof,
    leaf: value.leaf,
    state: value.state,
    transactionHash: value.transactionHash,
    executionEnabled: false,
    nextAction: value.state === "prepared" ? "prepare_transaction" : value.state === "confirmed" ? "none" : "reconcile_chain",
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function escrowReadinessView(intent: StoredAgonEscrowIntent, pool: AgonEscrowReadinessView["pool"]): AgonEscrowReadinessView {
  const terminal = intent.state === "released" || intent.state === "refunded" || intent.state === "failed";
  return {
    intentId: intent.intentId,
    state: intent.state,
    status: intent.state === "unknown" ? "reconciliation_required" : terminal ? "terminal" : "adapter_disabled",
    reason: intent.state === "unknown"
      ? "The previous escrow operation has an unknown outcome and requires independent reconciliation."
      : terminal
        ? "The escrow intent is terminal; no further operation is available."
        : "Agon escrow execution is disabled; the durable intent is ready for a separately approved adapter.",
    executionEnabled: false,
    nextAction: intent.state === "unknown"
      ? "reconcile_unknown_outcome"
      : terminal
        ? "none"
        : "escrow_adapter_not_enabled",
    pool,
    checkedAt: new Date().toISOString(),
  };
}

function escrowTransactionApprovalView(
  approval: {
    approvalHash: string;
    intentId: string;
    actor: string;
    operation: AgonEscrowWriteOperation;
    intentHash: string;
    approvalIdempotencyKey: string;
    approvedAt: Date;
    expiresAt: Date;
  },
  now = new Date(),
): AgonEscrowTransactionApprovalView {
  const expired = now >= approval.expiresAt;
  return {
    status: expired ? "expired" : "approved",
    approvalHash: approval.approvalHash,
    intentId: approval.intentId,
    actor: approval.actor as `0x${string}`,
    operation: approval.operation,
    intentHash: approval.intentHash,
    approvalIdempotencyKey: approval.approvalIdempotencyKey,
    testnetOnly: true,
    approvedAt: approval.approvedAt.toISOString(),
    expiresAt: approval.expiresAt.toISOString(),
    executionEnabled: false,
    nextAction: expired ? "refresh_expired_approval" : "transaction_adapter_not_enabled",
  };
}

function internalError(error: unknown): Result<never, AgonServiceError> {
  console.error("[agon] service error:", error instanceof Error ? error.message : "unknown failure");
  return { ok: false, error: { code: "internal", message: "Agon service request failed" } };
}

function jsonSafeTransactionArgs(args: readonly unknown[]): unknown[] {
  return args.map((value) => (typeof value === "bigint" ? value.toString() : value));
}

function facilitatorVerificationView(evidence: StoredX402FacilitatorVerification): X402FacilitatorVerificationView {
  return {
    receiptId: evidence.receiptId,
    intentId: evidence.intentId,
    state: "facilitator_verified",
    network: evidence.network,
    payer: evidence.payer as `0x${string}` | null,
    approvalHash: evidence.approvalHash,
    evidenceHash: evidence.evidenceHash,
    verified: true,
    executionEnabled: false,
    nextAction: "settlement_remains_disabled",
    verifiedAt: evidence.verifiedAt.toISOString(),
  };
}

function deliveryEvidenceView(evidence: import("../store/repository.ts").StoredX402DeliveryEvidence): X402DeliveryEvidenceView {
  return {
    deliveryId: evidence.deliveryId,
    receiptId: evidence.receiptId,
    intentId: evidence.intentId,
    provider: evidence.provider,
    listingReference: evidence.listingReference,
    state: "service_delivered",
    serviceStatus: evidence.serviceStatus,
    latencyMs: evidence.latencyMs,
    responseHash: evidence.responseHash,
    resultAttestationHash: evidence.resultAttestationHash,
    chargedAmountUSDC: evidence.chargedAmountUSDC,
    evidenceHash: evidence.evidenceHash,
    deliveredAt: evidence.deliveredAt.toISOString(),
    executionEnabled: false,
    nextAction: "reconcile_receipt",
  };
}

function quoteView(
  intent: { intentId: string; targetUrl?: string | null },
  receipt: { receiptId: string; updatedAt: Date },
  snapshot: X402QuoteSnapshot,
  quoteHash: string,
): X402QuoteView {
  return {
    receiptId: receipt.receiptId,
    intentId: intent.intentId,
    state: "payment_required",
    status: 402,
    targetUrl: intent.targetUrl!,
    quoteHash,
    x402Version: 2,
    resource: {
      url: snapshot.resource.url,
      description: snapshot.resource.description ?? null,
      mimeType: snapshot.resource.mimeType ?? null,
    },
    accepts: snapshot.accepts.map((option) => ({
      scheme: option.scheme,
      network: option.network,
      asset: option.asset,
      amount: option.amount,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds,
      gateway: option.extra.name === "GatewayWalletBatched",
    })),
    executionEnabled: false,
    nextAction: "authorization_not_enabled",
    capturedAt: receipt.updatedAt.toISOString(),
  };
}

function authorizationView(
  intentId: string,
  receipt: { receiptId: string; updatedAt: Date },
  payload: X402AuthorizationPayload,
  payloadHash: string,
): X402AuthorizationView {
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_ready",
    payloadHash,
    payload: payload as unknown as X402AuthorizationView["payload"],
    expiresAt: new Date(Number(payload.message.validBefore) * 1000).toISOString(),
    executionEnabled: false,
    nextAction: "user_signature_required",
    preparedAt: receipt.updatedAt.toISOString(),
  };
}

function authorizationSubmittedView(
  intentId: string,
  receipt: { receiptId: string; authorizationHash: string | null; updatedAt: Date },
): X402AuthorizationSubmittedView {
  if (!receipt.authorizationHash) throw new Error("authorization receipt has no signature hash");
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_submitted",
    authorizationHash: receipt.authorizationHash,
    signatureAccepted: true,
    executionEnabled: false,
    nextAction: "settlement_not_enabled",
    submittedAt: receipt.updatedAt.toISOString(),
  };
}

function executionPlanView(
  intentId: string,
  receipt: { receiptId: string; updatedAt: Date },
  plan: X402ExecutionPlanView["plan"],
): X402ExecutionPlanView {
  return {
    receiptId: receipt.receiptId,
    intentId,
    state: "authorization_submitted",
    plan,
    executionEnabled: false,
    nextAction: "explicit_execution_approval",
    preparedAt: receipt.updatedAt.toISOString(),
  };
}

function executionApprovalView(
  receipt: { receiptId: string },
  approval: {
    approvalHash: string;
    intentId: string;
    actor: string;
    planHash: string;
    authorizationHash: string;
    approvalIdempotencyKey: string;
    approvedAt: Date;
    expiresAt: Date;
  },
): X402ExecutionApprovalView {
  return {
    approvalHash: approval.approvalHash,
    receiptId: receipt.receiptId,
    intentId: approval.intentId,
    actor: approval.actor as `0x${string}`,
    planHash: approval.planHash,
    authorizationHash: approval.authorizationHash,
    approvalIdempotencyKey: approval.approvalIdempotencyKey,
    testnetOnly: true,
    approvedAt: approval.approvedAt.toISOString(),
    expiresAt: approval.expiresAt.toISOString(),
    executionEnabled: false,
    nextAction: "execution_adapter_not_enabled",
  };
}

export class PostgresAgonMarketService implements AgonMarketService {
  private readonly firstParty: readonly FirstPartyAgent[];
  private readonly repository: PostgresAgonRepository;
  private readonly options: PostgresAgonMarketServiceOptions;
  private readonly escrowExecutionAdapter: AgonEscrowAdapter;
  private readonly escrowLifecycle: ReturnType<typeof createAgonEscrowLifecycleOrchestrator>;

  constructor(repository: PostgresAgonRepository, options: PostgresAgonMarketServiceOptions = {}) {
    this.repository = repository;
    this.options = options;
    this.firstParty = options.firstPartyAgents ?? [];
    const transactionAdapter = options.escrowTransactionWriter && options.escrowWritePreflightAdapter
      ? createApprovalBoundAgonEscrowTransactionAdapter({
          store: repository,
          preflight: options.escrowWritePreflightAdapter,
          writer: options.escrowTransactionWriter,
          enabled: options.escrowExecutionEnabled === true,
        })
      : null;
    this.escrowExecutionAdapter = options.escrowExecutionAdapter ?? transactionAdapter ?? createDisabledAgonEscrowAdapter();
    this.escrowLifecycle = createAgonEscrowLifecycleOrchestrator({
      store: repository,
      enabled: options.escrowExecutionEnabled === true,
      adapter: this.escrowExecutionAdapter,
    });
  }

  async listListings(query: ListingQuery): Promise<Result<ListingPage, AgonServiceError>> {
    try {
      const rows = await this.repository.listListings({
        limit: query.limit,
        cursor: decodeCursor(query.cursor),
        category: query.category ? parsePositive(query.category, "category") : null,
        agentId: query.agentId ? parsePositive(query.agentId, "agent id") : null,
        serviceRegistry: this.options.activeServiceRegistryAddress ?? null,
      });
      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      const evidence = await this.repository.getLatestVerificationEvidence(pageRows);
      const manifestBodies = query.includeManifest === true
        ? await Promise.all(pageRows.map((listing) => readValidatedManifest(listing)))
        : [];
      return {
        ok: true,
        value: {
          items: pageRows.map((listing, index) => listingView(listing, this.firstParty, evidence.get(`${listing.listingId}:${listing.agentId}`), manifestBodies[index])),
          nextCursor: hasMore && last ? encodeCursor(last) : null,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("cursor")) {
        return { ok: false, error: { code: "validation_failed", message: error.message } };
      }
      return internalError(error);
    }
  }

  async getListing(reference: string): Promise<Result<AgonListingView, AgonServiceError>> {
    const key = parseReference(reference);
    if (!key) return { ok: false, error: { code: "not_found", message: "listing not found" } };
    try {
      const listing = await this.repository.getListing(key);
      return listing
        ? {
            ok: true,
            value: listingView(
              listing,
              this.firstParty,
              (await this.repository.getLatestVerificationEvidence([listing])).get(`${listing.listingId}:${listing.agentId}`),
            ),
          }
        : { ok: false, error: { code: "not_found", message: "listing not found" } };
    } catch (error) {
      return internalError(error);
    }
  }

  async bindProfile(
    actor: string,
    request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "profile writes are unavailable" },
      };
    }
    return this.options.writer.bindProfile(actor, request);
  }

  async publishListing(
    actor: string,
    request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "listing writes are unavailable" },
      };
    }
    try {
      const hosted = await verifyHostedManifestHash(request.manifestUri, request.manifestHash, this.options.inspectProviderManifest ?? inspectManifest);
      const manifest = normalizeManifestV2(hosted.body);
      if (!manifest.ok || manifest.value.identity.agentId !== request.agentId
        || manifest.value.identity.serviceKey.toLowerCase() !== request.serviceKey.toLowerCase()
        || manifest.value.service.version !== "1") {
        throw new Error("The hosted service file must describe this agent, service key, and first listing version.");
      }
    } catch (error) {
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "The hosted service file could not be checked" } };
    }
    return this.options.writer.publishListing(actor, request);
  }

  async getProviderListingForVersion(listingId: string): Promise<Result<AgonListingView, AgonServiceError>> {
    if (!/^[1-9]\d*$/.test(listingId) || !this.options.activeServiceRegistryAddress) {
      return { ok: false, error: { code: "validation_failed", message: "an active registry and positive listing ID are required" } };
    }
    return this.getListing(`5042002:${this.options.activeServiceRegistryAddress}:${listingId}`);
  }

  async publishProviderDraft(
    actor: string,
    draft: ProviderDraftInput,
    compiled: CompiledProviderManifest,
    manifestUri: string,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) return { ok: false, error: { code: "capability_unavailable", message: "listing writes are unavailable" } };
    if (!/^\d+$/.test(draft.category) || BigInt(draft.category) <= 0n) {
      return { ok: false, error: { code: "validation_failed", message: "provider category must be a positive onchain category id" } };
    }
    if (!/^https:\/\//.test(manifestUri)) {
      return { ok: false, error: { code: "validation_failed", message: "a public HTTPS manifest URI is required" } };
    }
    try {
      await verifyHostedProviderManifest(manifestUri, compiled, this.options.inspectProviderManifest ?? inspectManifest);
    } catch (error) {
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "The hosted service file could not be checked" } };
    }
    const result = await this.options.writer.publishListing(actor, {
      chainId: "5042002",
      agentId: compiled.body.identity.agentId,
      serviceKey: compiled.serviceKey,
      manifestHash: compiled.manifestHash,
      manifestUri,
      category: draft.category,
      paymentRail: "X402",
    });
    return result;
  }

  async publishProviderDraftVersion(
    actor: string,
    _draft: ProviderDraftInput,
    compiled: CompiledProviderManifest,
    manifestUri: string,
    listingId: string,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) return { ok: false, error: { code: "capability_unavailable", message: "listing writes are unavailable" } };
    if (!/^[1-9]\d*$/.test(listingId)) return { ok: false, error: { code: "validation_failed", message: "listing id must be a positive decimal string" } };
    if (!/^https:\/\//.test(manifestUri)) return { ok: false, error: { code: "validation_failed", message: "a public HTTPS manifest URI is required" } };
    const current = await this.getProviderListingForVersion(listingId);
    if (!current.ok) return current;
    if (current.value.providerSnapshot.toLowerCase() !== actor.toLowerCase()
      || current.value.agentId !== compiled.body.identity.agentId
      || current.value.serviceKey.toLowerCase() !== compiled.serviceKey.toLowerCase()
      || !/^[1-9]\d*$/.test(current.value.version)
      || compiled.body.service.version !== (BigInt(current.value.version) + 1n).toString()) {
      return { ok: false, error: { code: "validation_failed", message: "The existing listing changed or this file does not describe its next version. Compile the latest listing again." } };
    }
    try {
      await verifyHostedProviderManifest(manifestUri, compiled, this.options.inspectProviderManifest ?? inspectManifest);
    } catch (error) {
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "The hosted service file could not be checked" } };
    }
    const result = await this.options.writer.publishListingVersion(actor, {
      chainId: "5042002",
      listingId,
      manifestHash: compiled.manifestHash,
      manifestUri,
      paymentRail: "X402",
    });
    return result;
  }

  async publishListingVersion(
    actor: string,
    request: PublishListingVersionRequest,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "listing writes are unavailable" },
      };
    }
    const current = await this.getProviderListingForVersion(request.listingId);
    if (!current.ok) return current;
    try {
      const hosted = await verifyHostedManifestHash(request.manifestUri, request.manifestHash, this.options.inspectProviderManifest ?? inspectManifest);
      const manifest = normalizeManifestV2(hosted.body);
      if (!manifest.ok || current.value.providerSnapshot.toLowerCase() !== actor.toLowerCase()
        || manifest.value.identity.agentId !== current.value.agentId
        || manifest.value.identity.serviceKey.toLowerCase() !== current.value.serviceKey.toLowerCase()
        || !/^[1-9]\d*$/.test(current.value.version)
        || manifest.value.service.version !== (BigInt(current.value.version) + 1n).toString()) {
        throw new Error("The hosted service file must describe the next version of this listing and its current owner.");
      }
    } catch (error) {
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "The hosted service file could not be checked" } };
    }
    return this.options.writer.publishListingVersion(actor, request);
  }

  async pauseProviderListing(
    actor: string,
    reference: string,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer?.pauseListing) {
      return { ok: false, error: { code: "capability_unavailable", message: "listing status writes are unavailable" } };
    }
    const parsed = parseReference(reference);
    if (!parsed || parsed.chainId !== 5_042_002n) {
      return { ok: false, error: { code: "validation_failed", message: "listing reference must be an Arc Testnet listing reference" } };
    }
    const result = await this.options.writer.pauseListing(actor, {
      chainId: parsed.chainId.toString(),
      listingId: parsed.listingId.toString(),
    });
    return result;
  }

  async confirmOperation(
    actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, AgonServiceError>> {
    if (!this.options.writer) {
      return {
        ok: false,
        error: { code: "capability_unavailable", message: "write confirmation is unavailable" },
      };
    }
    return this.options.writer.confirmOperation(actor, operationId, txHash);
  }

  async prepareAgonEscrowIntent(
    actor: string,
    request: AgonEscrowIntentRequest,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const listing = await this.getListing(request.listingReference);
    if (!listing.ok) return listing;
    const terms = evaluateAgonEscrowTerms({
      listing: {
        serviceRegistry: listing.value.serviceRegistry,
        listingId: listing.value.listingId,
        agentId: listing.value.agentId,
        version: listing.value.version,
        manifestHash: listing.value.manifest.hash,
        providerSnapshot: listing.value.providerSnapshot,
        status: listing.value.status,
        verification: listing.value.verification.status,
        paymentRail: listing.value.payment.rail,
        quarantineReason: listing.value.risk.quarantineReason,
      } satisfies AgonEscrowListing,
      buyer: actor,
      amountBaseUnits: request.amountBaseUnits,
      expiresAt: new Date(request.expiresAt),
    });
    if (!terms.ok) {
      return {
        ok: false,
        error: {
          code: terms.error.code === "escrow_not_eligible" ? "capability_unavailable" : "validation_failed",
          message: terms.error.message,
        },
      };
    }
    try {
      let poolBinding: AgonPrizeEscrowPoolBinding | null = null;
      if (request.poolBinding) {
        if (!this.options.escrowPoolContract) {
          return { ok: false, error: { code: "capability_unavailable", message: "PrizeEscrow pool binding is not configured" } };
        }
        try {
          poolBinding = validateAgonPrizeEscrowPoolBinding({
            contractAddress: this.options.escrowPoolContract,
            controller: request.poolBinding.controller,
            poolId: request.poolBinding.poolId,
          }, this.options.escrowPoolContract);
        } catch (error) {
          return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "PrizeEscrow pool binding is invalid" } };
        }
      }
      const stored = await this.repository.prepareAgonEscrowIntent({
        intentId: randomUUID(),
        actor: actor as `0x${string}`,
        idempotencyKey: request.idempotencyKey,
        listingReference: request.listingReference,
        termsHash: hashAgonEscrowTerms(terms.value),
        terms: terms.value,
        state: "prepared",
        providerReference: null,
        transaction: null,
        poolBinding,
      });
      return { ok: true, value: escrowIntentView(stored, stored.listingReference) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency")) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async getAgonEscrowIntent(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can read this intent" } };
    return { ok: true, value: escrowIntentView(intent, intent.listingReference) };
  }

  async getAgonEscrowReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowReadinessView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can read escrow readiness" } };
    let pool: AgonEscrowReadinessView["pool"] = {
      status: "unbound",
      contractAddress: null,
      controller: null,
      poolId: null,
      balanceBaseUnits: null,
      checkedAt: null,
    };
    if (intent.poolBinding) {
      pool = {
        status: !this.options.escrowReadAdapter?.enabled ? "lookup_disabled" : "unavailable",
        contractAddress: intent.poolBinding.contractAddress,
        controller: intent.poolBinding.controller,
        poolId: intent.poolBinding.poolId,
        balanceBaseUnits: null,
        checkedAt: null,
      };
      if (this.options.escrowReadAdapter?.enabled) {
        try {
          const result = await this.options.escrowReadAdapter.inspect({
            network: intent.terms.network,
            escrowAddress: intent.poolBinding.contractAddress,
            controller: intent.poolBinding.controller,
            poolId: intent.poolBinding.poolId,
            expectedAsset: intent.terms.asset,
            expectedBalanceBaseUnits: intent.terms.amountBaseUnits.toString(),
          });
          pool = {
            ...pool,
            status: result.controllerAuthorized ? "match" : "controller_unapproved",
            balanceBaseUnits: result.balanceBaseUnits,
            checkedAt: result.checkedAt ?? new Date().toISOString(),
          };
        } catch (error) {
          if (error instanceof Error && (error.message.includes("does not match") || error.message.includes("different"))) pool.status = "mismatch";
        }
      }
    }
    return { ok: true, value: escrowReadinessView(intent, pool) };
  }

  async getAgonEscrowTransaction(
    actor: string,
    intentId: string,
    operation: "fund",
  ): Promise<Result<AgonEscrowTransactionView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can prepare this transaction" } };
    if (intent.state !== "prepared") return { ok: false, error: { code: "execution_not_ready", message: `escrow intent is ${intent.state}; funding is no longer ready` } };
    if (!this.options.agonJobEscrowAddress) return { ok: false, error: { code: "capability_unavailable", message: "AgonJobEscrow is not configured" } };
    if (this.options.jobEscrowCalldataSupported !== true) return { ok: false, error: { code: "capability_unavailable", message: "The deployed AgonJobEscrow interface is not supported for transaction preparation" } };
    if (operation !== "fund") return { ok: false, error: { code: "validation_failed", message: "unsupported escrow transaction" } };

    const clientReference = keccak256(stringToHex(intent.idempotencyKey));
    const args = [
      clientReference,
      BigInt(intent.terms.listing.listingId),
      intent.termsHash as `0x${string}`,
      intent.terms.amountBaseUnits,
      0n,
    ] as const;
    const data = encodeFunctionData({
      abi: [{
        type: "function",
        name: "createJob",
        stateMutability: "nonpayable",
        inputs: [
          { name: "clientReference", type: "bytes32" },
          { name: "listingId", type: "uint256" },
          { name: "termsHash", type: "bytes32" },
          { name: "amount", type: "uint256" },
          { name: "reviewHours", type: "uint64" },
        ],
        outputs: [{ name: "jobId", type: "uint256" }],
      }] as const,
      functionName: "createJob",
      args,
    });
    return {
      ok: true,
      value: {
        intentId,
        operation,
        chainId: "5042002",
        to: this.options.agonJobEscrowAddress,
        functionName: "createJob",
        args: [clientReference, intent.terms.listing.listingId, intent.termsHash as `0x${string}`, intent.terms.amountBaseUnits.toString(), 0],
        data,
        nextAction: "approve_usdc_then_submit",
      },
    };
  }

  async prepareAgonJobEscrowIntent(
    actor: string,
    request: AgonJobEscrowIntentRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>> {
    if (!this.options.agonJobEscrowAddress) return { ok: false, error: { code: "capability_unavailable", message: "AgonJobEscrow is not configured" } };
    if (this.options.jobEscrowCalldataSupported !== true) return { ok: false, error: { code: "capability_unavailable", message: "The deployed AgonJobEscrow interface is not supported for new jobs" } };
    const listing = await this.getListing(request.listingReference);
    if (!listing.ok) return listing;
    const expiresAt = new Date(request.expiresAt);
    const terms = evaluateAgonEscrowTerms({
      listing: {
        serviceRegistry: listing.value.serviceRegistry,
        listingId: listing.value.listingId,
        agentId: listing.value.agentId,
        version: listing.value.version,
        manifestHash: listing.value.manifest.hash,
        providerSnapshot: listing.value.providerSnapshot,
        status: listing.value.status,
        verification: listing.value.verification.status,
        paymentRail: listing.value.payment.rail,
        quarantineReason: listing.value.risk.quarantineReason,
      } satisfies AgonEscrowListing,
      buyer: actor,
      amountBaseUnits: request.amountBaseUnits,
      expiresAt,
    });
    if (!terms.ok) {
      return { ok: false, error: { code: terms.error.code === "escrow_not_eligible" ? "capability_unavailable" : "validation_failed", message: terms.error.message } };
    }
    const clientReference = clientReferenceForJobEscrow(request.idempotencyKey);
    const termsHash = hashAgonJobEscrowTerms({
      network: terms.value.network,
      asset: terms.value.asset,
      buyer: terms.value.buyer,
      provider: terms.value.beneficiary,
      escrowContract: this.options.agonJobEscrowAddress,
      serviceRegistry: terms.value.listing.serviceRegistry,
      listingId: terms.value.listing.listingId,
      agentId: terms.value.listing.agentId,
      listingVersion: terms.value.listing.version,
      manifestHash: terms.value.listing.manifestHash,
      amountBaseUnits: terms.value.amountBaseUnits,
      feeBps: terms.value.feeBps,
      reviewHours: request.reviewHours,
      expiresAt,
    });
    try {
      const stored = await this.repository.prepareAgonJobEscrowIntent({
        intentId: randomUUID(),
        idempotencyKey: request.idempotencyKey,
        actor: actor as `0x${string}`,
        buyer: terms.value.buyer,
        provider: terms.value.beneficiary,
        listingReference: request.listingReference,
        network: terms.value.network,
        asset: terms.value.asset,
        escrowContract: this.options.agonJobEscrowAddress,
        serviceRegistry: terms.value.listing.serviceRegistry,
        listingId: terms.value.listing.listingId,
        agentId: terms.value.listing.agentId,
        listingVersion: terms.value.listing.version,
        manifestHash: terms.value.listing.manifestHash,
        termsHash,
        amountBaseUnits: terms.value.amountBaseUnits,
        feeBps: terms.value.feeBps,
        reviewHours: request.reviewHours,
        expiresAt,
        clientReference,
        state: "prepared",
        settlement: "none",
        onchainJobId: null,
        transactionHash: null,
        deliverableHash: null,
        reasonHash: null,
        lastReconciledAt: null,
      });
      return { ok: true, value: jobEscrowIntentView(stored, this.options.jobEscrowTransactionAdapter?.enabled === true) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency")) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async getAgonJobEscrowIntent(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>> {
    const intent = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "AgonJobEscrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the job escrow intent owner can read this intent" } };
    return { ok: true, value: jobEscrowIntentView(intent, this.options.jobEscrowTransactionAdapter?.enabled === true) };
  }

  async getAgonJobEscrowTransaction(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonJobEscrowTransactionView, AgonServiceError>> {
    const intent = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "AgonJobEscrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the job escrow intent owner can prepare this transaction" } };
    if (intent.state !== "prepared") return { ok: false, error: { code: "execution_not_ready", message: `job escrow intent is ${intent.state}; createJob is no longer ready` } };
    if (this.options.jobEscrowCalldataSupported !== true) return { ok: false, error: { code: "capability_unavailable", message: "The deployed AgonJobEscrow interface is not supported for transaction preparation" } };
    const plan = buildAgonJobEscrowWritePlan({
      contractAddress: intent.escrowContract,
      action: "create",
      clientReference: intent.clientReference,
      listingId: intent.listingId,
      termsHash: intent.termsHash,
      amountBaseUnits: intent.amountBaseUnits,
      reviewHours: intent.reviewHours,
    });
    return {
      ok: true,
      value: {
        intentId: intent.intentId,
        chainId: plan.chainId.toString(),
        to: plan.contractAddress,
        functionName: "createJob",
        args: plan.args as [`0x${string}`, string, `0x${string}`, string, number],
        data: plan.data,
        executionEnabled: false,
        nextAction: "approve_usdc_then_submit",
      },
    };
  }

  async reconcileAgonJobEscrowIntent(
    actor: string,
    intentId: string,
    request: AgonJobEscrowReconcileRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>> {
    if (!this.options.jobEscrowReadAdapter?.enabled) return { ok: false, error: { code: "reconciliation_disabled", message: "AgonJobEscrow reconciliation is disabled by policy" } };
    const intent = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "AgonJobEscrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the job escrow intent owner can reconcile this intent" } };
    if (intent.escrowContract !== this.options.agonJobEscrowAddress?.toLowerCase()) return { ok: false, error: { code: "reconciliation_invalid", message: "job escrow intent is pinned to a different deployed contract" } };
    try {
      const job = await this.options.jobEscrowReadAdapter.inspect(request.jobId);
      const stored = await this.repository.reconcileAgonJobEscrowIntent({ intentId, job });
      return { ok: true, value: jobEscrowIntentView(stored, this.options.jobEscrowTransactionAdapter?.enabled === true) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) {
        const code = error.message.includes("does not match") || error.message.includes("different on-chain")
          ? "reconciliation_invalid"
          : "conflict";
        return { ok: false, error: { code, message: error.message } };
      }
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "AgonJobEscrow inspection failed" } };
    }
  }

  async markAgonJobEscrowSubmitted(
    actor: string,
    intentId: string,
    request: AgonJobEscrowSubmittedRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>> {
    const intent = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "AgonJobEscrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the job escrow intent owner can record submission" } };
    try {
      const stored = await this.repository.markAgonJobEscrowSubmitted({ intentId, transactionHash: request.transactionHash as `0x${string}` });
      return { ok: true, value: jobEscrowIntentView(stored, this.options.jobEscrowTransactionAdapter?.enabled === true) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async prepareAgonArenaEvaluation(
    actor: string,
    request: AgonArenaEvaluationRequest,
  ): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    if (!this.options.agonArenaAddress || !this.options.validationRegistryAddress || !this.options.playgroundStore) {
      return { ok: false, error: { code: "arena_disabled", message: "Agon Arena preparation requires the canonical Arena, ValidationRegistry, and playground store" } };
    }
    const listing = await this.getListing(request.listingReference);
    if (!listing.ok) return listing;
    const run = await this.options.playgroundStore.getRun(request.playgroundRunId);
    if (!run || run.state !== "completed" || !run.result) return { ok: false, error: { code: "validation_failed", message: "completed authenticated playground evidence is required" } };
    if (run.actorAddress?.toLowerCase() !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the playground run owner can anchor its evidence" } };
    try {
      const input = buildAgonArenaEvaluationInput({
        intentId: randomUUID(),
        actor,
        idempotencyKey: request.idempotencyKey,
        listingReference: request.listingReference,
        arenaContract: this.options.agonArenaAddress,
        validationRegistry: this.options.validationRegistryAddress,
        listing: {
          serviceRegistry: listing.value.serviceRegistry,
          listingId: listing.value.listingId,
          agentId: listing.value.agentId,
          version: listing.value.version,
          category: listing.value.category,
          manifestHash: listing.value.manifest.hash,
          providerSnapshot: listing.value.providerSnapshot,
        },
        playgroundRun: run.result,
        expiresAt: new Date(request.expiresAt),
      });
      const stored = await this.repository.prepareAgonArenaEvaluation({
        ...input,
        state: "prepared",
        evaluationId: null,
        requestTransactionHash: null,
        evidenceTransactionHash: null,
      });
      return { ok: true, value: arenaEvaluationView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "Arena evidence is invalid" } };
    }
  }

  async getAgonArenaEvaluation(actor: string, intentId: string): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can read this evaluation" } };
    return { ok: true, value: arenaEvaluationView(evaluation) };
  }

  async getAgonArenaRequestTransaction(actor: string, intentId: string): Promise<Result<AgonArenaTransactionView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can prepare this transaction" } };
    try {
      const plan = buildAgonArenaRequestPlan(evaluation);
      return { ok: true, value: { intentId, chainId: plan.chainId.toString(), to: plan.to, functionName: plan.functionName, args: jsonSafeTransactionArgs(plan.args), data: plan.data, executionEnabled: false, nextAction: "review_and_submit_with_wallet" } };
    } catch (error) {
      return { ok: false, error: { code: "execution_not_ready", message: error instanceof Error ? error.message : "Arena request transaction is not ready" } };
    }
  }

  async markAgonArenaEvaluationSubmitted(actor: string, intentId: string, request: AgonArenaEvaluationSubmittedRequest): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can record submission" } };
    try {
      const stored = await this.repository.markAgonArenaEvaluationRequested({ intentId, evaluationId: request.evaluationId, transactionHash: request.transactionHash as `0x${string}` });
      return { ok: true, value: arenaEvaluationView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async getAgonArenaEvidenceTransaction(actor: string, intentId: string): Promise<Result<AgonArenaTransactionView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can prepare evidence" } };
    try {
      const plan = buildAgonArenaEvidencePlan(evaluation);
      return { ok: true, value: { intentId, chainId: plan.chainId.toString(), to: plan.to, functionName: plan.functionName, args: jsonSafeTransactionArgs(plan.args), data: plan.data, executionEnabled: false, nextAction: "review_and_submit_with_wallet" } };
    } catch (error) {
      return { ok: false, error: { code: "execution_not_ready", message: error instanceof Error ? error.message : "Arena evidence transaction is not ready" } };
    }
  }

  async markAgonArenaEvaluationStarted(actor: string, intentId: string, request: AgonArenaEvaluationStartedRequest): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can record evaluator start" } };
    try {
      const stored = await this.repository.markAgonArenaEvaluationStarted({ intentId, transactionHash: request.transactionHash as `0x${string}` });
      return { ok: true, value: arenaEvaluationView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async markAgonArenaEvidenceSubmitted(actor: string, intentId: string, request: AgonArenaEvidenceSubmittedRequest): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can record evidence submission" } };
    try {
      const stored = await this.repository.markAgonArenaEvidenceSubmitted({ intentId, transactionHash: request.transactionHash as `0x${string}` });
      return { ok: true, value: arenaEvaluationView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async reconcileAgonArenaEvaluation(actor: string, intentId: string): Promise<Result<AgonArenaEvaluationView, AgonServiceError>> {
    const reader = this.options.protocolFinalityReader;
    if (!reader?.enabled) return { ok: false, error: { code: "reconciliation_disabled", message: "Agon Arena finality reads are not configured" } };
    const evaluation = await this.repository.getAgonArenaEvaluation(intentId);
    if (!evaluation) return { ok: false, error: { code: "not_found", message: "Agon Arena evaluation not found" } };
    if (evaluation.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the Arena evaluation owner can reconcile this evaluation" } };
    if (!evaluation.evaluationId) return { ok: false, error: { code: "conflict", message: "record the on-chain evaluation id before reconciliation" } };
    const escalate = async (reasons: readonly string[]) => {
      if (!this.options.arenaEscalation) return;
      try {
        await this.options.arenaEscalation({ intentId, listingReference: evaluation.listingReference, reasons });
      } catch (error) {
        console.error("agon arena escalation alert failed", error);
      }
    };
    try {
      let chain = await reader.inspectArenaEvaluation(evaluation.evaluationId, evaluation.arenaContract);
      const matches = [
        [chain.evaluationId === evaluation.evaluationId, "evaluation id"],
        [chain.listingId === evaluation.listingId, "listing id"],
        [chain.agentId === evaluation.agentId, "agent id"],
        [chain.listingVersion === evaluation.listingVersion, "listing version"],
        [chain.category === evaluation.category, "category"],
        [chain.participant.toLowerCase() === evaluation.participant.toLowerCase(), "participant"],
        [chain.manifestHash === evaluation.manifestHash.toLowerCase(), "manifest hash"],
        [chain.capabilityHash === evaluation.capabilityHash.toLowerCase(), "capability hash"],
        [chain.evaluatorVersionHash === evaluation.evaluatorVersionHash.toLowerCase(), "evaluator version"],
        [chain.taskCommitment === evaluation.taskCommitment.toLowerCase(), "task commitment"],
        [chain.validationRequestHash === evaluation.validationRequestHash.toLowerCase(), "validation request"],
        [Math.floor(chain.expiresAt.getTime() / 1000) === Math.floor(evaluation.expiresAt.getTime() / 1000), "expiry"],
      ] as const;
      const mismatch = matches.find(([ok]) => !ok);
      if (mismatch) {
        await escalate([`chain_${mismatch[1].replace(/ /g, "_")}_mismatch`]);
        return { ok: false, error: { code: "reconciliation_invalid", message: `Arena chain state does not match the prepared ${mismatch[1]}` } };
      }
      if (chain.state >= 2 && chain.evidenceRoot !== evaluation.evidenceRoot.toLowerCase()) {
        await escalate(["chain_evidence_root_mismatch"]);
        return { ok: false, error: { code: "reconciliation_invalid", message: "Arena chain evidence root does not match the playground evidence" } };
      }
      const evaluator = this.options.arenaEvaluatorAdapter;
      if (chain.state === 0 && evaluator?.enabled) {
        const transactionHash = await evaluator.startEvaluation(evaluation.evaluationId, evaluation.arenaContract);
        if (transactionHash) {
          return { ok: true, value: arenaEvaluationView(await this.repository.markAgonArenaEvaluationStarted({ intentId, transactionHash })) };
        }
        chain = await reader.inspectArenaEvaluation(evaluation.evaluationId, evaluation.arenaContract);
      }
      if (chain.state === 2 && evaluator?.enabled) {
        const storedRun = await this.options.playgroundStore?.getRun(evaluation.playgroundRunId);
        const run = storedRun?.state === "completed" ? storedRun.result : null;
        if (!run?.evidence) {
          await escalate(["playground_score_evidence_unavailable"]);
          return { ok: false, error: { code: "reconciliation_unavailable", message: "Arena score evidence is unavailable; operator review is required" } };
        }
        await evaluator.scoreEvaluation({
          evaluationId: evaluation.evaluationId,
          arenaAddress: evaluation.arenaContract,
          score: run.score,
          validationResponseHash: run.evidence.responseHash,
        });
        chain = await reader.inspectArenaEvaluation(evaluation.evaluationId, evaluation.arenaContract);
        if (chain.state !== 3 && chain.state !== 4) {
          await escalate(["score_confirmed_without_final_state"]);
          return { ok: false, error: { code: "reconciliation_unavailable", message: "Arena score transaction confirmed without a final contract state" } };
        }
        if (chain.score !== run.score || chain.validationResponseHash !== run.evidence.responseHash.toLowerCase()) {
          await escalate(["final_score_evidence_mismatch"]);
          return { ok: false, error: { code: "reconciliation_invalid", message: "Arena final score does not match the pinned playground result" } };
        }
      }
      const state = (["request_submitted", "evidence_ready", "evidence_submitted", "verified", "rejected", "expired", "revoked"] as const)[chain.state];
      if (!state) return { ok: false, error: { code: "reconciliation_invalid", message: "Agon Arena returned an unknown state" } };
      let stored = await this.repository.reconcileAgonArenaEvaluation({ intentId, state });
      if (state === "verified" && stored.marketplaceVerificationState !== "confirmed") {
        const verifier = this.options.listingVerifierAdapter;
        if (!verifier?.enabled && stored.marketplaceVerificationState === "not_started") {
          stored = await this.repository.recordAgonArenaMarketplaceVerification({
            intentId,
            state: "failed",
            error: "Automatic market publication is unavailable until the version-scoped registry is configured.",
          });
        } else if (verifier?.enabled) {
          const previousState = stored.marketplaceVerificationState;
          const previousTransactionHash = stored.marketplaceVerificationTransactionHash;
          const claimed = await this.repository.claimAgonArenaMarketplaceVerification({
            intentId,
            retryBefore: new Date(Date.now() - 120_000),
          });
          if (!claimed) return { ok: true, value: arenaEvaluationView(stored) };
          stored = claimed;
          try {
            const result = await verifier.verify({
              listingId: stored.listingId,
              agentId: stored.agentId,
              listingVersion: stored.listingVersion,
              manifestHash: stored.manifestHash,
              priorTransactionHash: previousState === "submitted" || previousState === "unknown"
                ? previousTransactionHash ?? undefined
                : undefined,
              onSubmitted: async (transactionHash) => {
                stored = await this.repository.recordAgonArenaMarketplaceVerification({ intentId, state: "submitted", transactionHash, error: null });
              },
            });
            stored = await this.repository.recordAgonArenaMarketplaceVerification({
              intentId,
              state: "confirmed",
              transactionHash: result.transactionHash ?? stored.marketplaceVerificationTransactionHash,
              error: null,
            });
          } catch (error) {
            const unknown = error instanceof AgonListingVerificationError && error.code === "unknown_outcome";
            stored = await this.repository.recordAgonArenaMarketplaceVerification({
              intentId,
              state: unknown ? "unknown" : "failed",
              transactionHash: error instanceof AgonListingVerificationError && error.transactionHash
                ? error.transactionHash
                : undefined,
              error: error instanceof Error ? error.message : "marketplace verification failed",
            });
          }
        }
      }
      return { ok: true, value: arenaEvaluationView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      await escalate(["arena_reconciliation_failed", error instanceof Error ? error.message.slice(0, 120) : "unknown"]);
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "Agon Arena finality read failed" } };
    }
  }

  async prepareAgonSyndicateContribution(actor: string, request: AgonSyndicateContributionRequest): Promise<Result<AgonSyndicateContributionView, AgonServiceError>> {
    const registryContract = this.options.agonSyndicateRegistryAddress;
    if (!registryContract) return { ok: false, error: { code: "syndicate_prize_disabled", message: "canonical AgonSyndicateRegistry is not configured" } };
    try {
      const plan = buildAgonSyndicateContributionPlan({ contract: registryContract, ...request });
      const stored = await this.repository.prepareAgonSyndicateContribution({
        intentId: randomUUID(),
        actor: actor as `0x${string}`,
        idempotencyKey: request.idempotencyKey,
        registryContract: plan.to,
        syndicateId: request.syndicateId,
        agentId: request.agentId,
        contributionKey: plan.args[2] as `0x${string}`,
        score: request.score,
        evidenceHash: plan.args[4] as `0x${string}`,
        state: "prepared",
        transactionHash: null,
      });
      return { ok: true, value: syndicateContributionView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "syndicate contribution is invalid" } };
    }
  }

  async getAgonSyndicateContribution(actor: string, intentId: string): Promise<Result<AgonSyndicateContributionView, AgonServiceError>> {
    const value = await this.repository.getAgonSyndicateContribution(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "syndicate contribution not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the contribution owner can read this intent" } };
    return { ok: true, value: syndicateContributionView(value) };
  }

  async getAgonSyndicateContributionTransaction(actor: string, intentId: string): Promise<Result<AgonSyndicatePrizeTransactionView, AgonServiceError>> {
    const value = await this.repository.getAgonSyndicateContribution(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "syndicate contribution not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the contribution owner can prepare this transaction" } };
    try {
      const plan = buildAgonSyndicateContributionPlan({ contract: value.registryContract, syndicateId: value.syndicateId, agentId: value.agentId, contributionKey: value.contributionKey, score: value.score, evidenceHash: value.evidenceHash });
      return { ok: true, value: { intentId, chainId: plan.chainId.toString(), to: plan.to, functionName: plan.functionName, args: plan.args, data: plan.data, executionEnabled: false, nextAction: "review_and_submit_with_wallet" } };
    } catch (error) { return { ok: false, error: { code: "execution_not_ready", message: error instanceof Error ? error.message : "syndicate contribution transaction is not ready" } }; }
  }

  async markAgonSyndicateContributionSubmitted(actor: string, intentId: string, request: AgonSyndicatePrizeSubmittedRequest): Promise<Result<AgonSyndicateContributionView, AgonServiceError>> {
    const value = await this.repository.getAgonSyndicateContribution(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "syndicate contribution not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the contribution owner can record submission" } };
    try { return { ok: true, value: syndicateContributionView(await this.repository.markAgonSyndicateContributionSubmitted({ intentId, transactionHash: request.transactionHash as `0x${string}` })) }; }
    catch (error) { if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } }; return internalError(error); }
  }

  async reconcileAgonSyndicateContribution(actor: string, intentId: string): Promise<Result<AgonSyndicateContributionView, AgonServiceError>> {
    const reader = this.options.protocolFinalityReader;
    if (!reader?.enabled) return { ok: false, error: { code: "reconciliation_disabled", message: "syndicate finality reads are not configured" } };
    const value = await this.repository.getAgonSyndicateContribution(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "syndicate contribution not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the contribution owner can reconcile this intent" } };
    if (!value.transactionHash) return { ok: false, error: { code: "conflict", message: "record the contribution transaction before reconciliation" } };
    try {
      await reader.confirmSyndicateContribution({
        transactionHash: value.transactionHash,
        syndicateId: value.syndicateId,
        agentId: value.agentId,
        contributionKey: value.contributionKey,
        score: value.score,
        evidenceHash: value.evidenceHash,
      });
      return { ok: true, value: syndicateContributionView(await this.repository.confirmAgonSyndicateContribution(intentId)) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "syndicate contribution finality read failed" } };
    }
  }

  async prepareAgonPrizeClaim(actor: string, request: AgonPrizeClaimRequest): Promise<Result<AgonPrizeClaimView, AgonServiceError>> {
    const vaultContract = this.options.agonPrizeVaultAddress;
    if (!vaultContract) return { ok: false, error: { code: "syndicate_prize_disabled", message: "canonical AgonPrizeVault is not configured" } };
    if (request.beneficiary.toLowerCase() !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "the authenticated beneficiary must prepare its own prize claim" } };
    try {
      const plan = buildAgonPrizeClaimPlan({ vault: vaultContract, ...request });
      const stored = await this.repository.prepareAgonPrizeClaim({
        intentId: randomUUID(), actor: actor as `0x${string}`, idempotencyKey: request.idempotencyKey,
        vaultContract: plan.to, poolKey: plan.args[0] as `0x${string}`, index: request.index,
        beneficiary: plan.args[2] as `0x${string}`, amount: request.amount, proof: plan.args[4] as `0x${string}`[],
        leaf: plan.leaf, state: "prepared", transactionHash: null,
      });
      return { ok: true, value: prizeClaimView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return { ok: false, error: { code: "validation_failed", message: error instanceof Error ? error.message : "prize claim is invalid" } };
    }
  }

  async getAgonPrizeClaim(actor: string, intentId: string): Promise<Result<AgonPrizeClaimView, AgonServiceError>> {
    const value = await this.repository.getAgonPrizeClaim(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "prize claim not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the prize claim owner can read this intent" } };
    return { ok: true, value: prizeClaimView(value) };
  }

  async getAgonPrizeClaimTransaction(actor: string, intentId: string): Promise<Result<AgonSyndicatePrizeTransactionView, AgonServiceError>> {
    const value = await this.repository.getAgonPrizeClaim(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "prize claim not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the prize claim owner can prepare this transaction" } };
    try {
      const plan = buildAgonPrizeClaimPlan({ vault: value.vaultContract, poolKey: value.poolKey, index: value.index, beneficiary: value.beneficiary, amount: value.amount, proof: value.proof });
      return { ok: true, value: { intentId, chainId: plan.chainId.toString(), to: plan.to, functionName: plan.functionName, args: plan.args, data: plan.data, executionEnabled: false, nextAction: "review_and_submit_with_wallet" } };
    } catch (error) { return { ok: false, error: { code: "execution_not_ready", message: error instanceof Error ? error.message : "prize claim transaction is not ready" } }; }
  }

  async markAgonPrizeClaimSubmitted(actor: string, intentId: string, request: AgonSyndicatePrizeSubmittedRequest): Promise<Result<AgonPrizeClaimView, AgonServiceError>> {
    const value = await this.repository.getAgonPrizeClaim(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "prize claim not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the prize claim owner can record submission" } };
    try { return { ok: true, value: prizeClaimView(await this.repository.markAgonPrizeClaimSubmitted({ intentId, transactionHash: request.transactionHash as `0x${string}` })) }; }
    catch (error) { if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } }; return internalError(error); }
  }

  async reconcileAgonPrizeClaim(actor: string, intentId: string): Promise<Result<AgonPrizeClaimView, AgonServiceError>> {
    const reader = this.options.protocolFinalityReader;
    if (!reader?.enabled) return { ok: false, error: { code: "reconciliation_disabled", message: "prize finality reads are not configured" } };
    const value = await this.repository.getAgonPrizeClaim(intentId);
    if (!value) return { ok: false, error: { code: "not_found", message: "prize claim not found" } };
    if (value.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the prize claim owner can reconcile this intent" } };
    if (!value.transactionHash) return { ok: false, error: { code: "conflict", message: "record the claim transaction before reconciliation" } };
    try {
      await reader.confirmPrizeClaim({ transactionHash: value.transactionHash, poolKey: value.poolKey, index: value.index, beneficiary: value.beneficiary, amount: value.amount });
      return { ok: true, value: prizeClaimView(await this.repository.confirmAgonPrizeClaim(intentId)) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "prize claim finality read failed" } };
    }
  }

  async getAgonJobEscrowJob(actor: string, jobId: string): Promise<Result<AgonJobEscrowJobView, AgonServiceError>> {
    if (!this.options.jobEscrowReadAdapter?.enabled) return { ok: false, error: { code: "capability_unavailable", message: "AgonJobEscrow read inspection is disabled by policy" } };
    if (!/^[1-9]\d*$/.test(jobId)) return { ok: false, error: { code: "validation_failed", message: "job id must be a positive decimal string" } };
    try {
      const job = await this.options.jobEscrowReadAdapter.inspect(jobId);
      return {
        ok: true,
        value: {
          ...job,
          acceptanceDeadline: job.acceptanceDeadline.toISOString(),
          reviewDeadline: job.reviewDeadline?.toISOString() ?? null,
          createdAt: job.createdAt.toISOString(),
          submittedAt: job.submittedAt?.toISOString() ?? null,
        },
      };
    } catch (error) {
      return { ok: false, error: { code: "internal", message: error instanceof Error ? error.message : "AgonJobEscrow inspection failed" } };
    }
  }

  async approveAgonEscrowTransaction(
    actor: string,
    intentId: string,
    request: AgonEscrowTransactionApprovalRequest,
  ): Promise<Result<AgonEscrowTransactionApprovalView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can approve this transaction" } };
    const existing = await this.repository.getAgonEscrowTransactionApproval(intentId, request.approvalIdempotencyKey);
    if (existing) {
      if (existing.actor !== actor.toLowerCase() || existing.operation !== request.operation) return { ok: false, error: { code: "conflict", message: "approval idempotency key is bound to a different escrow operation" } };
      return { ok: true, value: escrowTransactionApprovalView(existing) };
    }
    const operation = request.operation as AgonEscrowWriteOperation;
    const readyForOperation = operation === "fund" ? intent.state === "prepared" : intent.state === "funded";
    if (!readyForOperation) return { ok: false, error: { code: "execution_not_ready", message: `escrow intent is ${intent.state}; ${operation} approval is not ready` } };
    if (!intent.poolBinding) return { ok: false, error: { code: "execution_not_ready", message: "a bound PrizeEscrow pool is required before transaction approval" } };
    const preflight = this.options.escrowWritePreflightAdapter;
    if (!preflight?.enabled) return { ok: false, error: { code: "execution_not_ready", message: "read-only PrizeEscrow write preflight is disabled" } };
    const participant = operation === "release" ? intent.terms.beneficiary : intent.terms.buyer;
    let checked;
    try {
      checked = await preflight.preflight({
        network: intent.terms.network,
        escrowAddress: intent.poolBinding.contractAddress,
        controller: intent.poolBinding.controller,
        operation,
        poolId: intent.poolBinding.poolId,
        amountBaseUnits: intent.terms.amountBaseUnits,
        participant,
        expectedAsset: intent.terms.asset,
      });
    } catch (error) {
      return { ok: false, error: { code: "execution_not_ready", message: error instanceof Error ? error.message : "PrizeEscrow write preflight failed" } };
    }
    const approval = buildAgonEscrowTransactionApproval({
      preflight: checked,
      request: {
        intentId,
        actor,
        operation,
        approvalIdempotencyKey: request.approvalIdempotencyKey,
        confirmation: request.confirmation,
      },
    });
    if (!approval.ok) return { ok: false, error: { code: "validation_failed", message: approval.error.message } };
    try {
      const stored = await this.repository.prepareAgonEscrowTransactionApproval({
        approvalHash: approval.value.approvalHash,
        intentId: approval.value.intentId,
        actor: approval.value.actor,
        operation: approval.value.operation,
        intentHash: approval.value.intentHash,
        approvalIdempotencyKey: approval.value.approvalIdempotencyKey,
        approvedAt: new Date(approval.value.approvedAt),
        expiresAt: new Date(approval.value.expiresAt),
      });
      return { ok: true, value: escrowTransactionApprovalView(stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency")) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async getAgonEscrowTransactionApproval(
    actor: string,
    intentId: string,
  ): Promise<Result<AgonEscrowTransactionApprovalReadinessView, AgonServiceError>> {
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can read transaction approval" } };
    const approval = await this.repository.getAgonEscrowTransactionApproval(intentId);
    const checkedAt = new Date().toISOString();
    if (!approval) return { ok: true, value: { intentId, status: this.options.escrowWritePreflightAdapter?.enabled ? "approval_required" : "preflight_disabled", reason: this.options.escrowWritePreflightAdapter?.enabled ? "No durable transaction approval exists for this escrow intent." : "Read-only PrizeEscrow write preflight is disabled.", approval: null, executionEnabled: false, nextAction: this.options.escrowWritePreflightAdapter?.enabled ? "explicit_transaction_approval" : "enable_read_only_preflight", checkedAt } };
    const view = escrowTransactionApprovalView(approval);
    return { ok: true, value: { intentId, status: view.status, reason: view.status === "expired" ? "The transaction approval expired and must be refreshed." : "A durable approval is recorded; transaction execution remains disabled.", approval: view, executionEnabled: false, nextAction: view.status === "expired" ? "refresh_expired_approval" : "transaction_adapter_not_enabled", checkedAt } };
  }

  private async executeAgonEscrowLifecycle(
    actor: string,
    intentId: string,
    action: AgonEscrowLifecycleAction,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    const expected = {
      fund: "FUND_ARC_TESTNET_ESCROW",
      release: "RELEASE_ARC_TESTNET_ESCROW",
      refund: "REFUND_ARC_TESTNET_ESCROW",
    }[action];
    if (confirmation !== expected) return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet escrow confirmation is required" } };
    const intent = await this.repository.getAgonEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "Agon escrow intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the escrow intent owner can execute this operation" } };
    if (!this.options.escrowExecutionEnabled || !this.escrowExecutionAdapter.enabled) {
      return { ok: false, error: { code: "escrow_disabled", message: "Agon escrow execution is disabled by policy" } };
    }
    if (!intent.poolBinding || !this.options.escrowReadAdapter?.enabled) {
      return { ok: false, error: { code: "execution_not_ready", message: "escrow execution requires a bound pool and enabled read-only readiness adapter" } };
    }
    const readiness = await this.getAgonEscrowReadiness(actor, intentId);
    if (!readiness.ok) return readiness;
    if (readiness.value.pool.status !== "match") {
      return { ok: false, error: { code: "execution_not_ready", message: `escrow pool is ${readiness.value.pool.status}; an exact authorized pool match is required` } };
    }
    if (this.options.escrowTransactionWriter) {
      const approval = await this.repository.getAgonEscrowTransactionApproval(intentId);
      if (!approval) return { ok: false, error: { code: "execution_not_ready", message: "a durable transaction approval is required before escrow execution" } };
      if (approval.operation !== action) return { ok: false, error: { code: "execution_not_ready", message: "the durable transaction approval does not match the requested lifecycle action" } };
      if (approval.expiresAt.getTime() <= Date.now()) return { ok: false, error: { code: "execution_not_ready", message: "the durable transaction approval is expired" } };
    }
    const result = await this.escrowLifecycle[action](intentId);
    if (!result.ok) {
      if (result.error.code === "escrow_disabled") return { ok: false, error: { code: "escrow_disabled", message: result.error.message } };
      if (result.error.code === "escrow_unknown") return { ok: false, error: { code: "conflict", message: result.error.message } };
      if (result.error.code === "escrow_failed") return { ok: false, error: { code: "execution_not_ready", message: result.error.message } };
      return { ok: false, error: { code: "execution_not_ready", message: result.error.message } };
    }
    return { ok: true, value: escrowIntentView(result.intent, result.intent.listingReference) };
  }

  async fundAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "fund", confirmation);
  }

  async releaseAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "release", confirmation);
  }

  async refundAgonEscrow(
    actor: string,
    intentId: string,
    confirmation: string,
  ): Promise<Result<AgonEscrowIntentView, AgonServiceError>> {
    return this.executeAgonEscrowLifecycle(actor, intentId, "refund", confirmation);
  }

  async prepareX402Call(
    actor: string,
    reference: string,
    request: X402CallIntentRequest,
  ): Promise<Result<X402CallIntentView, AgonServiceError>> {
    const listing = await this.getListing(reference);
    if (!listing.ok) return listing;
    const prepared = prepareX402Call(actor, listing.value, request);
    if (!prepared.ok) {
      return {
        ok: false,
        error: {
          code: prepared.error.code === "invalid_request" ? "validation_failed" : "capability_unavailable",
          message: prepared.error.message,
        },
      };
    }
    try {
      const stored = await this.repository.prepareX402CallIntent({
        intentId: randomUUID(),
        actor: prepared.value.actor,
        idempotencyKey: prepared.value.idempotencyKey,
        listingReference: listing.value.id,
        chainId: BigInt(listing.value.chainId),
        serviceRegistry: listing.value.serviceRegistry,
        listingId: BigInt(listing.value.listingId),
        agentId: BigInt(listing.value.agentId),
        version: BigInt(listing.value.version),
        method: prepared.value.method,
        input: prepared.value.input,
        inputHash: prepared.value.inputHash,
        maxAmountUSDC: prepared.value.maxAmountUSDC,
        targetUrl: prepared.value.targetUrl,
        state: "prepared",
      });
      return {
        ok: true,
        value: callIntentView({
          intentId: stored.intentId,
          actor: stored.actor,
          idempotencyKey: stored.idempotencyKey,
          listingReference: stored.listingReference,
          listingVersion: stored.version.toString(),
          inputHash: stored.inputHash,
          maxAmountUSDC: stored.maxAmountUSDC,
          state: stored.state,
          createdAt: stored.createdAt,
          targetUrl: stored.targetUrl,
        }),
      };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError && error.message.includes("idempotency key")) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async approveX402Call(
    actor: string,
    intentId: string,
    request: X402ApprovalRequest,
  ): Promise<Result<X402ApprovalView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the intent owner can approve this spend" } };
    }
    const approval = validateX402Approval(intent.maxAmountUSDC, request);
    if (!approval.ok) {
      return {
        ok: false,
        error: {
          code: approval.error.code === "limit_exceeded" ? "validation_failed" : "validation_failed",
          message: approval.error.message,
        },
      };
    }
    try {
      const receipt = await this.repository.approveX402CallReceipt(intent.intentId, approval.value.approvedAmountUSDC);
      if (receipt.state !== "approved" || !receipt.approvedAmountUSDC) {
        return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}, not approved` } };
      }
      return {
        ok: true,
        value: {
          receiptId: receipt.receiptId,
          intentId: receipt.intentId,
          actor: intent.actor,
          state: "approved",
          approvedAmountUSDC: receipt.approvedAmountUSDC,
          executionEnabled: false,
          nextAction: "payment_adapter_not_enabled",
          approvedAt: receipt.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) {
        return { ok: false, error: { code: "conflict", message: error.message } };
      }
      return internalError(error);
    }
  }

  async captureX402Quote(
    actor: string,
    intentId: string,
  ): Promise<Result<X402QuoteView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the intent owner can capture this quote" } };
    }
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 approval receipt has not been created" } };
    if (receipt.state === "payment_required" && receipt.quoteSnapshot && receipt.quoteHash) {
      return { ok: true, value: quoteView(intent, receipt, receipt.quoteSnapshot as X402QuoteSnapshot, receipt.quoteHash) };
    }
    if (receipt.state !== "approved") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; approve the spend before reading a quote` } };
    }
    if (!intent.targetUrl || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "capability_unavailable", message: "this intent has no verified HTTPS provider endpoint" } };
    }
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchImpl(intent.targetUrl, {
        method: intent.method,
        redirect: "error",
        headers: intent.method === "GET" || intent.method === "DELETE" ? undefined : { "content-type": "application/json" },
        body: intent.method === "GET" || intent.method === "DELETE" ? undefined : JSON.stringify(intent.input),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, error: { code: "capability_unavailable", message: "Agon could not reach the verified provider endpoint" } };
    }
    if (response.status !== 402) {
      return { ok: false, error: { code: "validation_failed", message: `provider returned HTTP ${response.status}; expected HTTP 402` } };
    }
    const parsed = parsePaymentRequiredHeader(response.headers.get("PAYMENT-REQUIRED"), intent.targetUrl, intent.chainId.toString(), receipt.approvedAmountUSDC);
    if (!parsed.ok) return { ok: false, error: { code: "receipt_invalid", message: parsed.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "payment_required",
        quoteHash: parsed.value.quoteHash,
        quoteSnapshot: parsed.value.snapshot,
      });
      return { ok: true, value: quoteView(intent, stored, parsed.value.snapshot, parsed.value.quoteHash) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async prepareX402Authorization(
    actor: string,
    intentId: string,
  ): Promise<Result<X402AuthorizationView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can prepare authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state === "authorization_ready" && receipt.authorizationPayload && receipt.authorizationPayloadHash) {
      return { ok: true, value: authorizationView(intentId, receipt, receipt.authorizationPayload as X402AuthorizationPayload, receipt.authorizationPayloadHash) };
    }
    if (receipt.state !== "payment_required" || !receipt.quoteSnapshot) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; capture a payment quote first` } };
    }
    const built = buildX402Authorization(actor, intent.chainId.toString(), receipt.quoteSnapshot as X402QuoteSnapshot);
    if (!built.ok) return { ok: false, error: { code: "receipt_invalid", message: built.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "authorization_ready",
        authorizationPayloadHash: built.value.payloadHash,
        authorizationPayload: built.value.payload,
      });
      return { ok: true, value: authorizationView(intentId, stored, built.value.payload, built.value.payloadHash) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async submitX402Authorization(
    actor: string,
    intentId: string,
    request: X402AuthorizationSignatureRequest,
  ): Promise<Result<X402AuthorizationSubmittedView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can submit authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state === "authorization_submitted" && receipt.authorizationHash) {
      const submittedHash = keccak256(request.signature as `0x${string}`);
      if (submittedHash.toLowerCase() !== receipt.authorizationHash.toLowerCase()) {
        return { ok: false, error: { code: "conflict", message: "a different authorization signature was already recorded" } };
      }
      return { ok: true, value: authorizationSubmittedView(intentId, receipt) };
    }
    if (receipt.state !== "authorization_ready" || !receipt.authorizationPayload || !receipt.authorizationPayloadHash) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; prepare an authorization payload first` } };
    }
    if (request.payloadHash.toLowerCase() !== receipt.authorizationPayloadHash.toLowerCase()) {
      return { ok: false, error: { code: "signature_invalid", message: "payload hash does not match the prepared authorization" } };
    }
    const checked = await validateX402AuthorizationSignature(
      receipt.authorizationPayload as X402AuthorizationPayload,
      request.signature,
      actor,
    );
    if (!checked.ok) return { ok: false, error: { code: "signature_invalid", message: checked.error.message } };
    try {
      const stored = await this.repository.advanceX402CallReceipt(intentId, {
        type: "authorization_submitted",
        authorizationHash: checked.value.signatureHash,
      });
      return { ok: true, value: authorizationSubmittedView(intentId, stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async prepareX402ExecutionPlan(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionPlanView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can prepare an execution plan" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const built = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!built.ok) return { ok: false, error: { code: "execution_not_ready", message: built.error.message } };
    return { ok: true, value: executionPlanView(intentId, receipt, built.value) };
  }

  async approveX402Execution(
    actor: string,
    intentId: string,
    request: X402ExecutionApprovalRequest,
  ): Promise<Result<X402ExecutionApprovalView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can approve execution" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = buildX402ExecutionApproval({ intentId, actor, plan: plan.value, request });
    if (!approval.ok) return { ok: false, error: { code: "execution_not_ready", message: approval.error.message } };
    try {
      const stored = await this.repository.recordX402ExecutionApproval({
        approvalHash: approval.value.approvalHash,
        intentId,
        actor,
        planHash: approval.value.planHash,
        authorizationHash: approval.value.authorizationHash,
        approvalIdempotencyKey: approval.value.approvalIdempotencyKey,
        approvedAt: new Date(approval.value.approvedAt),
        expiresAt: new Date(approval.value.expiresAt),
      });
      return { ok: true, value: executionApprovalView(receipt, stored) };
    } catch (error) {
      if (error instanceof AgonStoreInvariantError) return { ok: false, error: { code: "conflict", message: error.message } };
      return internalError(error);
    }
  }

  async getX402ExecutionReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect execution readiness" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const stored = await this.repository.getLatestX402ExecutionApproval(intentId);
    const expired = stored ? stored.expiresAt.getTime() <= Date.now() : false;
    const executionEnabled = this.options.x402ExecutionEnabled === true && Boolean(this.options.x402SettlementAdapter);
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: "authorization_submitted",
        plan: plan.value,
        approval: stored ? executionApprovalView(receipt, stored) : null,
        status: !stored ? "approval_required" : expired ? "approval_expired" : executionEnabled ? "ready" : "approved_but_disabled",
        reason: !stored
          ? "Execution approval is required before a settlement adapter can be considered."
          : expired
            ? "The execution approval expired; prepare a fresh approval before any future execution review."
            : executionEnabled
              ? "Approval evidence is valid and the Circle Arc Testnet settlement adapter is ready."
              : "Approval evidence is valid, but Circle settlement remains disabled by policy.",
        executionEnabled,
        nextAction: !stored || expired ? "explicit_execution_approval" : executionEnabled ? "execute_settlement" : "execution_adapter_not_enabled",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async getX402SettlementReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402SettlementReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect settlement readiness" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    const executionEnabled = this.options.x402ExecutionEnabled === true && Boolean(this.options.x402SettlementAdapter);
    const transactionRef = receipt.settlementRef && /^0x[0-9a-f]{64}$/i.test(receipt.settlementRef)
      ? receipt.settlementRef
      : null;
    let status: X402SettlementReadinessView["status"];
    let reason: string;
    let nextAction: X402SettlementReadinessView["nextAction"];
    switch (receipt.state) {
      case "authorization_submitted":
        status = executionEnabled ? "ready" : "ready_but_disabled";
        reason = executionEnabled
          ? "Authorization and the Circle Arc Testnet settlement adapter are ready for explicit execution."
          : this.options.x402ExecutionEnabled === true
            ? "Settlement policy is configured, but no facilitator route is wired in this service instance."
            : "Authorization is valid, but Circle settlement is disabled by policy.";
        nextAction = executionEnabled ? "execute_settlement" : "execution_adapter_not_enabled";
        break;
      case "settlement_submitted":
        status = "service_delivery_pending";
        reason = transactionRef
          ? "Arc Testnet payment submission is recorded. Service delivery must be confirmed separately."
          : "A settlement attempt is recorded. A trusted transaction receipt is still required.";
        nextAction = "deliver_service";
        break;
      case "unknown":
        status = "reconciliation_required";
        reason = "The settlement outcome is ambiguous. Reconcile the Arc Testnet receipt before retrying.";
        nextAction = "reconcile_settlement";
        break;
      case "service_delivered":
        status = "service_delivery_pending";
        reason = "The provider response is recorded. Reconciliation is required before final receipt completion.";
        nextAction = "reconcile_settlement";
        break;
      case "reconciled":
      case "rejected":
      case "failed":
        status = "terminal";
        reason = receipt.state === "reconciled"
          ? "This x402 receipt is complete and immutable."
          : `This x402 receipt is terminal: ${receipt.state}.`;
        nextAction = "none";
        break;
      default:
        status = "authorization_required";
        reason = `x402 receipt is ${receipt.state}; complete authorization before settlement can be considered.`;
        nextAction = "complete_authorization";
        break;
    }
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: receipt.state,
        network: "eip155:5042002",
        settlementRef: transactionRef,
        providerTransferId: receipt.providerTransferId ?? null,
        status,
        reason,
        executionEnabled,
        nextAction,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async getX402ReconciliationReadiness(
    actor: string,
    intentId: string,
  ): Promise<Result<X402ReconciliationReadinessView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect receipt reconciliation" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };

    const transaction = receipt.settlementRef && /^0x[0-9a-f]{64}$/i.test(receipt.settlementRef)
      ? receipt.settlementRef.toLowerCase() as `0x${string}`
      : null;
    const providerTransferId = receipt.providerTransferId && isX402ProviderTransferId(receipt.providerTransferId)
      ? receipt.providerTransferId.toLowerCase()
      : null;
    let status: X402ReconciliationReadinessView["status"];
    let reason: string;
    let nextAction: X402ReconciliationReadinessView["nextAction"];
    const lookupEnabled = this.options.x402ReceiptLookup?.enabled === true;
    switch (receipt.state) {
      case "unknown":
      case "service_delivered":
        if (!transaction && !providerTransferId) {
          status = "reference_required";
          reason = lookupEnabled
            ? "This ambiguous payment attempt has no trusted reference. A candidate can be probed, but an operator must correlate the original authorization before recovery."
            : "This ambiguous payment attempt has no trusted reference. Operator review and read-only payment lookup are required before recovery.";
          nextAction = "operator_review";
        } else if (!lookupEnabled) {
          status = "lookup_disabled";
          reason = "A provider receipt is required for this Arc Testnet settlement, but the read-only lookup adapter is disabled.";
          nextAction = "enable_receipt_lookup";
        } else {
          status = "lookup_required";
          reason = "A provider reference exists and the read-only lookup adapter is enabled. Reconcile matching Arc Testnet evidence.";
          nextAction = "reconcile_receipt";
        }
        break;
      case "settlement_submitted":
        if (!transaction && !providerTransferId) {
          status = "reference_required";
          reason = lookupEnabled
            ? "Settlement was submitted without a trusted reference. A candidate can be probed, but an operator must correlate the original authorization before recovery."
            : "Settlement was submitted without a trusted reference. Operator review and read-only payment lookup are required before recovery.";
          nextAction = "operator_review";
        } else if (!lookupEnabled) {
          status = "lookup_disabled";
          reason = "A settlement reference exists, but the read-only lookup adapter is disabled.";
          nextAction = "enable_receipt_lookup";
        } else {
          status = "lookup_required";
          reason = "A settlement reference exists and the read-only lookup adapter is enabled. Reconcile only matching Arc Testnet evidence.";
          nextAction = "reconcile_receipt";
        }
        break;
      case "reconciled":
      case "rejected":
      case "failed":
        status = "terminal";
        reason = receipt.state === "reconciled"
          ? "This receipt is reconciled and terminal. No provider lookup is required."
          : `This x402 receipt is terminal: ${receipt.state}.`;
        nextAction = "none";
        break;
      default:
        status = "not_required";
        reason = `x402 receipt is ${receipt.state}; complete authorization before receipt reconciliation can begin.`;
        nextAction = "complete_authorization";
        break;
    }
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: receipt.state,
        network: "eip155:5042002",
        transaction,
        providerTransferId,
        status,
        reason,
        lookupEnabled,
        executionEnabled: false,
        nextAction,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async probeX402RecoveryCandidate(
    actor: string,
    intentId: string,
    request: X402RecoveryProbeRequest,
  ): Promise<Result<X402RecoveryProbeView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can inspect payment recovery" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    const lookup = this.options.x402ReceiptLookup;
    if (!lookup?.enabled) return { ok: false, error: { code: "reconciliation_disabled", message: "read-only Arc Testnet receipt lookup is disabled by policy" } };
    const probe = await inspectX402RecoveryCandidate({ receipt, reference: request, lookup });
    if (!probe.ok) {
      const code = probe.error.code === "not_recoverable" ? "conflict"
        : probe.error.code === "lookup_disabled" ? "reconciliation_disabled"
        : probe.error.code === "lookup_unavailable" ? "reconciliation_unavailable"
        : "reconciliation_invalid";
      return { ok: false, error: { code, message: probe.error.message } };
    }
    return {
      ok: true,
      value: {
        receiptId: receipt.receiptId,
        intentId,
        state: receipt.state,
        network: "eip155:5042002",
        ...probe.value,
        nextAction: "operator_review",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async reconcileX402Receipt(
    actor: string,
    intentId: string,
    request: X402ReconciliationRequest,
  ): Promise<Result<X402ReconciliationView, AgonServiceError>> {
    const adapter = this.options.x402ReceiptLookup;
    if (!adapter || adapter.enabled !== true) {
      return { ok: false, error: { code: "reconciliation_disabled", message: "Arc Testnet receipt reconciliation is disabled by policy" } };
    }
    if (request.confirmation !== "RECONCILE_ARC_TESTNET_X402") {
      return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet reconciliation confirmation is required" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can reconcile this receipt" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    const transaction = receipt.settlementRef && isX402Transaction(receipt.settlementRef) ? receipt.settlementRef.toLowerCase() as `0x${string}` : null;
    const providerTransferId = receipt.providerTransferId && isX402ProviderTransferId(receipt.providerTransferId) ? receipt.providerTransferId.toLowerCase() : null;
    if (!transaction && !providerTransferId) {
      return { ok: false, error: { code: "reconciliation_invalid", message: "x402 receipt has no valid Arc Testnet transaction or provider transfer reference" } };
    }
    if (receipt.state !== "unknown" && receipt.state !== "settlement_submitted" && receipt.state !== "service_delivered") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; reconciliation is not applicable` } };
    }

    let lookup: Awaited<ReturnType<X402ReceiptLookupAdapter["lookup"]>>;
    try {
      const authorization = receipt.authorizationPayload as { message?: { from?: string; to?: string; value?: string } } | null;
      const quote = receipt.quoteSnapshot as { accepts?: Array<{ payTo?: string; amount?: string }> } | null;
      const payer = typeof authorization?.message?.from === "string" && /^0x[0-9a-f]{40}$/i.test(authorization.message.from) ? authorization.message.from as `0x${string}` : undefined;
      const recipientValue = authorization?.message?.to ?? quote?.accepts?.[0]?.payTo;
      const recipient = typeof recipientValue === "string" && /^0x[0-9a-f]{40}$/i.test(recipientValue) ? recipientValue as `0x${string}` : undefined;
      const amountAtomicUnits = authorization?.message?.value ?? quote?.accepts?.[0]?.amount;
      lookup = await adapter.lookup({
        network: "eip155:5042002",
        transaction,
        providerTransferId,
        expected: {
          payer,
          recipient,
          amountAtomicUnits,
        },
      });
      lookup = validateX402ReceiptLookupResult(lookup, { network: "eip155:5042002", transaction, providerTransferId, expected: {
        payer,
        recipient,
        amountAtomicUnits,
      } });
    } catch (error) {
      return { ok: false, error: { code: "reconciliation_unavailable", message: error instanceof Error ? error.message : "provider receipt lookup failed without trusted evidence" } };
    }

    const orchestrator = createX402SettlementOrchestrator({
      store: this.repository,
      adapter: { settle: async () => ({ ok: false, error: { code: "execution_disabled", message: "settlement is not part of reconciliation" } }) },
      policy: createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: 0n }),
    });
    const reconciled = await orchestrator.reconcile(intentId, lookup);
    if (!reconciled.ok) {
      return { ok: false, error: { code: "reconciliation_invalid", message: reconciled.error.message } };
    }
    const nextState = reconciled.receipt.state;
    return {
      ok: true,
      value: {
        receiptId: reconciled.receipt.receiptId,
        intentId,
        state: nextState,
        network: "eip155:5042002",
        status: lookup.status,
        transaction: lookup.transaction ?? null,
        providerTransferId: lookup.providerTransferId ?? null,
        executionEnabled: false,
        serviceDeliveryPending: nextState === "settlement_submitted",
        nextAction: nextState === "failed" || nextState === "reconciled"
          ? "none"
          : lookup.status === "pending" ? "reconcile_receipt" : "deliver_service",
        recordedAt: reconciled.receipt.updatedAt.toISOString(),
      },
    };
  }

  async executeAgonJobEscrowTransaction(
    actor: string,
    intentId: string,
    request: AgonJobEscrowExecuteRequest,
  ): Promise<Result<AgonJobEscrowIntentView, AgonServiceError>> {
    const adapter = this.options.jobEscrowTransactionAdapter;
    if (!adapter?.enabled) return { ok: false, error: { code: "execution_not_ready", message: "AgonJobEscrow transaction execution is disabled by policy" } };
    if (request.confirmation !== "EXECUTE_ARC_TESTNET_JOB_ESCROW") return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet job escrow confirmation is required" } };
    const intent = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "AgonJobEscrow intent not found" } };
    const normalizedActor = actor.toLowerCase();
    if (intent.actor !== normalizedActor && intent.buyer !== normalizedActor && intent.provider !== normalizedActor) {
      return { ok: false, error: { code: "not_owner", message: "only an escrow party can execute this lifecycle action" } };
    }
    if (request.action !== "create" && !request.jobId && !intent.onchainJobId) {
      return { ok: false, error: { code: "validation_failed", message: "jobId is required for lifecycle actions after create" } };
    }
    const result = await adapter.submit({
      intentId,
      actor: normalizedActor,
      action: request.action,
      jobId: request.jobId,
      deliverableHash: request.deliverableHash,
      reasonHash: request.reasonHash,
    });
    if (!result.ok) {
      const code = result.error.code === "transaction_unknown" ? "reconciliation_unavailable" : result.error.code === "transaction_reverted" ? "conflict" : "execution_not_ready";
      return { ok: false, error: { code, message: result.error.message } };
    }
    const stored = await this.repository.getAgonJobEscrowIntent(intentId);
    if (!stored) return { ok: false, error: { code: "reconciliation_unavailable", message: "transaction succeeded but intent could not be reloaded" } };
    return { ok: true, value: jobEscrowIntentView(stored, this.options.jobEscrowTransactionAdapter?.enabled === true) };
  }

  async executeX402AgentSpend(
    actor: string,
    request: X402AgentSpendRequest,
  ): Promise<Result<X402AgentSpendView, AgonServiceError>> {
    const executor = this.options.x402AgentSpendExecutor;
    if (!executor) {
      return { ok: false, error: { code: "wallet_disabled", message: "agent wallet execution is not configured" } };
    }
    if (request.confirmation !== "EXECUTE_ARC_TESTNET_AGENT_X402") {
      return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet agent-spend confirmation is required" } };
    }
    const reference = parseReference(request.listingReference);
    if (!reference) return { ok: false, error: { code: "validation_failed", message: "listing reference is invalid" } };
    const listing = await this.repository.getListing(reference);
    if (!listing) return { ok: false, error: { code: "not_found", message: "agent listing not found" } };
    if (listing.status !== "Listed" || listing.quarantineReason) {
      return { ok: false, error: { code: "conflict", message: "agent listing is not eligible for machine-to-machine spending" } };
    }
    if (listing.providerSnapshot.toLowerCase() !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the listed agent owner can initiate this spend" } };
    }
    const result = await executor.execute({
      agentId: listing.agentId.toString(),
      idempotencyKey: request.idempotencyKey,
      amountBaseUnits: request.amountBaseUnits,
      recipient: request.recipient,
    });
    if (!result.ok) {
      const code = result.error.code === "wallet_disabled" || result.error.code === "wallet_unavailable"
        || result.error.code === "wallet_unknown" || result.error.code === "wallet_reconciliation_required"
        || result.error.code === "wallet_failed_replay"
        ? result.error.code
        : result.error.code === "wallet_policy_disabled" || result.error.code === "wallet_not_ready"
          ? "wallet_disabled"
          : result.error.code === "wallet_cap_exceeded" || result.error.code === "recipient_not_allowed" || result.error.code === "idempotency_conflict"
            ? "conflict"
            : "validation_failed";
      return { ok: false, error: { code, message: result.error.message } };
    }
    const record = result.record;
    const terminal = record.state === "confirmed" || record.state === "failed";
    return {
      ok: true,
      value: {
        agentId: record.agentId,
        listingReference: request.listingReference,
        idempotencyKey: record.idempotencyKey,
        state: record.state,
        providerTransferId: record.providerTransferId ?? null,
        transaction: record.transaction ?? null,
        executionEnabled: true,
        nextAction: terminal ? "none" : "reconcile_wallet",
        recordedAt: record.updatedAt.toISOString(),
      },
    };
  }

  async recordX402Delivery(
    actor: string,
    intentId: string,
    request: X402DeliveryEvidenceRequest,
  ): Promise<Result<X402DeliveryEvidenceView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "settlement_submitted" && receipt.state !== "unknown") {
      if (receipt.state === "service_delivered") {
        const existing = await this.repository.getLatestX402DeliveryEvidence(intentId);
        if (existing?.deliveryId === request.deliveryId) return { ok: true, value: deliveryEvidenceView(existing) };
      }
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; provider delivery cannot be recorded` } };
    }
    const listing = await this.repository.getListing({
      chainId: intent.chainId,
      serviceRegistry: intent.serviceRegistry,
      listingId: intent.listingId,
    });
    if (!listing) return { ok: false, error: { code: "not_found", message: "x402 listing not found" } };
    if (listing.currentVersion !== intent.version || listing.agentId !== intent.agentId) {
      return { ok: false, error: { code: "conflict", message: "x402 delivery does not match the prepared listing version" } };
    }
    if (listing.providerSnapshot.toLowerCase() !== actor.toLowerCase()) {
      return { ok: false, error: { code: "not_owner", message: "only the listing provider can record delivery evidence" } };
    }
    const evidenceInput: X402DeliveryEvidenceInput = {
      deliveryId: request.deliveryId,
      intentId,
      receiptId: receipt.receiptId,
      provider: actor,
      listingReference: intent.listingReference,
      serviceStatus: request.serviceStatus,
      latencyMs: request.latencyMs,
      responseHash: request.responseHash,
      resultAttestationHash: request.resultAttestationHash ?? null,
      chargedAmountUSDC: request.chargedAmountUSDC ?? null,
      deliveredAt: new Date(request.deliveredAt),
    };
    try {
      const evidence = validateX402DeliveryEvidence(evidenceInput);
      const stored = await this.repository.recordX402DeliveryEvidence(evidence);
      return { ok: true, value: deliveryEvidenceView(stored) };
    } catch (error) {
      if (error instanceof Error && error.name === "X402DeliveryInvariantError") {
        return { ok: false, error: { code: "validation_failed", message: error.message } };
      }
      return internalError(error);
    }
  }

  async settleX402Call(
    actor: string,
    intentId: string,
    request: X402SettlementRequest,
  ): Promise<Result<X402SettlementView, AgonServiceError>> {
    if (this.options.x402ExecutionEnabled !== true || !this.options.x402SettlementAdapter) {
      return { ok: false, error: { code: "execution_not_ready", message: "Circle x402 settlement is disabled by policy" } };
    }
    if (request.confirmation !== "EXECUTE_ARC_TESTNET_X402") {
      return { ok: false, error: { code: "validation_failed", message: "explicit Arc Testnet settlement confirmation is required" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can settle this call" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" && receipt.state !== "settlement_submitted" && receipt.state !== "unknown") {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    if (!receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "execution_not_ready", message: "x402 receipt is missing the exact execution evidence" } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = await this.repository.getLatestX402ExecutionApproval(intentId);
    if (!approval) return { ok: false, error: { code: "execution_not_ready", message: "explicit execution approval is required before settlement" } };
    const listing = await this.repository.getListing({ chainId: intent.chainId, serviceRegistry: intent.serviceRegistry, listingId: intent.listingId });
    if (!listing || listing.currentVersion !== intent.version || !intent.targetUrl) {
      return { ok: false, error: { code: "execution_not_ready", message: "the reviewed provider listing is no longer available" } };
    }
    const policy = this.options.x402ExecutionPolicy ?? createX402ExecutionPolicy({ enabled: false, maxAmountBaseUnits: 0n });
    const settled = await createX402SettlementOrchestrator({
      store: this.repository,
      adapter: this.options.x402SettlementAdapter,
      policy,
    }).settle({
      approval,
      plan: plan.value,
      signature: request.signature,
      confirmation: request.confirmation,
      delivery: { targetUrl: intent.targetUrl, method: intent.method, input: intent.input, idempotencyKey: intent.idempotencyKey },
    } as X402SettlementInput);
    if (!settled.ok) {
      if (settled.error.code === "reconciliation_required") return { ok: false, error: { code: "conflict", message: settled.error.message } };
      if (settled.error.code === "settlement_unknown") return { ok: false, error: { code: "facilitator_unavailable", message: settled.error.message } };
      return { ok: false, error: { code: "execution_not_ready", message: settled.error.message } };
    }
    let durableReceipt = settled.receipt;
    if (settled.delivery) {
      try {
        await this.repository.recordX402DeliveryEvidence({
          deliveryId: randomUUID(), intentId, receiptId: settled.receipt.receiptId,
          provider: listing.providerSnapshot, listingReference: intent.listingReference,
          serviceStatus: settled.delivery.serviceStatus, latencyMs: settled.delivery.latencyMs,
          responseHash: settled.delivery.responseHash, resultAttestationHash: null,
          chargedAmountUSDC: null, deliveredAt: new Date(settled.delivery.deliveredAt),
        }, settled.delivery.paymentResponseHash);
        durableReceipt = await this.repository.getX402CallReceipt(intentId) ?? settled.receipt;
      } catch {
        return { ok: false, error: { code: "reconciliation_unavailable", message: "provider delivered the service, but delivery evidence could not be stored; reconcile before another attempt" } };
      }
    }
    return {
      ok: true,
      value: {
        receiptId: durableReceipt.receiptId,
        intentId,
        state: settled.delivery ? "service_delivered" : "settlement_submitted",
        network: "eip155:5042002",
        transaction: settled.transaction,
        providerTransferId: durableReceipt.providerTransferId ?? null,
        payer: null,
        executionEnabled: true,
        serviceDeliveryPending: !settled.delivery,
        nextAction: settled.delivery ? "reconcile_receipt" : "deliver_service",
        ...(settled.delivery ? { serviceResult: settled.delivery.result, responseHash: settled.delivery.responseHash } : {}),
        recordedAt: durableReceipt.updatedAt.toISOString(),
      },
    };
  }

  async verifyX402Facilitator(
    actor: string,
    intentId: string,
    request: X402FacilitatorVerificationRequest,
  ): Promise<Result<X402FacilitatorVerificationView, AgonServiceError>> {
    if (!this.options.x402FacilitatorVerifier) {
      return { ok: false, error: { code: "facilitator_unavailable", message: "Circle facilitator verification is disabled by policy" } };
    }
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can verify this authorization" } };
    const receipt = await this.repository.getX402CallReceipt(intentId);
    if (!receipt) return { ok: false, error: { code: "receipt_unavailable", message: "x402 receipt has not been created" } };
    if (receipt.state !== "authorization_submitted" || !receipt.quoteSnapshot || !receipt.authorizationPayload || !receipt.authorizationPayloadHash || !receipt.authorizationHash || !receipt.approvedAmountUSDC) {
      return { ok: false, error: { code: "conflict", message: `x402 receipt is ${receipt.state}; submit a valid authorization first` } };
    }
    const plan = buildX402ExecutionPlan({
      snapshot: receipt.quoteSnapshot as X402QuoteSnapshot,
      authorization: receipt.authorizationPayload as X402AuthorizationPayload,
      authorizationPayloadHash: receipt.authorizationPayloadHash,
      authorizationHash: receipt.authorizationHash,
      approvedAmountUSDC: receipt.approvedAmountUSDC,
    });
    if (!plan.ok) return { ok: false, error: { code: "execution_not_ready", message: plan.error.message } };
    const approval = await this.repository.getLatestX402ExecutionApproval(intentId);
    if (!approval) return { ok: false, error: { code: "execution_not_ready", message: "explicit execution approval is required before facilitator verification" } };
    const recorded = await this.repository.getLatestX402FacilitatorVerification(intentId);
    if (recorded) {
      if (recorded.receiptId !== receipt.receiptId || recorded.approvalHash.toLowerCase() !== approval.approvalHash.toLowerCase()) {
        return { ok: false, error: { code: "conflict", message: "stored facilitator evidence does not match the current x402 receipt" } };
      }
      return { ok: true, value: facilitatorVerificationView(recorded) };
    }
    const result = await this.options.x402FacilitatorVerifier.verify({
      approval,
      plan: plan.value,
      signature: request.signature,
      confirmation: request.confirmation,
    } as X402FacilitatorVerificationInput);
    if (!result.ok) {
      const code = result.error.code === "facilitator_rejected" ? "facilitator_rejected" : result.error.code === "facilitator_unavailable" ? "facilitator_unavailable" : "execution_not_ready";
      return { ok: false, error: { code, message: result.error.message } };
    }
    const verifiedAt = new Date();
    const evidenceHash = keccak256(stringToHex(JSON.stringify({
      intentId,
      receiptId: receipt.receiptId,
      approvalHash: result.value.approvalHash,
      network: result.value.network,
      payer: result.value.payer,
      verifiedAt: verifiedAt.toISOString(),
    })));
    try {
      const stored = await this.repository.recordX402FacilitatorVerification({
        receiptId: receipt.receiptId,
        intentId,
        approvalHash: result.value.approvalHash,
        network: result.value.network,
        payer: result.value.payer,
        evidenceHash,
        verifiedAt,
      });
      return { ok: true, value: facilitatorVerificationView(stored) };
    } catch (error) {
      return internalError(error);
    }
  }

  async getX402FacilitatorVerification(
    actor: string,
    intentId: string,
  ): Promise<Result<X402FacilitatorVerificationView, AgonServiceError>> {
    const intent = await this.repository.getX402CallIntent(intentId);
    if (!intent) return { ok: false, error: { code: "not_found", message: "x402 call intent not found" } };
    if (intent.actor !== actor.toLowerCase()) return { ok: false, error: { code: "not_owner", message: "only the intent owner can read this verification" } };
    const evidence = await this.repository.getLatestX402FacilitatorVerification(intentId);
    if (!evidence) return { ok: false, error: { code: "receipt_unavailable", message: "no facilitator verification has been recorded" } };
    return { ok: true, value: facilitatorVerificationView(evidence) };
  }

  async getCapabilities(): Promise<AgonCapabilities> {
    const readiness = this.options.writer ? await this.options.writer.getReadiness() : null;
    const writesReady = readiness?.ready ?? false;
    const escrowReadiness = this.options.escrowProductionReadiness?.() ?? {
      testnetOnly: true as const,
      ready: false,
      executionEnabled: false as const,
      checkedAt: null,
      reasons: ["readiness_unconfigured"],
      requiredApprovals: [],
    };
    const protocolReadiness = this.options.protocolReadiness?.() ?? {
      ready: false,
      chainId: null,
      missingContracts: [],
      unverifiedContracts: [],
      externalRegistry: { identity: null, validation: null },
      reasons: ["protocol_readiness_unconfigured"],
    };
    let arenaEvaluatorReadiness: AgonCapabilities["arenaEvaluatorReadiness"] = {
      enabled: false,
      arenaAddress: null,
      evaluatorAddress: null,
      role: AGON_ARENA_EVALUATOR_ROLE,
      assigned: false,
      reason: "unconfigured",
      executionEnabled: false,
      executionReason: "writer_disabled",
      checkedAt: null,
    };
    if (this.options.arenaEvaluatorReadiness) {
      try {
        const result = await this.options.arenaEvaluatorReadiness();
        const executionEnabled = result.assigned && this.options.arenaEvaluatorAdapter?.enabled === true;
        arenaEvaluatorReadiness = {
          ...result,
          executionEnabled,
          executionReason: executionEnabled ? "ready" : result.reason === "service_registry_link_mismatch" ? "service_registry_link_mismatch" : result.assigned ? "writer_disabled" : "role_not_assigned",
          checkedAt: new Date().toISOString(),
        };
      } catch {
        arenaEvaluatorReadiness = {
          ...arenaEvaluatorReadiness,
          enabled: true,
          arenaAddress: this.options.agonArenaAddress ?? null,
          reason: "read_failed",
          executionEnabled: false,
          executionReason: "writer_disabled",
          checkedAt: new Date().toISOString(),
        };
      }
    }
    let listingVerifierReadiness: AgonCapabilities["listingVerifierReadiness"] = {
      enabled: false,
      registryAddress: null,
      verifierAddress: null,
      role: null,
      assigned: false,
      reason: "unconfigured",
      executionEnabled: false,
      executionReason: "writer_disabled",
      checkedAt: null,
    };
    if (this.options.listingVerifierReadiness) {
      try {
        const result = await this.options.listingVerifierReadiness();
        const executionEnabled = result.assigned && this.options.listingVerifierAdapter?.enabled === true;
        listingVerifierReadiness = {
          ...result,
          executionEnabled,
          executionReason: executionEnabled
            ? "ready"
            : result.reason === "scoped_verification_unsupported"
              ? "scoped_verification_unsupported"
              : result.assigned ? "writer_disabled" : "role_not_assigned",
          checkedAt: new Date().toISOString(),
        };
      } catch {
        listingVerifierReadiness = {
          ...listingVerifierReadiness,
          enabled: true,
          reason: "read_failed",
          checkedAt: new Date().toISOString(),
        };
      }
    }
    let endpointQa = false;
    try {
      endpointQa = typeof this.options.endpointQa === "function"
        ? await this.options.endpointQa()
        : this.options.endpointQa ?? false;
    } catch {
      endpointQa = false;
    }
    let operationsAlerts: AgonCapabilities["operationsAlerts"] = {
      enabled: false,
      ready: false,
      recipientAddress: null,
      recipientExists: false,
      telegramLinked: false,
      workerEnabled: false,
      pendingDeliveries: 0,
      retryingDeliveries: 0,
      deadDeliveries: 0,
      activeSubscribers: 0,
      telegramSubscribers: 0,
      unlinkedTelegramSubscribers: 0,
      reasons: ["readiness_unconfigured"],
      checkedAt: null,
    };
    if (this.options.operationsAlertReadiness) {
      try {
        operationsAlerts = await this.options.operationsAlertReadiness();
      } catch {
        operationsAlerts = { ...operationsAlerts, enabled: true, reasons: ["readiness_check_failed"], checkedAt: new Date().toISOString() };
      }
    }
    return {
      identityReads: this.options.identityReads ?? false,
      profileWrites: writesReady,
      listingReads: true,
      listingWrites: writesReady,
      endpointQa,
      certificationLifecycle: this.options.certificationLifecycle ?? {
        enabled: false,
        checkIntervalSeconds: 0,
        warningRetrySeconds: 0,
        failureThreshold: 0,
        endpointQaRequired: false,
        operatorAlertsConfigured: false,
      },
      operationsAlerts,
      directX402: this.options.directX402 ?? this.options.x402ExecutionEnabled === true,
      escrow: Boolean(this.options.agonJobEscrowAddress),
      jobEscrowCalldataSupported: this.options.jobEscrowCalldataSupported === true,
      jobEscrowExecution: this.options.jobEscrowTransactionAdapter?.enabled === true,
      jobEscrowExecutionReason: this.options.jobEscrowTransactionAdapter?.enabled === true ? null : this.options.jobEscrowExecutionReason ?? "job_escrow_execution_disabled",
      arenaVerification: Boolean(this.options.agonArenaAddress),
      arenaEvaluatorReadiness,
      listingVerifierReadiness,
      syndicateRegistry: Boolean(this.options.agonSyndicateRegistryAddress),
      prizeVault: Boolean(this.options.agonPrizeVaultAddress),
      protocolReadiness,
      writeReadiness: {
        checkedAt: readiness?.checkedAt ?? null,
        reasons: readiness?.reasons ?? ["adapter_unconfigured"],
      },
      escrowReadiness,
    };
  }
}
