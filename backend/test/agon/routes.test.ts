import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  createAgonRoutes,
  type AgonMarketService,
  type AgonRouteVariables,
} from "../../src/agon/http/routes.ts";
import type {
  AgonCapabilities,
  AgonListingView,
  BindProfileRequest,
  ListingPage,
  ListingQuery,
  PublishListingRequest,
  SubmittedOperation,
  X402ApprovalRequest,
  X402ApprovalView,
  X402CallIntentRequest,
  X402CallIntentView,
  X402QuoteView,
  X402AuthorizationView,
  X402AuthorizationSignatureRequest,
  X402AuthorizationSubmittedView,
  X402ExecutionPlanView,
  X402ExecutionApprovalRequest,
  X402ExecutionApprovalView,
  X402ExecutionReadinessView,
  X402SettlementReadinessView,
  X402SettlementRequest,
  X402SettlementView,
  X402ReconciliationReadinessView,
  X402FacilitatorVerificationRequest,
  X402FacilitatorVerificationView,
  AgonEscrowIntentRequest,
  AgonEscrowIntentView,
  AgonEscrowReadinessView,
} from "../../src/agon/http/api-types.ts";
import type { Result } from "../../src/agon/core/result.ts";
import { InMemoryPlaygroundRateLimiter, InMemoryPlaygroundRunStore } from "../../src/agon/playground-store.ts";
import type { McpHireStore } from "../../src/agon/mcp/hire-store.ts";

const ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REGISTRY = "0x3333333333333333333333333333333333333333";
const SERVICE_KEY = `0x${"44".repeat(32)}`;
const MANIFEST_HASH = `0x${"55".repeat(32)}`;

const listing: AgonListingView = {
  id: `5042002:${REGISTRY}:1`,
  chainId: "5042002",
  serviceRegistry: REGISTRY,
  listingId: "1",
  agentId: "42",
  serviceKey: SERVICE_KEY,
  category: "1",
  version: "1",
  manifest: { hash: MANIFEST_HASH, uri: "ipfs://manifest-v1" },
  providerSnapshot: ADDRESS,
  status: "Listed",
  verification: {
    status: "Unverified",
    scope: { agentId: "42", listingId: "1", version: "1", category: "1" },
  },
  risk: {
    unverified: true,
    warning: "This service has not passed Agon Arena verification.",
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
  provenance: {
    sourceBlockNumber: "100",
    sourceTxHash: `0x${"66".repeat(32)}`,
    sourceLogIndex: 0,
  },
};

const capabilities: AgonCapabilities = {
  identityReads: true,
  profileWrites: false,
  listingReads: true,
  listingWrites: false,
  endpointQa: false,
  directX402: false,
  escrow: false,
  jobEscrowCalldataSupported: false,
  jobEscrowExecution: false,
  jobEscrowExecutionReason: "job_escrow_not_configured",
  arenaVerification: false,
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
  syndicateRegistry: false,
  prizeVault: false,
  protocolReadiness: {
    ready: false,
    chainId: 5042002,
    missingContracts: [],
    unverifiedContracts: [],
    externalRegistry: { identity: null, validation: null },
    reasons: ["source_verification_incomplete"],
  },
  writeReadiness: { checkedAt: null, reasons: ["adapter_unconfigured"] },
  escrowReadiness: {
    testnetOnly: true,
    ready: false,
    executionEnabled: false,
    checkedAt: null,
    reasons: ["readiness_unconfigured"],
    requiredApprovals: [],
  },
};

function preparedOperation(operationId: string): SubmittedOperation {
  return {
    operationId,
    state: "prepared",
    transaction: {
      chainId: "5042002",
      to: REGISTRY,
      data: "0x1234",
      functionName: "publish",
      args: ["42", SERVICE_KEY, MANIFEST_HASH, "ipfs://manifest-v1", "1", "0"],
    },
    txHash: null,
    resultReference: null,
    proof: null,
  };
}

type ServiceError = {
  code: "not_found" | "not_owner" | "conflict" | "capability_unavailable" | "execution_not_ready";
  message: string;
};

class FakeAgonService implements AgonMarketService {
  lastQuery: ListingQuery | null = null;
  bindResult: Result<SubmittedOperation, ServiceError> = {
    ok: true,
    value: preparedOperation("bind-1"),
  };
  publishResult: Result<SubmittedOperation, ServiceError> = {
    ok: true,
    value: preparedOperation("publish-1"),
  };

  async listListings(query: ListingQuery): Promise<Result<ListingPage, ServiceError>> {
    this.lastQuery = query;
    return { ok: true, value: { items: [listing], nextCursor: "cursor-next" } };
  }

  async getListing(reference: string): Promise<Result<AgonListingView, ServiceError>> {
    return reference === listing.id
      ? { ok: true, value: listing }
      : { ok: false, error: { code: "not_found", message: "listing not found" } };
  }

  async bindProfile(
    _actor: string,
    _request: BindProfileRequest,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    return this.bindResult;
  }

  async publishListing(
    _actor: string,
    _request: PublishListingRequest,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    return this.publishResult;
  }

  async confirmOperation(
    _actor: string,
    operationId: string,
    txHash: `0x${string}`,
  ): Promise<Result<SubmittedOperation, ServiceError>> {
    const operation = preparedOperation(operationId);
    return {
      ok: true,
      value: {
        ...operation,
        state: "confirmed",
        txHash,
        proof: { blockNumber: "123", logIndex: 7 },
      },
    };
  }

  async prepareX402Call(
    _actor: string,
    _reference: string,
    _request: X402CallIntentRequest,
  ): Promise<Result<X402CallIntentView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId: "00000000-0000-4000-8000-000000000001",
        actor: ADDRESS,
        idempotencyKey: "review-001",
        listingReference: listing.id,
        listingVersion: listing.version,
        inputHash: `0x${"77".repeat(32)}`,
        maxAmountUSDC: "0.01",
        state: "prepared",
        executionEnabled: false,
        nextAction: "execution_adapter_not_enabled",
        createdAt: "2026-08-20T10:00:00.000Z",
      },
    };
  }

  async approveX402Call(
    _actor: string,
    _intentId: string,
    request: X402ApprovalRequest,
  ): Promise<Result<X402ApprovalView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId: "00000000-0000-4000-8000-000000000001",
        actor: ADDRESS,
        state: "approved",
        approvedAmountUSDC: request.approvedAmountUSDC,
        executionEnabled: false,
        nextAction: "payment_adapter_not_enabled",
        approvedAt: "2026-08-20T10:01:00.000Z",
      },
    };
  }

  async captureX402Quote(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402QuoteView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "payment_required",
        status: 402,
        targetUrl: "https://provider.example/x402",
        quoteHash: `0x${"88".repeat(32)}`,
        x402Version: 2,
        resource: { url: "https://provider.example/x402", description: null, mimeType: "application/json" },
        accepts: [{ scheme: "exact", network: "eip155:5042002", asset: `0x${"11".repeat(20)}`, amount: "0.001", payTo: ADDRESS, maxTimeoutSeconds: 600, gateway: true }],
        executionEnabled: false,
        nextAction: "authorization_not_enabled",
        capturedAt: "2026-08-20T10:02:00.000Z",
      },
    };
  }

  async prepareX402Authorization(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402AuthorizationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_ready",
        payloadHash: `0x${"99".repeat(32)}`,
        payload: {
          x402Version: 2,
          domain: { name: "GatewayWalletBatched", version: "1", chainId: 5042002, verifyingContract: ADDRESS },
          types: { TransferWithAuthorization: [{ name: "from", type: "address" }] },
          primaryType: "TransferWithAuthorization",
          message: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
        },
        expiresAt: "2026-08-27T10:00:00.000Z",
        executionEnabled: false,
        nextAction: "user_signature_required",
        preparedAt: "2026-08-20T10:03:00.000Z",
      },
    };
  }

  async submitX402Authorization(
    _actor: string,
    intentId: string,
    _request: X402AuthorizationSignatureRequest,
  ): Promise<Result<X402AuthorizationSubmittedView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        authorizationHash: `0x${"ab".repeat(32)}`,
        signatureAccepted: true,
        executionEnabled: false,
        nextAction: "settlement_not_enabled",
        submittedAt: "2026-08-20T10:04:00.000Z",
      },
    };
  }

  async prepareX402ExecutionPlan(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionPlanView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        plan: {
          testnetOnly: true,
          facilitatorUrl: "https://gateway-api-testnet.circle.com",
          settlementEndpoint: "https://gateway-api-testnet.circle.com/v1/x402/settle",
          requirements: {
            scheme: "exact",
            network: "eip155:5042002",
            asset: `0x${"11".repeat(20)}`,
            amount: "1000",
            payTo: ADDRESS,
            maxTimeoutSeconds: 604900,
            extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ADDRESS },
          },
          authorization: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
          authorizationHash: `0x${"ab".repeat(32)}`,
          planHash: `0x${"cd".repeat(32)}`,
          paymentPayloadPreview: {
            x402Version: 2,
            payload: {
              authorization: { from: ADDRESS, to: ADDRESS, value: "1000", validAfter: "1", validBefore: "2", nonce: `0x${"aa".repeat(32)}` },
              signatureHash: `0x${"ab".repeat(32)}`,
              signature: null,
            },
          },
          executionEnabled: false,
          nextAction: "explicit_execution_approval",
        },
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
        preparedAt: "2026-08-20T10:05:00.000Z",
      },
    };
  }

  async approveX402Execution(
    _actor: string,
    intentId: string,
    _request: X402ExecutionApprovalRequest,
  ): Promise<Result<X402ExecutionApprovalView, ServiceError>> {
    return {
      ok: true,
      value: {
        approvalHash: `0x${"ee".repeat(32)}`,
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        actor: ADDRESS,
        planHash: `0x${"cd".repeat(32)}`,
        authorizationHash: `0x${"ab".repeat(32)}`,
        approvalIdempotencyKey: "approval-001",
        testnetOnly: true,
        approvedAt: "2026-08-20T10:06:00.000Z",
        expiresAt: "2026-08-20T10:11:00.000Z",
        executionEnabled: false,
        nextAction: "execution_adapter_not_enabled",
      },
    };
  }

  async getX402ExecutionReadiness(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ExecutionReadinessView, ServiceError>> {
    const plan = await this.prepareX402ExecutionPlan("", intentId);
    if (!plan.ok) return plan;
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted",
        plan: plan.value.plan,
        approval: null,
        status: "approval_required",
        reason: "Execution approval is required before a settlement adapter can be considered.",
        executionEnabled: false,
        nextAction: "explicit_execution_approval",
        checkedAt: "2026-08-20T10:07:00.000Z",
      },
    };
  }

  async getX402SettlementReadiness(
    _actor: string,
    intentId: string,
  ) {
    return {
      ok: true as const,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "authorization_submitted" as const,
        network: "eip155:5042002" as const,
        settlementRef: null,
        status: "ready_but_disabled" as const,
        reason: "Authorization is valid, but Circle settlement is disabled by policy.",
        executionEnabled: false as const,
        nextAction: "execution_adapter_not_enabled" as const,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async settleX402Call(
    _actor: string,
    _intentId: string,
    _request: X402SettlementRequest,
  ): Promise<Result<X402SettlementView, ServiceError>> {
    return { ok: false, error: { code: "execution_not_ready", message: "Circle x402 settlement is disabled by policy" } };
  }

  async getX402ReconciliationReadiness(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402ReconciliationReadinessView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "unknown",
        network: "eip155:5042002",
        transaction: `0x${"ab".repeat(32)}`,
        status: "lookup_disabled",
        reason: "The read-only provider receipt lookup adapter is disabled.",
        lookupEnabled: false,
        executionEnabled: false,
        nextAction: "enable_receipt_lookup",
        checkedAt: new Date().toISOString(),
      },
    };
  }

  async reconcileX402Receipt(
    _actor: string,
    intentId: string,
    _request: { confirmation: "RECONCILE_ARC_TESTNET_X402" },
  ): Promise<Result<import("../../src/agon/http/api-types.ts").X402ReconciliationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "settlement_submitted",
        network: "eip155:5042002",
        status: "confirmed",
        transaction: `0x${"ab".repeat(32)}`,
        executionEnabled: false,
        serviceDeliveryPending: true,
        nextAction: "deliver_service",
        recordedAt: new Date().toISOString(),
      },
    };
  }

  async verifyX402Facilitator(
    _actor: string,
    intentId: string,
    _request: X402FacilitatorVerificationRequest,
  ): Promise<Result<X402FacilitatorVerificationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "facilitator_verified",
        network: "eip155:5042002",
        payer: ADDRESS,
        approvalHash: `0x${"ee".repeat(32)}`,
        evidenceHash: `0x${"ef".repeat(32)}`,
        verified: true,
        executionEnabled: false,
        nextAction: "settlement_remains_disabled",
        verifiedAt: "2026-08-20T10:08:00.000Z",
      },
    };
  }

  async getX402FacilitatorVerification(
    _actor: string,
    intentId: string,
  ): Promise<Result<X402FacilitatorVerificationView, ServiceError>> {
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "facilitator_verified",
        network: "eip155:5042002",
        payer: ADDRESS,
        approvalHash: `0x${"ee".repeat(32)}`,
        evidenceHash: `0x${"ef".repeat(32)}`,
        verified: true,
        executionEnabled: false,
        nextAction: "settlement_remains_disabled",
        verifiedAt: "2026-08-20T10:08:00.000Z",
      },
    };
  }

  async prepareAgonEscrowIntent(
    _actor: string,
    request: AgonEscrowIntentRequest,
  ): Promise<Result<AgonEscrowIntentView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId: "00000000-0000-4000-8000-000000000010",
        actor: ADDRESS,
        idempotencyKey: request.idempotencyKey,
        listingReference: request.listingReference,
        termsHash: `0x${"aa".repeat(32)}`,
        network: "eip155:5042002",
        asset: `0x${"36".repeat(20)}`,
        buyer: ADDRESS,
        beneficiary: ADDRESS,
        listing: { serviceRegistry: REGISTRY, listingId: "1", agentId: "42", version: "1", manifestHash: MANIFEST_HASH },
        amountBaseUnits: request.amountBaseUnits,
        feeBps: 500,
        expiresAt: request.expiresAt,
        state: "prepared",
        providerReference: null,
        transaction: null,
        executionEnabled: false,
        nextAction: "escrow_adapter_not_enabled",
        createdAt: "2026-08-22T12:00:00.000Z",
        updatedAt: "2026-08-22T12:00:00.000Z",
      },
    };
  }

  async getAgonEscrowIntent(_actor: string, intentId: string): Promise<Result<AgonEscrowIntentView, ServiceError>> {
    const result = await this.prepareAgonEscrowIntent(ADDRESS, {
      listingReference: listing.id,
      idempotencyKey: "escrow-route-001",
      amountBaseUnits: "1000000",
      feeBps: 500,
      expiresAt: "2026-08-23T12:00:00.000Z",
    });
    if (result.ok) result.value.intentId = intentId;
    return result;
  }

  async getAgonEscrowReadiness(_actor: string, intentId: string): Promise<Result<AgonEscrowReadinessView, ServiceError>> {
    return {
      ok: true,
      value: {
        intentId,
        state: "prepared",
        status: "adapter_disabled",
        reason: "Agon escrow execution is disabled",
        executionEnabled: false,
        nextAction: "escrow_adapter_not_enabled",
        checkedAt: "2026-08-22T12:00:00.000Z",
      },
    };
  }

  async getCapabilities(): Promise<AgonCapabilities> {
    return capabilities;
  }
}

const testAuth: MiddlewareHandler<{ Variables: AgonRouteVariables }> = async (context, next) => {
  const address = context.req.header("x-test-address");
  if (!address) return context.json({ error: { code: "unauthorized", message: "unauthorized" } }, 401);
  context.set("address", address.toLowerCase());
  await next();
};

function testApp(
  service: AgonMarketService,
  playground = false,
  verifyMcpToken: (token: string) => Promise<{ address: string; client: string | null; scopes: string[] } | null> = async () => null,
  hireStore?: McpHireStore,
) {
  const app = new Hono<{ Variables: AgonRouteVariables }>();
  app.route("/agon", createAgonRoutes({
    service,
    verifyMcpToken,
    requireAuth: testAuth,
    hireStore,
    playgroundStore: playground ? new InMemoryPlaygroundRunStore() : undefined,
    playgroundRateLimiter: playground ? new InMemoryPlaygroundRateLimiter() : undefined,
    playgroundProviderRunner: playground ? {
      scopes: () => [`${listing.id}@${listing.version}`],
      supports: () => true,
      run: async ({ provider }) => ({
        agent: { id: `erc8004:${provider.agentId}:test`, name: "Test provider", version: provider.listingVersion, capabilities: ["research"] },
        output: { decision: "review", observations: ["provider fact"], untrustedClaims: [], ignoredInstructions: true, writesPerformed: false },
        passed: true,
        score: 100,
        chainId: null,
        blockNumber: null,
        providerHost: "provider.example",
      }),
    } : undefined,
  }));
  return app;
}

test("REST MCP listing actions enforce prepare and write scopes before parsing input", async () => {
  const app = new Hono<{ Variables: AgonRouteVariables }>();
  const denied: string[] = [];
  const prepare: MiddlewareHandler<{ Variables: AgonRouteVariables }> = async (context) => {
    denied.push("listing:prepare");
    return context.json({ error: "scope_required", scope: "listing:prepare" }, 403);
  };
  const write: MiddlewareHandler<{ Variables: AgonRouteVariables }> = async (context) => {
    denied.push("listing:write");
    return context.json({ error: "scope_required", scope: "listing:write" }, 403);
  };
  app.route("/agon", createAgonRoutes({
    service: new FakeAgonService(),
    verifyMcpToken: async () => null,
    requireAuth: testAuth,
    requireListingPrepareAuth: prepare,
    requireListingWriteAuth: write,
  }));
  for (const path of ["start-listing", "check-listing", "compile-listing"]) {
    const response = await app.request(`/agon/mcp/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json() as { scope: string }).scope, "listing:prepare");
  }
  const draft = await app.request("/agon/mcp/listing/draft-1");
  assert.equal(draft.status, 403);
  for (const path of ["publish-listing", "publish-listing-version", "pause-listing"]) {
    const response = await app.request(`/agon/mcp/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403, path);
    assert.equal((await response.json() as { scope: string }).scope, "listing:write");
  }
  assert.deepEqual(denied, ["listing:prepare", "listing:prepare", "listing:prepare", "listing:prepare", "listing:write", "listing:write", "listing:write"]);
});

test("MCP retry-or-report uses the authenticated hire owner", async () => {
  const checkedActors: string[] = [];
  const app = testApp(new FakeAgonService(), false, async () => null, {
    async create() { throw new Error("unused"); },
    async get(actor) { checkedActors.push(actor); return null; },
  });
  const response = await app.request("/agon/mcp/hire/hire-1/retry-or-report", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS.toUpperCase() },
    body: JSON.stringify({ action: "report_problem" }),
  });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /hire_not_found/);
  assert.deepEqual(checkedActors, [ADDRESS]);
});

test("MCP tools trust only verified bearer claims for an actor", async () => {
  const seenTokens: string[] = [];
  const app = testApp(new FakeAgonService(), false, async (token) => {
    seenTokens.push(token);
    return token === "valid-test-token" ? { address: ADDRESS, client: null, scopes: [] } : null;
  });
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "get_hire_status", arguments: { hireId: "hire-1" } },
  });
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const invalid = await app.request("/agon/mcp", { method: "POST", headers: { ...headers, authorization: "Bearer invalid" }, body });
  assert.equal(invalid.status, 401, "an unverified token starts sign-in instead of reaching tools");
  assert.match(invalid.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
  const anonymous = await app.request("/agon/mcp", { method: "POST", headers, body });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/api\.agon\.surf\/\.well-known\/oauth-protected-resource\/agon\/mcp", scope="agon:read"/);

  const valid = await app.request("/agon/mcp", { method: "POST", headers: { ...headers, authorization: "Bearer valid-test-token" }, body });
  assert.equal(valid.status, 200);
  assert.match(await valid.text(), /hire_not_found/);
  assert.deepEqual(seenTokens, ["invalid", "valid-test-token"]);
});

test("returns public listings with explicit unverified payment risk", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/listings");
  assert.equal(response.status, 200);
  const body = (await response.json()) as ListingPage;
  assert.equal(body.items[0]?.verification.status, "Unverified");
  assert.equal(body.items[0]?.risk.unverified, true);
  assert.equal(body.items[0]?.payment.directX402, true);
  assert.equal(body.items[0]?.payment.escrowEligible, false);
});

test("supports stable cursor pagination and category or agent filters", async () => {
  const service = new FakeAgonService();
  const app = testApp(service);
  const response = await app.request("/agon/listings?limit=10&cursor=cursor-1&category=7&agentId=42");
  assert.equal(response.status, 200);
  assert.deepEqual(service.lastQuery, {
    limit: 10,
    cursor: "cursor-1",
    category: "7",
    agentId: "42",
    includeManifest: false,
  });

  await app.request("/agon/listings?includeManifest=1");
  assert.equal(service.lastQuery?.includeManifest, true);

  await app.request("/agon/categories/9/listings");
  assert.equal(service.lastQuery?.category, "9");
  await app.request("/agon/agents/77/listings");
  assert.equal(service.lastQuery?.agentId, "77");
});

test("returns listing detail and a typed not-found response", async () => {
  const app = testApp(new FakeAgonService());
  const found = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}`);
  assert.equal(found.status, 200);
  assert.equal(((await found.json()) as AgonListingView).id, listing.id);

  const missing = await app.request("/agon/listings/missing");
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as { error: { code: string } }).error.code, "not_found");
});

test("requires authentication for profile binding and listing publication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/profiles/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" }),
  });
  assert.equal(response.status, 401);
});

test("validates authenticated write payloads with path-specific issues", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/listings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ chainId: "0", agentId: "x", manifestHash: "bad" }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: { code: string; issues: Array<{ path: string[] }> } };
  assert.equal(body.error.code, "invalid_request");
  assert(body.error.issues.some((issue) => issue.path.join(".") === "chainId"));
  assert(body.error.issues.some((issue) => issue.path.join(".") === "manifestHash"));
});

test("maps owner refusal and unavailable contract capability honestly", async () => {
  const service = new FakeAgonService();
  const app = testApp(service);
  service.bindResult = { ok: false, error: { code: "not_owner", message: "not identity owner" } };
  const refused = await app.request("/agon/profiles/bind", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ chainId: "5042002", agentId: "42", metadataUri: "ipfs://profile" }),
  });
  assert.equal(refused.status, 403);

  service.publishResult = {
    ok: false,
    error: { code: "capability_unavailable", message: "listing writes are unavailable" },
  };
  const unavailable = await app.request("/agon/listings", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({
      chainId: "5042002",
      agentId: "42",
      serviceKey: SERVICE_KEY,
      manifestHash: MANIFEST_HASH,
      manifestUri: "ipfs://manifest-v1",
      category: "1",
      paymentRail: "X402",
    }),
  });
  assert.equal(unavailable.status, 503);
  assert.equal(
    ((await unavailable.json()) as { error: { code: string } }).error.code,
    "capability_unavailable",
  );
});

test("reports granular Agon capabilities and keeps escrow disabled", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/health");
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean; capabilities: AgonCapabilities };
  assert.equal(body.ok, true);
  assert.equal(body.capabilities.listingReads, true);
  assert.equal(body.capabilities.listingWrites, false);
  assert.equal(body.capabilities.escrow, false);
  assert.equal(body.capabilities.jobEscrowCalldataSupported, false);
  assert.equal(body.capabilities.jobEscrowExecution, false);
  assert.equal(body.capabilities.jobEscrowExecutionReason, "job_escrow_not_configured");
  assert.equal(body.capabilities.arenaEvaluatorReadiness.reason, "unconfigured");
  assert.equal(body.capabilities.arenaEvaluatorReadiness.assigned, false);
  assert.equal(body.capabilities.protocolReadiness.ready, false);
  assert.deepEqual(body.capabilities.protocolReadiness.reasons, ["source_verification_incomplete"]);
  assert.deepEqual(body.capabilities.writeReadiness.reasons, ["adapter_unconfigured"]);
  assert.deepEqual(body.capabilities.escrowReadiness.reasons, ["readiness_unconfigured"]);
});

test("keeps deployed AgonJobEscrow inspection authenticated and fail-closed", async () => {
  const app = testApp(new FakeAgonService());
  assert.equal((await app.request("/agon/job-escrow/jobs/1")).status, 401);
  const invalid = await app.request("/agon/job-escrow/jobs/0", { headers: { "x-test-address": ADDRESS } });
  assert.equal(invalid.status, 422);
  const unavailable = await app.request("/agon/job-escrow/jobs/1", { headers: { "x-test-address": ADDRESS } });
  assert.equal(unavailable.status, 503);
});

test("keeps durable AgonJobEscrow intent routes authenticated and capability-gated", async () => {
  const app = testApp(new FakeAgonService());
  assert.equal((await app.request("/agon/job-escrow/intents", { method: "POST", body: "{}" })).status, 401);
  const invalid = await app.request("/agon/job-escrow/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: "bad" }),
  });
  assert.equal(invalid.status, 400);
  const unavailable = await app.request("/agon/job-escrow/intents/00000000-0000-4000-8000-000000000001", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(unavailable.status, 503);
  const submitted = await app.request("/agon/job-escrow/intents/00000000-0000-4000-8000-000000000001/submitted", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ transactionHash: `0x${"11".repeat(32)}` }),
  });
  assert.equal(submitted.status, 503);
});

test("confirms a prepared operation with a validated transaction hash", async () => {
  const app = testApp(new FakeAgonService());
  const txHash = `0x${"77".repeat(32)}`;
  const response = await app.request("/agon/operations/op-1/confirm", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ txHash }),
  });
  assert.equal(response.status, 200);
  const operation = (await response.json()) as SubmittedOperation;
  assert.equal(operation.state, "confirmed");
  assert.equal(operation.txHash, txHash);
});

test("requires authentication and strict validation for Agon escrow preparation", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents", { method: "POST", body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/escrow/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: listing.id, idempotencyKey: "short", amountBaseUnits: "0", feeBps: 1001, expiresAt: "not-a-date" }),
  });
  assert.equal(invalid.status, 400);
});

test("prepares and reads an escrow intent without enabling execution", async () => {
  const app = testApp(new FakeAgonService());
  const prepared = await app.request("/agon/escrow/intents", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: listing.id, idempotencyKey: "escrow-route-001", amountBaseUnits: "1000000", expiresAt: "2026-08-23T12:00:00.000Z" }),
  });
  assert.equal(prepared.status, 201);
  const body = (await prepared.json()) as AgonEscrowIntentView;
  assert.equal(body.state, "prepared");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "escrow_adapter_not_enabled");

  const readiness = await app.request(`/agon/escrow/intents/${body.intentId}/readiness`, { headers: { "x-test-address": ADDRESS } });
  assert.equal(readiness.status, 200);
  assert.equal(((await readiness.json()) as AgonEscrowReadinessView).status, "adapter_disabled");
});

test("requires authentication and exact confirmation for escrow lifecycle routes", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/fund", {
    method: "POST",
    body: JSON.stringify({ confirmation: "FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(unauthenticated.status, 401);

  const invalid = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/fund", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(((await invalid.json()) as { error: { code: string } }).error.code, "invalid_request");
});

test("disabled escrow lifecycle routes fail closed before an adapter exists", async () => {
  const app = testApp(new FakeAgonService());
  for (const action of ["fund", "release", "refund"] as const) {
    const confirmation = `${action.toUpperCase()}_ARC_TESTNET_ESCROW`;
    const response = await app.request(`/agon/escrow/intents/00000000-0000-4000-8000-000000000001/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-address": ADDRESS },
      body: JSON.stringify({ confirmation }),
    });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, "escrow_disabled");
  }
});

test("escrow transaction approval routes require auth and fail closed without service wiring", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "approval-route-001", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "short", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(invalid.status, 400);
  const disabled = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ operation: "fund", approvalIdempotencyKey: "approval-route-001", confirmation: "APPROVE_FUND_ARC_TESTNET_ESCROW" }),
  });
  assert.equal(disabled.status, 409);
  assert.equal(((await disabled.json()) as { error: { code: string } }).error.code, "execution_not_ready");
  const readiness = await app.request("/agon/escrow/intents/00000000-0000-4000-8000-000000000001/transaction-approval", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(readiness.status, 409);
});

test("requires authentication before preparing an x402 call intent", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}/call-intents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "review-001", method: "POST", input: {}, maxAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 401);
});

test("returns a durable execution-disabled x402 intent after auth", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request(`/agon/listings/${encodeURIComponent(listing.id)}/call-intents`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ idempotencyKey: "review-001", method: "POST", input: { prompt: "audit" }, maxAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 201);
  const body = (await response.json()) as X402CallIntentView;
  assert.equal(body.state, "prepared");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("requires authentication before approving an x402 spend", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/approve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approvedAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 401);
});

test("returns an execution-disabled approval after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/approve", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ approvedAmountUSDC: "0.01" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ApprovalView;
  assert.equal(body.state, "approved");
  assert.equal(body.approvedAmountUSDC, "0.01");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "payment_adapter_not_enabled");
});

test("requires authentication before capturing a provider payment quote", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/payment-required", { method: "POST" });
  assert.equal(response.status, 401);
});

test("returns a non-spending HTTP 402 quote after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/payment-required", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402QuoteView;
  assert.equal(body.status, 402);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "authorization_not_enabled");
});

test("returns a reviewable unsigned authorization payload after authentication", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402AuthorizationView;
  assert.equal(body.state, "authorization_ready");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "user_signature_required");
});

test("requires authentication before accepting an authorization signature", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization/signature", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payloadHash: `0x${"99".repeat(32)}`, signature: `0x${"11".repeat(65)}` }),
  });
  assert.equal(response.status, 401);
});

test("records a validated signature handoff without enabling settlement", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/authorization/signature", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ payloadHash: `0x${"99".repeat(32)}`, signature: `0x${"11".repeat(65)}` }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402AuthorizationSubmittedView;
  assert.equal(body.state, "authorization_submitted");
  assert.equal(body.signatureAccepted, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "settlement_not_enabled");
});

test("returns a testnet-only redacted execution plan after signature handoff", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-plan", {
    method: "POST",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionPlanView;
  assert.equal(body.plan.testnetOnly, true);
  assert.equal(body.plan.requirements.network, "eip155:5042002");
  assert.equal(body.plan.paymentPayloadPreview.payload.signature, null);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "explicit_execution_approval");
});

test("records explicit execution approval without enabling settlement", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-approval", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ planHash: `0x${"cd".repeat(32)}`, approvalIdempotencyKey: "approval-001", confirmation: "APPROVE_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionApprovalView;
  assert.equal(body.testnetOnly, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("returns disabled execution readiness without calling Circle", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/execution-readiness", {
    method: "GET",
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ExecutionReadinessView;
  assert.equal(body.status, "approval_required");
  assert.equal(body.approval, null);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "explicit_execution_approval");
});

test("returns authenticated settlement readiness without enabling Circle", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settlement-readiness", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402SettlementReadinessView;
  assert.equal(body.state, "authorization_submitted");
  assert.equal(body.network, "eip155:5042002");
  assert.equal(body.settlementRef, null);
  assert.equal(body.status, "ready_but_disabled");
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "execution_adapter_not_enabled");
});

test("keeps settlement submission behind authentication, strict signature validation, and the kill switch", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: "0x12", confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(invalid.status, 400);
  const disabled = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/settle", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "EXECUTE_ARC_TESTNET_X402" }),
  });
  assert.equal(disabled.status, 409);
  const body = await disabled.json() as { error: { code: string } };
  assert.equal(body.error.code, "execution_not_ready");
});

test("returns authenticated reconciliation readiness without enabling a provider lookup", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconciliation-readiness", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402ReconciliationReadinessView;
  assert.equal(body.status, "lookup_disabled");
  assert.equal(body.network, "eip155:5042002");
  assert.equal(body.lookupEnabled, false);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "enable_receipt_lookup");
});

test("keeps reconciliation mutation behind authentication and explicit confirmation", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "RECONCILE_ARC_TESTNET_X402" }),
  });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "RECONCILE" }),
  });
  assert.equal(invalid.status, 400);
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ confirmation: "RECONCILE_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { executionEnabled: boolean; nextAction: string };
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "deliver_service");
});

test("recovery probe requires auth, one reference, and never reports automatic finality", async () => {
  const service = new FakeAgonService();
  let observedActor = "";
  let calls = 0;
  service.probeX402RecoveryCandidate = async (actor, intentId, request) => {
    observedActor = actor;
    calls += 1;
    return {
      ok: true,
      value: {
        receiptId: "00000000-0000-4000-8000-000000000002",
        intentId,
        state: "settlement_submitted" as const,
        network: "eip155:5042002" as const,
        status: "confirmed" as const,
        transaction: request.transaction ?? null,
        providerTransferId: request.providerTransferId ?? null,
        payer: ADDRESS as `0x${string}`,
        recipient: ADDRESS as `0x${string}`,
        amountAtomicUnits: "1000",
        correlation: "terms_only" as const,
        mayAutoFinalize: false as const,
        nextAction: "operator_review" as const,
        checkedAt: new Date().toISOString(),
      },
    };
  };
  const app = testApp(service);
  const url = "/agon/call-intents/00000000-0000-4000-8000-000000000001/recovery-probe";
  const candidate = { providerTransferId: "11111111-1111-4111-8111-111111111111" };
  assert.equal((await app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(candidate) })).status, 401);
  assert.equal((await app.request(url, { method: "POST", headers: { "content-type": "application/json", "x-test-address": ADDRESS }, body: JSON.stringify({}) })).status, 400);
  assert.equal((await app.request(url, { method: "POST", headers: { "content-type": "application/json", "x-test-address": ADDRESS }, body: JSON.stringify({ ...candidate, transaction: `0x${"12".repeat(32)}` }) })).status, 400);
  assert.equal(calls, 0);
  const response = await app.request(url, { method: "POST", headers: { "content-type": "application/json", "x-test-address": ADDRESS }, body: JSON.stringify(candidate) });
  assert.equal(response.status, 200);
  assert.equal(observedActor, ADDRESS);
  const body = await response.json() as { correlation: string; mayAutoFinalize: boolean; nextAction: string };
  assert.equal(body.correlation, "terms_only");
  assert.equal(body.mayAutoFinalize, false);
  assert.equal(body.nextAction, "operator_review");
});

test("keeps machine-to-machine agent spends owner-scoped and explicitly confirmed", async () => {
  const service = new FakeAgonService();
  const app = testApp(service);
  const payload = {
    listingReference: listing.id,
    recipient: ADDRESS,
    amountBaseUnits: "1000",
    idempotencyKey: "agent-spend-001",
    confirmation: "EXECUTE_ARC_TESTNET_AGENT_X402",
  };
  assert.equal((await app.request("/agon/agent-spends", { method: "POST", body: JSON.stringify(payload) })).status, 401);
  const invalid = await app.request("/agon/agent-spends", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ ...payload, confirmation: "EXECUTE" }),
  });
  assert.equal(invalid.status, 400);
  const disabled = await app.request("/agon/agent-spends", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify(payload),
  });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json() as { error: { code: string } }).error.code, "wallet_disabled");

  let observedActor = "";
  (service as FakeAgonService & { executeX402AgentSpend: Function }).executeX402AgentSpend = async (actor, request) => {
    observedActor = actor;
    return {
      ok: true,
      value: {
        agentId: "42",
        listingReference: request.listingReference,
        idempotencyKey: request.idempotencyKey,
        state: "submitted",
        providerTransferId: "transfer-1",
        transaction: null,
        executionEnabled: true,
        nextAction: "reconcile_wallet",
        recordedAt: new Date().toISOString(),
      },
    };
  };
  const submitted = await app.request("/agon/agent-spends", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify(payload),
  });
  assert.equal(submitted.status, 200);
  assert.equal(observedActor, ADDRESS);
  assert.equal((await submitted.json() as { nextAction: string }).nextAction, "reconcile_wallet");
});

test("requires authentication before facilitator verification", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "VERIFY_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 401);
});

test("returns durable facilitator verification evidence and never settlement permission", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ signature: `0x${"11".repeat(65)}`, confirmation: "VERIFY_ARC_TESTNET_X402" }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402FacilitatorVerificationView;
  assert.equal(body.state, "facilitator_verified");
  assert.equal(body.verified, true);
  assert.equal(body.executionEnabled, false);
  assert.equal(body.nextAction, "settlement_remains_disabled");
  assert.match(body.evidenceHash, /^0x[0-9a-f]{64}$/);
});

test("reads facilitator verification evidence through the authenticated owner path", async () => {
  const app = testApp(new FakeAgonService());
  const response = await app.request("/agon/call-intents/00000000-0000-4000-8000-000000000001/facilitator-verification", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as X402FacilitatorVerificationView;
  assert.equal(body.state, "facilitator_verified");
  assert.match(body.evidenceHash, /^0x[0-9a-f]{64}$/);
});

test("persists a public playground sample and bounds its payload", async () => {
  const app = testApp(new FakeAgonService(), true);
  const response = await app.request("/agon/playground/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "development", taskId: "selector-guard", input: { to: ADDRESS, data: "0xa9059cbb" } }),
  });
  assert.equal(response.status, 201);
  const body = await response.json() as { runId: string; evidence: { evidenceRoot: string } };
  assert.match(body.runId, /^[0-9a-f-]{36}$/i);
  assert.match(body.evidence.evidenceRoot, /^0x[0-9a-f]{64}$/);

  const oversized = await app.request("/agon/playground/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "development", taskId: "selector-guard", input: { value: "x".repeat(16 * 1024) } }),
  });
  assert.equal(oversized.status, 400);
  assert.equal((await oversized.json() as { error: { code: string } }).error.code, "input_too_large");
});

test("authenticated evaluation binds the exact listing version and replays idempotently", async () => {
  const app = testApp(new FakeAgonService(), true);
  const unauthenticated = await app.request("/agon/playground/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "research", taskId: "arc-live-fact", listingReference: listing.id, listingVersion: listing.version, idempotencyKey: "evaluation-route-1" }),
  });
  assert.equal(unauthenticated.status, 401);

  const invalidScope = await app.request("/agon/playground/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ category: "research", taskId: "arc-live-fact", listingReference: listing.id, listingVersion: "999", idempotencyKey: "evaluation-route-2" }),
  });
  assert.equal(invalidScope.status, 422);

  const payload = { category: "research", taskId: "arc-live-fact", listingReference: listing.id, listingVersion: listing.version, idempotencyKey: "evaluation-route-3" };
  const first = await app.request("/agon/playground/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 201);
  const firstBody = await first.json() as { runId: string; scope: { listingReference: string; listingVersion: string } };
  assert.equal(firstBody.scope.listingReference, listing.id);
  assert.equal(firstBody.scope.listingVersion, listing.version);

  const retry = await app.request("/agon/playground/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify(payload),
  });
  assert.equal(retry.status, 200);
  const retryBody = await retry.json() as { runId: string; replayed: boolean };
  assert.equal(retryBody.runId, firstBody.runId);
  assert.equal(retryBody.replayed, true);

  const conflict = await app.request("/agon/playground/evaluate", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ ...payload, input: { to: "0x0000000000000000000000000000000000000009" } }),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json() as { error: { code: string } }).error.code, "idempotency_conflict");
});

test("Arena evidence routes require authentication and fail closed without service wiring", async () => {
  const app = testApp(new FakeAgonService());
  const unauthenticated = await app.request("/agon/arena/evaluations", { method: "POST", body: "{}" });
  assert.equal(unauthenticated.status, 401);
  const invalid = await app.request("/agon/arena/evaluations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ listingReference: listing.id }),
  });
  assert.equal(invalid.status, 400);
  const unavailable = await app.request("/agon/arena/evaluations/00000000-0000-4000-8000-000000000001", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(unavailable.status, 503);
  const transaction = await app.request("/agon/arena/evaluations/00000000-0000-4000-8000-000000000001/request-transaction", {
    headers: { "x-test-address": ADDRESS },
  });
  assert.equal(transaction.status, 503);
  const reconcile = await app.request("/agon/arena/evaluations/00000000-0000-4000-8000-000000000001/reconcile", { method: "POST", headers: { "x-test-address": ADDRESS } });
  assert.equal(reconcile.status, 503);
});

test("syndicate and prize intent routes require authentication and fail closed without service wiring", async () => {
  const app = testApp(new FakeAgonService());
  const hash = `0x${"11".repeat(32)}`;
  assert.equal((await app.request("/agon/syndicates/contributions", { method: "POST", body: "{}" })).status, 401);
  const invalidContribution = await app.request("/agon/syndicates/contributions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ idempotencyKey: "syndicate-route-001", syndicateId: "7", agentId: "42", contributionKey: "0x00", score: "1", evidenceHash: hash }),
  });
  assert.equal(invalidContribution.status, 400);
  const unavailableContribution = await app.request("/agon/syndicates/contributions/00000000-0000-4000-8000-000000000001", { headers: { "x-test-address": ADDRESS } });
  assert.equal(unavailableContribution.status, 503);
  assert.equal((await app.request("/agon/syndicates/contributions/00000000-0000-4000-8000-000000000001/reconcile", { method: "POST", headers: { "x-test-address": ADDRESS } })).status, 503);

  assert.equal((await app.request("/agon/prize-claims", { method: "POST", body: "{}" })).status, 401);
  const invalidClaim = await app.request("/agon/prize-claims", {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-address": ADDRESS },
    body: JSON.stringify({ idempotencyKey: "prize-route-001", poolKey: hash, index: "0", beneficiary: ADDRESS, amount: "1", proof: ["0x00"] }),
  });
  assert.equal(invalidClaim.status, 400);
  const unavailableClaim = await app.request("/agon/prize-claims/00000000-0000-4000-8000-000000000001/transaction", { headers: { "x-test-address": ADDRESS } });
  assert.equal(unavailableClaim.status, 503);
  assert.equal((await app.request("/agon/prize-claims/00000000-0000-4000-8000-000000000001/reconcile", { method: "POST", headers: { "x-test-address": ADDRESS } })).status, 503);
});

test("public manifest inspection is rate limited per network address", async () => {
  const app = testApp(new FakeAgonService(), true);
  let last = 0;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    const response = await app.request("/agon/manifests/inspect?uri=not-a-url", { headers: { "x-forwarded-for": "203.0.113.50" } });
    last = response.status;
  }
  assert.equal(last, 429);
  const other = await app.request("/agon/manifests/inspect?uri=not-a-url", { headers: { "x-forwarded-for": "203.0.113.51" } });
  assert.notEqual(other.status, 429);
});
