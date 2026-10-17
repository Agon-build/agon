import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { transitionX402Receipt, type X402ReceiptEvent, type X402ReceiptState } from "../execution/x402-receipt.ts";
import { validateX402DeliveryEvidence, type X402DeliveryEvidence, type X402DeliveryEvidenceInput } from "../execution/x402-delivery.ts";
import { hashAgonEscrowTerms, isAgonEscrowTransitionAllowed, type AgonEscrowIntentState, type AgonEscrowTerms } from "../escrow-policy.ts";
import type { AgonPrizeEscrowPoolBinding } from "../execution/escrow-reconciliation.ts";
import type { AgonEscrowWriteOperation } from "../execution/escrow-write-preflight.ts";
import type { AgonListingAnchor } from "../write/repository.ts";
import {
  isAgonJobEscrowTransitionAllowed,
  settlementForAgonJobStatus,
  stateForAgonJobStatus,
  validateAgonJobEscrowJobMatch,
  type AgonJobEscrowIntent,
  type AgonJobEscrowIntentState,
  type AgonJobEscrowSettlement,
} from "../execution/job-escrow-state.ts";
import type { AgonJobEscrowAction, AgonJobEscrowJob } from "../execution/agon-job-escrow.ts";
import type { AgonArenaEvaluation, AgonArenaEvaluationInput, AgonArenaEvaluationState } from "../execution/arena-verification.ts";
import { buildAgonCertificationJob, type AgonCertificationJob, type AgonCertificationScheduleInput } from "../certification.ts";
import { evaluateAgonLifecycle, type AgonLifecycleCheckResult, type AgonLifecycleTransition } from "../certification-lifecycle.ts";
import type { PlaygroundRun } from "../playground.ts";
import type {
  AgonPrizeClaim,
  AgonPrizeClaimInput,
  AgonPrizeClaimState,
  AgonSyndicateContribution,
  AgonSyndicateContributionInput,
  AgonSyndicateContributionState,
} from "../execution/syndicate-prize.ts";

/// A claimed certification job is held this long: the agent task may take up to AGENT_TASK_TIMEOUT_MS,
/// then the endpoint check and saving the result run before the job is released.
export const AGON_CERTIFICATION_LEASE_MS = 120_000;

export type ProfileStatus = "Active" | "Suspended" | "Archived";
export type ListingStatus = "Listed" | "Suspended" | "Delisted";
export type VerificationStatus =
  | "Unverified"
  | "Pending"
  | "Verified"
  | "Expired"
  | "Suspended"
  | "Revoked";
export type PaymentRail = "X402" | "Escrow";
export type ListingEventType =
  | "published"
  | "version_published"
  | "status_changed"
  | "verification_changed"
  | "quarantined";

export type ProfileKey = {
  chainId: bigint;
  profileRegistry: string;
  agentId: bigint;
};

export type ProfileProjection = ProfileKey & {
  identityRegistry: string;
  ownerSnapshot: string;
  metadataUri: string;
  status: ProfileStatus;
  suspensionReason: string | null;
  sourceBlockNumber: bigint;
  sourceTxHash: string;
  sourceLogIndex: number;
  observedAt: Date;
};

export type StoredProfile = ProfileProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type ListingKey = {
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
};

export type ListingProjection = ListingKey & {
  agentId: bigint;
  serviceKey: string;
  category: bigint;
  currentVersion: bigint;
  manifestHash: string;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: string;
  chainStatus?: ListingStatus;
  status: ListingStatus;
  verification: VerificationStatus;
  quarantineReason: string | null;
  sourceBlockNumber: bigint;
  sourceTxHash: string;
  sourceLogIndex: number;
  observedAt: Date;
};

export type StoredListing = Omit<ListingProjection, "chainStatus"> & {
  chainStatus: ListingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredVerificationEvidence = {
  listingId: bigint;
  agentId: bigint;
  passed: boolean;
  evidenceHash: string;
  evidence: unknown;
  createdAt: Date;
  attempts: number;
  passedAttempts: number;
};

export type X402CallIntentProjection = {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
  agentId: bigint;
  version: bigint;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  inputHash: string;
  maxAmountUSDC: string;
  targetUrl?: string | null;
  state: "prepared";
  createdAt?: Date;
};

export type StoredX402CallIntent = X402CallIntentProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type X402CallReceiptProjection = {
  receiptId: string;
  intentId: string;
  state: X402ReceiptState;
  approvedAmountUSDC?: string | null;
  quoteHash: string | null;
  quoteSnapshot?: unknown | null;
  authorizationPayloadHash?: string | null;
  authorizationPayload?: unknown | null;
  authorizationHash: string | null;
  settlementRef: string | null;
  providerTransferId?: string | null;
  serviceStatus: number | null;
  paymentResponseHash: string | null;
  chargedAmountUSDC: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt?: Date;
};

export type StoredX402CallReceipt = X402CallReceiptProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type X402ExecutionApprovalProjection = {
  approvalHash: string;
  intentId: string;
  actor: string;
  planHash: string;
  authorizationHash: string;
  approvalIdempotencyKey: string;
  approvedAt: Date;
  expiresAt: Date;
};

export type StoredX402ExecutionApproval = X402ExecutionApprovalProjection & {
  createdAt: Date;
};

export type X402FacilitatorVerificationProjection = {
  verificationId?: string;
  receiptId: string;
  intentId: string;
  approvalHash: string;
  network: "eip155:5042002";
  payer: string | null;
  evidenceHash: string;
  verifiedAt: Date;
};

export type StoredX402FacilitatorVerification = X402FacilitatorVerificationProjection & {
  verificationId: string;
  createdAt: Date;
};

export type X402DeliveryEvidenceProjection = X402DeliveryEvidenceInput;
export type StoredX402DeliveryEvidence = X402DeliveryEvidence;

export type AgonEscrowIntentProjection = {
  intentId: string;
  actor: string;
  idempotencyKey: string;
  listingReference: string;
  termsHash: string;
  terms: AgonEscrowTerms;
  state: AgonEscrowIntentState;
  providerReference: string | null;
  transaction: `0x${string}` | null;
  poolBinding?: AgonPrizeEscrowPoolBinding | null;
  createdAt?: Date;
};

export type StoredAgonEscrowIntent = AgonEscrowIntentProjection & {
  createdAt: Date;
  updatedAt: Date;
};

export type AgonJobEscrowIntentProjection = Omit<AgonJobEscrowIntent, "createdAt" | "updatedAt"> & {
  createdAt?: Date;
};

export type StoredAgonJobEscrowIntent = AgonJobEscrowIntent;

export type AgonArenaEvaluationProjection = AgonArenaEvaluationInput & {
  state: AgonArenaEvaluationState;
  evaluationId: string | null;
  requestTransactionHash: `0x${string}` | null;
  startTransactionHash: `0x${string}` | null;
  evidenceTransactionHash: `0x${string}` | null;
  createdAt?: Date;
};

export type AgonMarketplaceVerificationState = "not_started" | "pending" | "submitted" | "confirmed" | "failed" | "unknown";

export type StoredAgonArenaEvaluation = AgonArenaEvaluation & {
  marketplaceVerificationState: AgonMarketplaceVerificationState;
  marketplaceVerificationTransactionHash: `0x${string}` | null;
  marketplaceVerificationError: string | null;
  marketplaceVerifiedAt: Date | null;
};

export type AgonSyndicateContributionProjection = AgonSyndicateContributionInput;
export type StoredAgonSyndicateContribution = AgonSyndicateContribution;
export type AgonPrizeClaimProjection = AgonPrizeClaimInput;
export type StoredAgonPrizeClaim = AgonPrizeClaim;

export type AgonEscrowTransactionApprovalProjection = {
  approvalHash: string;
  intentId: string;
  actor: string;
  operation: AgonEscrowWriteOperation;
  intentHash: string;
  approvalIdempotencyKey: string;
  approvedAt: Date;
  expiresAt: Date;
};

export type StoredAgonEscrowTransactionApproval = AgonEscrowTransactionApprovalProjection & {
  createdAt: Date;
};

export type ListingCursor = {
  updatedAt: Date;
  chainId: bigint;
  serviceRegistry: string;
  listingId: bigint;
};

export type ListingSearch = {
  limit: number;
  cursor: ListingCursor | null;
  category: bigint | null;
  agentId: bigint | null;
  serviceRegistry: string | null;
};

export type ValidatedListingVersion = ListingKey & {
  version: bigint;
  manifestHash: string;
  manifestUri: string;
  paymentRail: PaymentRail;
  providerSnapshot: string;
  validatedAt: Date;
};

export type ListingAudit = ListingKey & {
  version: bigint | null;
  eventType: ListingEventType;
  payload: Record<string, unknown>;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  observedAt: Date;
};

export type ChainEventRecord = {
  chainId: bigint;
  contractAddress: string;
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockHash: string;
  eventName: string;
  args: Record<string, unknown>;
  observedAt: Date;
};

export type IndexerCursorKey = {
  streamName: string;
  chainId: bigint;
  contractAddress: string;
};

export type IndexerCursor = IndexerCursorKey & {
  lastBlock: bigint;
  lastBlockHash: string;
  updatedAt?: Date;
};

type ProfileRow = QueryResultRow & {
  chain_id: string;
  profile_registry_address: string;
  identity_registry_address: string;
  agent_id: string;
  owner_snapshot: string;
  metadata_uri: string;
  status: ProfileStatus;
  suspension_reason: string | null;
  source_block_number: string;
  source_tx_hash: string;
  source_log_index: number;
  created_at: Date;
  updated_at: Date;
};

type ListingRow = QueryResultRow & {
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  service_key: string;
  category: string;
  current_version: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  chain_status: ListingStatus;
  status: ListingStatus;
  verification: VerificationStatus;
  quarantine_reason: string | null;
  source_block_number: string;
  source_tx_hash: string;
  source_log_index: number;
  created_at: Date;
  updated_at: Date;
};

type VerificationEvidenceRow = QueryResultRow & {
  listing_id: string;
  agent_id: string;
  passed: boolean;
  evidence_hash: string;
  evidence: unknown;
  created_at: Date;
  attempts: string;
  passed_attempts: string;
};

type X402CallIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  input: unknown;
  input_hash: string;
  max_amount_usdc: string;
  target_url: string | null;
  state: "prepared";
  created_at: Date;
  updated_at: Date;
};

type X402CallReceiptRow = QueryResultRow & {
  receipt_id: string;
  intent_id: string;
  state: X402ReceiptState;
  approved_amount_usdc: string | null;
  quote_hash: string | null;
  quote_snapshot: unknown | null;
  authorization_payload_hash: string | null;
  authorization_payload: unknown | null;
  authorization_hash: string | null;
  settlement_ref: string | null;
  provider_transfer_id: string | null;
  service_status: number | null;
  payment_response_hash: string | null;
  charged_amount_usdc: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  updated_at: Date;
};

type X402ExecutionApprovalRow = QueryResultRow & {
  approval_hash: string;
  intent_id: string;
  actor_address: string;
  plan_hash: string;
  authorization_hash: string;
  approval_idempotency_key: string;
  approved_at: Date;
  expires_at: Date;
  created_at: Date;
};

type X402FacilitatorVerificationRow = QueryResultRow & {
  verification_id: string;
  receipt_id: string;
  intent_id: string;
  approval_hash: string;
  network: "eip155:5042002";
  payer_address: string | null;
  evidence_hash: string;
  verified_at: Date;
  created_at: Date;
};

type X402DeliveryEvidenceRow = QueryResultRow & {
  delivery_id: string;
  intent_id: string;
  receipt_id: string;
  provider_address: string;
  listing_reference: string;
  service_status: number;
  latency_ms: number;
  response_hash: string;
  result_attestation_hash: string | null;
  charged_amount_usdc: string | null;
  evidence_hash: string;
  delivered_at: Date;
  created_at: Date;
};

type AgonEscrowIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  terms_hash: string;
  network: "eip155:5042002";
  asset: "0x3600000000000000000000000000000000000000";
  buyer_address: string;
  beneficiary_address: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  manifest_hash: string;
  amount_base_units: string;
  fee_bps: number;
  expires_at: Date;
  state: AgonEscrowIntentState;
  provider_reference: string | null;
  transaction_hash: `0x${string}` | null;
  pool_contract_address: string | null;
  pool_controller_address: string | null;
  pool_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type AgonJobEscrowIntentRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  network: "eip155:5042002";
  asset: "0x3600000000000000000000000000000000000000";
  escrow_contract_address: string;
  buyer_address: string;
  provider_address: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  manifest_hash: string;
  terms_hash: string;
  amount_base_units: string;
  fee_bps: number;
  review_hours: number;
  expires_at: Date;
  client_reference: string;
  state: AgonJobEscrowIntentState;
  settlement: AgonJobEscrowSettlement;
  onchain_job_id: string | null;
  transaction_hash: `0x${string}` | null;
  deliverable_hash: `0x${string}` | null;
  reason_hash: `0x${string}` | null;
  last_reconciled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AgonArenaEvaluationRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  listing_reference: string;
  network: "eip155:5042002";
  arena_contract_address: string;
  validation_registry_address: string;
  participant_address: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  category: string;
  manifest_hash: string;
  capability_hash: string;
  evaluator_version_hash: string;
  task_commitment: string;
  validation_request_hash: string;
  evidence_root: string;
  playground_run_id: string;
  expires_at: Date;
  state: AgonArenaEvaluationState;
  evaluation_id: string | null;
  request_transaction_hash: `0x${string}` | null;
  start_transaction_hash: `0x${string}` | null;
  evidence_transaction_hash: `0x${string}` | null;
  marketplace_verification_state: AgonMarketplaceVerificationState;
  marketplace_verification_transaction_hash: `0x${string}` | null;
  marketplace_verification_error: string | null;
  marketplace_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AgonCertificationRow = QueryResultRow & {
  job_id: string;
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  listing_version: string;
  service_key: string;
  category: string;
  task_id: string | null;
  listing_reference: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  state: AgonCertificationJob["state"];
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date;
  lease_expires_at: Date | null;
  blocked_reason: string | null;
  last_error_code: string | null;
  playground_run_id: string | null;
  passed: boolean | null;
  score: number | null;
  evidence_root: string | null;
  response_hash: string | null;
  task_commitment: string | null;
  validation_request_hash: string | null;
  evaluator_version_hash: string | null;
  provider_host: string | null;
  lifecycle_status: AgonCertificationJob["lifecycleStatus"];
  consecutive_failures: number;
  check_sequence: number;
  last_checked_at: Date | null;
  last_passed_at: Date | null;
  last_failed_at: Date | null;
  verification_action: AgonCertificationJob["verificationAction"];
  verification_action_state: AgonCertificationJob["verificationActionState"];
  verification_transaction_hash: string | null;
  verification_error: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
};

type AgonSyndicateContributionRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  registry_contract_address: string;
  syndicate_id: string;
  agent_id: string;
  contribution_key: string;
  score: string;
  evidence_hash: string;
  state: AgonSyndicateContributionState;
  transaction_hash: `0x${string}` | null;
  created_at: Date;
  updated_at: Date;
};

type AgonPrizeClaimRow = QueryResultRow & {
  intent_id: string;
  actor_address: string;
  idempotency_key: string;
  vault_contract_address: string;
  pool_key: string;
  claim_index: string;
  beneficiary_address: string;
  amount_base_units: string;
  proof: unknown;
  leaf_hash: string;
  state: AgonPrizeClaimState;
  transaction_hash: `0x${string}` | null;
  created_at: Date;
  updated_at: Date;
};

type AgonEscrowTransactionApprovalRow = QueryResultRow & {
  approval_hash: string;
  intent_id: string;
  actor_address: string;
  operation: AgonEscrowWriteOperation;
  intent_hash: string;
  approval_idempotency_key: string;
  approved_at: Date;
  expires_at: Date;
  created_at: Date;
};

type VersionRow = QueryResultRow & {
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  version: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  validated_at: Date;
};

type CertificationBackfillRow = QueryResultRow & {
  chain_id: string;
  service_registry_address: string;
  listing_id: string;
  agent_id: string;
  service_key: string;
  category: string;
  version: string;
  manifest_hash: string;
  manifest_uri: string;
  payment_rail: PaymentRail;
  provider_snapshot: string;
  status: ListingStatus;
  quarantine_reason: string | null;
};

type CursorRow = QueryResultRow & {
  stream_name: string;
  chain_id: string;
  contract_address: string;
  last_block: string;
  last_block_hash: string;
  updated_at: Date;
};

export class AgonStoreInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgonStoreInvariantError";
  }
}

function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-f]{40}$/i.test(value)) {
    throw new AgonStoreInvariantError(`invalid EVM address: ${value}`);
  }
  return value.toLowerCase();
}

function normalizeHash(value: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value)) {
    throw new AgonStoreInvariantError(`invalid bytes32 hash: ${value}`);
  }
  return value.toLowerCase();
}

function requirePositive(value: bigint, label: string): string {
  if (value <= 0n) throw new AgonStoreInvariantError(`${label} must be positive`);
  return value.toString();
}

function requireNonNegative(value: bigint, label: string): string {
  if (value < 0n) throw new AgonStoreInvariantError(`${label} must be non-negative`);
  return value.toString();
}

function requireLogIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgonStoreInvariantError("log index must be a non-negative safe integer");
  }
  return value;
}

function requireText(value: string, label: string): string {
  if (value.length === 0) throw new AgonStoreInvariantError(`${label} must not be empty`);
  return value;
}

function requireCertificationBackfillLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new AgonStoreInvariantError("certification backfill limit must be between 1 and 500");
  }
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]));
  }
  return value;
}

function mapProfile(row: ProfileRow): StoredProfile {
  return {
    chainId: BigInt(row.chain_id),
    profileRegistry: row.profile_registry_address,
    identityRegistry: row.identity_registry_address,
    agentId: BigInt(row.agent_id),
    ownerSnapshot: row.owner_snapshot,
    metadataUri: row.metadata_uri,
    status: row.status,
    suspensionReason: row.suspension_reason,
    sourceBlockNumber: BigInt(row.source_block_number),
    sourceTxHash: row.source_tx_hash,
    sourceLogIndex: row.source_log_index,
    observedAt: row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListing(row: ListingRow): StoredListing {
  return {
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    agentId: BigInt(row.agent_id),
    serviceKey: row.service_key,
    category: BigInt(row.category),
    currentVersion: BigInt(row.current_version),
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    paymentRail: row.payment_rail,
    providerSnapshot: row.provider_snapshot,
    chainStatus: row.chain_status,
    status: row.status,
    verification: row.verification,
    quarantineReason: row.quarantine_reason,
    sourceBlockNumber: BigInt(row.source_block_number),
    sourceTxHash: row.source_tx_hash,
    sourceLogIndex: row.source_log_index,
    observedAt: row.updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVersion(row: VersionRow): ValidatedListingVersion {
  return {
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    version: BigInt(row.version),
    manifestHash: row.manifest_hash,
    manifestUri: row.manifest_uri,
    paymentRail: row.payment_rail,
    providerSnapshot: row.provider_snapshot,
    validatedAt: row.validated_at,
  };
}

function mapX402CallIntent(row: X402CallIntentRow): StoredX402CallIntent {
  return {
    intentId: row.intent_id,
    actor: row.actor_address,
    idempotencyKey: row.idempotency_key,
    listingReference: row.listing_reference,
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: BigInt(row.listing_id),
    agentId: BigInt(row.agent_id),
    version: BigInt(row.listing_version),
    method: row.method,
    input: row.input,
    inputHash: row.input_hash,
    maxAmountUSDC: row.max_amount_usdc,
    targetUrl: row.target_url,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapX402CallReceipt(row: X402CallReceiptRow): StoredX402CallReceipt {
  return {
    receiptId: row.receipt_id,
    intentId: row.intent_id,
    state: row.state,
    approvedAmountUSDC: row.approved_amount_usdc,
    quoteHash: row.quote_hash,
    quoteSnapshot: row.quote_snapshot,
    authorizationPayloadHash: row.authorization_payload_hash,
    authorizationPayload: row.authorization_payload,
    authorizationHash: row.authorization_hash,
    settlementRef: row.settlement_ref,
    providerTransferId: row.provider_transfer_id,
    serviceStatus: row.service_status,
    paymentResponseHash: row.payment_response_hash,
    chargedAmountUSDC: row.charged_amount_usdc,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapX402ExecutionApproval(row: X402ExecutionApprovalRow): StoredX402ExecutionApproval {
  return {
    approvalHash: row.approval_hash,
    intentId: row.intent_id,
    actor: row.actor_address,
    planHash: row.plan_hash,
    authorizationHash: row.authorization_hash,
    approvalIdempotencyKey: row.approval_idempotency_key,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapX402FacilitatorVerification(row: X402FacilitatorVerificationRow): StoredX402FacilitatorVerification {
  return {
    verificationId: row.verification_id,
    receiptId: row.receipt_id,
    intentId: row.intent_id,
    approvalHash: row.approval_hash,
    network: row.network,
    payer: row.payer_address,
    evidenceHash: row.evidence_hash,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
}

function mapX402DeliveryEvidence(row: X402DeliveryEvidenceRow): StoredX402DeliveryEvidence {
  return {
    deliveryId: row.delivery_id,
    intentId: row.intent_id,
    receiptId: row.receipt_id,
    provider: row.provider_address as `0x${string}`,
    listingReference: row.listing_reference,
    serviceStatus: row.service_status,
    latencyMs: row.latency_ms,
    responseHash: row.response_hash as `0x${string}`,
    resultAttestationHash: row.result_attestation_hash as `0x${string}` | null,
    chargedAmountUSDC: row.charged_amount_usdc,
    evidenceHash: row.evidence_hash as `0x${string}`,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

function mapAgonEscrowIntent(row: AgonEscrowIntentRow): StoredAgonEscrowIntent {
  return {
    intentId: row.intent_id,
    actor: row.actor_address,
    idempotencyKey: row.idempotency_key,
    listingReference: row.listing_reference,
    termsHash: row.terms_hash,
    terms: {
      network: row.network,
      asset: row.asset,
      buyer: row.buyer_address as `0x${string}`,
      beneficiary: row.beneficiary_address as `0x${string}`,
      listing: {
        serviceRegistry: row.service_registry_address as `0x${string}`,
        listingId: row.listing_id,
        agentId: row.agent_id,
        version: row.listing_version,
        manifestHash: row.manifest_hash as `0x${string}`,
      },
      amountBaseUnits: BigInt(row.amount_base_units),
      feeBps: row.fee_bps,
      expiresAt: row.expires_at,
    },
    state: row.state,
    providerReference: row.provider_reference,
    transaction: row.transaction_hash,
    poolBinding: row.pool_contract_address && row.pool_controller_address && row.pool_id !== null
      ? {
          contractAddress: row.pool_contract_address as `0x${string}`,
          controller: row.pool_controller_address as `0x${string}`,
          poolId: row.pool_id,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonJobEscrowIntent(row: AgonJobEscrowIntentRow): StoredAgonJobEscrowIntent {
  return {
    intentId: row.intent_id,
    idempotencyKey: row.idempotency_key,
    actor: row.actor_address as `0x${string}`,
    buyer: row.buyer_address as `0x${string}`,
    provider: row.provider_address as `0x${string}`,
    listingReference: row.listing_reference,
    network: row.network,
    asset: row.asset as `0x${string}`,
    escrowContract: row.escrow_contract_address as `0x${string}`,
    serviceRegistry: row.service_registry_address as `0x${string}`,
    listingId: row.listing_id,
    agentId: row.agent_id,
    listingVersion: row.listing_version,
    manifestHash: row.manifest_hash as `0x${string}`,
    termsHash: row.terms_hash as `0x${string}`,
    amountBaseUnits: BigInt(row.amount_base_units),
    feeBps: row.fee_bps,
    reviewHours: row.review_hours,
    expiresAt: row.expires_at,
    clientReference: row.client_reference as `0x${string}`,
    state: row.state,
    settlement: row.settlement,
    onchainJobId: row.onchain_job_id,
    transactionHash: row.transaction_hash,
    deliverableHash: row.deliverable_hash,
    reasonHash: row.reason_hash,
    lastReconciledAt: row.last_reconciled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonArenaEvaluation(row: AgonArenaEvaluationRow): StoredAgonArenaEvaluation {
  return {
    intentId: row.intent_id,
    actor: row.actor_address as `0x${string}`,
    idempotencyKey: row.idempotency_key,
    listingReference: row.listing_reference,
    network: row.network,
    arenaContract: row.arena_contract_address as `0x${string}`,
    validationRegistry: row.validation_registry_address as `0x${string}`,
    participant: row.participant_address as `0x${string}`,
    serviceRegistry: row.service_registry_address as `0x${string}`,
    listingId: row.listing_id,
    agentId: row.agent_id,
    listingVersion: row.listing_version,
    category: row.category,
    manifestHash: row.manifest_hash as `0x${string}`,
    capabilityHash: row.capability_hash as `0x${string}`,
    evaluatorVersionHash: row.evaluator_version_hash as `0x${string}`,
    taskCommitment: row.task_commitment as `0x${string}`,
    validationRequestHash: row.validation_request_hash as `0x${string}`,
    evidenceRoot: row.evidence_root as `0x${string}`,
    playgroundRunId: row.playground_run_id,
    expiresAt: row.expires_at,
    state: row.state,
    evaluationId: row.evaluation_id,
    requestTransactionHash: row.request_transaction_hash,
    startTransactionHash: row.start_transaction_hash,
    evidenceTransactionHash: row.evidence_transaction_hash,
    marketplaceVerificationState: row.marketplace_verification_state,
    marketplaceVerificationTransactionHash: row.marketplace_verification_transaction_hash,
    marketplaceVerificationError: row.marketplace_verification_error,
    marketplaceVerifiedAt: row.marketplace_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonCertification(row: AgonCertificationRow): AgonCertificationJob {
  return {
    jobId: row.job_id,
    chainId: BigInt(row.chain_id),
    serviceRegistry: row.service_registry_address,
    listingId: row.listing_id,
    agentId: row.agent_id,
    listingVersion: row.listing_version,
    serviceKey: row.service_key as `0x${string}`,
    category: row.category,
    taskId: row.task_id,
    listingReference: row.listing_reference,
    manifestHash: row.manifest_hash as `0x${string}`,
    manifestUri: row.manifest_uri,
    paymentRail: row.payment_rail,
    providerSnapshot: row.provider_snapshot as `0x${string}`,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    leaseExpiresAt: row.lease_expires_at,
    blockedReason: row.blocked_reason,
    lastErrorCode: row.last_error_code,
    playgroundRunId: row.playground_run_id,
    passed: row.passed,
    score: row.score,
    evidenceRoot: row.evidence_root as `0x${string}` | null,
    responseHash: row.response_hash as `0x${string}` | null,
    taskCommitment: row.task_commitment as `0x${string}` | null,
    validationRequestHash: row.validation_request_hash as `0x${string}` | null,
    evaluatorVersionHash: row.evaluator_version_hash as `0x${string}` | null,
    providerHost: row.provider_host,
    lifecycleStatus: row.lifecycle_status,
    consecutiveFailures: row.consecutive_failures,
    checkSequence: row.check_sequence,
    lastCheckedAt: row.last_checked_at,
    lastPassedAt: row.last_passed_at,
    lastFailedAt: row.last_failed_at,
    verificationAction: row.verification_action,
    verificationActionState: row.verification_action_state,
    verificationTransactionHash: row.verification_transaction_hash as `0x${string}` | null,
    verificationError: row.verification_error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonSyndicateContribution(row: AgonSyndicateContributionRow): StoredAgonSyndicateContribution {
  return {
    intentId: row.intent_id,
    actor: row.actor_address as `0x${string}`,
    idempotencyKey: row.idempotency_key,
    registryContract: row.registry_contract_address as `0x${string}`,
    syndicateId: row.syndicate_id,
    agentId: row.agent_id,
    contributionKey: row.contribution_key as `0x${string}`,
    score: row.score,
    evidenceHash: row.evidence_hash as `0x${string}`,
    state: row.state,
    transactionHash: row.transaction_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonPrizeClaim(row: AgonPrizeClaimRow): StoredAgonPrizeClaim {
  if (!Array.isArray(row.proof) || !row.proof.every((value): value is string => typeof value === "string")) {
    throw new AgonStoreInvariantError("prize claim proof is not a string array");
  }
  return {
    intentId: row.intent_id,
    actor: row.actor_address as `0x${string}`,
    idempotencyKey: row.idempotency_key,
    vaultContract: row.vault_contract_address as `0x${string}`,
    poolKey: row.pool_key as `0x${string}`,
    index: row.claim_index,
    beneficiary: row.beneficiary_address as `0x${string}`,
    amount: row.amount_base_units,
    proof: row.proof as `0x${string}`[],
    leaf: row.leaf_hash as `0x${string}`,
    state: row.state,
    transactionHash: row.transaction_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgonEscrowTransactionApproval(row: AgonEscrowTransactionApprovalRow): StoredAgonEscrowTransactionApproval {
  return {
    approvalHash: row.approval_hash,
    intentId: row.intent_id,
    actor: row.actor_address,
    operation: row.operation,
    intentHash: row.intent_hash,
    approvalIdempotencyKey: row.approval_idempotency_key,
    approvedAt: row.approved_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function versionsMatch(left: ValidatedListingVersion, right: ValidatedListingVersion): boolean {
  return (
    left.chainId === right.chainId &&
    left.serviceRegistry === normalizeAddress(right.serviceRegistry) &&
    left.listingId === right.listingId &&
    left.version === right.version &&
    left.manifestHash === normalizeHash(right.manifestHash) &&
    left.manifestUri === right.manifestUri &&
    left.paymentRail === right.paymentRail &&
    left.providerSnapshot === normalizeAddress(right.providerSnapshot)
  );
}

const PROFILE_COLUMNS = `
  chain_id, profile_registry_address, identity_registry_address, agent_id,
  owner_snapshot, metadata_uri, status, suspension_reason, source_block_number,
  source_tx_hash, source_log_index, created_at, updated_at`;

const LISTING_COLUMNS = `
  chain_id, service_registry_address, listing_id, agent_id, service_key, category,
  current_version, manifest_hash, manifest_uri, payment_rail, provider_snapshot,
  chain_status, status, verification, quarantine_reason, source_block_number,
  source_tx_hash, source_log_index, created_at, updated_at`;

const X402_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, chain_id,
  service_registry_address, listing_id, agent_id, listing_version, method,
  input, input_hash, max_amount_usdc, target_url, state, created_at, updated_at`;

const X402_RECEIPT_COLUMNS = `
  receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref, provider_transfer_id,
  service_status, payment_response_hash, charged_amount_usdc, failure_code,
  failure_message, created_at, updated_at`;

const X402_EXECUTION_APPROVAL_COLUMNS = `
  approval_hash, intent_id, actor_address, plan_hash, authorization_hash,
  approval_idempotency_key, approved_at, expires_at, created_at`;

const X402_FACILITATOR_VERIFICATION_COLUMNS = `
  verification_id, receipt_id, intent_id, approval_hash, network, payer_address,
  evidence_hash, verified_at, created_at`;

const X402_DELIVERY_EVIDENCE_COLUMNS = `
  delivery_id, intent_id, receipt_id, provider_address, listing_reference,
  service_status, latency_ms, response_hash, result_attestation_hash,
  charged_amount_usdc, evidence_hash, delivered_at, created_at`;

const AGON_ESCROW_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, terms_hash, network, asset,
  buyer_address, beneficiary_address, service_registry_address, listing_id,
  agent_id, listing_version, manifest_hash, amount_base_units, fee_bps,
  expires_at, state, provider_reference, transaction_hash, pool_contract_address,
  pool_controller_address, pool_id, created_at, updated_at`;

const AGON_JOB_ESCROW_INTENT_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, network, asset,
  escrow_contract_address, buyer_address, provider_address, service_registry_address,
  listing_id, agent_id, listing_version, manifest_hash, terms_hash, amount_base_units,
  fee_bps, review_hours, expires_at, client_reference, state, settlement, onchain_job_id,
  transaction_hash, deliverable_hash, reason_hash, last_reconciled_at, created_at, updated_at`;

const AGON_ARENA_EVALUATION_COLUMNS = `
  intent_id, actor_address, idempotency_key, listing_reference, network,
  arena_contract_address, validation_registry_address, participant_address,
  service_registry_address, listing_id, agent_id, listing_version, category,
  manifest_hash, capability_hash, evaluator_version_hash, task_commitment,
  validation_request_hash, evidence_root, playground_run_id, expires_at, state,
  evaluation_id, request_transaction_hash, start_transaction_hash, evidence_transaction_hash,
  marketplace_verification_state, marketplace_verification_transaction_hash,
  marketplace_verification_error, marketplace_verified_at, created_at, updated_at`;

const AGON_CERTIFICATION_COLUMNS = `
  job_id, chain_id, service_registry_address, listing_id, agent_id, listing_version,
  service_key, category, task_id, listing_reference, manifest_hash, manifest_uri, payment_rail,
  provider_snapshot, state, attempts, max_attempts, next_attempt_at, lease_expires_at,
  blocked_reason, last_error_code, playground_run_id, passed, score, evidence_root,
  response_hash, task_commitment, validation_request_hash, evaluator_version_hash,
  provider_host, lifecycle_status, consecutive_failures, check_sequence,
  last_checked_at, last_passed_at, last_failed_at,
  verification_action, verification_action_state, verification_transaction_hash, verification_error,
  created_at, started_at, completed_at, updated_at`;

const AGON_SYNDICATE_CONTRIBUTION_COLUMNS = `
  intent_id, actor_address, idempotency_key, registry_contract_address,
  syndicate_id, agent_id, contribution_key, score, evidence_hash, state,
  transaction_hash, created_at, updated_at`;

const AGON_PRIZE_CLAIM_COLUMNS = `
  intent_id, actor_address, idempotency_key, vault_contract_address, pool_key,
  claim_index, beneficiary_address, amount_base_units, proof, leaf_hash, state,
  transaction_hash, created_at, updated_at`;

const AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS = `
  approval_hash, intent_id, actor_address, operation, intent_hash,
  approval_idempotency_key, approved_at, expires_at, created_at`;

export class PostgresAgonRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async withTransaction<T>(work: (repository: AgonTransactionRepository) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await work(new AgonTransactionRepository(client));
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getProfile(key: ProfileKey): Promise<StoredProfile | null> {
    const result = await this.pool.query<ProfileRow>(
      `select ${PROFILE_COLUMNS} from agon_profiles
       where chain_id = $1 and profile_registry_address = $2 and agent_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.profileRegistry), requirePositive(key.agentId, "agent id")],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async getListing(key: ListingKey): Promise<StoredListing | null> {
    const result = await this.pool.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return result.rows[0] ? mapListing(result.rows[0]) : null;
  }

  async insertValidatedListingVersion(anchor: AgonListingAnchor): Promise<void> {
    await this.withTransaction((repository) => repository.insertValidatedListingVersion(anchor));
  }

  async reconcileListingAnchor(anchor: AgonListingAnchor): Promise<void> {
    await this.pool.query(
      `update agon_listings
          set status = chain_status,
              quarantine_reason = null,
              updated_at = now()
        where chain_id = $1
          and service_registry_address = $2
          and listing_id = $3
          and current_version = $4
          and manifest_hash = $5
          and manifest_uri = $6
          and payment_rail = $7
          and provider_snapshot = $8
          and quarantine_reason = 'missing_validated_version'`,
      [
        anchor.chainId.toString(),
        anchor.serviceRegistry.toLowerCase(),
        anchor.listingId.toString(),
        anchor.version.toString(),
        anchor.manifestHash.toLowerCase(),
        anchor.manifestUri,
        anchor.paymentRail,
        anchor.providerSnapshot.toLowerCase(),
      ],
    );
    // A listing is often indexed a moment before Agon records its validated version, so its
    // certification job starts blocked as quarantined. Once the anchor is confirmed, queue it.
    await this.pool.query(
      `update agon_certification_jobs
          set state = 'scheduled', blocked_reason = null, next_attempt_at = now(), updated_at = now()
        where chain_id = $1
          and service_registry_address = $2
          and listing_id = $3
          and listing_version = $4
          and manifest_hash = $5
          and state = 'blocked'
          and blocked_reason = 'listing_quarantined'
          and task_id is not null`,
      [
        anchor.chainId.toString(),
        anchor.serviceRegistry.toLowerCase(),
        anchor.listingId.toString(),
        anchor.version.toString(),
        anchor.manifestHash.toLowerCase(),
      ],
    );
  }

  async getAgonEscrowIntent(intentId: string): Promise<StoredAgonEscrowIntent | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonEscrowIntentRow>(
      `select ${AGON_ESCROW_INTENT_COLUMNS} from agon_escrow_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonEscrowIntent(result.rows[0]) : null;
  }

  async getAgonJobEscrowIntent(intentId: string): Promise<StoredAgonJobEscrowIntent | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonJobEscrowIntentRow>(
      `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonJobEscrowIntent(result.rows[0]) : null;
  }

  async getAgonArenaEvaluation(intentId: string): Promise<StoredAgonArenaEvaluation | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonArenaEvaluationRow>(
      `select ${AGON_ARENA_EVALUATION_COLUMNS} from agon_arena_evaluations where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonArenaEvaluation(result.rows[0]) : null;
  }

  async getAgonCertification(jobId: string): Promise<AgonCertificationJob | null> {
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
    const result = await this.pool.query<AgonCertificationRow>(
      `select ${AGON_CERTIFICATION_COLUMNS} from agon_certification_jobs where job_id = $1`,
      [jobId],
    );
    return result.rows[0] ? mapAgonCertification(result.rows[0]) : null;
  }

  async claimAgonCertification(now = new Date()): Promise<AgonCertificationJob | null> {
    if (!Number.isFinite(now.getTime())) throw new AgonStoreInvariantError("certification claim time is invalid");
    return this.withTransaction(async (repository) => repository.claimAgonCertification(now));
  }

  async backfillAgonCertifications(limit = 100, now = new Date()): Promise<number> {
    requireCertificationBackfillLimit(limit);
    if (!Number.isFinite(now.getTime())) throw new AgonStoreInvariantError("certification backfill time is invalid");
    return this.withTransaction((repository) => repository.backfillAgonCertifications(limit, now));
  }

  async retryAgonCertificationVerification(jobId: string, at: Date): Promise<void> {
    await this.pool.query(
      `update agon_certification_jobs
          set next_attempt_at = least(next_attempt_at, $2), updated_at = now()
        where job_id = $1 and state = 'scheduled'`,
      [jobId, at],
    );
  }

  async deferAgonCertification(jobId: string, nextAttemptAt: Date, reason: string): Promise<void> {
    await this.pool.query(
      `update agon_certification_jobs
          set state = 'scheduled', attempts = greatest(attempts - 1, 0),
              lease_expires_at = null, next_attempt_at = $2,
              last_error_code = $3, updated_at = now()
        where job_id = $1 and state = 'running'`,
      [jobId, nextAttemptAt, reason.slice(0, 80)],
    );
  }

  async completeAgonCertification(jobId: string, result: PlaygroundRun): Promise<void> {
    const evidence = result.evidence;
    const updated = await this.pool.query(
      `update agon_certification_jobs
          set state = 'completed', lease_expires_at = null, completed_at = now(), updated_at = now(),
              playground_run_id = $2, passed = $3, score = $4, evidence_root = $5,
              response_hash = $6, task_commitment = $7, validation_request_hash = $8,
              evaluator_version_hash = $9, provider_host = $10, last_error_code = null
        where job_id = $1 and state = 'running'`,
      [
        jobId,
        result.runId,
        result.passed,
        result.score,
        evidence.evidenceRoot,
        evidence.responseHash,
        evidence.taskCommitment,
        evidence.validationRequestHash,
        evidence.evaluatorVersionHash,
        result.provenance.providerHost,
      ],
    );
    if (updated.rowCount !== 1) throw new AgonStoreInvariantError("certification job was not running");
  }

  async finalizeAgonCertificationLifecycle(jobId: string, check: AgonLifecycleCheckResult): Promise<AgonLifecycleTransition> {
    return this.withTransaction((repository) => repository.finalizeAgonCertificationLifecycle(jobId, check));
  }

  async recordAgonCertificationVerificationAction(input: {
    jobId: string;
    action: "approve" | "suspend";
    state: "submitted" | "confirmed" | "unknown" | "failed";
    transactionHash?: `0x${string}` | null;
    error?: string | null;
  }): Promise<void> {
    const transactionHash = input.transactionHash === undefined ? undefined : input.transactionHash === null ? null : normalizeHash(input.transactionHash);
    const updated = await this.pool.query(
      `update agon_certification_jobs
          set verification_action_state = $3,
              verification_transaction_hash = coalesce($4, verification_transaction_hash),
              verification_error = $5,
              updated_at = now()
        where job_id = $1 and verification_action = $2
          and verification_action_state in ('pending','submitted','unknown','failed','confirmed')
          and (verification_action_state <> 'confirmed' or $3 = 'confirmed')`,
      [input.jobId, input.action, input.state, transactionHash, input.error?.slice(0, 500) ?? null],
    );
    if (updated.rowCount !== 1) throw new AgonStoreInvariantError("certification verification action is not pending");
  }

  async recordAgonEndpointQa(input: {
    listingId: bigint;
    agentId: bigint;
    passed: boolean;
    evidenceHash: `0x${string}`;
    evidence: unknown;
  }): Promise<void> {
    await this.pool.query(
      `insert into agon_verification_evidence (listing_id, agent_id, passed, evidence_hash, evidence, verifier)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [input.listingId.toString(), input.agentId.toString(), input.passed, normalizeHash(input.evidenceHash), JSON.stringify({ source: "agon-endpoint-qa", ...((input.evidence as Record<string, unknown> | null) ?? {}) }), "agon-endpoint-qa"],
    );
  }

  async failAgonCertification(jobId: string, errorCode: string, nextAttemptAt: Date | null): Promise<void> {
    const updated = await this.pool.query(
      `update agon_certification_jobs
          set state = case when $2::timestamptz is null then 'failed' else 'scheduled' end,
              lease_expires_at = null, next_attempt_at = coalesce($2::timestamptz, next_attempt_at),
              completed_at = case when $2::timestamptz is null then now() else null end,
              last_error_code = $3, updated_at = now()
        where job_id = $1 and state = 'running'`,
      [jobId, nextAttemptAt, errorCode.slice(0, 80)],
    );
    if (updated.rowCount !== 1) throw new AgonStoreInvariantError("certification job was not running");
  }

  async prepareAgonArenaEvaluation(input: AgonArenaEvaluationProjection): Promise<StoredAgonArenaEvaluation> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("Arena evaluation idempotency key is invalid");
    if (input.state !== "prepared" || input.evaluationId !== null || input.requestTransactionHash !== null || input.startTransactionHash !== null || input.evidenceTransactionHash !== null) {
      throw new AgonStoreInvariantError("Arena evaluation must start prepared without transaction evidence");
    }
    const inserted = await this.pool.query<AgonArenaEvaluationRow>(
      `insert into agon_arena_evaluations (
         intent_id, actor_address, idempotency_key, listing_reference, network,
         arena_contract_address, validation_registry_address, participant_address,
         service_registry_address, listing_id, agent_id, listing_version, category,
         manifest_hash, capability_hash, evaluator_version_hash, task_commitment,
         validation_request_hash, evidence_root, playground_run_id, expires_at,
         state, evaluation_id, request_transaction_hash, start_transaction_hash, evidence_transaction_hash,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $27)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
      [
        input.intentId,
        actor,
        input.idempotencyKey,
        input.listingReference,
        input.network,
        normalizeAddress(input.arenaContract),
        normalizeAddress(input.validationRegistry),
        normalizeAddress(input.participant),
        normalizeAddress(input.serviceRegistry),
        requirePositive(BigInt(input.listingId), "listing id"),
        requirePositive(BigInt(input.agentId), "agent id"),
        requirePositive(BigInt(input.listingVersion), "listing version"),
        input.category,
        normalizeHash(input.manifestHash),
        normalizeHash(input.capabilityHash),
        normalizeHash(input.evaluatorVersionHash),
        normalizeHash(input.taskCommitment),
        normalizeHash(input.validationRequestHash),
        normalizeHash(input.evidenceRoot),
        input.playgroundRunId,
        input.expiresAt,
        input.state,
        input.evaluationId,
        input.requestTransactionHash,
        input.startTransactionHash,
        input.evidenceTransactionHash,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapAgonArenaEvaluation(inserted.rows[0]);
    const existing = await this.pool.query<AgonArenaEvaluationRow>(
      `select ${AGON_ARENA_EVALUATION_COLUMNS}
       from agon_arena_evaluations where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("Arena evaluation idempotency conflict could not be loaded");
    const value = mapAgonArenaEvaluation(row);
    const same = value.listingReference === input.listingReference
      && value.playgroundRunId === input.playgroundRunId
      && value.validationRequestHash === input.validationRequestHash.toLowerCase()
      && value.evidenceRoot === input.evidenceRoot.toLowerCase()
      && value.arenaContract === input.arenaContract.toLowerCase()
      && value.validationRegistry === input.validationRegistry.toLowerCase()
      && value.expiresAt.getTime() === input.expiresAt.getTime();
    if (!same) throw new AgonStoreInvariantError("Arena evaluation idempotency key already used for different evidence");
    return value;
  }

  async markAgonArenaEvaluationRequested(input: {
    intentId: string;
    evaluationId: string;
    transactionHash: `0x${string}`;
  }): Promise<StoredAgonArenaEvaluation> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    if (!/^[1-9]\d*$/.test(input.evaluationId)) throw new AgonStoreInvariantError("Arena evaluation id must be positive");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonArenaEvaluationRow>(
        `select ${AGON_ARENA_EVALUATION_COLUMNS} from agon_arena_evaluations where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("Arena evaluation not found");
      if (row.state === "request_submitted" && row.evaluation_id === input.evaluationId && row.request_transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonArenaEvaluation(row);
      }
      if (row.state !== "prepared") throw new AgonStoreInvariantError(`cannot mark Arena evaluation ${row.state} as requested`);
      const updated = await client.query<AgonArenaEvaluationRow>(
        `update agon_arena_evaluations set state = 'request_submitted', evaluation_id = $2,
           request_transaction_hash = $3, updated_at = now()
         where intent_id = $1 returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
        [input.intentId, input.evaluationId, transactionHash],
      );
      await client.query("commit");
      return mapAgonArenaEvaluation(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markAgonArenaEvaluationStarted(input: {
    intentId: string;
    transactionHash: `0x${string}`;
  }): Promise<StoredAgonArenaEvaluation> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonArenaEvaluationRow>(
        `select ${AGON_ARENA_EVALUATION_COLUMNS} from agon_arena_evaluations where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("Arena evaluation not found");
      if (row.state === "evidence_ready" && row.start_transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonArenaEvaluation(row);
      }
      if (row.state !== "request_submitted") throw new AgonStoreInvariantError(`cannot mark Arena evaluation ${row.state} as started`);
      const updated = await client.query<AgonArenaEvaluationRow>(
        `update agon_arena_evaluations set state = 'evidence_ready', start_transaction_hash = $2, updated_at = now()
         where intent_id = $1 returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
        [input.intentId, transactionHash],
      );
      await client.query("commit");
      return mapAgonArenaEvaluation(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markAgonArenaEvidenceSubmitted(input: {
    intentId: string;
    transactionHash: `0x${string}`;
  }): Promise<StoredAgonArenaEvaluation> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonArenaEvaluationRow>(
        `select ${AGON_ARENA_EVALUATION_COLUMNS} from agon_arena_evaluations where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("Arena evaluation not found");
      if (row.state === "evidence_submitted" && row.evidence_transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonArenaEvaluation(row);
      }
      if (row.state !== "request_submitted" && row.state !== "evidence_ready") throw new AgonStoreInvariantError(`cannot mark Arena evidence while evaluation is ${row.state}`);
      const updated = await client.query<AgonArenaEvaluationRow>(
        `update agon_arena_evaluations set state = 'evidence_submitted', evidence_transaction_hash = $2, updated_at = now()
         where intent_id = $1 returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
        [input.intentId, transactionHash],
      );
      await client.query("commit");
      return mapAgonArenaEvaluation(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileAgonArenaEvaluation(input: {
    intentId: string;
    state: AgonArenaEvaluationState;
  }): Promise<StoredAgonArenaEvaluation> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    const allowed: AgonArenaEvaluationState[] = ["request_submitted", "evidence_ready", "evidence_submitted", "verified", "rejected", "expired", "revoked"];
    if (!allowed.includes(input.state)) throw new AgonStoreInvariantError("Arena reconciliation state is invalid");
    const current = await this.getAgonArenaEvaluation(input.intentId);
    if (!current) throw new AgonStoreInvariantError("Arena evaluation not found");
    const rank: Record<AgonArenaEvaluationState, number> = {
      prepared: 0, request_submitted: 1, evidence_ready: 2, evidence_submitted: 3,
      verified: 4, rejected: 4, expired: 4, revoked: 5, unknown: 0,
    };
    if (rank[input.state] < rank[current.state]) throw new AgonStoreInvariantError(`cannot reconcile Arena evaluation from ${current.state} to ${input.state}`);
    if (["verified", "rejected", "expired", "revoked"].includes(current.state) && current.state !== input.state) {
      if (!(current.state === "verified" || current.state === "rejected") || input.state !== "revoked") {
        throw new AgonStoreInvariantError(`Arena evaluation ${current.state} is terminal`);
      }
    }
    const updated = await this.pool.query<AgonArenaEvaluationRow>(
      `update agon_arena_evaluations set state = $2, updated_at = now()
       where intent_id = $1 returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
      [input.intentId, input.state],
    );
    if (!updated.rows[0]) throw new AgonStoreInvariantError("Arena evaluation not found");
    return mapAgonArenaEvaluation(updated.rows[0]);
  }

  async recordAgonArenaMarketplaceVerification(input: {
    intentId: string;
    state: AgonMarketplaceVerificationState;
    transactionHash?: `0x${string}` | null;
    error?: string | null;
  }): Promise<StoredAgonArenaEvaluation> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    const current = await this.getAgonArenaEvaluation(input.intentId);
    if (!current) throw new AgonStoreInvariantError("Arena evaluation not found");
    if (current.state !== "verified") throw new AgonStoreInvariantError("marketplace verification requires a verified Arena evaluation");
    if (current.marketplaceVerificationState === "confirmed" && input.state !== "confirmed") return current;
    const transactionHash = input.transactionHash === undefined
      ? current.marketplaceVerificationTransactionHash
      : input.transactionHash === null ? null : normalizeHash(input.transactionHash);
    const error = input.error === undefined ? current.marketplaceVerificationError : input.error?.slice(0, 500) ?? null;
    const updated = await this.pool.query<AgonArenaEvaluationRow>(
      `update agon_arena_evaluations
          set marketplace_verification_state = $2,
              marketplace_verification_transaction_hash = $3,
              marketplace_verification_error = $4,
              marketplace_verified_at = case when $2 = 'confirmed' then coalesce(marketplace_verified_at, now()) else marketplace_verified_at end,
              updated_at = now()
        where intent_id = $1
          and state = 'verified'
          and (marketplace_verification_state <> 'confirmed' or $2 = 'confirmed')
        returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
      [input.intentId, input.state, transactionHash, error],
    );
    if (!updated.rows[0]) {
      const latest = await this.getAgonArenaEvaluation(input.intentId);
      if (latest?.marketplaceVerificationState === "confirmed") return latest;
      throw new AgonStoreInvariantError("Arena evaluation is not eligible for marketplace verification");
    }
    return mapAgonArenaEvaluation(updated.rows[0]);
  }

  async claimAgonArenaMarketplaceVerification(input: {
    intentId: string;
    retryBefore: Date;
  }): Promise<StoredAgonArenaEvaluation | null> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("Arena evaluation intent id must be a UUID");
    if (!Number.isFinite(input.retryBefore.getTime())) throw new AgonStoreInvariantError("marketplace verification retry time is invalid");
    const claimed = await this.pool.query<AgonArenaEvaluationRow>(
      `update agon_arena_evaluations
          set marketplace_verification_state = 'pending',
              marketplace_verification_error = null,
              updated_at = now()
        where intent_id = $1
          and state = 'verified'
          and marketplace_verification_state <> 'confirmed'
          and (
            marketplace_verification_state in ('not_started', 'failed')
            or (
              marketplace_verification_state in ('pending', 'submitted', 'unknown')
              and updated_at <= $2
            )
          )
        returning ${AGON_ARENA_EVALUATION_COLUMNS}`,
      [input.intentId, input.retryBefore],
    );
    return claimed.rows[0] ? mapAgonArenaEvaluation(claimed.rows[0]) : null;
  }

  async getAgonSyndicateContribution(intentId: string): Promise<StoredAgonSyndicateContribution | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonSyndicateContributionRow>(
      `select ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS} from agon_syndicate_contributions where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapAgonSyndicateContribution(result.rows[0]) : null;
  }

  async prepareAgonSyndicateContribution(input: AgonSyndicateContributionProjection): Promise<StoredAgonSyndicateContribution> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("syndicate contribution intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("syndicate contribution idempotency key is invalid");
    if (input.state !== "prepared" || input.transactionHash !== null) throw new AgonStoreInvariantError("syndicate contribution must start prepared without transaction evidence");
    const registryContract = normalizeAddress(input.registryContract);
    const syndicateId = requirePositive(BigInt(input.syndicateId), "syndicate id");
    const agentId = requirePositive(BigInt(input.agentId), "agent id");
    const contributionKey = normalizeHash(input.contributionKey);
    const score = requirePositive(BigInt(input.score), "score");
    const evidenceHash = normalizeHash(input.evidenceHash);
    const inserted = await this.pool.query<AgonSyndicateContributionRow>(
      `insert into agon_syndicate_contributions (
         intent_id, actor_address, idempotency_key, registry_contract_address,
         syndicate_id, agent_id, contribution_key, score, evidence_hash, state,
         transaction_hash, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'prepared', null, $10, $10)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS}`,
      [input.intentId, actor, input.idempotencyKey, registryContract, syndicateId, agentId, contributionKey, score, evidenceHash, input.createdAt ?? new Date()],
    );
    if (inserted.rows[0]) return mapAgonSyndicateContribution(inserted.rows[0]);
    const existing = await this.pool.query<AgonSyndicateContributionRow>(
      `select ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS} from agon_syndicate_contributions where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("syndicate contribution idempotency conflict could not be loaded");
    const value = mapAgonSyndicateContribution(row);
    if (value.registryContract !== registryContract || value.syndicateId !== syndicateId || value.agentId !== agentId || value.contributionKey !== contributionKey || value.score !== score || value.evidenceHash !== evidenceHash) {
      throw new AgonStoreInvariantError("syndicate contribution idempotency key already used for different evidence");
    }
    return value;
  }

  async markAgonSyndicateContributionSubmitted(input: { intentId: string; transactionHash: `0x${string}` }): Promise<StoredAgonSyndicateContribution> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("syndicate contribution intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonSyndicateContributionRow>(`select ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS} from agon_syndicate_contributions where intent_id = $1 for update`, [input.intentId]);
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("syndicate contribution not found");
      if ((row.state === "submitted" || row.state === "confirmed") && row.transaction_hash === transactionHash) { await client.query("commit"); return mapAgonSyndicateContribution(row); }
      if (row.state !== "prepared") throw new AgonStoreInvariantError(`cannot mark syndicate contribution ${row.state} as submitted`);
      const updated = await client.query<AgonSyndicateContributionRow>(`update agon_syndicate_contributions set state = 'submitted', transaction_hash = $2, updated_at = now() where intent_id = $1 returning ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS}`, [input.intentId, transactionHash]);
      await client.query("commit");
      return mapAgonSyndicateContribution(updated.rows[0]!);
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async confirmAgonSyndicateContribution(intentId: string): Promise<StoredAgonSyndicateContribution> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new AgonStoreInvariantError("syndicate contribution intent id must be a UUID");
    const updated = await this.pool.query<AgonSyndicateContributionRow>(
      `update agon_syndicate_contributions set state = 'confirmed', updated_at = now()
       where intent_id = $1 and state in ('submitted','confirmed') and transaction_hash is not null
       returning ${AGON_SYNDICATE_CONTRIBUTION_COLUMNS}`,
      [intentId],
    );
    if (!updated.rows[0]) throw new AgonStoreInvariantError("syndicate contribution is not submitted for confirmation");
    return mapAgonSyndicateContribution(updated.rows[0]);
  }

  async getAgonPrizeClaim(intentId: string): Promise<StoredAgonPrizeClaim | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = await this.pool.query<AgonPrizeClaimRow>(`select ${AGON_PRIZE_CLAIM_COLUMNS} from agon_prize_claim_intents where intent_id = $1`, [intentId]);
    return result.rows[0] ? mapAgonPrizeClaim(result.rows[0]) : null;
  }

  async prepareAgonPrizeClaim(input: AgonPrizeClaimProjection): Promise<StoredAgonPrizeClaim> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("prize claim intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("prize claim idempotency key is invalid");
    if (input.state !== "prepared" || input.transactionHash !== null) throw new AgonStoreInvariantError("prize claim must start prepared without transaction evidence");
    const vaultContract = normalizeAddress(input.vaultContract);
    const poolKey = normalizeHash(input.poolKey);
    const claimIndex = requireNonNegative(BigInt(input.index), "claim index");
    const beneficiary = normalizeAddress(input.beneficiary);
    const amount = requirePositive(BigInt(input.amount), "claim amount");
    const proof = input.proof.map((value) => normalizeHash(value));
    const leaf = normalizeHash(input.leaf);
    const inserted = await this.pool.query<AgonPrizeClaimRow>(
      `insert into agon_prize_claim_intents (
         intent_id, actor_address, idempotency_key, vault_contract_address, pool_key,
         claim_index, beneficiary_address, amount_base_units, proof, leaf_hash, state,
         transaction_hash, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'prepared', null, $11, $11)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_PRIZE_CLAIM_COLUMNS}`,
      [input.intentId, actor, input.idempotencyKey, vaultContract, poolKey, claimIndex, beneficiary, amount, JSON.stringify(proof), leaf, input.createdAt ?? new Date()],
    );
    if (inserted.rows[0]) return mapAgonPrizeClaim(inserted.rows[0]);
    const existing = await this.pool.query<AgonPrizeClaimRow>(`select ${AGON_PRIZE_CLAIM_COLUMNS} from agon_prize_claim_intents where actor_address = $1 and idempotency_key = $2`, [actor, input.idempotencyKey]);
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("prize claim idempotency conflict could not be loaded");
    const value = mapAgonPrizeClaim(row);
    if (value.vaultContract !== vaultContract || value.poolKey !== poolKey || value.index !== claimIndex || value.beneficiary !== beneficiary || value.amount !== amount || value.leaf !== leaf || JSON.stringify(value.proof) !== JSON.stringify(proof)) {
      throw new AgonStoreInvariantError("prize claim idempotency key already used for different claim");
    }
    return value;
  }

  async markAgonPrizeClaimSubmitted(input: { intentId: string; transactionHash: `0x${string}` }): Promise<StoredAgonPrizeClaim> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("prize claim intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonPrizeClaimRow>(`select ${AGON_PRIZE_CLAIM_COLUMNS} from agon_prize_claim_intents where intent_id = $1 for update`, [input.intentId]);
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("prize claim not found");
      if ((row.state === "submitted" || row.state === "confirmed") && row.transaction_hash === transactionHash) { await client.query("commit"); return mapAgonPrizeClaim(row); }
      if (row.state !== "prepared") throw new AgonStoreInvariantError(`cannot mark prize claim ${row.state} as submitted`);
      const updated = await client.query<AgonPrizeClaimRow>(`update agon_prize_claim_intents set state = 'submitted', transaction_hash = $2, updated_at = now() where intent_id = $1 returning ${AGON_PRIZE_CLAIM_COLUMNS}`, [input.intentId, transactionHash]);
      await client.query("commit");
      return mapAgonPrizeClaim(updated.rows[0]!);
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async confirmAgonPrizeClaim(intentId: string): Promise<StoredAgonPrizeClaim> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new AgonStoreInvariantError("prize claim intent id must be a UUID");
    const updated = await this.pool.query<AgonPrizeClaimRow>(
      `update agon_prize_claim_intents set state = 'confirmed', updated_at = now()
       where intent_id = $1 and state in ('submitted','confirmed') and transaction_hash is not null
       returning ${AGON_PRIZE_CLAIM_COLUMNS}`,
      [intentId],
    );
    if (!updated.rows[0]) throw new AgonStoreInvariantError("prize claim is not submitted for confirmation");
    return mapAgonPrizeClaim(updated.rows[0]);
  }

  async prepareAgonJobEscrowIntent(input: AgonJobEscrowIntentProjection): Promise<StoredAgonJobEscrowIntent> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("job escrow idempotency key is invalid");
    if (input.state !== "prepared" || input.settlement !== "none" || input.onchainJobId !== null) {
      throw new AgonStoreInvariantError("job escrow intent must start prepared with no settlement");
    }
    const inserted = await this.pool.query<AgonJobEscrowIntentRow>(
      `insert into agon_job_escrow_intents (
         intent_id, actor_address, idempotency_key, listing_reference, network, asset,
         escrow_contract_address, buyer_address, provider_address, service_registry_address,
         listing_id, agent_id, listing_version, manifest_hash, terms_hash, amount_base_units,
         fee_bps, review_hours, expires_at, client_reference, state, settlement, onchain_job_id,
         transaction_hash, deliverable_hash, reason_hash, last_reconciled_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $28)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        input.idempotencyKey,
        input.listingReference,
        input.network,
        input.asset.toLowerCase(),
        normalizeAddress(input.escrowContract),
        normalizeAddress(input.buyer),
        normalizeAddress(input.provider),
        normalizeAddress(input.serviceRegistry),
        requirePositive(BigInt(input.listingId), "listing id"),
        requirePositive(BigInt(input.agentId), "agent id"),
        requirePositive(BigInt(input.listingVersion), "listing version"),
        normalizeHash(input.manifestHash),
        normalizeHash(input.termsHash),
        requirePositive(input.amountBaseUnits, "job escrow amount"),
        input.feeBps,
        input.reviewHours,
        input.expiresAt,
        normalizeHash(input.clientReference),
        input.state,
        input.settlement,
        input.onchainJobId,
        input.transactionHash,
        input.deliverableHash,
        input.reasonHash,
        input.lastReconciledAt,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapAgonJobEscrowIntent(inserted.rows[0]);

    const existing = await this.pool.query<AgonJobEscrowIntentRow>(
      `select ${AGON_JOB_ESCROW_INTENT_COLUMNS}
       from agon_job_escrow_intents where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("job escrow idempotency conflict could not be loaded");
    const value = mapAgonJobEscrowIntent(row);
    const same = value.termsHash === input.termsHash.toLowerCase()
      && value.clientReference === input.clientReference.toLowerCase()
      && value.listingReference === input.listingReference
      && value.escrowContract === input.escrowContract.toLowerCase()
      && value.buyer === input.buyer.toLowerCase()
      && value.provider === input.provider.toLowerCase()
      && value.listingId === input.listingId
      && value.agentId === input.agentId
      && value.listingVersion === input.listingVersion
      && value.manifestHash === input.manifestHash.toLowerCase()
      && value.amountBaseUnits === input.amountBaseUnits
      && value.feeBps === input.feeBps
      && value.reviewHours === input.reviewHours
      && value.expiresAt.getTime() === input.expiresAt.getTime();
    if (!same) throw new AgonStoreInvariantError("job escrow idempotency key already used for different terms");
    return value;
  }

  async reconcileAgonJobEscrowIntent(input: {
    intentId: string;
    job: AgonJobEscrowJob;
    transactionHash?: `0x${string}` | null;
  }): Promise<StoredAgonJobEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonJobEscrowIntentRow>(
        `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("job escrow intent not found");
      const intent = mapAgonJobEscrowIntent(row);
      const match = validateAgonJobEscrowJobMatch(intent, input.job);
      if (!match.ok) throw new AgonStoreInvariantError(match.message);
      if (intent.onchainJobId !== null && intent.onchainJobId !== input.job.jobId) {
        throw new AgonStoreInvariantError("job escrow intent is already bound to a different on-chain job");
      }
      const nextState = stateForAgonJobStatus(input.job.status);
      if (!isAgonJobEscrowTransitionAllowed(intent.state, nextState)) {
        throw new AgonStoreInvariantError(`cannot reconcile job escrow intent from ${intent.state} to ${nextState}`);
      }
      const settlement = settlementForAgonJobStatus(input.job.settlement);
      const deliverableHash = /^0x0{64}$/i.test(input.job.deliverableHash) ? null : input.job.deliverableHash;
      const updated = await client.query<AgonJobEscrowIntentRow>(
        `update agon_job_escrow_intents set
           state = $2,
           settlement = $3,
           onchain_job_id = $4,
           transaction_hash = coalesce($5, transaction_hash),
           deliverable_hash = coalesce($6, deliverable_hash),
           last_reconciled_at = now(),
           updated_at = now()
         where intent_id = $1
         returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, nextState, settlement, input.job.jobId, input.transactionHash ?? null, deliverableHash],
      );
      await client.query("commit");
      return mapAgonJobEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markAgonJobEscrowSubmitted(input: {
    intentId: string;
    transactionHash: `0x${string}`;
  }): Promise<StoredAgonJobEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonJobEscrowIntentRow>(
        `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("job escrow intent not found");
      if (row.state === "submitted" && row.transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonJobEscrowIntent(row);
      }
      if (row.state !== "prepared") throw new AgonStoreInvariantError(`cannot mark job escrow intent ${row.state} as submitted`);
      const updated = await client.query<AgonJobEscrowIntentRow>(
        `update agon_job_escrow_intents set state = 'submitted', transaction_hash = $2, updated_at = now()
         where intent_id = $1 returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, transactionHash],
      );
      await client.query("commit");
      return mapAgonJobEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordAgonJobEscrowAction(input: {
    intentId: string;
    action: AgonJobEscrowAction;
    transactionHash: `0x${string}`;
    jobId?: string | null;
    deliverableHash?: string | null;
    reasonHash?: string | null;
  }): Promise<StoredAgonJobEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("job escrow intent id must be a UUID");
    const transactionHash = normalizeHash(input.transactionHash) as `0x${string}`;
    const nextState: AgonJobEscrowIntentState = input.action === "create" ? "submitted"
      : input.action === "accept" ? "accepted"
        : input.action === "submit" ? "job_submitted"
          : input.action === "accept_submission" || input.action === "auto_accept" || input.action === "resolve_pay" ? "complete"
            : input.action === "reject" ? "rejected"
              : input.action === "dispute" ? "disputed"
                : "failed";
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonJobEscrowIntentRow>(
        `select ${AGON_JOB_ESCROW_INTENT_COLUMNS} from agon_job_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("job escrow intent not found");
      if (row.state === nextState && row.transaction_hash === transactionHash) {
        await client.query("commit");
        return mapAgonJobEscrowIntent(row);
      }
      if (!isAgonJobEscrowTransitionAllowed(row.state, nextState)) {
        throw new AgonStoreInvariantError(`cannot transition job escrow intent from ${row.state} to ${nextState}`);
      }
      const updated = await client.query<AgonJobEscrowIntentRow>(
        `update agon_job_escrow_intents set
           state = $2,
           transaction_hash = $3,
           onchain_job_id = coalesce($4, onchain_job_id),
           deliverable_hash = coalesce($5, deliverable_hash),
           reason_hash = coalesce($6, reason_hash),
           updated_at = now()
         where intent_id = $1 returning ${AGON_JOB_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, nextState, transactionHash, input.jobId ?? null, input.deliverableHash ? normalizeHash(input.deliverableHash) : null, input.reasonHash ? normalizeHash(input.reasonHash) : null],
      );
      await client.query("commit");
      return mapAgonJobEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAgonEscrowTransactionApproval(intentId: string, approvalIdempotencyKey?: string): Promise<StoredAgonEscrowTransactionApproval | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) return null;
    const result = approvalIdempotencyKey
      ? await this.pool.query<AgonEscrowTransactionApprovalRow>(
        `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
         from agon_escrow_transaction_approvals
         where intent_id = $1 and approval_idempotency_key = $2`,
        [intentId, approvalIdempotencyKey],
      )
      : await this.pool.query<AgonEscrowTransactionApprovalRow>(
        `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
         from agon_escrow_transaction_approvals
         where intent_id = $1 order by approved_at desc limit 1`,
        [intentId],
      );
    return result.rows[0] ? mapAgonEscrowTransactionApproval(result.rows[0]) : null;
  }

  async prepareAgonEscrowTransactionApproval(input: AgonEscrowTransactionApprovalProjection): Promise<StoredAgonEscrowTransactionApproval> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    if (!/^(fund|release|refund)$/.test(input.operation)) throw new AgonStoreInvariantError("escrow approval operation is invalid");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.approvalIdempotencyKey)) throw new AgonStoreInvariantError("escrow approval idempotency key is invalid");
    const approvalHash = normalizeHash(input.approvalHash);
    const intentHash = normalizeHash(input.intentHash);
    if (!(input.expiresAt > input.approvedAt)) throw new AgonStoreInvariantError("escrow approval expiry must be after approval time");
    const inserted = await this.pool.query<AgonEscrowTransactionApprovalRow>(
      `insert into agon_escrow_transaction_approvals (
         approval_hash, intent_id, actor_address, operation, intent_hash,
         approval_idempotency_key, approved_at, expires_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $7)
       on conflict (intent_id, approval_idempotency_key) do nothing
       returning ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}`,
      [approvalHash, input.intentId, actor, input.operation, intentHash, input.approvalIdempotencyKey, input.approvedAt, input.expiresAt],
    );
    if (inserted.rows[0]) return mapAgonEscrowTransactionApproval(inserted.rows[0]);
    const existing = await this.pool.query<AgonEscrowTransactionApprovalRow>(
      `select ${AGON_ESCROW_TRANSACTION_APPROVAL_COLUMNS}
       from agon_escrow_transaction_approvals
       where intent_id = $1 and approval_idempotency_key = $2`,
      [input.intentId, input.approvalIdempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("escrow approval idempotency conflict could not be loaded");
    const value = mapAgonEscrowTransactionApproval(row);
    if (value.approvalHash !== approvalHash || value.actor !== actor || value.operation !== input.operation || value.intentHash !== intentHash) {
      throw new AgonStoreInvariantError("escrow approval idempotency key already used for different transaction intent");
    }
    return value;
  }

  async prepareAgonEscrowIntent(input: AgonEscrowIntentProjection): Promise<StoredAgonEscrowIntent> {
    const actor = normalizeAddress(input.actor);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.idempotencyKey)) throw new AgonStoreInvariantError("escrow idempotency key is invalid");
    const terms = input.terms;
    if (hashAgonEscrowTerms(terms).toLowerCase() !== input.termsHash.toLowerCase()) throw new AgonStoreInvariantError("escrow terms hash does not match the stored terms");
    const inserted = await this.pool.query<AgonEscrowIntentRow>(
      `insert into agon_escrow_intents (
         intent_id, actor_address, idempotency_key, listing_reference, terms_hash, network, asset,
         buyer_address, beneficiary_address, service_registry_address, listing_id,
         agent_id, listing_version, manifest_hash, amount_base_units, fee_bps,
         expires_at, state, provider_reference, transaction_hash, pool_contract_address,
         pool_controller_address, pool_id, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${AGON_ESCROW_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        input.idempotencyKey,
        input.listingReference,
        normalizeHash(input.termsHash),
        terms.network,
        terms.asset.toLowerCase(),
        normalizeAddress(terms.buyer),
        normalizeAddress(terms.beneficiary),
        normalizeAddress(terms.listing.serviceRegistry),
        requirePositive(BigInt(terms.listing.listingId), "listing id"),
        requirePositive(BigInt(terms.listing.agentId), "agent id"),
        requirePositive(BigInt(terms.listing.version), "listing version"),
        normalizeHash(terms.listing.manifestHash),
        requirePositive(terms.amountBaseUnits, "escrow amount"),
        terms.feeBps,
        terms.expiresAt,
        input.state,
        input.providerReference,
        input.transaction,
        input.poolBinding?.contractAddress ?? null,
        input.poolBinding?.controller ?? null,
        input.poolBinding?.poolId ?? null,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapAgonEscrowIntent(inserted.rows[0]);

    const existing = await this.pool.query<AgonEscrowIntentRow>(
      `select ${AGON_ESCROW_INTENT_COLUMNS}
       from agon_escrow_intents where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("escrow idempotency conflict could not be loaded");
    const value = mapAgonEscrowIntent(row);
    if (value.termsHash !== input.termsHash.toLowerCase()) {
      throw new AgonStoreInvariantError("escrow idempotency key already used for different terms");
    }
    const existingBinding = value.poolBinding;
    const requestedBinding = input.poolBinding ?? null;
    if (JSON.stringify(existingBinding) !== JSON.stringify(requestedBinding)) {
      throw new AgonStoreInvariantError("escrow idempotency key already used for different pool binding");
    }
    return value;
  }

  async advanceAgonEscrowIntent(input: {
    intentId: string;
    state: Exclude<AgonEscrowIntentState, "prepared">;
    providerReference?: string | null;
    transaction?: `0x${string}` | null;
  }): Promise<StoredAgonEscrowIntent> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("escrow intent id must be a UUID");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<AgonEscrowIntentRow>(
        `select ${AGON_ESCROW_INTENT_COLUMNS} from agon_escrow_intents where intent_id = $1 for update`,
        [input.intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("escrow intent not found");
      if (!isAgonEscrowTransitionAllowed(row.state, input.state)) {
        throw new AgonStoreInvariantError(`cannot transition escrow intent from ${row.state} to ${input.state}`);
      }
      const updated = await client.query<AgonEscrowIntentRow>(
        `update agon_escrow_intents set
           state = $2,
           provider_reference = case when $3::text is null then provider_reference else $3 end,
           transaction_hash = case when $4::text is null then transaction_hash else $4 end,
           updated_at = now()
         where intent_id = $1 returning ${AGON_ESCROW_INTENT_COLUMNS}`,
        [input.intentId, input.state, input.providerReference ?? null, input.transaction ?? null],
      );
      await client.query("commit");
      return mapAgonEscrowIntent(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getX402CallIntent(intentId: string): Promise<StoredX402CallIntent | null> {
    const result = await this.pool.query<X402CallIntentRow>(
      `select ${X402_INTENT_COLUMNS} from agon_x402_call_intents where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapX402CallIntent(result.rows[0]) : null;
  }

  async getX402CallReceipt(intentId: string): Promise<StoredX402CallReceipt | null> {
    const result = await this.pool.query<X402CallReceiptRow>(
      `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1`,
      [intentId],
    );
    return result.rows[0] ? mapX402CallReceipt(result.rows[0]) : null;
  }

  async recordX402DeliveryEvidence(input: X402DeliveryEvidenceProjection, paymentResponseHash?: string): Promise<StoredX402DeliveryEvidence> {
    const evidence = validateX402DeliveryEvidence(input);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const receiptResult = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`,
        [evidence.intentId],
      );
      const receipt = receiptResult.rows[0];
      if (!receipt) throw new AgonStoreInvariantError("x402 receipt not found");
      if (receipt.receipt_id !== evidence.receiptId) throw new AgonStoreInvariantError("delivery evidence does not match the x402 receipt");

      const existing = await client.query<X402DeliveryEvidenceRow>(
        `select ${X402_DELIVERY_EVIDENCE_COLUMNS}
         from agon_x402_delivery_evidence
         where intent_id = $1 and evidence_hash = $2`,
        [evidence.intentId, evidence.evidenceHash],
      );
      if (existing.rows[0]) {
        await client.query("commit");
        return mapX402DeliveryEvidence(existing.rows[0]);
      }

      const transition = transitionX402Receipt(receipt.state, {
        type: "service_delivered",
        serviceStatus: evidence.serviceStatus,
        paymentResponseHash,
        chargedAmountUSDC: evidence.chargedAmountUSDC,
      });
      const inserted = await client.query<X402DeliveryEvidenceRow>(
        `insert into agon_x402_delivery_evidence (
           delivery_id, intent_id, receipt_id, provider_address, listing_reference,
           service_status, latency_ms, response_hash, result_attestation_hash,
           charged_amount_usdc, evidence_hash, delivered_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         returning ${X402_DELIVERY_EVIDENCE_COLUMNS}`,
        [
          evidence.deliveryId,
          evidence.intentId,
          evidence.receiptId,
          evidence.provider.toLowerCase(),
          evidence.listingReference,
          evidence.serviceStatus,
          evidence.latencyMs,
          evidence.responseHash,
          evidence.resultAttestationHash,
          evidence.chargedAmountUSDC,
          evidence.evidenceHash,
          evidence.deliveredAt,
          evidence.createdAt,
        ],
      );
      await client.query(
        `update agon_x402_call_receipts set
           state = $2, service_status = $3, payment_response_hash = $4,
           charged_amount_usdc = coalesce($5, charged_amount_usdc), updated_at = now()
         where intent_id = $1`,
        [evidence.intentId, transition.to, evidence.serviceStatus, transition.patch.paymentResponseHash ?? null, transition.patch.chargedAmountUSDC ?? null],
      );
      await client.query("commit");
      return mapX402DeliveryEvidence(inserted.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestX402DeliveryEvidence(intentId: string): Promise<StoredX402DeliveryEvidence | null> {
    const result = await this.pool.query<X402DeliveryEvidenceRow>(
      `select ${X402_DELIVERY_EVIDENCE_COLUMNS}
       from agon_x402_delivery_evidence
       where intent_id = $1
       order by delivered_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402DeliveryEvidence(result.rows[0]) : null;
  }

  async prepareX402CallIntent(input: X402CallIntentProjection): Promise<StoredX402CallIntent> {
    const actor = normalizeAddress(input.actor);
    const inserted = await this.pool.query<X402CallIntentRow>(
      `insert into agon_x402_call_intents (
         intent_id, actor_address, idempotency_key, listing_reference, chain_id,
         service_registry_address, listing_id, agent_id, listing_version, method,
         input, input_hash, max_amount_usdc, target_url, state, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $16)
       on conflict (actor_address, idempotency_key) do nothing
       returning ${X402_INTENT_COLUMNS}`,
      [
        input.intentId,
        actor,
        requireText(input.idempotencyKey, "idempotency key"),
        requireText(input.listingReference, "listing reference"),
        requirePositive(input.chainId, "chain id"),
        normalizeAddress(input.serviceRegistry),
        requirePositive(input.listingId, "listing id"),
        requireNonNegative(input.agentId, "agent id"),
        requirePositive(input.version, "listing version"),
        input.method,
        JSON.stringify(jsonSafe(input.input)),
        normalizeHash(input.inputHash),
        input.maxAmountUSDC,
        input.targetUrl ?? null,
        input.state,
        input.createdAt ?? new Date(),
      ],
    );
    if (inserted.rows[0]) return mapX402CallIntent(inserted.rows[0]);

    const existing = await this.pool.query<X402CallIntentRow>(
      `select ${X402_INTENT_COLUMNS}
       from agon_x402_call_intents
       where actor_address = $1 and idempotency_key = $2`,
      [actor, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("x402 call intent conflict could not be loaded");
    const value = mapX402CallIntent(row);
    if (
      value.listingReference !== input.listingReference ||
      value.method !== input.method ||
      value.inputHash !== input.inputHash ||
      value.maxAmountUSDC !== input.maxAmountUSDC
      || value.targetUrl !== (input.targetUrl ?? null)
    ) {
      throw new AgonStoreInvariantError("idempotency key already used for a different x402 call");
    }
    return value;
  }

  async createX402CallReceipt(input: X402CallReceiptProjection): Promise<StoredX402CallReceipt> {
    if (!/^[0-9a-f-]{36}$/i.test(input.receiptId) || !/^[0-9a-f-]{36}$/i.test(input.intentId)) {
      throw new AgonStoreInvariantError("receipt and intent ids must be UUIDs");
    }
    if (input.state !== "prepared") throw new AgonStoreInvariantError("new x402 receipts must start prepared");
    const inserted = await this.pool.query<X402CallReceiptRow>(
      `insert into agon_x402_call_receipts (
         receipt_id, intent_id, state, approved_amount_usdc, quote_hash, quote_snapshot, authorization_payload_hash, authorization_payload, authorization_hash, settlement_ref, provider_transfer_id,
         service_status, payment_response_hash, charged_amount_usdc, failure_code,
         failure_message, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
       on conflict (intent_id) do nothing
       returning ${X402_RECEIPT_COLUMNS}`,
      [input.receiptId, input.intentId, input.state, input.approvedAmountUSDC, input.quoteHash, input.quoteSnapshot, input.authorizationPayloadHash, input.authorizationPayload, input.authorizationHash, input.settlementRef, input.providerTransferId, input.serviceStatus, input.paymentResponseHash, input.chargedAmountUSDC, input.failureCode, input.failureMessage, input.createdAt ?? new Date()],
    );
    if (inserted.rows[0]) return mapX402CallReceipt(inserted.rows[0]);
    const existing = await this.pool.query<X402CallReceiptRow>(
      `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1`, [input.intentId],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("x402 receipt conflict could not be loaded");
    // The intent is the idempotency boundary. A retry may generate a fresh
    // candidate receipt UUID, but it must receive the original durable receipt.
    return mapX402CallReceipt(row);
  }

  async advanceX402CallReceipt(intentId: string, event: X402ReceiptEvent): Promise<StoredX402CallReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`, [intentId],
      );
      const row = current.rows[0];
      if (!row) throw new AgonStoreInvariantError("x402 receipt not found");
      const transition = transitionX402Receipt(row.state, event);
      const updated = await client.query<X402CallReceiptRow>(
        `update agon_x402_call_receipts set
           state = $2, approved_amount_usdc = coalesce($3, approved_amount_usdc),
           quote_hash = coalesce($4, quote_hash),
           quote_snapshot = coalesce($5, quote_snapshot),
           authorization_payload_hash = coalesce($6, authorization_payload_hash),
           authorization_payload = coalesce($7, authorization_payload),
           authorization_hash = coalesce($8, authorization_hash),
           settlement_ref = coalesce($9, settlement_ref),
           provider_transfer_id = coalesce($10, provider_transfer_id),
           service_status = coalesce($11, service_status),
           payment_response_hash = coalesce($12, payment_response_hash),
           failure_code = coalesce($13, failure_code),
           failure_message = coalesce($14, failure_message), updated_at = now()
         where intent_id = $1 returning ${X402_RECEIPT_COLUMNS}`,
        [intentId, transition.to, transition.patch.approvedAmountUSDC ?? null, transition.patch.quoteHash ?? null, transition.patch.quoteSnapshot ?? null, transition.patch.authorizationPayloadHash ?? null, transition.patch.authorizationPayload ?? null, transition.patch.authorizationHash ?? null, transition.patch.settlementRef ?? null, transition.patch.providerTransferId ?? null, transition.patch.serviceStatus ?? null, transition.patch.paymentResponseHash ?? null, transition.patch.failureCode ?? null, transition.patch.failureMessage ?? null],
      );
      await client.query("commit");
      return mapX402CallReceipt(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async approveX402CallReceipt(intentId: string, approvedAmountUSDC: string): Promise<StoredX402CallReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<X402CallReceiptRow>(
        `select ${X402_RECEIPT_COLUMNS} from agon_x402_call_receipts where intent_id = $1 for update`, [intentId],
      );
      let row = existing.rows[0];
      if (!row) {
        const inserted = await client.query<X402CallReceiptRow>(
          `insert into agon_x402_call_receipts (receipt_id, intent_id, state, created_at, updated_at)
           values ($1, $2, 'prepared', now(), now()) returning ${X402_RECEIPT_COLUMNS}`,
          [randomUUID(), intentId],
        );
        row = inserted.rows[0];
      }
      if (!row) throw new AgonStoreInvariantError("x402 receipt could not be created");
      const approval = transitionX402Receipt("prepared", { type: "approve", approvedAmountUSDC });
      if (row.state === "approved") {
        if (row.approved_amount_usdc !== approval.patch.approvedAmountUSDC) {
          throw new AgonStoreInvariantError("x402 approval already recorded with a different spend limit");
        }
        await client.query("commit");
        return mapX402CallReceipt(row);
      }
      const transition = transitionX402Receipt(row.state, { type: "approve", approvedAmountUSDC });
      const updated = await client.query<X402CallReceiptRow>(
        `update agon_x402_call_receipts
         set state = 'approved', approved_amount_usdc = $2, updated_at = now()
         where intent_id = $1 returning ${X402_RECEIPT_COLUMNS}`,
        [intentId, transition.patch.approvedAmountUSDC],
      );
      await client.query("commit");
      return mapX402CallReceipt(updated.rows[0]!);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordX402ExecutionApproval(input: X402ExecutionApprovalProjection): Promise<StoredX402ExecutionApproval> {
    const actor = normalizeAddress(input.actor);
    const planHash = normalizeHash(input.planHash);
    const authorizationHash = normalizeHash(input.authorizationHash);
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId)) throw new AgonStoreInvariantError("intent id must be a UUID");
    const approvalHash = normalizeHash(input.approvalHash);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.approvalIdempotencyKey)) throw new AgonStoreInvariantError("approval idempotency key is invalid");
    if (!(input.expiresAt > input.approvedAt)) throw new AgonStoreInvariantError("execution approval expiry must be after approval time");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const receipt = await client.query<{ state: X402ReceiptState }>(
        "select state from agon_x402_call_receipts where intent_id = $1 for update",
        [input.intentId],
      );
      if (receipt.rows[0]?.state !== "authorization_submitted") {
        throw new AgonStoreInvariantError("execution approval requires a submitted authorization");
      }
      const inserted = await client.query<X402ExecutionApprovalRow>(
        `insert into agon_x402_execution_approvals (
           approval_hash, intent_id, actor_address, plan_hash, authorization_hash,
           approval_idempotency_key, approved_at, expires_at, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (intent_id, approval_idempotency_key) do nothing
         returning ${X402_EXECUTION_APPROVAL_COLUMNS}`,
        [approvalHash, input.intentId, actor, planHash, authorizationHash, input.approvalIdempotencyKey, input.approvedAt, input.expiresAt],
      );
      if (inserted.rows[0]) {
        await client.query("commit");
        return mapX402ExecutionApproval(inserted.rows[0]);
      }
      const existing = await client.query<X402ExecutionApprovalRow>(
        `select ${X402_EXECUTION_APPROVAL_COLUMNS}
         from agon_x402_execution_approvals
         where intent_id = $1 and approval_idempotency_key = $2`,
        [input.intentId, input.approvalIdempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new AgonStoreInvariantError("execution approval conflict could not be loaded");
      if (row.approval_hash !== approvalHash || row.plan_hash !== planHash || row.authorization_hash !== authorizationHash || row.actor_address !== actor) {
        throw new AgonStoreInvariantError("approval idempotency key already used for a different execution plan");
      }
      await client.query("commit");
      return mapX402ExecutionApproval(row);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLatestX402ExecutionApproval(intentId: string): Promise<StoredX402ExecutionApproval | null> {
    const result = await this.pool.query<X402ExecutionApprovalRow>(
      `select ${X402_EXECUTION_APPROVAL_COLUMNS}
       from agon_x402_execution_approvals
       where intent_id = $1
       order by approved_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402ExecutionApproval(result.rows[0]) : null;
  }

  async recordX402FacilitatorVerification(input: X402FacilitatorVerificationProjection): Promise<StoredX402FacilitatorVerification> {
    if (!/^[0-9a-f-]{36}$/i.test(input.intentId) || !/^[0-9a-f-]{36}$/i.test(input.receiptId)) {
      throw new AgonStoreInvariantError("facilitator verification ids must be UUIDs");
    }
    if (input.verificationId && !/^[0-9a-f-]{36}$/i.test(input.verificationId)) {
      throw new AgonStoreInvariantError("facilitator verification id must be a UUID");
    }
    const approvalHash = normalizeHash(input.approvalHash);
    const evidenceHash = normalizeHash(input.evidenceHash);
    const payer = input.payer === null ? null : normalizeAddress(input.payer);
    if (input.network !== "eip155:5042002") throw new AgonStoreInvariantError("facilitator verification network is not Arc Testnet");
    if (!(input.verifiedAt instanceof Date) || !Number.isFinite(input.verifiedAt.getTime())) {
      throw new AgonStoreInvariantError("facilitator verification timestamp is invalid");
    }
    const inserted = await this.pool.query<X402FacilitatorVerificationRow>(
      `insert into agon_x402_facilitator_verifications (
         verification_id, receipt_id, intent_id, approval_hash, network, payer_address,
         evidence_hash, verified_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (intent_id, approval_hash) do nothing
       returning ${X402_FACILITATOR_VERIFICATION_COLUMNS}`,
      [input.verificationId ?? randomUUID(), input.receiptId, input.intentId, approvalHash, input.network, payer, evidenceHash, input.verifiedAt],
    );
    if (inserted.rows[0]) return mapX402FacilitatorVerification(inserted.rows[0]);
    const existing = await this.pool.query<X402FacilitatorVerificationRow>(
      `select ${X402_FACILITATOR_VERIFICATION_COLUMNS}
       from agon_x402_facilitator_verifications
       where intent_id = $1 and approval_hash = $2`,
      [input.intentId, approvalHash],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("facilitator verification conflict could not be loaded");
    if (row.receipt_id !== input.receiptId || row.network !== input.network || row.payer_address !== payer || row.evidence_hash !== evidenceHash) {
      throw new AgonStoreInvariantError("facilitator verification conflict does not match the original evidence");
    }
    return mapX402FacilitatorVerification(row);
  }

  async getLatestX402FacilitatorVerification(intentId: string): Promise<StoredX402FacilitatorVerification | null> {
    if (!/^[0-9a-f-]{36}$/i.test(intentId)) throw new AgonStoreInvariantError("intent id must be a UUID");
    const result = await this.pool.query<X402FacilitatorVerificationRow>(
      `select ${X402_FACILITATOR_VERIFICATION_COLUMNS}
       from agon_x402_facilitator_verifications
       where intent_id = $1
       order by verified_at desc, created_at desc
       limit 1`,
      [intentId],
    );
    return result.rows[0] ? mapX402FacilitatorVerification(result.rows[0]) : null;
  }

  async getLatestVerificationEvidence(
    keys: Array<Pick<ListingKey, "listingId"> & Pick<ListingProjection, "agentId">>,
  ): Promise<Map<string, StoredVerificationEvidence>> {
    if (keys.length === 0) return new Map();
    const params: string[] = [];
    const values = keys.map((key, index) => {
      params.push(requirePositive(key.listingId, "listing id"), requireNonNegative(key.agentId, "agent id"));
      const offset = index * 2;
      return `($${offset + 1}::numeric, $${offset + 2}::numeric)`;
    });
    const result = await this.pool.query<VerificationEvidenceRow>(
      `select distinct on (e.listing_id, e.agent_id)
         e.listing_id::text, e.agent_id::text, e.passed, e.evidence_hash, e.evidence, e.created_at,
         count(*) over (partition by e.listing_id, e.agent_id)::text as attempts,
         (count(*) filter (where e.passed) over (partition by e.listing_id, e.agent_id))::text as passed_attempts
       from agon_verification_evidence e
       join (values ${values.join(", ")}) as requested(listing_id, agent_id)
         on requested.listing_id = e.listing_id and requested.agent_id = e.agent_id
       order by e.listing_id, e.agent_id, e.created_at desc, e.id desc`,
      params,
    );
    return new Map(result.rows.map((row) => [
      `${row.listing_id}:${row.agent_id}`,
      {
        listingId: BigInt(row.listing_id),
        agentId: BigInt(row.agent_id),
        passed: row.passed,
        evidenceHash: row.evidence_hash,
        evidence: row.evidence,
        createdAt: row.created_at,
        attempts: Number(row.attempts),
        passedAttempts: Number(row.passed_attempts),
      },
    ]));
  }

  async listListings(search: ListingSearch): Promise<StoredListing[]> {
    if (!Number.isSafeInteger(search.limit) || search.limit < 1 || search.limit > 100) {
      throw new AgonStoreInvariantError("listing limit must be between 1 and 100");
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    const parameter = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (search.cursor) {
      const updatedAt = parameter(search.cursor.updatedAt);
      const chainId = parameter(requirePositive(search.cursor.chainId, "cursor chain id"));
      const registry = parameter(normalizeAddress(search.cursor.serviceRegistry));
      const listingId = parameter(requirePositive(search.cursor.listingId, "cursor listing id"));
      clauses.push(
        `(updated_at, chain_id, service_registry_address, listing_id) < ` +
          `(${updatedAt}::timestamptz, ${chainId}::numeric, ${registry}::text, ${listingId}::numeric)`,
      );
    }
    if (search.category !== null) {
      clauses.push(`category = ${parameter(requirePositive(search.category, "category"))}`);
    }
    if (search.agentId !== null) {
      clauses.push(`agent_id = ${parameter(requirePositive(search.agentId, "agent id"))}`);
    }
    if (search.serviceRegistry !== null) {
      clauses.push(`service_registry_address = ${parameter(normalizeAddress(search.serviceRegistry))}`);
    }

    const limit = parameter(search.limit + 1);
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    const result = await this.pool.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       ${where}
       order by updated_at desc, chain_id desc, service_registry_address desc, listing_id desc
       limit ${limit}`,
      params,
    );
    return result.rows.map(mapListing);
  }

  async getIndexerCursor(key: IndexerCursorKey): Promise<IndexerCursor | null> {
    const result = await this.pool.query<CursorRow>(
      `select stream_name, chain_id, contract_address, last_block, last_block_hash, updated_at
       from agon_indexer_state
       where stream_name = $1 and chain_id = $2 and contract_address = $3`,
      [requireText(key.streamName, "stream name"), requirePositive(key.chainId, "chain id"), normalizeAddress(key.contractAddress)],
    );
    const row = result.rows[0];
    return row
      ? {
          streamName: row.stream_name,
          chainId: BigInt(row.chain_id),
          contractAddress: row.contract_address,
          lastBlock: BigInt(row.last_block),
          lastBlockHash: row.last_block_hash,
          updatedAt: row.updated_at,
        }
      : null;
  }
}

export class AgonTransactionRepository {
  private readonly client: PoolClient;

  constructor(client: PoolClient) {
    this.client = client;
  }

  async getProfile(key: ProfileKey): Promise<StoredProfile | null> {
    const result = await this.client.query<ProfileRow>(
      `select ${PROFILE_COLUMNS} from agon_profiles
       where chain_id = $1 and profile_registry_address = $2 and agent_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.profileRegistry), requirePositive(key.agentId, "agent id")],
    );
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  async upsertProfile(profile: ProfileProjection): Promise<void> {
    await this.client.query(
      `insert into agon_profiles (
         chain_id, profile_registry_address, identity_registry_address, agent_id,
         owner_snapshot, metadata_uri, status, suspension_reason, source_block_number,
         source_tx_hash, source_log_index, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       on conflict (chain_id, profile_registry_address, agent_id) do update set
         owner_snapshot = excluded.owner_snapshot,
         metadata_uri = excluded.metadata_uri,
         status = excluded.status,
         suspension_reason = excluded.suspension_reason,
         source_block_number = excluded.source_block_number,
         source_tx_hash = excluded.source_tx_hash,
         source_log_index = excluded.source_log_index,
         updated_at = excluded.updated_at`,
      [
        requirePositive(profile.chainId, "chain id"),
        normalizeAddress(profile.profileRegistry),
        normalizeAddress(profile.identityRegistry),
        requirePositive(profile.agentId, "agent id"),
        normalizeAddress(profile.ownerSnapshot),
        requireText(profile.metadataUri, "metadata URI"),
        profile.status,
        profile.suspensionReason ? normalizeHash(profile.suspensionReason) : null,
        requireNonNegative(profile.sourceBlockNumber, "source block number"),
        normalizeHash(profile.sourceTxHash),
        requireLogIndex(profile.sourceLogIndex),
        profile.observedAt,
      ],
    );
  }

  async getListing(key: ListingKey): Promise<StoredListing | null> {
    const result = await this.client.query<ListingRow>(
      `select ${LISTING_COLUMNS} from agon_listings
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return result.rows[0] ? mapListing(result.rows[0]) : null;
  }

  async scheduleAgonCertification(input: AgonCertificationScheduleInput): Promise<AgonCertificationJob> {
    const job = buildAgonCertificationJob(input);
    const inserted = await this.client.query<AgonCertificationRow>(
      `insert into agon_certification_jobs (
         job_id, chain_id, service_registry_address, listing_id, agent_id, listing_version,
         service_key, category, task_id, listing_reference, manifest_hash, manifest_uri, payment_rail,
         provider_snapshot, state, attempts, max_attempts, next_attempt_at, lease_expires_at,
         blocked_reason, last_error_code
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16, $17, null, $18, null)
       on conflict (chain_id, service_registry_address, listing_id, listing_version) do nothing
       returning ${AGON_CERTIFICATION_COLUMNS}`,
      [
        job.jobId,
        job.chainId.toString(),
        job.serviceRegistry,
        job.listingId,
        job.agentId,
        job.listingVersion,
        job.serviceKey,
        job.category,
        job.taskId,
        job.listingReference,
        job.manifestHash,
        job.manifestUri,
        job.paymentRail,
        job.providerSnapshot,
        job.state,
        job.maxAttempts,
        job.nextAttemptAt,
        job.blockedReason,
      ],
    );
    if (inserted.rows[0]) return mapAgonCertification(inserted.rows[0]);
    const existing = await this.client.query<AgonCertificationRow>(
      `select ${AGON_CERTIFICATION_COLUMNS}
         from agon_certification_jobs
        where chain_id = $1 and service_registry_address = $2 and listing_id = $3 and listing_version = $4`,
      [job.chainId.toString(), job.serviceRegistry, job.listingId, job.listingVersion],
    );
    const row = existing.rows[0];
    if (!row) throw new AgonStoreInvariantError("certification idempotency record could not be loaded");
    const value = mapAgonCertification(row);
    if (value.manifestHash !== job.manifestHash || value.providerSnapshot !== job.providerSnapshot || value.serviceKey !== job.serviceKey || value.taskId !== job.taskId) {
      throw new AgonStoreInvariantError("immutable listing version conflicts with certification job");
    }
    return value;
  }

  async backfillAgonCertifications(limit = 100, now = new Date()): Promise<number> {
    requireCertificationBackfillLimit(limit);
    if (!Number.isFinite(now.getTime())) throw new AgonStoreInvariantError("certification backfill time is invalid");
    // Jobs created while a listing was briefly quarantined (indexed before its anchor was recorded)
    // are queued once the listing is clean and active at that same version.
    await this.client.query(
      `update agon_certification_jobs j
          set state = 'scheduled', blocked_reason = null, next_attempt_at = $1, updated_at = $1
         from agon_listings l
        where j.state = 'blocked'
          and j.blocked_reason = 'listing_quarantined'
          and j.task_id is not null
          and l.chain_id = j.chain_id
          and l.service_registry_address = j.service_registry_address
          and l.listing_id = j.listing_id
          and l.current_version = j.listing_version
          and l.quarantine_reason is null
          and l.status = 'Listed'`,
      [now],
    );
    const candidates = await this.client.query<CertificationBackfillRow>(
      `select v.chain_id, v.service_registry_address, v.listing_id, l.agent_id,
              l.service_key, l.category, v.version, v.manifest_hash, v.manifest_uri,
              v.payment_rail, v.provider_snapshot, l.status, l.quarantine_reason
         from agon_listing_versions v
         join agon_listings l
           on l.chain_id = v.chain_id
          and l.service_registry_address = v.service_registry_address
          and l.listing_id = v.listing_id
        where not exists (
          select 1
            from agon_certification_jobs j
           where j.chain_id = v.chain_id
             and j.service_registry_address = v.service_registry_address
             and j.listing_id = v.listing_id
             and j.listing_version = v.version
        )
        order by v.chain_id, v.service_registry_address, v.listing_id, v.version
        limit $1`,
      [limit],
    );

    for (const row of candidates.rows) {
      await this.scheduleAgonCertification({
        chainId: BigInt(row.chain_id),
        serviceRegistry: row.service_registry_address,
        listingId: BigInt(row.listing_id),
        agentId: BigInt(row.agent_id),
        listingVersion: BigInt(row.version),
        serviceKey: row.service_key,
        category: BigInt(row.category),
        manifestHash: row.manifest_hash,
        manifestUri: row.manifest_uri,
        paymentRail: row.payment_rail,
        providerSnapshot: row.provider_snapshot,
        listingStatus: row.status,
        quarantineReason: row.quarantine_reason,
        now,
      });
    }
    return candidates.rows.length;
  }

  async claimAgonCertification(now: Date): Promise<AgonCertificationJob | null> {
    const expired = await this.client.query(
      `update agon_certification_jobs
          set state = 'scheduled', lease_expires_at = null, next_attempt_at = now(), updated_at = now()
        where state = 'running' and lease_expires_at <= $1`,
      [now],
    );
    void expired;
    const claimed = await this.client.query<AgonCertificationRow>(
      `select ${AGON_CERTIFICATION_COLUMNS}
         from agon_certification_jobs
        where state = 'scheduled' and next_attempt_at <= $1
        order by next_attempt_at asc, created_at asc
        for update skip locked
        limit 1`,
      [now],
    );
    const row = claimed.rows[0];
    if (!row) return null;
    const updated = await this.client.query<AgonCertificationRow>(
      `update agon_certification_jobs
          set state = 'running', attempts = attempts + 1,
              lease_expires_at = $2, started_at = coalesce(started_at, $1), updated_at = $1
        where job_id = $3 and state = 'scheduled'
        returning ${AGON_CERTIFICATION_COLUMNS}`,
      [now, new Date(now.getTime() + AGON_CERTIFICATION_LEASE_MS), row.job_id],
    );
    return updated.rows[0] ? mapAgonCertification(updated.rows[0]) : null;
  }

  async finalizeAgonCertificationLifecycle(jobId: string, check: AgonLifecycleCheckResult): Promise<AgonLifecycleTransition> {
    if (!/^[0-9a-f-]{36}$/i.test(check.checkId)) throw new AgonStoreInvariantError("certification check id must be a UUID");
    if (!Number.isFinite(check.checkedAt.getTime()) || !Number.isFinite(check.nextCheckAt.getTime()) || check.nextCheckAt <= check.checkedAt) {
      throw new AgonStoreInvariantError("certification lifecycle schedule is invalid");
    }
    const current = await this.client.query<AgonCertificationRow>(
      `select ${AGON_CERTIFICATION_COLUMNS} from agon_certification_jobs where job_id = $1 for update`,
      [jobId],
    );
    const row = current.rows[0];
    if (!row || row.state !== "running") throw new AgonStoreInvariantError("certification job was not running");
    const transition = evaluateAgonLifecycle({
      previousStatus: row.lifecycle_status,
      previousConsecutiveFailures: row.consecutive_failures,
      passed: check.passed,
      failureThreshold: check.failureThreshold,
    });
    const requestedAction: "approve" | "suspend" | null = transition.actions.includes("suspend")
      ? "suspend"
      : transition.actions.includes("approve") || transition.actions.includes("recover") ? "approve" : null;
    const actionPending = requestedAction !== null
      && (row.verification_action !== requestedAction || row.verification_action_state !== "confirmed");
    const sequence = row.check_sequence + 1;
    await this.client.query(
      `insert into agon_certification_checks (
         check_id, job_id, sequence, outcome, reason_codes, playground_run_id,
         endpoint_qa_evidence_hash, checked_at, next_check_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        check.checkId,
        jobId,
        sequence,
        check.passed ? "passed" : "failed",
        check.reasons.map((reason) => reason.slice(0, 80)),
        check.playgroundRunId,
        check.endpointQaEvidenceHash,
        check.checkedAt,
        check.nextCheckAt,
      ],
    );
    await this.client.query(
      `update agon_certification_jobs
          set state = 'scheduled', attempts = 0, lease_expires_at = null,
              next_attempt_at = $2, lifecycle_status = $3, consecutive_failures = $4,
              check_sequence = $5, last_checked_at = $6,
              last_passed_at = case when $7 then $6 else last_passed_at end,
              last_failed_at = case when $7 then last_failed_at else $6 end,
              completed_at = $6, last_error_code = case when $7 then null else $8 end,
              playground_run_id = $9, passed = $7, score = $10, evidence_root = $11,
              response_hash = $12, task_commitment = $13, validation_request_hash = $14,
              evaluator_version_hash = $15, provider_host = $16,
              verification_action = case when $17::text is null then verification_action else $17 end,
              verification_action_state = case when $18 then 'pending' else verification_action_state end,
              verification_transaction_hash = case when $18 then null else verification_transaction_hash end,
              verification_error = case when $18 then null else verification_error end,
              updated_at = $6
        where job_id = $1 and state = 'running'`,
      [
        jobId, check.nextCheckAt, transition.status, transition.consecutiveFailures,
        sequence, check.checkedAt, check.passed, check.reasons[0] ?? null,
        check.playgroundRunId, check.score, check.evidenceRoot, check.responseHash,
        check.taskCommitment, check.validationRequestHash, check.evaluatorVersionHash,
        check.providerHost,
        requestedAction,
        actionPending,
      ],
    );
    return transition;
  }

  async upsertListing(listing: ListingProjection): Promise<void> {
    await this.client.query(
      `insert into agon_listings (
         chain_id, service_registry_address, listing_id, agent_id, service_key, category,
         current_version, manifest_hash, manifest_uri, payment_rail, provider_snapshot,
         chain_status, status, verification, quarantine_reason, source_block_number,
         source_tx_hash, source_log_index, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $19
       )
       on conflict (chain_id, service_registry_address, listing_id) do update set
         current_version = excluded.current_version,
         manifest_hash = excluded.manifest_hash,
         manifest_uri = excluded.manifest_uri,
         payment_rail = excluded.payment_rail,
         provider_snapshot = excluded.provider_snapshot,
         chain_status = excluded.chain_status,
         status = excluded.status,
         verification = excluded.verification,
         quarantine_reason = excluded.quarantine_reason,
         source_block_number = excluded.source_block_number,
         source_tx_hash = excluded.source_tx_hash,
         source_log_index = excluded.source_log_index,
         updated_at = excluded.updated_at`,
      [
        requirePositive(listing.chainId, "chain id"),
        normalizeAddress(listing.serviceRegistry),
        requirePositive(listing.listingId, "listing id"),
        requirePositive(listing.agentId, "agent id"),
        normalizeHash(listing.serviceKey),
        requirePositive(listing.category, "category"),
        requirePositive(listing.currentVersion, "listing version"),
        normalizeHash(listing.manifestHash),
        requireText(listing.manifestUri, "manifest URI"),
        listing.paymentRail,
        normalizeAddress(listing.providerSnapshot),
        listing.chainStatus ?? listing.status,
        listing.status,
        listing.verification,
        listing.quarantineReason,
        requireNonNegative(listing.sourceBlockNumber, "source block number"),
        normalizeHash(listing.sourceTxHash),
        requireLogIndex(listing.sourceLogIndex),
        listing.observedAt,
      ],
    );
  }

  async insertValidatedListingVersion(version: ValidatedListingVersion): Promise<void> {
    const normalized: ValidatedListingVersion = {
      ...version,
      serviceRegistry: normalizeAddress(version.serviceRegistry),
      manifestHash: normalizeHash(version.manifestHash),
      providerSnapshot: normalizeAddress(version.providerSnapshot),
    };
    const inserted = await this.client.query(
      `insert into agon_listing_versions (
         chain_id, service_registry_address, listing_id, version, manifest_hash,
         manifest_uri, payment_rail, provider_snapshot, validated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (chain_id, service_registry_address, listing_id, version) do nothing
       returning version`,
      [
        requirePositive(normalized.chainId, "chain id"),
        normalized.serviceRegistry,
        requirePositive(normalized.listingId, "listing id"),
        requirePositive(normalized.version, "listing version"),
        normalized.manifestHash,
        requireText(normalized.manifestUri, "manifest URI"),
        normalized.paymentRail,
        normalized.providerSnapshot,
        normalized.validatedAt,
      ],
    );
    if ((inserted.rowCount ?? 0) > 0) return;

    const existing = await this.getValidatedListingVersion(normalized);
    if (!existing || !versionsMatch(existing, normalized)) {
      throw new AgonStoreInvariantError("immutable listing version conflicts with existing validation");
    }
  }

  async getValidatedListingVersion(
    key: ListingKey & { version: bigint },
  ): Promise<ValidatedListingVersion | null> {
    const result = await this.client.query<VersionRow>(
      `select chain_id, service_registry_address, listing_id, version, manifest_hash,
              manifest_uri, payment_rail, provider_snapshot, validated_at
       from agon_listing_versions
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3 and version = $4`,
      [
        requirePositive(key.chainId, "chain id"),
        normalizeAddress(key.serviceRegistry),
        requirePositive(key.listingId, "listing id"),
        requirePositive(key.version, "listing version"),
      ],
    );
    return result.rows[0] ? mapVersion(result.rows[0]) : null;
  }

  async hasValidatedListingVersion(key: ListingKey): Promise<boolean> {
    const result = await this.client.query(
      `select 1 from agon_listing_versions
       where chain_id = $1 and service_registry_address = $2 and listing_id = $3
       limit 1`,
      [requirePositive(key.chainId, "chain id"), normalizeAddress(key.serviceRegistry), requirePositive(key.listingId, "listing id")],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async appendListingEvent(event: ListingAudit): Promise<boolean> {
    const result = await this.client.query(
      `insert into agon_listing_events (
         chain_id, service_registry_address, listing_id, version, event_type,
         payload, tx_hash, log_index, block_number, block_hash, observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (chain_id, tx_hash, log_index, event_type) do nothing
       returning id`,
      [
        requirePositive(event.chainId, "chain id"),
        normalizeAddress(event.serviceRegistry),
        requirePositive(event.listingId, "listing id"),
        event.version === null ? null : requirePositive(event.version, "listing version"),
        event.eventType,
        jsonSafe(event.payload),
        normalizeHash(event.txHash),
        requireLogIndex(event.logIndex),
        requireNonNegative(event.blockNumber, "block number"),
        normalizeHash(event.blockHash),
        event.observedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async insertChainEvent(event: ChainEventRecord): Promise<boolean> {
    const result = await this.client.query(
      `insert into agon_chain_events (
         chain_id, contract_address, tx_hash, log_index, block_number,
         block_hash, event_name, args, observed_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (chain_id, tx_hash, log_index) do nothing
       returning log_index`,
      [
        requirePositive(event.chainId, "chain id"),
        normalizeAddress(event.contractAddress),
        normalizeHash(event.txHash),
        requireLogIndex(event.logIndex),
        requireNonNegative(event.blockNumber, "block number"),
        normalizeHash(event.blockHash),
        requireText(event.eventName, "event name"),
        jsonSafe(event.args),
        event.observedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async advanceIndexerCursor(cursor: IndexerCursor): Promise<void> {
    await this.client.query(
      `insert into agon_indexer_state (
         stream_name, chain_id, contract_address, last_block, last_block_hash, updated_at
       ) values ($1, $2, $3, $4, $5, now())
       on conflict (stream_name, chain_id, contract_address) do update set
         last_block = excluded.last_block,
         last_block_hash = excluded.last_block_hash,
         updated_at = now()
       where excluded.last_block >= agon_indexer_state.last_block`,
      [
        requireText(cursor.streamName, "stream name"),
        requirePositive(cursor.chainId, "chain id"),
        normalizeAddress(cursor.contractAddress),
        requireNonNegative(cursor.lastBlock, "last block"),
        normalizeHash(cursor.lastBlockHash),
      ],
    );
  }
}
