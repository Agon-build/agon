import { canonicalManifestHash } from "./canonical.ts";
import type { AgonCapabilities, AgonHealth, AgonListing } from "./types.ts";

const SERVICE_REGISTRY = "0xf017290A267A3CEb693544882464a188D9e4a516";
const PROVIDER = "0x0aeEF0Dd6b0754262d1a91e435565749Cdc365Ad";

const verifiedManifest = {
  name: "Contract Safety Review",
  version: 1,
  description: "Reviews Solidity contracts and returns prioritized findings with reproducible evidence.",
  category: "verification",
  endpoint: "https://security.preview.agon.surf/x402/review",
  tags: ["security", "solidity", "audit"],
  pricing: { rail: "escrow", amountUSDC: "4.00" },
};

const providerManifest = {
  name: "Agon Market Intel",
  version: 1,
  description: "Returns current crypto prediction-market odds and volume data for autonomous research agents.",
  category: "prediction",
  endpoint: "https://api.agon.surf/x402/market-intel",
  tags: ["market-data", "polymarket", "x402"],
  pricing: { rail: "x402", amountUSDC: "0.001" },
};

const quarantinedManifest = {
  name: "Autonomous Treasury Executor",
  version: 2,
  description: "Claims to rebalance treasury positions across protocols without a matching manifest anchor.",
  category: "execution",
  endpoint: "https://unsafe.preview.agon.surf/x402/execute",
  tags: ["execution", "treasury", "high-risk"],
  pricing: { rail: "escrow", amountUSDC: "15.00" },
};

function id(listingId: string) {
  return `5042002:${SERVICE_REGISTRY}:${listingId}`;
}

function txHash(byte: string) {
  return `0x${byte.repeat(64)}`;
}

export const AGON_PREVIEW_LISTINGS: AgonListing[] = [
  {
    id: id("1"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "1",
    agentId: "880101",
    serviceKey: `0x${"11".repeat(32)}`,
    category: "8",
    version: "1",
    manifest: {
      hash: canonicalManifestHash(verifiedManifest),
      uri: "https://verified.preview.agon.surf/manifest-v1.json",
      body: verifiedManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: {
      status: "Verified",
      scope: { agentId: "880101", listingId: "1", version: "1", category: "8" },
    },
    risk: { unverified: false, warning: null, quarantineReason: null },
    endpointQa: {
      status: "passed",
      checkedAt: "2026-08-20T08:00:00.000Z",
      endpointStatus: 402,
      evidenceHash: `0x${"a1".repeat(32)}`,
      reason: "Agon observed the service endpoint returning HTTP 402.",
      attempts: 3,
      passedAttempts: 3,
      successRate: 100,
    },
    payment: { rail: "Escrow", directX402: false, escrowEligible: true },
    provenance: { sourceBlockNumber: "57530001", sourceTxHash: txHash("1"), sourceLogIndex: 0 },
    firstParty: false,
  },
  {
    id: id("2"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "2",
    agentId: "880102",
    serviceKey: `0x${"22".repeat(32)}`,
    category: "4",
    version: "1",
    manifest: {
      hash: canonicalManifestHash(providerManifest),
      uri: "https://agon.surf/.well-known/agon/market-intel/manifest-v1.json",
      body: providerManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: {
      status: "Unverified",
      scope: { agentId: "880102", listingId: "2", version: "1", category: "4" },
    },
    risk: {
      unverified: true,
      warning: "The provider anchored this version, but Agon has not verified its behavior yet.",
      quarantineReason: null,
    },
    endpointQa: {
      status: "not_checked",
      checkedAt: null,
      endpointStatus: null,
      evidenceHash: null,
      reason: "Agon has not run endpoint verification for this listing yet.",
      attempts: 0,
      passedAttempts: 0,
      successRate: null,
    },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "57530002", sourceTxHash: txHash("2"), sourceLogIndex: 1 },
    firstParty: false,
  },
  {
    id: id("4"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "4",
    agentId: "880104",
    serviceKey: `0x${"44".repeat(32)}`,
    category: "4",
    version: "1",
    manifest: {
      hash: canonicalManifestHash(providerManifest),
      uri: "https://verified.preview.agon.surf/market-intel/manifest-v1.json",
      body: providerManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Listed",
    verification: {
      status: "Verified",
      scope: { agentId: "880104", listingId: "4", version: "1", category: "4" },
    },
    risk: { unverified: false, warning: null, quarantineReason: null },
    endpointQa: {
      status: "passed",
      checkedAt: "2026-08-20T08:04:00.000Z",
      endpointStatus: 402,
      evidenceHash: `0x${"a4".repeat(32)}`,
      reason: "Agon observed the direct x402 endpoint returning HTTP 402.",
      attempts: 3,
      passedAttempts: 3,
      successRate: 100,
    },
    payment: { rail: "X402", directX402: true, escrowEligible: false },
    provenance: { sourceBlockNumber: "57530004", sourceTxHash: txHash("4"), sourceLogIndex: 3 },
    firstParty: false,
  },
  {
    id: id("3"),
    chainId: "5042002",
    serviceRegistry: SERVICE_REGISTRY,
    listingId: "3",
    agentId: "880103",
    serviceKey: `0x${"33".repeat(32)}`,
    category: "5",
    version: "2",
    manifest: {
      hash: `0x${"99".repeat(32)}`,
      uri: "https://unsafe.preview.agon.surf/manifest-v2.json",
      body: quarantinedManifest,
    },
    providerSnapshot: PROVIDER,
    status: "Suspended",
    verification: {
      status: "Suspended",
      scope: { agentId: "880103", listingId: "3", version: "2", category: "5" },
    },
    risk: {
      unverified: true,
      warning: "The indexed manifest does not match the onchain hash.",
      quarantineReason: "manifest_hash_mismatch",
    },
    endpointQa: {
      status: "failed",
      checkedAt: "2026-08-20T08:02:00.000Z",
      endpointStatus: 200,
      evidenceHash: `0x${"a3".repeat(32)}`,
      reason: "The latest Agon endpoint verification did not pass.",
      attempts: 2,
      passedAttempts: 0,
      successRate: 0,
    },
    payment: { rail: "Escrow", directX402: false, escrowEligible: false },
    provenance: { sourceBlockNumber: "57530003", sourceTxHash: txHash("3"), sourceLogIndex: 2 },
    firstParty: false,
  },
];

export const AGON_PREVIEW_CAPABILITIES: AgonCapabilities = {
  identityReads: true,
  profileWrites: false,
  listingReads: true,
  listingWrites: false,
  endpointQa: false,
  directX402: true,
  escrow: false,
  arenaVerification: false,
  operationsAlerts: {
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
    reasons: ["preview_read_only"],
    checkedAt: null,
  },
  arenaEvaluatorReadiness: {
    enabled: false,
    arenaAddress: null,
    evaluatorAddress: null,
    role: `0x${"00".repeat(32)}`,
    assigned: false,
    reason: "unconfigured",
    executionEnabled: false,
    executionReason: "writer_disabled",
    checkedAt: null,
  },
  listingVerifierReadiness: {
    enabled: false,
    registryAddress: null,
    verifierAddress: null,
    role: null,
    assigned: false,
    reason: "unconfigured",
    executionEnabled: false,
    executionReason: "writer_disabled",
    checkedAt: null,
  },
  syndicateRegistry: false,
  prizeVault: false,
  protocolReadiness: {
    ready: false,
    chainId: 5042002,
    missingContracts: [],
    unverifiedContracts: [],
    externalRegistry: { identity: null, validation: null },
    reasons: ["preview_read_only"],
  },
  writeReadiness: {
    checkedAt: null,
    reasons: ["preview_read_only"],
  },
  escrowReadiness: {
    testnetOnly: true,
    ready: false,
    executionEnabled: false,
    checkedAt: null,
    reasons: ["preview_read_only"],
    requiredApprovals: [],
  },
};

export const AGON_PREVIEW_HEALTH: AgonHealth = {
  ok: true,
  service: "agon",
  capabilities: AGON_PREVIEW_CAPABILITIES,
};

