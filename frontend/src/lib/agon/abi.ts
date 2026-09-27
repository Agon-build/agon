import { parseAbi } from "viem";

export const AGON_PROFILE_REGISTRY = "0xE0c7A2545C2f4eE6d2bD797B6f2742c73E640574" as const;
export const AGON_SERVICE_REGISTRY = "0xf017290A267A3CEb693544882464a188D9e4a516" as const;

export const agonProfileRegistryAbi = parseAbi([
  "function bindProfile(uint256 id, string uri)",
]);

export const agonServiceRegistryAbi = parseAbi([
  "function publish(uint256 agentId, bytes32 serviceKey, bytes32 manifestHash, string uri, uint256 category, uint8 rail) returns (uint256 id)",
  "function publishVersion(uint256 id, bytes32 hash, string uri, uint8 rail)",
]);

export const agonJobEscrowAbi = parseAbi([
  "event JobCreated(uint256 indexed jobId,bytes32 indexed clientReference,address indexed buyer,address provider,uint256 listingId,uint256 agentId,uint256 listingVersion,bytes32 manifestHash,bytes32 termsHash,uint256 amount,uint256 fee,uint64 reviewHours,uint64 acceptanceDeadline)",
  "function createJob(bytes32 clientReference, uint256 listingId, bytes32 termsHash, uint256 amount, uint64 reviewHours) returns (uint256 jobId)",
  "function acceptJob(uint256 jobId)",
  "function submitJob(uint256 jobId, bytes32 deliverableHash)",
  "function acceptSubmission(uint256 jobId)",
  "function autoAccept(uint256 jobId)",
  "function rejectSubmission(uint256 jobId, bytes32 reasonHash)",
  "function openDispute(uint256 jobId, bytes32 reasonHash)",
  "function resolveDispute(uint256 jobId, bool payProvider)",
  "function failJob(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((uint256 jobId,address buyer,address provider,uint256 listingId,uint256 agentId,uint256 listingVersion,bytes32 manifestHash,bytes32 termsHash,bytes32 deliverableHash,uint256 amount,uint256 fee,uint64 reviewHours,uint64 acceptanceDeadline,uint64 reviewDeadline,uint64 createdAt,uint64 submittedAt,uint8 status,uint8 settlement))",
]);

/** V2 escrow ABI for future deployments. V2 keeps the same lifecycle calls,
 * adds governance fee controls, and exposes the per-job fee snapshot. */
export const agonJobEscrowV2Abi = parseAbi([
  "event ProtocolFeeChangeScheduled(uint256 indexed oldFeeBps,uint256 indexed newFeeBps,uint64 effectiveAt)",
  "event ProtocolFeeChanged(uint256 indexed oldFeeBps,uint256 indexed newFeeBps)",
  "event ProtocolFeeChangeCancelled(uint256 indexed pendingFeeBps,uint64 effectiveAt)",
  "function protocolFeeBps() view returns (uint16)",
  "function pendingProtocolFeeBps() view returns (uint16)",
  "function pendingProtocolFeeEffectiveAt() view returns (uint64)",
  "function MAX_PROTOCOL_FEE_BPS() view returns (uint256)",
  "function PROTOCOL_FEE_CHANGE_DELAY() view returns (uint64)",
  "function scheduleProtocolFeeChange(uint16 newFeeBps)",
  "function applyProtocolFeeChange()",
  "function cancelProtocolFeeChange()",
  "function createJob(bytes32 clientReference, uint256 listingId, bytes32 termsHash, uint256 amount, uint64 reviewHours) returns (uint256 jobId)",
  "function acceptJob(uint256 jobId)",
  "function submitJob(uint256 jobId, bytes32 deliverableHash)",
  "function acceptSubmission(uint256 jobId)",
  "function autoAccept(uint256 jobId)",
  "function rejectSubmission(uint256 jobId, bytes32 reasonHash)",
  "function openDispute(uint256 jobId, bytes32 reasonHash)",
  "function resolveDispute(uint256 jobId, bool payProvider)",
  "function failJob(uint256 jobId)",
  "function getJob(uint256 jobId) view returns ((uint256 jobId,address buyer,address provider,uint256 listingId,uint256 agentId,uint256 listingVersion,bytes32 manifestHash,bytes32 termsHash,bytes32 deliverableHash,uint256 amount,uint256 fee,uint16 feeBps,uint64 reviewHours,uint64 acceptanceDeadline,uint64 reviewDeadline,uint64 createdAt,uint64 submittedAt,uint8 status,uint8 settlement))",
]);

export const agonArenaAbi = parseAbi([
  "event EvaluationRequested(uint256 indexed evaluationId,bytes32 indexed validationRequestHash,uint256 indexed listingId,uint256 agentId,uint256 listingVersion,address participant,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,uint64 expiresAt)",
  "function requestEvaluation(bytes32 validationRequestHash,uint256 listingId,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,uint64 expiresAt) returns (uint256 evaluationId)",
  "function startEvaluation(uint256 evaluationId)",
  "function submitEvidence(uint256 evaluationId,bytes32 evidenceRoot)",
  "function scoreEvaluation(uint256 evaluationId,uint8 score,bytes32 validationResponseHash)",
  "function expireEvaluation(uint256 evaluationId)",
  "function getEvaluation(uint256 evaluationId) view returns ((uint256 evaluationId,uint256 listingId,uint256 agentId,uint256 listingVersion,uint256 category,address participant,bytes32 manifestHash,bytes32 capabilityHash,bytes32 evaluatorVersionHash,bytes32 taskCommitment,bytes32 evidenceRoot,bytes32 validationRequestHash,bytes32 validationResponseHash,uint8 score,uint64 requestedAt,uint64 submittedAt,uint64 scoredAt,uint64 expiresAt,uint8 state))",
]);

export const agonSyndicateRegistryAbi = parseAbi([
  "function createSyndicate(bytes32 nameHash,bytes32 campaignHash) returns (uint256 syndicateId)",
  "function joinSyndicate(uint256 syndicateId,uint256 agentId)",
  "function lockRoster(uint256 syndicateId)",
  "function startCompetition(uint256 syndicateId)",
  "function recordContribution(uint256 syndicateId,uint256 agentId,bytes32 contributionKey,uint256 score,bytes32 evidenceHash)",
  "function settleCampaign(uint256 syndicateId)",
  "function getSyndicate(uint256 syndicateId) view returns ((uint256 syndicateId,bytes32 nameHash,bytes32 campaignHash,address creator,uint64 createdAt,uint64 lockedAt,uint64 settledAt,uint256 memberCount,uint8 state))",
  "function getMemberAgentIds(uint256 syndicateId) view returns (uint256[])",
]);

export const agonPrizeVaultAbi = parseAbi([
  "event PoolFunded(bytes32 indexed poolKey,uint8 indexed kind,uint256 indexed sourceId,address sponsor,uint256 principal,uint256 fee)",
  "event PayoutRootPublished(bytes32 indexed poolKey,bytes32 indexed payoutRoot,uint256 payoutTotal,uint64 claimDeadline)",
  "function createPool(bytes32 poolKey,uint8 kind,uint256 sourceId,address sponsor,uint256 principal,uint16 feeBps)",
  "function publishPayoutRoot(bytes32 poolKey,bytes32 payoutRoot,uint256 payoutTotal,uint64 claimDeadline)",
  "function refundRemaining(bytes32 poolKey)",
  "function getPool(bytes32 poolKey) view returns ((bytes32 poolKey,uint8 kind,uint256 sourceId,address sponsor,uint256 principal,uint256 fee,bytes32 payoutRoot,uint256 payoutTotal,uint256 claimedTotal,uint64 claimDeadline,uint8 state))",
  "function isClaimed(bytes32 poolKey,uint256 index) view returns (bool)",
  "function claim(bytes32 poolKey,uint256 index,address beneficiary,uint256 amount,bytes32[] proof)",
]);

export const agonUsdcAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
]);

