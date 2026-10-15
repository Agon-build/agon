import "dotenv/config";
import { serve } from "@hono/node-server";

import { startArcX402Seller } from "../nanopayments/arcSeller.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, setCookie } from "hono/cookie";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { z } from "zod";
import { createSupportRoutes } from "../support/routes.js";
import { secretMatches } from "../support/security.js";

import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config/index.js";
import { withActiveAgonContracts } from "../config/deployments.ts";
import { publicClient, arcTestnet } from "../chain/arc.js";
import { usdcMinimalAbi } from "../chain/abi.js";
import { pool, query } from "../db/pool.js";
import { PostgresAgonRepository } from "../agon/store/repository.js";
import { createAgonRoutes } from "../agon/http/routes.js";
import { startSeasonRuntime } from "../agon/playground/seasons/runtime.ts";
import { startPaymentsRuntime } from "../agon/payments/runtime.ts";
import { PostgresChannelStore } from "../agon/channels/store.ts";
import { createApprovalRoutes } from "../agon/stage/approval-routes.ts";
import { createAppRoutes } from "../agon/stage/app-routes.ts";
import { createLeaderboardReader } from "../agon/stage/leaderboard.ts";
import { createRateLimiter } from "../agon/stage/rate-limit.ts";
import { createStageServices, type StageServices } from "../agon/stage/services.ts";
import { resolveStageSettings } from "../agon/stage/settings.ts";
import { classifyIntent } from "../agon/channels/chat/intents.ts";
import { createTelegramChannel } from "../agon/channels/telegram/channel.ts";
import { callModel } from "../runners/llm/client.js";
import { formatUsdc } from "../agon/payments/bargain.ts";
import { checkStage, startStageMonitor } from "../agon/stage/monitor.ts";
import { PostgresMonitorStore } from "../agon/stage/monitor-store.ts";
import { createErc8004EntryVerifier, createSeasonRoutes } from "../agon/playground/seasons/routes.ts";
import { createPublicClient as createSeasonClient, fallback as seasonFallback } from "viem";
import { createCircleTestnetFacilitatorClient, createX402ExecutionPolicy, createX402FacilitatorAdapter } from "../agon/execution/x402-settlement.js";
import { createX402ProviderExecutionAdapter } from "../agon/execution/x402-provider-execution.js";
import { createAgonTestnetReceiptLookupAdapter } from "../agon/execution/x402-reconciliation.js";
import { createCircleX402AgentSpendExecutor } from "../agon/execution/x402-agent-executor.ts";
import { PostgresX402AgentWalletPolicyStore } from "../agon/store/x402-agent-policy.ts";
import { createViemAgonPrizeEscrowReadAdapter, type AgonPrizeEscrowReadClient } from "../agon/execution/escrow-reconciliation.js";
import { evaluateAgonEscrowProductionReadiness } from "../agon/execution/escrow-production-readiness.js";
import { AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES } from "../agon/execution/escrow-transaction-approval.js";
import { parseFirstPartyAgents } from "../agon/first-party.js";
import { createListingChecker } from "../agon/listing/checker.js";
import { PostgresListingCheckStore } from "../agon/listing/check-store.js";
import { defaultListingCheckDeps, runListingChecks } from "../agon/listing/endpoint-check.js";
import { agonNetwork } from "../agon/network.js";
import { createBuilderRoutes } from "../agon/builder-routes.js";
import { PostgresAccessTokenStore, createMcpTokenVerifier } from "../agon/access-tokens.js";
import { PostgresAgonMarketService } from "../agon/http/service.js";
import { createPostgresProviderDraftStore } from "../agon/mcp/provider-draft-store.ts";
import { createMcpAccessAdapter } from "../agon/mcp/adapter.ts";
import { createManagedPublisher } from "../agon/mcp/managed-publisher.ts";
import { createPostgresManagedPublisherStore } from "../agon/mcp/managed-publisher-store.ts";
import { createPostgresMcpHireStore } from "../agon/mcp/hire-store.ts";
import { createPostgresHostedManifestStore } from "../agon/hosted-manifest-store.ts";
import { inspectAgonProtocolReadiness } from "../agon/protocol-readiness.ts";
import {
  createViemAgonJobEscrowReadAdapter,
  type AgonJobEscrowContractVersion,
  type AgonJobEscrowReadClient,
} from "../agon/execution/agon-job-escrow.ts";
import { createViemAgonJobEscrowTransactionWriter } from "../agon/execution/agon-job-escrow-writer.ts";
import { createAgonJobEscrowTransactionAdapter } from "../agon/execution/agon-job-escrow-adapter.ts";
import { createViemAgonProtocolFinalityReader, type AgonProtocolFinalityClient } from "../agon/execution/protocol-finality.ts";
import { readAgonArenaEvaluatorReadiness, type AgonArenaRoleReadClient } from "../agon/execution/arena-readiness.ts";
import { createViemAgonArenaEvaluator, type AgonArenaEvaluatorClient, type AgonArenaEvaluatorWallet } from "../agon/execution/arena-evaluator.ts";
import {
  createViemAgonListingVerifier,
  readAgonListingVerifierReadiness,
  type AgonListingVerifierReadClient,
  type AgonListingVerifierWallet,
} from "../agon/execution/listing-verifier.ts";
import { authorizeArenaCircleExecution } from "../agon/execution/arena-circle-auth.ts";
import { PostgresPlaygroundRunStore, RedisPlaygroundRateLimiter } from "../agon/playground-store.ts";
import { createHttpPlaygroundProviderRunner } from "../agon/playground-provider.ts";
import {
  createManifestDerivedAgonEndpointQaRunner,
  createManifestDerivedPlaygroundProviderRunner,
} from "../agon/manifest-derived-provider.ts";
import { agonCertificationWorkerLoop } from "../agon/certification-worker.ts";
import { alertAgonCertificationOperator } from "../agon/execution/certification-alerts.ts";
import { alertAgonArenaOperator } from "../agon/execution/arena-review-alerts.ts";
import {
  PostgresAgonOperationsAlertRepository,
  agonOperationsAlertWorkerLoop,
  createTelegramAlertSender,
} from "../agon/operations-alerts.ts";
import { isAgonCertificationSchemaReady } from "../agon/certification-readiness.ts";
import { PostgresAgonOperationStore } from "../agon/write/repository.js";
import { CachedAgonReadiness } from "../agon/write/readiness.js";
import { ViemAgonWriteAdapter } from "../agon/write/adapter.js";
import { logEvent } from "../events.js";
import { notify } from "../notifications/index.js";
import { setTierGate, getTierGate, type GateSurface } from "../lib/tierGate.js";
import { merkleProof, merkleRoot, payoutLeaf } from "../coordinator/merkle.js";
import { redis } from "../redis.js";
import { issueToken, requestClaims, requireAgonScope, requireAuth, SESSION_COOKIE, verifyTokenClaims } from "./jwt.js";
import { authorizeWalletExecute, createWalletExecutePolicy } from "./wallet-execute-policy.ts";
import { walletPrincipalForOperator } from "./wallet-principal.js";
import { walletPrincipalForLinkedCircleWallet } from "./wallet-principal.js";
import { getWalletPrincipal, listWalletPrincipals, linkCircleUserControlledWallet } from "./wallet-principal-repository.js";
import { createCircleUserControlledService } from "./circle-user-controlled.js";
import { CLI_USER_CODE_RE, formatCliUserCode, hashCliCode, randomCliCode } from "./cli-device.js";
import { createAgonAuthMiddleware } from "../agon/http/admin-auth.js";
import { createAgonPrincipalMiddleware } from "../agon/http/principal-auth.js";
import { checkEntry } from "./entryGuard.js";
import {
  DAILY_POOL_MAX,
  MYSTERY_ODDS,
  nextResetMs,
  rollMystery,
  RUG_CHANCE,
  sameUtcDay,
  TRAITS,
  traitById,
  type Trait,
} from "./traits.js";
import {
  STATS,
  MAX_STAT_LEVEL,
  cyclesCost,
  maxSpeedupSteps,
  secondsCost,
  speedupParams,
  flushTrainingQueue,
  type Stat,
} from "../coordinator/training.js";
import {
  circleDevConfigured,
  createPublisherWallet,
  executePublisherCall,
  createUserWallet,
  seedTestnetUsdc,
  executeContractCall,
  getTxState,
  createWalletOnChain,
  walletUsdcBalance,
  dcwBlockchainFor,
} from "../chain/circleDev.js";
import {
  listCredentialsForEmail,
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
} from "./webauthn.js";
import {
  consumeEmailVerification,
  isEmailVerified,
  OtpError,
  startEmailOtp,
  verifyEmailOtp,
} from "../lib/emailOtp.js";
import {
  MAX_EQUIPPED,
  validateLoadout,
  setLoadout,
  getLoadout,
  ownedTraitPool,
  TRAIT_CATALOGUE,
  liveEntryCount,
  liveEntryCountForSurface,
  hasAgentInEvent,
} from "./loadouts.js";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days, matches issueToken expiry

/// Auth service: SIWE wallet login plus optional X (Twitter) OAuth2 linking.
/// The wallet is the identity, so X is not required to enter contests; it is a
/// social link, and Discord can be added the same way later.

const app = new Hono<{ Variables: { address: string } }>();

const circleUserControlled = createCircleUserControlledService({
  enabled: config.circle.userControlled.enabled,
  apiKey: config.circle.apiKey,
  baseUrl: config.circle.userControlled.apiBaseUrl,
  blockchain: config.circle.userControlled.blockchain,
});

const allowedBrowserOrigins = new Set([
  config.auth.appUrl,
  "https://agon.surf",
  "https://www.agon.surf",
  "https://arcrun.xyz",
  "https://www.arcrun.xyz",
  "http://localhost:3000",
  "http://localhost:3003",
]);

// Allow the frontend origin to call the auth API from the browser. Credentials
// are on so the httpOnly session cookie is sent on cross-origin fetches from
// the Next.js app to this service.
app.use(
  "*",
  cors({
    origin: (origin) => (allowedBrowserOrigins.has(origin) ? origin : null),
    credentials: true,
    // x-admin-token is the custom header the /admin console sends. Without it
    // in allowHeaders the browser's CORS preflight rejects the request and the
    // console shows "Failed to fetch".
    allowHeaders: ["Content-Type", "Authorization", "x-admin-token", "x-agon-actor", "x-agon-principal", "x-support-ticket-token"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

const NONCE_TTL = 300; // seconds
const STATE_TTL = 600;
const CLI_DEVICE_TTL = 10 * 60;
const CLI_SCOPES = ["agon:read", "listing:prepare", "listing:write", "listing:confirm", "wallet:execute", "playground:run", "arena:prepare"] as const;
// A device request that names no scopes gets read access only. Tools that
// need more (the ASP CLI, MCP clients) request each scope explicitly, and the
// approval page shows the user exactly what they grant.
const DEFAULT_CLI_SCOPES = ["agon:read"] as const;
const cliDeviceRequestSchema = z.object({
  clientName: z.string().trim().min(1).max(80).default("agon-cli"),
  scopes: z.array(z.enum(CLI_SCOPES)).min(1).max(CLI_SCOPES.length).default([...DEFAULT_CLI_SCOPES]),
});
const b64url = (b: Buffer) => b.toString("base64url");


app.get("/health", (c) => c.json({ ok: true, service: "auth" }));

// ----- CLI device authorization -----
//
// The CLI is an authenticated Agon client, not a wallet-key transport. It
// requests a short-lived device code, the user approves that code in the
// already-authenticated browser, and the CLI exchanges it for a bearer token.
// The device table stores only hashes, so a database read cannot reconstruct
// an active code. This flow never signs or broadcasts a blockchain transaction.

app.post("/auth/cli/device", async (c) => {
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    // An empty body is valid and uses the stable default client name.
  }
  const parsed = cliDeviceRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid CLI device request" }, 400);

  const deviceCode = randomCliCode(32);
  const userCode = formatCliUserCode(randomCliCode(8));
  const expiresAt = new Date(Date.now() + CLI_DEVICE_TTL * 1000);
  await query(
    `insert into agon_cli_device_sessions
       (device_code_hash, user_code_hash, client_name, scopes, status, requested_at, expires_at)
     values ($1, $2, $3, $4, 'pending', now(), $5)`,
    [hashCliCode(deviceCode), hashCliCode(userCode), parsed.data.clientName, parsed.data.scopes, expiresAt],
  );

  const verificationUri = new URL("/cli/authorize", config.auth.appUrl);
  verificationUri.searchParams.set("user_code", userCode);
  return c.json({
    deviceCode,
    userCode,
    verificationUri: verificationUri.toString(),
    expiresAt: expiresAt.toISOString(),
    pollInterval: 5,
  });
});

app.get("/auth/cli/device", async (c) => {
  const userCode = (c.req.query("user_code") ?? "").trim().toUpperCase();
  if (!CLI_USER_CODE_RE.test(userCode)) {
    return c.json({ error: "valid user code required" }, 400);
  }
  const { rows } = await query<{
    client_name: string;
    scopes: string[];
    status: "pending" | "approved" | "consumed" | "expired";
    expires_at: string;
  }>(
    `select client_name, scopes, status, expires_at
       from agon_cli_device_sessions
      where user_code_hash = $1
      limit 1`,
    [hashCliCode(userCode)],
  );
  const session = rows[0];
  if (!session) return c.json({ error: "device request not found" }, 404);
  if (new Date(session.expires_at).getTime() <= Date.now() && session.status === "pending") {
    return c.json({ clientName: session.client_name, scopes: session.scopes, status: "expired", expiresAt: session.expires_at });
  }
  return c.json({
    clientName: session.client_name,
    scopes: session.scopes,
    status: session.status,
    expiresAt: session.expires_at,
  });
});

app.post("/auth/cli/device/approve", requireAuth, async (c) => {
  let body: { userCode?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const userCode = typeof body.userCode === "string" ? body.userCode.trim().toUpperCase() : "";
  if (!CLI_USER_CODE_RE.test(userCode)) {
    return c.json({ error: "valid user code required" }, 400);
  }

  const { rows } = await query<{
    client_name: string;
    scopes: string[];
    expires_at: string;
  }>(
    `update agon_cli_device_sessions
        set status = 'approved', approved_by = $2, approved_at = now()
      where user_code_hash = $1
        and status = 'pending'
        and expires_at > now()
      returning client_name, scopes, expires_at`,
    [hashCliCode(userCode), c.get("address")],
  );
  const approved = rows[0];
  if (!approved) return c.json({ error: "device request is missing, expired, or already approved" }, 409);
  void logEvent({
    kind: "cli_device_approved",
    address: c.get("address"),
    context: { clientName: approved.client_name },
    source: "auth",
  });
  return c.json({ ok: true, clientName: approved.client_name, scopes: approved.scopes, expiresAt: approved.expires_at });
});

app.post("/auth/cli/device/token", async (c) => {
  let body: { deviceCode?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const deviceCode = typeof body.deviceCode === "string" ? body.deviceCode.trim() : "";
  if (deviceCode.length < 32 || deviceCode.length > 128) {
    return c.json({ error: "valid device code required" }, 400);
  }

  const { rows } = await query<{
    status: "pending" | "approved" | "consumed" | "expired";
    approved_by: string | null;
    scopes: string[];
    expires_at: string;
  }>(
    `select status, approved_by, scopes, expires_at
       from agon_cli_device_sessions
      where device_code_hash = $1
      limit 1`,
    [hashCliCode(deviceCode)],
  );
  const session = rows[0];
  if (!session) return c.json({ error: "device request not found" }, 404);
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await query(
      `update agon_cli_device_sessions set status = 'expired'
        where device_code_hash = $1 and status = 'pending'`,
      [hashCliCode(deviceCode)],
    );
    return c.json({ error: "expired_token" }, 410);
  }
  if (session.status === "pending") return c.json({ error: "authorization_pending" }, 428);
  if (session.status !== "approved" || !session.approved_by) {
    return c.json({ error: "device request is not available" }, 409);
  }

  const claimed = await query<{ approved_by: string }>(
    `update agon_cli_device_sessions
        set status = 'consumed', consumed_at = now()
      where device_code_hash = $1 and status = 'approved'
      returning approved_by`,
    [hashCliCode(deviceCode)],
  );
  const owner = claimed.rows[0]?.approved_by;
  if (!owner) return c.json({ error: "device request was already consumed" }, 409);
  const token = await issueToken(owner, { client: "agon-cli", scopes: session.scopes });
  void logEvent({ kind: "cli_device_token_issued", address: owner, context: { scopes: session.scopes }, source: "auth" });
  return c.json({ accessToken: token, tokenType: "Bearer", expiresIn: SESSION_MAX_AGE });
});

const agonRepository = new PostgresAgonRepository(pool);
const agonOperationsAlerts = new PostgresAgonOperationsAlertRepository(pool);
const agonProviderDraftStore = createPostgresProviderDraftStore(pool);
const agonAccessTokens = new PostgresAccessTokenStore(pool);
// One live checker for the web flow and the MCP tools (Plan 3e). Publishing needs a recent pass.
const agonListingChecker = createListingChecker({
  store: new PostgresListingCheckStore(pool),
  run: (draft) => runListingChecks({
    endpoint: draft.endpoint, priceUSDC: draft.priceUSDC, category: draft.category,
    deps: defaultListingCheckDeps(agonNetwork(config.chainId === 5042002 ? "arc-testnet" : "arc")),
  }),
});
const agonChecksPassed = async (actor: string, draftId: string) => {
  const stored = await agonProviderDraftStore.get(actor, draftId);
  return stored ? agonListingChecker.hasRecentPass(actor, stored.draft) : false;
};
const agonMcpHireStore = createPostgresMcpHireStore(pool);
const agonOperations = new PostgresAgonOperationStore(pool);
const agonActiveDeployment = config.agon.deployment
  ? withActiveAgonContracts(config.agon.deployment)
  : null;
const agonHostedManifestStore = config.agon.publicApiUrl && agonActiveDeployment
  ? createPostgresHostedManifestStore(pool, {
      publicApiUrl: config.agon.publicApiUrl,
      isAgentOwner: async (actor, agentId) => {
        const owner = await publicClient.readContract({
          address: agonActiveDeployment.external.IdentityRegistry.address,
          abi: parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]),
          functionName: "ownerOf",
          args: [BigInt(agentId)],
        });
        return owner.toLowerCase() === actor.toLowerCase();
      },
    })
  : undefined;
const agonReadiness = new CachedAgonReadiness(
  {
    enabled: config.agon.writesEnabled,
    configuredChainId: config.chainId,
    deployment: agonActiveDeployment,
    client: publicClient,
  },
  config.agon.readinessCacheMs,
);
const agonWriter = agonActiveDeployment
  ? new ViemAgonWriteAdapter({
      deployment: agonActiveDeployment,
      client: publicClient,
      readiness: agonReadiness,
      operations: agonOperations,
      listingAnchors: agonRepository,
    })
  : undefined;
const x402ExecutionPolicy = createX402ExecutionPolicy({
  enabled: config.agon.x402.executionEnabled && config.agon.x402.allowedRecipients.length > 0,
  maxAmountBaseUnits: config.agon.x402.maxAmountBaseUnits,
  allowedRecipients: config.agon.x402.allowedRecipients,
});
const x402VerificationPolicy = createX402ExecutionPolicy({
  enabled: config.agon.x402.verificationEnabled && config.agon.x402.allowedRecipients.length > 0,
  maxAmountBaseUnits: config.agon.x402.maxAmountBaseUnits,
  allowedRecipients: config.agon.x402.allowedRecipients,
});
const x402FacilitatorClient = config.agon.x402.verificationEnabled
  ? createCircleTestnetFacilitatorClient()
  : undefined;
const x402SettlementAdapter = createX402ProviderExecutionAdapter({
  enabled: config.agon.x402.executionEnabled,
  policy: x402ExecutionPolicy,
});
const agonEscrowReadAdapter = createViemAgonPrizeEscrowReadAdapter({
  enabled: config.agon.escrow.reconciliationEnabled,
  escrowAddress: config.contracts.PrizeEscrow,
  client: publicClient as unknown as AgonPrizeEscrowReadClient,
});
const x402FacilitatorVerifier = createX402FacilitatorAdapter({
  enabled: config.agon.x402.verificationEnabled,
  policy: x402VerificationPolicy,
  client: x402FacilitatorClient,
});
const x402AgentPolicyStore = new PostgresX402AgentWalletPolicyStore(pool);
const x402AgentSpendExecutor = createCircleX402AgentSpendExecutor(x402AgentPolicyStore, {
  enabled: config.agon.x402.executionEnabled && config.agon.x402.agentPolicy.enabled,
});
const agonEscrowProductionReadiness = () => evaluateAgonEscrowProductionReadiness({
  chainId: config.chainId,
  network: config.agon.escrow.network,
  asset: config.agon.escrow.asset,
  deployment: config.agon.deployment,
  // PrizeEscrow is deployed by the platform receipt, while the Agon
  // registries live in the separate canonical Agon receipt.
  prizeEscrowAddress: config.contracts.PrizeEscrow,
  controller: config.agon.escrow.controllerAddress,
  signerAddress: config.coordinator.address,
  controllerPolicyConfigured: config.agon.escrow.controllerAddress !== undefined,
  flags: {
    writesEnabled: config.agon.writesEnabled,
    escrowEnabled: config.agon.escrow.enabled,
    executionEnabled: config.agon.escrow.executionEnabled,
    preflightEnabled: false,
    writerEnabled: false,
    lifecycleAdapterEnabled: false,
    reconciliationEnabled: config.agon.escrow.reconciliationEnabled,
  },
  approvalRequired: true,
  approvalPhrases: AGON_ESCROW_TRANSACTION_APPROVAL_PHRASES,
  exactTransactionPlanBound: false,
  signerAvailable: config.coordinator.address !== null,
  providerFinalityConfigured: false,
});
const agonPlaygroundStore = new PostgresPlaygroundRunStore(pool);
const agonPlaygroundProviderRunner = createHttpPlaygroundProviderRunner(config.agon.playground.providerEndpoints);
// Certification discovers each provider endpoint from its immutable manifest.
// The environment maps remain available only as a compatibility override for
// older jobs that do not yet carry manifest source fields.
const agonCertificationProviderRunner = createManifestDerivedPlaygroundProviderRunner({
  overrides: config.agon.playground.providerEndpoints,
});
const agonCertificationEndpointQaRunner = createManifestDerivedAgonEndpointQaRunner({
  overrides: config.agon.playground.endpointQaEndpoints,
});
const configuredJobEscrowV2 = config.agon.deployment?.contracts.AgonJobEscrowV2;
const configuredJobEscrow = configuredJobEscrowV2 ?? config.agon.deployment?.contracts.AgonJobEscrow;
const configuredServiceRegistry = agonActiveDeployment?.contracts.AgonServiceRegistry;
const configuredArena = agonActiveDeployment?.contracts.AgonArena;

function resolveConfiguredJobEscrowVersion(): AgonJobEscrowContractVersion | null {
  if (configuredJobEscrowV2) {
    return config.agon.deployment?.contractInterfaces?.AgonJobEscrowV2 === "v2-governed-fee" ? "v2" : null;
  }
  if (config.agon.deployment?.contractInterfaces?.AgonJobEscrow === "v1-fixed-fee") {
    return "v1";
  }
  if (config.agon.deployment?.contractInterfaces?.AgonJobEscrow === "legacy-fee-input") {
    return "legacy";
  }
  return null;
}

const configuredJobEscrowVersion = resolveConfiguredJobEscrowVersion();
const jobEscrowCalldataSupported = configuredJobEscrowVersion === "v1" || configuredJobEscrowVersion === "v2";
const legacyJobEscrow = configuredJobEscrowV2 && config.agon.deployment?.contracts.AgonJobEscrow
  ? [config.agon.deployment.contracts.AgonJobEscrow]
  : undefined;
const coordinatorJobEscrowSigner = config.coordinator.privateKey && configuredJobEscrow
  ? privateKeyToAccount(config.coordinator.privateKey)
  : undefined;
const coordinatorJobEscrowWallet = coordinatorJobEscrowSigner
  ? createWalletClient({ account: coordinatorJobEscrowSigner, chain: arcTestnet, transport: http(config.rpcHttp) })
  : undefined;
const coordinatorJobEscrowClient = coordinatorJobEscrowWallet
  ? {
      writeContract: (input: { address: `0x${string}`; abi: unknown; functionName: string; args: readonly unknown[]; account: `0x${string}` }) =>
        coordinatorJobEscrowWallet.writeContract({
          address: input.address,
          abi: input.abi as never,
          functionName: input.functionName as never,
          args: input.args as never,
          account: input.account,
        }),
      waitForTransactionReceipt: (input: { hash: `0x${string}`; timeout?: number }) =>
        publicClient.waitForTransactionReceipt({ hash: input.hash, timeout: input.timeout }),
    }
  : undefined;
const jobEscrowExecutionEnabled = Boolean(
  config.agon.writesEnabled
  && config.agon.escrow.enabled
  && config.agon.escrow.executionEnabled
  && coordinatorJobEscrowSigner
  && configuredJobEscrow
  && jobEscrowCalldataSupported,
);

app.route("/", createSupportRoutes());
const jobEscrowTransactionWriter = configuredJobEscrow && configuredJobEscrowVersion
  ? createViemAgonJobEscrowTransactionWriter({
      enabled: jobEscrowExecutionEnabled,
      client: coordinatorJobEscrowClient,
      escrowAddress: configuredJobEscrow,
      escrowVersion: configuredJobEscrowVersion,
      allowedActors: coordinatorJobEscrowSigner ? [coordinatorJobEscrowSigner.address] : [],
    })
  : undefined;
const jobEscrowTransactionAdapter = jobEscrowTransactionWriter
  ? createAgonJobEscrowTransactionAdapter({
      enabled: jobEscrowExecutionEnabled,
      repository: agonRepository,
      writer: jobEscrowTransactionWriter,
    })
  : undefined;
const arenaEvaluatorSigner = config.validator.privateKey && configuredArena
  ? privateKeyToAccount(config.validator.privateKey)
  : undefined;
const configuredArenaEvaluator = config.agon.x402.validation.validatorAddress?.toLowerCase();
const signerMatchesArenaEvaluator = Boolean(
  arenaEvaluatorSigner
  && configuredArenaEvaluator
  && arenaEvaluatorSigner.address.toLowerCase() === configuredArenaEvaluator,
);
const arenaEvaluatorWallet = arenaEvaluatorSigner
  ? createWalletClient({ account: arenaEvaluatorSigner, chain: arcTestnet, transport: http(config.rpcHttp) })
  : undefined;
const arenaEvaluatorAdapter = configuredArena
  ? createViemAgonArenaEvaluator({
      enabled: config.agon.writesEnabled && config.agon.x402.validation.enabled && signerMatchesArenaEvaluator,
      arenaAddress: configuredArena,
      legacyArenaAddresses: config.agon.deployment?.contracts.AgonArenaV2 && config.agon.deployment.contracts.AgonArena
        ? [config.agon.deployment.contracts.AgonArena]
        : [],
      client: publicClient as unknown as AgonArenaEvaluatorClient,
      wallet: arenaEvaluatorWallet
        ? {
            writeContract: (input) => arenaEvaluatorWallet.writeContract({
              address: input.address,
              abi: input.abi as never,
              functionName: input.functionName as never,
              args: input.args as never,
              account: arenaEvaluatorSigner!,
            }),
          } as AgonArenaEvaluatorWallet
        : undefined,
    })
  : undefined;
const listingVerifierAdapter = config.agon.deployment?.contracts.AgonServiceRegistryV2 && arenaEvaluatorSigner
  ? createViemAgonListingVerifier({
      enabled: config.agon.writesEnabled && config.agon.x402.validation.enabled && signerMatchesArenaEvaluator,
      registryAddress: config.agon.deployment.contracts.AgonServiceRegistryV2,
      verifierAddress: arenaEvaluatorSigner.address,
      client: publicClient as unknown as AgonListingVerifierReadClient,
      wallet: arenaEvaluatorWallet
        ? {
            writeContract: (input) => arenaEvaluatorWallet.writeContract({
              address: input.address,
              abi: input.abi as never,
              functionName: input.functionName,
              args: input.args,
              account: arenaEvaluatorSigner,
            }),
          } as AgonListingVerifierWallet
        : undefined,
    })
  : undefined;

function explainJobEscrowExecutionReadiness(): string | null {
  if (!configuredJobEscrow) return "job_escrow_not_configured";
  if (configuredJobEscrowVersion === "legacy") return "deployed_abi_requires_buyer_supplied_fee";
  if (configuredJobEscrowVersion === null) return "job_escrow_interface_metadata_missing";
  return jobEscrowExecutionEnabled ? null : "job_escrow_execution_disabled";
}

const agonFirstParty = parseFirstPartyAgents(process.env.AGON_FIRST_PARTY_AGENTS);
if (!agonFirstParty.ok) console.warn(`[agon] ${agonFirstParty.problem}; no listing is marked Built by Agon`);
const agonService = new PostgresAgonMarketService(agonRepository, {
  writer: agonWriter,
  firstPartyAgents: agonFirstParty.ok ? agonFirstParty.agents : [],
  activeServiceRegistryAddress: configuredServiceRegistry,
  inspectProviderManifest: agonHostedManifestStore?.inspect,
  x402ExecutionEnabled: config.agon.x402.executionEnabled,
  x402ExecutionPolicy,
  x402SettlementAdapter,
  x402FacilitatorVerifier,
  x402ReceiptLookup: createAgonTestnetReceiptLookupAdapter({
    enabled: config.agon.x402.reconciliationEnabled,
  }),
  endpointQa: config.agon.certification.workerEnabled
    ? () => isAgonCertificationSchemaReady(pool)
    : false,
  certificationLifecycle: {
    enabled: config.agon.certification.workerEnabled,
    checkIntervalSeconds: config.agon.certification.checkIntervalMs / 1000,
    warningRetrySeconds: config.agon.certification.warningRetryMs / 1000,
    failureThreshold: config.agon.certification.failureThreshold,
    endpointQaRequired: config.agon.certification.endpointQaRequired,
    operatorAlertsConfigured: Boolean(config.agon.operationsAlerts.operatorAddress),
  },
  operationsAlertReadiness: () => agonOperationsAlerts.readiness({
    operator: config.agon.operationsAlerts.operatorAddress,
    enabled: config.agon.operationsAlerts.enabled,
    workerEnabled: config.agon.operationsAlerts.workerEnabled,
    telegramConfigured: Boolean(config.auth.telegram.botToken),
  }),
  x402AgentSpendExecutor,
  escrowReadAdapter: agonEscrowReadAdapter,
  escrowPoolContract: config.contracts.PrizeEscrow,
  escrowProductionReadiness: agonEscrowProductionReadiness,
  protocolReadiness: () => inspectAgonProtocolReadiness(config.agon.deployment),
  jobEscrowReadAdapter: config.agon.jobEscrowReadsEnabled && configuredJobEscrow && configuredServiceRegistry
    && configuredJobEscrowVersion
    ? createViemAgonJobEscrowReadAdapter({
        enabled: true,
        client: publicClient as unknown as AgonJobEscrowReadClient,
        escrowAddress: configuredJobEscrow,
        escrowVersion: configuredJobEscrowVersion,
        legacyEscrowAddresses: legacyJobEscrow,
        expectedServiceRegistry: configuredServiceRegistry,
      })
    : undefined,
  jobEscrowTransactionAdapter,
  jobEscrowCalldataSupported,
  jobEscrowExecutionReason: explainJobEscrowExecutionReadiness(),
  agonJobEscrowAddress: configuredJobEscrow,
  agonArenaAddress: configuredArena,
  arenaEvaluatorReadiness: configuredArena
    ? () => readAgonArenaEvaluatorReadiness({
        enabled: config.agon.x402.validation.enabled,
        client: publicClient as unknown as AgonArenaRoleReadClient,
        arenaAddress: configuredArena,
        expectedServiceRegistry: configuredServiceRegistry,
        evaluatorAddress: typeof config.agon.x402.validation.validatorAddress === "string"
          && /^0x[a-fA-F0-9]{40}$/.test(config.agon.x402.validation.validatorAddress)
          ? config.agon.x402.validation.validatorAddress
          : undefined,
      })
    : undefined,
  arenaEvaluatorAdapter,
  arenaEscalation: config.agon.operationsAlerts.enabled && config.agon.operationsAlerts.operatorAddress
    ? (input) => alertAgonArenaOperator({
        operator: config.agon.operationsAlerts.operatorAddress!,
        intentId: input.intentId,
        listingReference: input.listingReference,
        reasons: input.reasons,
      }, agonOperationsAlerts)
    : undefined,
  listingVerifierAdapter,
  listingVerifierReadiness: configuredServiceRegistry
    ? () => readAgonListingVerifierReadiness({
        enabled: config.agon.x402.validation.enabled,
        client: publicClient as unknown as AgonListingVerifierReadClient,
        registryAddress: configuredServiceRegistry,
        verifierAddress: arenaEvaluatorSigner?.address,
      })
    : undefined,
  validationRegistryAddress: config.agon.deployment?.external.ValidationRegistry?.address,
  playgroundStore: agonPlaygroundStore,
  agonSyndicateRegistryAddress: config.agon.deployment?.contracts.AgonSyndicateRegistry,
  agonPrizeVaultAddress: config.agon.deployment?.contracts.AgonPrizeVault,
  protocolFinalityReader: configuredArena
    && agonActiveDeployment?.contracts.AgonSyndicateRegistry
    && agonActiveDeployment.contracts.AgonPrizeVault
    ? createViemAgonProtocolFinalityReader({
        client: publicClient as unknown as AgonProtocolFinalityClient,
        arenaAddress: configuredArena,
        legacyArenaAddresses: config.agon.deployment?.contracts.AgonArenaV2 && config.agon.deployment.contracts.AgonArena
          ? [config.agon.deployment.contracts.AgonArena]
          : [],
        syndicateRegistryAddress: agonActiveDeployment.contracts.AgonSyndicateRegistry,
        prizeVaultAddress: agonActiveDeployment.contracts.AgonPrizeVault,
      })
    : undefined,
});
const agonManagedPublisher = config.agon.managedPublisherEnabled
  && config.agon.writesEnabled && config.chainId === 5042002
  && circleDevConfigured() && config.agon.publicApiUrl
  && agonActiveDeployment && agonHostedManifestStore
  ? createManagedPublisher({
      store: createPostgresManagedPublisherStore(pool),
      draftStore: agonProviderDraftStore,
      access: createMcpAccessAdapter(agonService, { providerDraftStore: agonProviderDraftStore, hostedManifestStore: agonHostedManifestStore }),
      circle: { createWallet: createPublisherWallet, execute: executePublisherCall, transaction: getTxState },
      chain: {
        balance: (address) => publicClient.getBalance({ address }),
        hasCode: async (address) => {
          const code = await publicClient.getBytecode({ address });
          return Boolean(code && code !== "0x");
        },
        async gasQuote(from, to, data) {
          const [gas, price] = await Promise.all([
            publicClient.estimateGas({ account: from, to, data }),
            publicClient.getGasPrice(),
          ]);
          return { gasLimit: gas, gasPriceWei: price };
        },
        async receipt(hash) {
          try { return await publicClient.getTransactionReceipt({ hash }); }
          catch (error) {
            if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") return null;
            throw error;
          }
        },
        transaction: (hash) => publicClient.getTransaction({ hash }),
        ownerOf: (agentId) => publicClient.readContract({
          address: agonActiveDeployment.external.IdentityRegistry.address,
          abi: parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]),
          functionName: "ownerOf", args: [agentId],
        }),
        agentURI: (agentId) => publicClient.readContract({
          address: agonActiveDeployment.external.IdentityRegistry.address,
          abi: parseAbi(["function tokenURI(uint256 tokenId) view returns (string)"]),
          functionName: "tokenURI", args: [agentId],
        }),
      },
      identityRegistry: agonActiveDeployment.external.IdentityRegistry.address,
      serviceRegistry: agonActiveDeployment.contracts.AgonServiceRegistry,
      publicApiUrl: config.agon.publicApiUrl,
      publicationReady: async () => (await agonReadiness.get(true)).ready,
      checksPassed: agonChecksPassed,
    })
  : undefined;

// Season 1 routes are mounted before the main /agon router so its handlers
// never shadow /agon/seasons.
const agonSeason = startSeasonRuntime();
let seasonRoutes: ReturnType<typeof createSeasonRoutes> | null = null;
if (agonSeason) {
  const seasonClient = createSeasonClient({ transport: seasonFallback(agonSeason.network.rpcHttp.map((url) => http(url))) });
  seasonRoutes = createSeasonRoutes({
    store: agonSeason.store,
    rounds: agonSeason.rounds,
    network: agonSeason.network,
    verifyEntry: createErc8004EntryVerifier(
      {
        readContract: (args) => seasonClient.readContract(args as never),
        verifyMessage: (args) => seasonClient.verifyMessage(args),
      },
      agonSeason.network.identityRegistry,
    ),
  });
  app.route("/agon/seasons", seasonRoutes);
}

// Money path routes are mounted before the main /agon router for the same
// reason as the season routes. `agonPayments.hire` is what channels call.
const stage = resolveStageSettings(process.env);
for (const problem of stage.problems) console.error(`[stage] ${problem}`);
const agonPayments = startPaymentsRuntime({ season: agonSeason, blockedProviders: () => stage.settings.providerBlocklist });
const channelStore = new PostgresChannelStore(pool);
const monitorStore = new PostgresMonitorStore(pool);
let stageServices: StageServices | null = null;
if (agonPayments) {
  app.route("/agon", agonPayments.routes.payments);
  app.route("/agon/agents/house", agonPayments.routes.house);
  if (agonPayments.routes.standin) app.route("/agon/standin", agonPayments.routes.standin);
  stageServices = createStageServices({
    hire: agonPayments.hire,
    store: agonPayments.store,
    network: agonPayments.settings.network,
    siteUrl: stage.settings.siteUrl,
    balanceOf: agonPayments.balanceOf,
    leaderboard: createLeaderboardReader(agonSeason),
    leadPrice: async () => agonPayments.settings.leadPrice,
    // Each new owner costs a Circle wallet: at most 60 new wallets an hour across all channels.
    newWalletAllowed: (() => { const gate = createRateLimiter({ limit: 60, windowMs: 3_600_000 }); return () => gate("new-wallet"); })(),
    now: () => new Date(),
  });
  app.route("/agon/app", createAppRoutes({ services: stageServices, requireAuth, off: () => stage.settings.channelsOff.web }));
  app.route("/agon", createApprovalRoutes({
    gate: { payments: agonPayments.store, channels: channelStore, chatIdPepper: stage.settings.chatIdPepper, network: agonPayments.settings.network, now: () => new Date() },
    hire: agonPayments.hire,
    requireAuth,
  }));
  console.log(`[stage] web app on ${agonPayments.settings.network.label}; site ${stage.settings.siteUrl}`);
  if (stage.settings.telegram && stage.settings.chatIdPepper) {
    const telegram = createTelegramChannel({
      telegram: stage.settings.telegram,
      pepper: stage.settings.chatIdPepper,
      services: stageServices,
      channels: channelStore,
      classify: (text) => classifyIntent(text, { callModel: async (p) => ({ text: (await callModel(p)).text }), model: stage.settings.classifierModel, log: (m) => console.warn(`[telegram] ${m}`) }),
      off: () => stage.settings.channelsOff.telegram,
      log: (m) => console.warn(`[telegram] ${m}`),
    });
    app.route("/agon/telegram", telegram.routes);
    console.log(`[stage] Telegram channel on @${stage.settings.telegram.botUsername}`);
  }
  const alertOperator = stage.settings.alertOperator ?? config.agon.operationsAlerts.operatorAddress ?? null;
  if (alertOperator) {
    const s = agonPayments.settings;
    const watched = [
      { label: "Lead agent", address: s.lead.address, floor: stage.settings.leadBalanceFloor },
      ...Object.entries(s.houseSellers).map(([key, w]) => ({ label: `${key} seller`, address: w.address, floor: stage.settings.sellerBalanceFloor })),
      ...(s.standin ? [{ label: "Testnet stand-in", address: s.standin.address, floor: stage.settings.sellerBalanceFloor }] : []),
    ];
    startStageMonitor({
      intervalMs: 60_000,
      log: (m) => console.warn(`[stage] ${m}`),
      check: () => checkStage({
        store: monitorStore, wallets: watched, balanceOf: agonPayments.balanceOf, siteUrl: stage.settings.siteUrl, now: () => new Date(),
        lastCommitAt: async () => {
          if (!agonSeason) return null;
          const rounds = await agonSeason.store.listRounds(agonSeason.season.seasonId, 12);
          const times = rounds.map((r) => r.commitBlockTime).filter((t): t is Date => t !== null);
          return times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
        },
      }),
      raise: async (a) => { await agonOperationsAlerts.raise({ operator: alertOperator, fingerprint: a.fingerprint, source: "stage", severity: a.severity, title: a.title, body: a.body, ...(a.href ? { href: a.href } : {}) }); },
      resolve: async (f) => { await agonOperationsAlerts.resolve(alertOperator, f); },
    });
    console.log(`[stage] monitor on; alerts to ${alertOperator}`);
  }
}

app.route("/agon/builder", createBuilderRoutes({
  tokens: agonAccessTokens,
  requireAuth,
  // The web listing flow uses the same draft store, checker and publisher as the MCP tools.
  listing: {
    access: createMcpAccessAdapter(agonService, { providerDraftStore: agonProviderDraftStore, hostedManifestStore: agonHostedManifestStore, listingChecker: agonListingChecker }),
    drafts: agonProviderDraftStore,
    publisher: agonManagedPublisher,
  },
}));
app.route("/agon", createAgonRoutes({
  service: agonService,
  verifyMcpToken: createMcpTokenVerifier(agonAccessTokens, verifyTokenClaims),
  stageMcp: stageServices
    ? {
        services: stageServices,
        season: seasonRoutes ? { request: (path: string, init?: RequestInit) => seasonRoutes!.request(path, init) } : null,
        seasonId: agonSeason ? agonSeason.season.seasonId.toString() : "1",
        off: () => stage.settings.channelsOff.mcp,
      }
    : undefined,
  requireAuth: createAgonAuthMiddleware(config.adminToken, requireAuth),
  requireListingPrepareAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("listing:prepare")),
  requireListingWriteAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("listing:write")),
  requireListingConfirmAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("listing:confirm")),
  requirePlaygroundAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("playground:run")),
  requireArenaAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("arena:prepare")),
  requireHireReadAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("agon:read")),
  requireHireWalletAuth: createAgonAuthMiddleware(config.adminToken, requireAgonScope("wallet:execute")),
  requirePrincipal: createAgonPrincipalMiddleware(async (operatorAddress, requestedAddress) =>
    Boolean(await getWalletPrincipal(operatorAddress, requestedAddress, pool)),
  ),
  playgroundStore: agonPlaygroundStore,
  playgroundRateLimiter: new RedisPlaygroundRateLimiter(redis),
  playgroundProviderRunner: agonPlaygroundProviderRunner,
  providerDraftStore: agonProviderDraftStore,
  listingChecker: agonListingChecker,
  hostedManifestStore: agonHostedManifestStore,
  hireStore: agonMcpHireStore,
  managedPublisher: agonManagedPublisher,
}));

if (config.agon.certification.workerEnabled) {
  void agonCertificationWorkerLoop({
    repository: agonRepository,
    playgroundStore: agonPlaygroundStore,
    providerRunner: agonCertificationProviderRunner,
    endpointQaRunner: agonCertificationEndpointQaRunner,
    listingVerifier: listingVerifierAdapter,
    alert: config.agon.operationsAlerts.enabled
      ? (input) => alertAgonCertificationOperator(input, agonOperationsAlerts)
      : undefined,
    checkIntervalMs: config.agon.certification.checkIntervalMs,
    warningRetryMs: config.agon.certification.warningRetryMs,
    failureThreshold: config.agon.certification.failureThreshold,
    requireEndpointQa: config.agon.certification.endpointQaRequired,
    alertOperator: config.agon.operationsAlerts.operatorAddress,
  }).catch((error) => {
    console.error("[agon-certification] worker stopped:", error instanceof Error ? error.message : error);
  });
}

if (config.agon.operationsAlerts.enabled && config.agon.operationsAlerts.workerEnabled) {
  void agonOperationsAlertWorkerLoop({
    repository: agonOperationsAlerts,
    sendTelegram: createTelegramAlertSender({
      botToken: config.auth.telegram.botToken,
      appUrl: config.auth.appUrl,
    }),
    appUrl: config.auth.appUrl,
    retryBaseMs: config.agon.operationsAlerts.retryBaseMs,
  }).catch((error) => {
    console.error("[agon-alerts] delivery worker stopped:", error instanceof Error ? error.message : error);
  });
}

// ----- SIWE wallet login -----

app.post("/auth/wallet/nonce", async (c) => {
  const { address } = await c.req.json<{ address?: string }>();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "valid address required" }, 400);
  }
  const nonce = generateSiweNonce();
  await redis.set(`siwe:nonce:${nonce}`, address.toLowerCase(), "EX", NONCE_TTL);
  return c.json({ nonce });
});

app.post("/auth/wallet/verify", async (c) => {
  const { message, signature } = await c.req.json<{ message?: string; signature?: `0x${string}` }>();
  if (!message || !signature) return c.json({ error: "message and signature required" }, 400);

  const fields = parseSiweMessage(message);
  if (!fields.address || !fields.nonce) return c.json({ error: "malformed SIWE message" }, 400);

  // One-time nonce: consume it and confirm it was issued for this address.
  const issuedFor = await redis.getdel(`siwe:nonce:${fields.nonce}`);
  if (!issuedFor || issuedFor !== fields.address.toLowerCase()) {
    return c.json({ error: "invalid or expired nonce" }, 401);
  }
  // Keep the configured origin authoritative while allowing the canonical Agon
  // domains during the ArcRun -> Agon migration. This prevents a stale VPS
  // AUTH_DOMAIN value from making SIWE unusable after the production cutover,
  // without accepting arbitrary origins.
  const allowedSiweDomains = new Set([
    config.auth.domain,
    "agon.surf",
    "www.agon.surf",
    "arcrun.xyz",
    "www.arcrun.xyz",
    "localhost:3000",
    "localhost:3003",
  ]);
  if (!fields.domain || !allowedSiweDomains.has(fields.domain)) return c.json({ error: "bad domain" }, 401);
  if (fields.chainId !== config.chainId) return c.json({ error: "wrong chain" }, 401);
  if (fields.expirationTime && new Date(fields.expirationTime) < new Date()) {
    return c.json({ error: "message expired" }, 401);
  }

  // verifyMessage handles EOAs and EIP-1271 smart accounts (Arc Modular Wallets)
  // through the Arc public client.
  const valid = await publicClient.verifyMessage({ address: fields.address, message, signature });
  if (!valid) return c.json({ error: "bad signature" }, 401);

  const address = fields.address.toLowerCase();
  await query("insert into operators (address) values ($1) on conflict (address) do nothing", [address]);
  const token = await issueToken(address);

  // Persist the session in an httpOnly cookie so XSS cannot lift it. The token
  // is also returned in the JSON body for back-compat with any non-browser
  // caller (scripts, server-to-server), but the frontend should ignore it.
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  void logEvent({ kind: "login", address, source: "auth" });
  return c.json({ token, address });
});

// Sign out: clears the server-side session cookie. The frontend has no token to
// clear because it never stored one. Returns 200 even when no session exists.
app.post("/auth/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ----- Email login with WebAuthn passkey (Circle Developer-Controlled wallets) -----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readEmail(body: unknown): string | null {
  const b = body as { email?: unknown };
  const email = (typeof b?.email === "string" ? b.email : "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/// Email OTP: step 1. Generate a 6-digit code, persist its hash with a
/// 10-minute TTL, and email it to the address. Required at first-time
/// signup so an attacker can't claim someone else's email and mint a
/// Circle wallet under it. Opt-in via EMAIL_OTP_ENABLED=true.
app.post("/auth/email/otp/start", async (c) => {
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "email otp is disabled on this server" }, 503);
  }
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  try {
    await startEmailOtp(email);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({ level: "error", kind: "otp_start_error", message, context: { email }, source: "auth" });
    return c.json({ error: "could not send the code, try again" }, 500);
  }
});

/// Email OTP: step 2. Verify the 6-digit code. On success the email is
/// flagged as verified for VERIFY_TTL (15 min); the next
/// /auth/email/begin call within that window passes the first-time
/// signup gate. The verification is consumed once /auth/email/finish
/// completes so a token can't be replayed for two signups.
app.post("/auth/email/otp/verify", async (c) => {
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "email otp is disabled on this server" }, 503);
  }
  let body: { email?: string; code?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  if (typeof body.code !== "string") return c.json({ error: "code required" }, 400);
  try {
    await verifyEmailOtp(email, body.code);
    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof OtpError) return c.json({ error: err.message, code: err.code }, err.status as 400);
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({ level: "error", kind: "otp_verify_error", message, context: { email }, source: "auth" });
    return c.json({ error: "could not verify the code" }, 500);
  }
});

/// Email passkey flow, step 1. The client posts an email; we decide whether
/// this email needs a fresh passkey registration ("register") or can prove
/// itself with an existing passkey ("login"), and return the matching
/// WebAuthn challenge for the browser ceremony.
app.post("/auth/email/begin", async (c) => {
  if (!circleDevConfigured()) {
    return c.json(
      { error: "email login is not configured on this server; ask the operator to set CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID" },
      503,
    );
  }

  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);

  try {
    const credentials = await listCredentialsForEmail(email);
    if (credentials.length > 0) {
      const options = await beginAuthentication(email);
      return c.json({ mode: "login", options });
    }
    // First-time signup gate. EMAIL_OTP_ENABLED=true requires the
    // caller to have completed /auth/email/otp/verify within the past
    // 15 minutes before we hand out a registration challenge. Once a
    // passkey is enrolled this branch is unreachable on subsequent
    // logins (the credentials check above catches them).
    if (config.auth.emailOtp.enabled) {
      const verified = await isEmailVerified(email);
      if (!verified) {
        return c.json(
          {
            error: "verify your email first",
            code: "otp_required",
            otpRequired: true,
          },
          403,
        );
      }
    }
    const options = await beginRegistration(email);
    return c.json({ mode: "register", options });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      level: "error",
      kind: "email_begin_error",
      message,
      context: { email },
      source: "auth",
    });
    return c.json({ error: `email begin failed: ${message}` }, 500);
  }
});

/// Email passkey flow, step 2. The client posts the email, the mode it ran
/// (matching what /begin returned), and the browser's attestation or
/// assertion. We verify, mint a Circle wallet if this is a fresh registration,
/// store the credential, and set the session cookie.
app.post("/auth/email/finish", async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "email login is not configured on this server" }, 503);
  }

  let body: { email?: string; mode?: string; response?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);
  if (body.mode !== "register" && body.mode !== "login") {
    return c.json({ error: "mode must be register or login" }, 400);
  }
  if (!body.response || typeof body.response !== "object") {
    return c.json({ error: "missing webauthn response" }, 400);
  }

  if (body.mode === "register") {
    // Either resume an existing operator row (e.g. they signed up under the
    // earlier passkey-less flow and are enrolling a passkey now) or mint a
    // fresh Circle wallet for a never-seen email.
    let address: string;
    let walletId: string | null;
    let seeded = false;
    let createdNow = false;

    const existing = await query<{ address: string; circle_wallet_id: string | null }>(
      "select address, circle_wallet_id from operators where email = $1",
      [email],
    );

    if (existing.rows[0]) {
      address = existing.rows[0].address;
      walletId = existing.rows[0].circle_wallet_id;
    } else {
      const created = await createUserWallet(email).catch((err) => {
        console.error("[auth/email/finish] createUserWallet failed:", err);
        return null;
      });
      if (!created) return c.json({ error: "could not create wallet, try again in a moment" }, 502);
      address = created.address;
      walletId = created.walletId;

      await query(
        `insert into operators (address, email, circle_wallet_id)
           values ($1, $2, $3)
           on conflict (address) do update set email = excluded.email, circle_wallet_id = excluded.circle_wallet_id`,
        [address, email, walletId],
      );
      createdNow = true;
      const seed = await seedTestnetUsdc(address as `0x${string}`).catch(() => ({ requested: false }));
      seeded = seed.requested;
    }

    try {
      await finishRegistration(email, address, body.response as RegistrationResponseJSON);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "registration verification failed" }, 401);
    }

    // Consume any verified OTP so the token can't be replayed against a
    // second signup attempt. Safe to call when OTP wasn't used (the row
    // doesn't exist and DELETE is a no-op).
    await consumeEmailVerification(email).catch(() => {});

    const token = await issueToken(address);
    setSessionCookie(c, token);
    void logEvent({
      kind: createdNow ? "email_signup" : "passkey_enroll",
      address,
      context: { email, walletId, seeded },
      source: "auth",
    });
    return c.json({ address, walletId, seeded, isNew: createdNow });
  }

  // login mode
  let resolved: { operatorAddress: string };
  try {
    const out = await finishAuthentication(email, body.response as AuthenticationResponseJSON);
    resolved = { operatorAddress: out.operatorAddress };
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "authentication verification failed" }, 401);
  }
  const token = await issueToken(resolved.operatorAddress);
  setSessionCookie(c, token);

  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [resolved.operatorAddress],
  );
  void logEvent({ kind: "email_login", address: resolved.operatorAddress, context: { email }, source: "auth" });
  return c.json({
    address: resolved.operatorAddress,
    walletId: rows[0]?.circle_wallet_id ?? null,
    seeded: false,
    isNew: false,
  });
});

/// Email login WITHOUT a passkey: complete sign-in from a verified OTP alone.
/// Signup is just email + code; passkeys become optional and are enrolled
/// later from settings (and offered automatically on return once enrolled).
/// Gated on a recent OTP verification so a session can't be claimed for an
/// email the caller doesn't control.
app.post("/auth/email/session", async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "email login is not configured on this server" }, 503);
  }
  if (!config.auth.emailOtp.enabled) {
    return c.json({ error: "code-based email login is not enabled" }, 400);
  }

  let body: { email?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const email = readEmail(body);
  if (!email) return c.json({ error: "valid email required" }, 400);

  if (!(await isEmailVerified(email))) {
    return c.json({ error: "verify your email code first", code: "otp_required" }, 401);
  }

  let address: string;
  let walletId: string | null;
  let seeded = false;
  let createdNow = false;

  const existing = await query<{ address: string; circle_wallet_id: string | null }>(
    "select address, circle_wallet_id from operators where email = $1",
    [email],
  );
  if (existing.rows[0]) {
    address = existing.rows[0].address;
    walletId = existing.rows[0].circle_wallet_id;
  } else {
    const created = await createUserWallet(email).catch((err) => {
      console.error("[auth/email/session] createUserWallet failed:", err);
      return null;
    });
    if (!created) return c.json({ error: "could not create wallet, try again in a moment" }, 502);
    address = created.address;
    walletId = created.walletId;
    await query(
      `insert into operators (address, email, circle_wallet_id)
         values ($1, $2, $3)
         on conflict (address) do update set email = excluded.email, circle_wallet_id = excluded.circle_wallet_id`,
      [address, email, walletId],
    );
    createdNow = true;
    const seed = await seedTestnetUsdc(address as `0x${string}`).catch(() => ({ requested: false }));
    seeded = seed.requested;
  }

  await consumeEmailVerification(email).catch(() => {});
  const token = await issueToken(address);
  setSessionCookie(c, token);
  void logEvent({
    kind: createdNow ? "email_signup" : "email_login",
    address,
    context: { email, walletId, seeded, method: "otp" },
    source: "auth",
  });
  return c.json({ address, walletId, seeded, isNew: createdNow });
});

// ----- Passkey enrollment from inside a live session -----
//
// Lets a signed-in user attach a passkey to their existing operator row so
// the next login requires the passkey ceremony. Different from /auth/email/
// begin+finish, which expects no session and creates one. This pair runs
// against the live session's address and uses the operator row's email as
// the WebAuthn user handle.

app.post("/auth/passkey/enroll/begin", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{ email: string | null }>(
    "select email from operators where address = $1",
    [address],
  );
  const email = rows[0]?.email;
  if (!email) {
    return c.json(
      { error: "this session is not an email account; passkeys are only for email logins" },
      400,
    );
  }
  const options = await beginRegistration(email);
  return c.json({ options });
});

/// Lists the current session's registered passkeys with device hints so
/// the profile settings can show "you have 2 passkeys" with a per-row
/// summary (device type, when added). Read-only.
app.get("/auth/passkey/list", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{
    credential_id: string;
    device_type: string | null;
    backed_up: boolean | null;
    transports: string[] | null;
    created_at: Date;
  }>(
    `select credential_id, device_type, backed_up, transports, created_at
       from webauthn_credentials
      where operator_address = $1
      order by created_at asc`,
    [address],
  );
  return c.json({
    passkeys: rows.map((r) => ({
      id: r.credential_id,
      deviceType: r.device_type,
      backedUp: r.backed_up ?? false,
      transports: r.transports ?? [],
      createdAt: r.created_at,
    })),
  });
});

app.post("/auth/passkey/enroll/finish", requireAuth, async (c) => {
  const address = c.get("address");
  const { rows } = await query<{ email: string | null }>(
    "select email from operators where address = $1",
    [address],
  );
  const email = rows[0]?.email;
  if (!email) return c.json({ error: "this session is not an email account" }, 400);

  let body: { response?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  if (!body.response || typeof body.response !== "object") {
    return c.json({ error: "missing webauthn response" }, 400);
  }

  try {
    await finishRegistration(email, address, body.response as RegistrationResponseJSON);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "passkey enrollment failed" }, 401);
  }

  void logEvent({ kind: "passkey_enroll", address, context: { email }, source: "auth" });
  return c.json({ ok: true });
});

// ----- Circle wallet execute (server-signed contract calls) -----

// ArcRun contracts, explicitly configured Agon contracts, and USDC are the
// only addresses /wallet/execute will sign for. Each Agon path adds its own
// prepared-intent authorization below, so this is not a generic signing oracle.
const WRITE_ALLOWLIST = new Set<string>(
  [
    config.contracts.ContestEngine,
    config.contracts.ChallengeArena,
    config.contracts.AgentRegistry,
    config.contracts.PrizeEscrow,
    config.contracts.SyndicateFactory,
    config.contracts.PointsLedger,
    config.external.USDC,
    ...(config.agon.deployment
      ? [
          config.agon.deployment.contracts.AgonProfileRegistry,
          config.agon.deployment.contracts.AgonServiceRegistry,
          ...(config.agon.deployment.contracts.AgonServiceRegistryV2
            ? [config.agon.deployment.contracts.AgonServiceRegistryV2]
            : []),
          ...(config.agon.deployment.contracts.AgonArena
            ? [config.agon.deployment.contracts.AgonArena]
            : []),
          ...(config.agon.deployment.contracts.AgonArenaV2
            ? [config.agon.deployment.contracts.AgonArenaV2]
            : []),
          // Email-login users create their ERC-8004 identity through the
          // same Circle signing boundary before binding it to Agon.
          config.agon.deployment.external.IdentityRegistry.address,
        ]
      : []),
  ].map((a) => a.toLowerCase()),
);

const AGON_WRITE_ADDRESSES = new Set(
  config.agon.deployment
    ? [
        config.agon.deployment.contracts.AgonProfileRegistry.toLowerCase(),
        config.agon.deployment.contracts.AgonServiceRegistry.toLowerCase(),
        ...(config.agon.deployment.contracts.AgonServiceRegistryV2
          ? [config.agon.deployment.contracts.AgonServiceRegistryV2.toLowerCase()]
          : []),
      ]
    : [],
);

const AGON_ARENA_WRITE_ADDRESSES = new Set(
  config.agon.deployment
    ? [
        ...(config.agon.deployment.contracts.AgonArena
          ? [config.agon.deployment.contracts.AgonArena.toLowerCase()]
          : []),
        ...(config.agon.deployment.contracts.AgonArenaV2
          ? [config.agon.deployment.contracts.AgonArenaV2.toLowerCase()]
          : []),
      ]
    : [],
);

// Function-level rules for the Circle signer. See wallet-execute-policy.ts.
const walletExecutePolicy = createWalletExecutePolicy({
  usdc: config.external.USDC,
  identityRegistry: config.agon.deployment?.external.IdentityRegistry.address ?? null,
  intentBound: [...AGON_WRITE_ADDRESSES, ...AGON_ARENA_WRITE_ADDRESSES],
  usdcSpenders: [
    config.contracts.ContestEngine,
    config.contracts.ChallengeArena,
    config.contracts.AgentRegistry,
    config.contracts.PrizeEscrow,
    config.contracts.SyndicateFactory,
    ...(config.agon.deployment?.contracts.AgonJobEscrow ? [config.agon.deployment.contracts.AgonJobEscrow] : []),
    ...(config.agon.deployment?.contracts.AgonPrizeVault ? [config.agon.deployment.contracts.AgonPrizeVault] : []),
  ],
  legacy: [
    config.contracts.ContestEngine,
    config.contracts.ChallengeArena,
    config.contracts.AgentRegistry,
    config.contracts.PrizeEscrow,
    config.contracts.SyndicateFactory,
    config.contracts.PointsLedger,
  ],
});

const executeBodySchema = {
  parse(body: unknown): {
    contractAddress: `0x${string}`;
    abiFunctionSignature: string;
    abiParameters: ReadonlyArray<string | number | boolean | string[]>;
    amount?: string;
    refId?: string;
  } {
    if (!body || typeof body !== "object") throw new Error("body must be an object");
    const b = body as Record<string, unknown>;
    if (typeof b.contractAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(b.contractAddress)) {
      throw new Error("contractAddress must be a 0x address");
    }
    if (typeof b.abiFunctionSignature !== "string" || !b.abiFunctionSignature.includes("(")) {
      throw new Error("abiFunctionSignature must look like name(types,...)");
    }
    if (!Array.isArray(b.abiParameters)) throw new Error("abiParameters must be an array");
    const amount = typeof b.amount === "string" ? b.amount : undefined;
    const refId = typeof b.refId === "string" ? b.refId : undefined;
    return {
      contractAddress: b.contractAddress.toLowerCase() as `0x${string}`,
      abiFunctionSignature: b.abiFunctionSignature,
      abiParameters: b.abiParameters as ReadonlyArray<string | number | boolean | string[]>,
      amount,
      refId,
    };
  },
};

app.post("/wallet/execute", requireAgonScope("wallet:execute"), async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }

  const operator = c.get("address");
  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [operator],
  );
  const walletId = rows[0]?.circle_wallet_id;
  if (!walletId) {
    return c.json(
      { error: "this session is not a Circle-managed wallet; connect an injected wallet and sign client-side" },
      400,
    );
  }

  let body: ReturnType<typeof executeBodySchema.parse>;
  try {
    body = executeBodySchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  if (!WRITE_ALLOWLIST.has(body.contractAddress.toLowerCase())) {
    return c.json({ error: "contract address is not part of ArcRun" }, 400);
  }
  const claims = await requestClaims(c);
  const decision = authorizeWalletExecute(walletExecutePolicy, {
    client: claims?.client ?? null,
    contractAddress: body.contractAddress,
    abiFunctionSignature: body.abiFunctionSignature,
    abiParameters: body.abiParameters,
  });
  if (!decision.ok) {
    void logEvent({
      level: "warn",
      kind: "wallet_execute_refused",
      address: operator,
      message: decision.message,
      context: { fn: body.abiFunctionSignature, contract: body.contractAddress, client: claims?.client ?? null },
      source: "auth",
    });
    return c.json({ error: decision.message }, decision.status);
  }

  if (AGON_WRITE_ADDRESSES.has(body.contractAddress.toLowerCase())) {
    if (!agonWriter) return c.json({ error: "Agon writes are unavailable" }, 503);
    if (!body.refId) return c.json({ error: "prepared Agon operation reference is required" }, 400);
    const authorization = await agonWriter.authorizeCircleExecution(
      operator,
      body.refId,
      body.contractAddress,
      body.abiFunctionSignature,
      body.abiParameters,
    );
    if (!authorization.ok) {
      const status = authorization.error.code === "capability_unavailable" ? 503 : 400;
      return c.json({ error: authorization.error.message }, status);
    }
  }

  if (AGON_ARENA_WRITE_ADDRESSES.has(body.contractAddress.toLowerCase())) {
    if (!body.refId) return c.json({ error: "prepared Arena evaluation reference is required" }, 400);
    const evaluation = await agonRepository.getAgonArenaEvaluation(body.refId);
    const authorization = authorizeArenaCircleExecution({
      evaluation,
      operator,
      contractAddress: body.contractAddress,
      abiFunctionSignature: body.abiFunctionSignature,
      abiParameters: body.abiParameters,
    });
    if (!authorization.ok) return c.json({ error: authorization.message }, 400);
  }

  // Enforce the 6-agent profile cap for Circle wallet users at the
  // backend's signing layer. Wagmi users sign client-side and bypass
  // this check, but the cap also stays enforced on-chain once the
  // mainnet AgentRegistry redeploy lands. Off-chain we just refuse to
  // sign a seventh createAgent call so Circle users can't race past the
  // frontend gate.
  if (
    body.contractAddress.toLowerCase() === config.contracts.AgentRegistry.toLowerCase() &&
    body.abiFunctionSignature.startsWith("createAgent")
  ) {
    const { rows: countRows } = await query<{ n: string }>(
      "select count(*)::text as n from agents where owner = $1",
      [operator],
    );
    const owned = Number(countRows[0]?.n ?? "0");
    if (owned >= 6) {
      return c.json({ error: "6 agent cap reached; no more claims allowed" }, 403);
    }
  }

  try {
    const tx = await executeContractCall({
      walletId,
      contractAddress: body.contractAddress,
      abiFunctionSignature: body.abiFunctionSignature,
      abiParameters: body.abiParameters,
      amount: body.amount,
      refId: body.refId,
    });
    void logEvent({
      kind: "wallet_execute",
      address: operator,
      context: { circleTxId: tx.id, state: tx.state, fn: body.abiFunctionSignature, contract: body.contractAddress },
      source: "auth",
    });
    return c.json({ id: tx.id, state: tx.state });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      level: "error",
      kind: "wallet_execute_error",
      address: operator,
      message,
      context: { fn: body.abiFunctionSignature, contract: body.contractAddress },
      source: "auth",
    });
    return c.json({ error: message }, 502);
  }
});

/// CCTPv2 bridge for email users. Their Dev-Controlled wallet on Arc signs the
/// approve + burn server-side; Circle's Forwarder Service mints to the
/// recipient on the destination chain. The frontend posts (destChain, amount,
/// recipientAddress) and gets back the same step-array shape the wagmi bridge
/// UI renders, so the UI can light up approve / burn / attest / mint live.
const bridgeBodySchema = {
  parse(body: unknown): {
    destChain: string;
    amount: string;
    recipientAddress: `0x${string}`;
  } {
    if (!body || typeof body !== "object") throw new Error("body must be an object");
    const b = body as Record<string, unknown>;
    if (typeof b.destChain !== "string" || b.destChain.length === 0) {
      throw new Error("destChain required (e.g. Base_Sepolia)");
    }
    if (typeof b.amount !== "string" || !/^\d+(\.\d+)?$/.test(b.amount) || Number(b.amount) <= 0) {
      throw new Error("amount must be a positive decimal string");
    }
    if (typeof b.recipientAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(b.recipientAddress)) {
      throw new Error("recipientAddress must be a 0x address");
    }
    return {
      destChain: b.destChain,
      amount: b.amount,
      recipientAddress: b.recipientAddress as `0x${string}`,
    };
  },
};

app.post("/wallet/bridge", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }

  const operator = c.get("address");
  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [operator],
  );
  const walletId = rows[0]?.circle_wallet_id;
  if (!walletId) {
    return c.json(
      { error: "this session is not a Circle-managed wallet; web3 wallet users bridge through the frontend SDK." },
      400,
    );
  }

  let body: ReturnType<typeof bridgeBodySchema.parse>;
  try {
    body = bridgeBodySchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  try {
    const { circleBridge } = await import("../chain/circleBridge.js");
    const result = await circleBridge({
      sourceChain: "Arc_Testnet",
      // The operator's login identity IS their Arc Circle wallet address, so the
      // adapter signs the burn from the right per-user wallet. (Previously omitted,
      // which left the adapter with no bound wallet on a multi-user server.)
      fromAddress: operator as `0x${string}`,
      destChain: body.destChain,
      amount: body.amount,
      recipientAddress: body.recipientAddress,
    });
    void logEvent({
      kind: "wallet_bridge",
      address: operator,
      context: {
        destChain: body.destChain,
        amount: body.amount,
        recipient: body.recipientAddress,
        state: result.state,
      },
      source: "auth",
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({
      kind: "wallet_bridge_failed",
      level: "error",
      address: operator,
      message,
      source: "auth",
    });
    return c.json({ error: message }, 502);
  }
});

/// Get or create the user's dev-controlled deposit wallet on a source chain,
/// cached in circle_chain_wallets so a user only ever has one per chain.
async function getOrCreateChainWallet(
  operator: string,
  appKitChain: string,
): Promise<{ walletId: string; address: `0x${string}` } | null> {
  const dcw = dcwBlockchainFor(appKitChain);
  if (!dcw) return null;
  const { rows } = await query<{ wallet_id: string; address: string }>(
    "select wallet_id, address from circle_chain_wallets where operator = $1 and chain = $2",
    [operator, appKitChain],
  );
  if (rows[0]) return { walletId: rows[0].wallet_id, address: rows[0].address as `0x${string}` };
  const created = await createWalletOnChain(`${operator}:${appKitChain}`, dcw);
  await query(
    `insert into circle_chain_wallets (operator, chain, wallet_id, address)
       values ($1, $2, $3, $4)
       on conflict (operator, chain) do nothing`,
    [operator, appKitChain, created.walletId, created.address],
  );
  return created;
}

/// TOP UP (cross-chain) for email/custodial users: hand back a dev-controlled
/// deposit address on the source chain. The user funds it from their own wallet
/// or an exchange; the frontend then polls /status and auto-fires /bridge.
app.post("/wallet/topup/deposit-address", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }
  const operator = c.get("address");
  const { rows } = await query<{ circle_wallet_id: string | null }>(
    "select circle_wallet_id from operators where address = $1",
    [operator],
  );
  if (!rows[0]?.circle_wallet_id) {
    return c.json(
      { error: "this session is not a Circle-managed wallet; web3 wallet users top up through the connected wallet." },
      400,
    );
  }
  let sourceChain = "";
  try {
    const b = (await c.req.json()) as { sourceChain?: unknown };
    if (typeof b.sourceChain !== "string" || !b.sourceChain) throw new Error("sourceChain required (e.g. Base_Sepolia)");
    sourceChain = b.sourceChain;
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  if (sourceChain === "Arc_Testnet") {
    return c.json({ error: "Arc is your home chain; receive USDC directly to your wallet address instead." }, 400);
  }
  try {
    const w = await getOrCreateChainWallet(operator, sourceChain);
    if (!w) return c.json({ error: `unsupported source chain: ${sourceChain}` }, 400);
    return c.json({ chain: sourceChain, address: w.address });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/// Poll the source-chain deposit wallet's USDC balance so the frontend knows
/// when the user's funds have landed and it can fire the bridge.
app.get("/wallet/topup/status", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }
  const operator = c.get("address");
  const sourceChain = c.req.query("sourceChain") ?? "";
  if (!sourceChain) return c.json({ error: "sourceChain required" }, 400);
  const { rows } = await query<{ wallet_id: string; address: string }>(
    "select wallet_id, address from circle_chain_wallets where operator = $1 and chain = $2",
    [operator, sourceChain],
  );
  if (!rows[0]) return c.json({ usdc: "0", address: null });
  try {
    const bal = await walletUsdcBalance(rows[0].wallet_id);
    return c.json({ usdc: bal.toString(), address: rows[0].address });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/// Bridge the deposited USDC from the source chain to the user's Arc wallet
/// (recipient = the operator's own Arc address). Forwarder mints on Arc.
app.post("/wallet/topup/bridge", requireAuth, async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }
  const operator = c.get("address");
  let sourceChain = "";
  let amount = "";
  try {
    const b = (await c.req.json()) as { sourceChain?: unknown; amount?: unknown };
    if (typeof b.sourceChain !== "string" || !b.sourceChain) throw new Error("sourceChain required");
    if (typeof b.amount !== "string" || !/^\d+(\.\d+)?$/.test(b.amount) || Number(b.amount) <= 0) {
      throw new Error("amount must be a positive decimal string");
    }
    sourceChain = b.sourceChain;
    amount = b.amount;
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const { rows } = await query<{ wallet_id: string; address: string }>(
    "select wallet_id, address from circle_chain_wallets where operator = $1 and chain = $2",
    [operator, sourceChain],
  );
  if (!rows[0]) {
    return c.json({ error: "no deposit wallet for this chain; request a deposit address first." }, 400);
  }
  try {
    const { circleBridge } = await import("../chain/circleBridge.js");
    const result = await circleBridge({
      sourceChain,
      fromAddress: rows[0].address as `0x${string}`,
      destChain: "Arc_Testnet",
      amount,
      recipientAddress: operator as `0x${string}`,
    });
    void logEvent({
      kind: "wallet_topup",
      address: operator,
      context: { sourceChain, amount, state: result.state },
      source: "auth",
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void logEvent({ kind: "wallet_topup_failed", level: "error", address: operator, message, source: "auth" });
    return c.json({ error: message }, 502);
  }
});

app.get("/wallet/tx/:id", requireAgonScope("wallet:execute"), async (c) => {
  if (!circleDevConfigured()) {
    return c.json({ error: "Circle Dev-Controlled wallets are not configured on this server" }, 503);
  }
  const id = c.req.param("id");
  if (!id) return c.json({ error: "id required" }, 400);
  try {
    const state = await getTxState(id);
    return c.json(state);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

// Circle User-Controlled Wallet onboarding. These routes carry short-lived
// Circle credentials only in memory between the browser SDK and Circle's API.
// They never persist or log user tokens, encryption keys, refresh tokens, or
// keyshares. The feature is unavailable unless explicitly enabled and the
// backend has a Circle API key.
app.get("/auth/circle/user-controlled/config", (c) => {
  if (!circleUserControlled.enabled || !config.circle.userControlled.appId) {
    return c.json({ enabled: false, appId: null });
  }
  return c.json({ enabled: true, appId: config.circle.userControlled.appId });
});

app.post("/auth/circle/user-controlled/device", async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as { deviceId?: unknown; email?: unknown } | null;
  const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (deviceId.length < 8 || deviceId.length > 512 || !EMAIL_RE.test(email) || email.length > 254) {
    return c.json({ error: "valid deviceId and email required" }, 400);
  }
  try {
    const result = await circleUserControlled.createDeviceToken({ deviceId, email });
    return c.json(result);
  } catch {
    return c.json({ error: "Circle onboarding could not be started" }, 502);
  }
});

app.post("/auth/circle/user-controlled/prepare", async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as { userToken?: unknown } | null;
  const userToken = typeof body?.userToken === "string" ? body.userToken : "";
  if (userToken.length < 8 || userToken.length > 4096) return c.json({ error: "userToken required" }, 400);
  try {
    const result = await circleUserControlled.prepareWallet({ userToken });
    return c.json(result);
  } catch {
    return c.json({ error: "Circle wallet preparation failed" }, 502);
  }
});

app.post("/auth/circle/user-controlled/wallets", async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as { userToken?: unknown } | null;
  const userToken = typeof body?.userToken === "string" ? body.userToken : "";
  if (userToken.length < 8 || userToken.length > 4096) return c.json({ error: "userToken required" }, 400);
  try {
    return c.json({ wallets: await circleUserControlled.listWallets({ userToken }) });
  } catch {
    return c.json({ error: "Circle wallets could not be loaded" }, 502);
  }
});

app.post("/auth/circle/user-controlled/link", requireAuth, async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as {
    userToken?: unknown;
    walletId?: unknown;
    address?: unknown;
  } | null;
  const userToken = typeof body?.userToken === "string" ? body.userToken : "";
  const walletId = typeof body?.walletId === "string" ? body.walletId.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (userToken.length < 8 || userToken.length > 4096 || walletId.length < 8 || walletId.length > 256 || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "valid userToken, walletId, and address required" }, 400);
  }
  try {
    const wallet = await circleUserControlled.findOwnedWallet({ userToken, walletId, address });
    const providerUserId = wallet.userId;
    if (!providerUserId) return c.json({ error: "Circle wallet has no provider user identity" }, 502);
    const linked = await linkCircleUserControlledWallet({
      operatorAddress: c.get("address"),
      address: wallet.address,
      providerUserId,
      providerWalletId: wallet.id,
      blockchain: wallet.blockchain,
    }, pool);
    return c.json({
      address: linked.address,
      mode: "circle_user_controlled",
      custody: "user",
      signingSurface: "browser_circle",
      label: "Circle user-controlled wallet",
      linkedAt: linked.linkedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Circle wallet could not be linked";
    if (message.includes("already linked") || message.includes("mismatch")) return c.json({ error: message }, 409);
    return c.json({ error: "Circle wallet could not be linked" }, 502);
  }
});

app.post("/auth/circle/user-controlled/contract-challenge", requireAuth, async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as {
    userToken?: unknown;
    walletId?: unknown;
    address?: unknown;
    contractAddress?: unknown;
    callData?: unknown;
    idempotencyKey?: unknown;
    amount?: unknown;
    refId?: unknown;
  } | null;
  const userToken = typeof body?.userToken === "string" ? body.userToken : "";
  const walletId = typeof body?.walletId === "string" ? body.walletId.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  const contractAddress = typeof body?.contractAddress === "string" ? body.contractAddress.trim().toLowerCase() : "";
  const callData = typeof body?.callData === "string" ? body.callData.trim() : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : randomUUID();
  const amount = typeof body?.amount === "string" ? body.amount.trim() : undefined;
  const refId = typeof body?.refId === "string" ? body.refId.trim().slice(0, 128) : undefined;
  if (
    userToken.length < 8 ||
    userToken.length > 4096 ||
    walletId.length < 8 ||
    walletId.length > 256 ||
    !/^0x[a-fA-F0-9]{40}$/.test(address) ||
    !/^0x[a-fA-F0-9]{40}$/.test(contractAddress) ||
    callData.length < 4 ||
    !/^0x[0-9a-fA-F]*$/.test(callData) ||
    callData.length % 2 !== 0 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)
  ) {
    return c.json({ error: "valid user-controlled wallet and exact contract call required" }, 400);
  }
  if (!WRITE_ALLOWLIST.has(contractAddress)) return c.json({ error: "contract is not enabled for Agon writes" }, 403);
  const principal = await getWalletPrincipal(c.get("address"), address, pool);
  if (!principal || principal.providerWalletId !== walletId || principal.blockchain !== config.circle.blockchain) {
    return c.json({ error: "wallet principal is not linked to this operator" }, 403);
  }
  try {
    const challenge = await circleUserControlled.createContractExecutionChallenge({
      userToken,
      walletId,
      contractAddress: contractAddress as `0x${string}`,
      callData: callData as `0x${string}`,
      blockchain: config.circle.blockchain,
      idempotencyKey,
      ...(amount ? { amount } : {}),
      ...(refId ? { refId } : {}),
    });
    return c.json({ challengeId: challenge.challengeId, chainId: config.chainId, contractAddress, callData });
  } catch {
    return c.json({ error: "Circle contract challenge could not be created" }, 502);
  }
});

app.post("/auth/circle/user-controlled/contract-status", requireAuth, async (c) => {
  if (!circleUserControlled.enabled) return c.json({ error: "Circle user-controlled wallets are disabled" }, 503);
  const body = await c.req.json().catch(() => null) as {
    userToken?: unknown;
    walletId?: unknown;
    address?: unknown;
    challengeId?: unknown;
  } | null;
  const userToken = typeof body?.userToken === "string" ? body.userToken : "";
  const walletId = typeof body?.walletId === "string" ? body.walletId.trim() : "";
  const address = typeof body?.address === "string" ? body.address.trim().toLowerCase() : "";
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  if (userToken.length < 8 || userToken.length > 4096 || walletId.length < 8 || walletId.length > 256 || !/^0x[a-fA-F0-9]{40}$/.test(address) || challengeId.length < 8 || challengeId.length > 256) {
    return c.json({ error: "valid wallet and challenge are required" }, 400);
  }
  const principal = await getWalletPrincipal(c.get("address"), address, pool);
  if (!principal || principal.providerWalletId !== walletId || principal.blockchain !== config.circle.blockchain) {
    return c.json({ error: "wallet principal is not linked to this operator" }, 403);
  }
  try {
    return c.json(await circleUserControlled.getContractExecutionStatus({ userToken, challengeId }));
  } catch {
    return c.json({ error: "Circle contract status could not be loaded" }, 502);
  }
});

app.get("/auth/me", requireAgonScope("agon:read"), async (c) => {
  const address = c.get("address");
  const { rows } = await query<{
    address: string;
    x_handle: string | null;
    current_syndicate_id: string | null;
    email: string | null;
    circle_wallet_id: string | null;
    cycles: string;
  }>(
    "select address, x_handle, current_syndicate_id, email, circle_wallet_id, cycles from operators where address = $1",
    [address],
  );
  const op =
    rows[0] ?? {
      address,
      x_handle: null,
      current_syndicate_id: null,
      email: null,
      circle_wallet_id: null,
      cycles: "0",
    };
  // The wallet is the identity; any authenticated operator can compete. X is an
  // optional social link, not a gate. `walletKind` lets the frontend pick the
  // write path: "circle" => POST /wallet/execute, "wagmi" => useWriteContract.
  const walletKind: "circle" | "wagmi" = op.circle_wallet_id ? "circle" : "wagmi";
  const wallet = walletPrincipalForOperator({
    address: op.address,
    circleWalletId: op.circle_wallet_id,
  });
  const linkedWallets = await listWalletPrincipals(op.address, pool);
  const walletPrincipals = [
    wallet,
    ...linkedWallets.map((linked) => walletPrincipalForLinkedCircleWallet({
      address: linked.address,
      principalType: linked.principalType,
    })),
  ];

  // Count this address's enrolled passkeys so the settings UI can show "ADD
  // A PASSKEY" vs "PASSKEY ENABLED" without a separate round-trip.
  const credCount = await query<{ n: string }>(
    "select count(*)::text as n from webauthn_credentials where operator_address = $1",
    [op.address],
  );
  const hasPasskey = Number(credCount.rows[0]?.n ?? "0") > 0;

  // PointsLedger qualification gate. Off-chain check: the indexer
  // mirrors PointsLedger credits into operators.cycles, and entry is
  // refused below the configured floor. Default 0 = open to everyone
  // (matches the contract's "qualification enforced off-chain at
  // scoring time" note). On-chain enforcement on registerEntry needs a
  // contract redeploy.
  const minCycles = Number(process.env.QUALIFY_MIN_POINTS ?? "0");
  const cycles = Number(op.cycles ?? "0");
  const canEnterContests = minCycles <= 0 || cycles >= minCycles;

  return c.json({
    address: op.address,
    x_handle: op.x_handle,
    current_syndicate_id: op.current_syndicate_id,
    email: op.email,
    walletKind,
    wallet,
    walletPrincipals,
    hasPasskey,
    canEnterContests,
    cycles,
    cyclesRequired: minCycles,
  });
});

// ----- Activity and error log -----

// Open ingest: clients and services append events here. The friendly message is
// shown to the user; the raw error and context land here for the admin.
app.post("/events", async (c) => {
  let body: { level?: string; kind?: string; message?: string; context?: unknown; address?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  if (!body.kind || typeof body.kind !== "string") return c.json({ error: "kind required" }, 400);
  const level = body.level === "error" || body.level === "warn" ? body.level : "info";
  await logEvent({
    level,
    kind: body.kind,
    message: typeof body.message === "string" ? body.message : undefined,
    context: body.context,
    address: typeof body.address === "string" ? body.address : undefined,
    source: "web",
  });
  return c.json({ ok: true });
});

// Read: token-gated, admin only. Send the token as the x-admin-token header.
app.get("/admin/events", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin log disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 500);
  const level = c.req.query("level");
  const { rows } = level
    ? await query("select * from events where level = $1 order by id desc limit $2", [level, limit])
    : await query("select * from events order by id desc limit $1", [limit]);
  return c.json({ events: rows });
});

// ----- Admin console: live contract state + treasury actions -----
//
// All gated by the x-admin-token header (same token as /admin/events). Reads
// expose every contract's live USDC balance so the team can show the system
// running in front of judges. Writes are signed by the coordinator wallet,
// which holds COORDINATOR_ROLE and is the treasury for now (the standalone
// Treasury contract is parked in todo.md). USDC on Arc is the native token, so
// balances come from balanceOf at the canonical USDC address.

function adminAuthed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return secretMatches(c.req.header("x-admin-token"), config.adminToken);
}

type AdminLevel = "admin" | "support";
/// Resolve the caller's admin tier from the x-admin-token header. The full
/// ADMIN_TOKEN grants "admin" (every action); a SUPPORT_TOKEN grants "support"
/// (read-only: Members, Events, Audit, no money/settle/cancel). Unknown -> null.
/// Lets a support team triage issues without the keys to the money actions.
function adminLevel(c: { req: { header: (k: string) => string | undefined } }): AdminLevel | null {
  const t = c.req.header("x-admin-token");
  if (!t) return null;
  if (secretMatches(t, config.adminToken)) return "admin";
  if (secretMatches(t, config.supportToken)) return "support";
  return null;
}
/// Read-only gate: admin OR support may pass.
function readAuthed(c: { req: { header: (k: string) => string | undefined } }): boolean {
  return adminLevel(c) !== null;
}

function coordinatorSigner() {
  const pk = config.coordinator.privateKey;
  if (!pk) return null;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
  return { account, wallet };
}

/// Signer for the treasury EOA (where PrizeEscrow forwards fees). Distinct from
/// the coordinator: fees never touch the coordinator wallet, so a treasury
/// withdraw must sign with this key.
function treasurySigner() {
  const pk = config.treasury.privateKey;
  if (!pk) return null;
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(config.rpcHttp) });
  return { account, wallet };
}

const usdc6 = (b: bigint) => (Number(b) / 1e6).toFixed(2);
// Native USDC on Arc is 18-decimal (eth_getBalance); it is the SAME balance as the
// 6-decimal ERC-20 view, just a different scale (docs: stablecoin-native-model).
const usdc18 = (b: bigint) => (Number(b) / 1e18).toFixed(2);

// Last-known-good native balances, so a transient RPC failure shows the previous
// value ("as of Ns ago") instead of "read failed". Process memory: warms on the
// first successful load and rides out RPC hiccups (does not survive a restart).
const lastGoodBalance = new Map<string, { wei: bigint; at: number }>();
const cancelContestAbi = parseAbi(["function cancelContest(uint256 contestId)"]);
const cancelChallengeAbi = parseAbi(["function cancelChallenge(uint256 id)"]);
const treasuryViewAbi = parseAbi(["function treasury() view returns (address)"]);
const getContestRootAbi = parseAbi([
  "function getContest(uint256 contestId) view returns ((uint8 contestType,uint8 status,uint16 winnerCutBps,uint16 topN,uint16 platformFeeBps,address sponsor,address protocolTarget,bytes32 metric,uint64 startTime,uint64 endTime,uint256 prizePool,bytes32 finalRoot))",
]);
const getChallengeRootAbi = parseAbi([
  "function getChallenge(uint256 id) view returns ((address creator,uint8 kind,uint8 status,bool isPrivate,uint16 platformFeeBps,uint128 stake,uint64 maxEntrants,uint64 joinDeadline,uint64 resolveDeadline,bytes32 winnerRoot))",
]);

// Live snapshot: contract addresses, their USDC balances, the treasury and
// coordinator wallets, and headline DB counts.
app.get("/admin/overview", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const contracts = [
    { key: "ContestEngine", address: config.contracts.ContestEngine },
    { key: "ChallengeArena", address: config.contracts.ChallengeArena },
    { key: "PrizeEscrow", address: config.contracts.PrizeEscrow },
    { key: "AgentRegistry", address: config.contracts.AgentRegistry },
    { key: "SyndicateFactory", address: config.contracts.SyndicateFactory },
    { key: "PointsLedger", address: config.contracts.PointsLedger },
  ];

  // Treasury is wherever PrizeEscrow currently sends skimmed fees.
  let treasuryAddr: `0x${string}` | null = null;
  try {
    treasuryAddr = (await publicClient.readContract({
      address: config.contracts.PrizeEscrow,
      abi: treasuryViewAbi,
      functionName: "treasury",
    })) as `0x${string}`;
  } catch { /* leave null if the read fails */ }

  const signer = coordinatorSigner();
  const coordinatorAddress = signer?.account.address ?? null;

  const targets: `0x${string}`[] = [
    ...contracts.map((x) => x.address as `0x${string}`),
    ...(treasuryAddr ? [treasuryAddr] : []),
    ...(coordinatorAddress ? [coordinatorAddress] : []),
  ];
  // On Arc, native USDC (18-dec, eth_getBalance) and ERC-20 balanceOf (6-dec) are
  // the SAME balance (docs: stablecoin-native-model), so the native read is the
  // canonical value (it is what made a funded wallet read 0 when it failed).
  //
  // Read these SEQUENTIALLY, deliberately NOT through the transport batcher: this
  // is a tiny, critical set, and batching folds all of them into ONE JSON-RPC
  // request that the rate-limited public RPC can 429 as a unit — which nulled
  // every wallet at once ("read failed" on all cards). Decoupled, each is its own
  // lightweight request with the transport's built-in retry, so a busy moment
  // drops one balance, not all of them. A read that still fails stays null
  // (surfaced as "read failed"), never a fake 0.00. ~8 addresses, admin-only, so
  // the extra latency is fine; the durable cure is a dedicated ARC_RPC_HTTP.
  const balMap = new Map<string, bigint | null>();
  for (const a of targets) {
    const key = a.toLowerCase();
    const b = await publicClient.getBalance({ address: a }).then((x) => x as bigint).catch(() => null);
    if (b != null) lastGoodBalance.set(key, { wei: b, at: Date.now() });
    balMap.set(key, b);
  }

  const counts = await query<{
    contests: string; challenges: string; operators: string; agents: string;
    open_contests: string; live_challenges: string;
  }>(
    `select
       (select count(*) from contests) as contests,
       (select count(*) from challenges) as challenges,
       (select count(*) from operators) as operators,
       (select count(*) from agents) as agents,
       (select count(*) from contests where status = 'open') as open_contests,
       (select count(*) from challenges where status in ('open','locked')) as live_challenges`,
  );
  const k = counts.rows[0];

  // Resolve a wallet to { usdc, staleSeconds }: the fresh read, or the last-known-
  // good value with its age when the live read failed, or null if never read. So a
  // transient RPC failure shows the previous balance ("as of Ns ago"), not "read
  // failed". On Arc the balance IS the gas headroom (same asset), so no separate
  // gas figure is needed.
  const resolveBal = (addr: string | null | undefined): { usdc: string | null; staleSeconds: number | null } => {
    if (!addr) return { usdc: null, staleSeconds: null };
    const key = addr.toLowerCase();
    const fresh = balMap.get(key);
    if (fresh != null) return { usdc: usdc18(fresh), staleSeconds: null };
    const cached = lastGoodBalance.get(key);
    if (cached) return { usdc: usdc18(cached.wei), staleSeconds: Math.max(0, Math.round((Date.now() - cached.at) / 1000)) };
    return { usdc: null, staleSeconds: null };
  };
  return c.json({
    chainId: config.chainId,
    usdc: config.external.USDC,
    coordinator: coordinatorAddress
      ? { address: coordinatorAddress, ...resolveBal(coordinatorAddress) }
      : null,
    treasury: treasuryAddr
      ? { address: treasuryAddr, ...resolveBal(treasuryAddr) }
      : null,
    contracts: contracts.map((x) => ({
      key: x.key,
      address: x.address,
      ...resolveBal(x.address),
    })),
    counts: {
      contests: Number(k?.contests ?? 0),
      challenges: Number(k?.challenges ?? 0),
      operators: Number(k?.operators ?? 0),
      agents: Number(k?.agents ?? 0),
      openContests: Number(k?.open_contests ?? 0),
      liveChallenges: Number(k?.live_challenges ?? 0),
    },
  });
});

// Member directory + P0 traction, in one call. Every registered operator with
// their identity, agents, and event participation, plus the real-vs-platform
// headline counts, so the team proves traction and traces any user from the
// console without a SQL session. New registrations appear on the next poll.
app.get("/admin/operators", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  // Platform wallets to exclude from "real" counts: coordinator, treasury key,
  // and whatever PrizeEscrow currently points at as treasury.
  const platform = new Set<string>();
  const coord = coordinatorSigner();
  if (coord) platform.add(coord.account.address.toLowerCase());
  const treas = treasurySigner();
  if (treas) platform.add(treas.account.address.toLowerCase());
  try {
    const t = (await publicClient.readContract({
      address: config.contracts.PrizeEscrow,
      abi: treasuryViewAbi,
      functionName: "treasury",
    })) as string;
    if (t) platform.add(t.toLowerCase());
  } catch { /* leave as-is if the read fails */ }

  const { rows } = await query<{
    address: string; email: string | null; x_handle: string | null; discord_id: string | null;
    telegram_id: string | null; circle_wallet_id: string | null; created_at: string;
    has_passkey: boolean; agent_count: string; entered: boolean; usdc_won: string | null;
  }>(
    `select o.address, o.email, o.x_handle, o.discord_id, o.telegram_id, o.circle_wallet_id, o.created_at,
            exists(select 1 from webauthn_credentials w where lower(w.operator_address)=lower(o.address)) as has_passkey,
            (select count(*) from agents a where lower(a.owner)=lower(o.address)) as agent_count,
            (exists(select 1 from entries e where lower(e.operator)=lower(o.address))
             or exists(select 1 from challenge_entries ce where lower(ce.operator)=lower(o.address))) as entered,
            (select coalesce(sum(claimed_amount),0) from entries e
               where lower(e.operator)=lower(o.address) and e.claimed) as usdc_won
       from operators o
       order by o.created_at desc`,
  );

  const intStr = (v: string | null | undefined) => BigInt(String(v ?? "0").split(".")[0] || "0");
  const operators = rows.map((r) => {
    const isPlatform = platform.has(r.address.toLowerCase());
    const hasIdentity = Boolean(
      r.email || r.x_handle || r.discord_id || r.telegram_id || r.circle_wallet_id || r.has_passkey,
    );
    return {
      address: r.address,
      isPlatform,
      hasIdentity,
      entered: r.entered,
      agents: Number(r.agent_count ?? 0),
      identity: {
        email: r.email,
        x: r.x_handle,
        discord: r.discord_id,
        telegram: r.telegram_id,
        circleWallet: Boolean(r.circle_wallet_id),
        passkey: r.has_passkey,
      },
      usdcWon: usdc6(intStr(r.usdc_won)),
      createdAt: r.created_at,
    };
  });

  const real = operators.filter((o) => !o.isPlatform);
  // Human-funded campaigns: contests sponsored by a non-platform address.
  const camp = await query<{ n: string; pool: string | null }>(
    `select count(*) as n, coalesce(sum(prize_pool),0) as pool
       from contests where sponsor is not null and lower(sponsor) <> all($1::text[])`,
    [Array.from(platform)],
  );
  const c0 = camp.rows[0];

  return c.json({
    summary: {
      total: operators.length,
      realOperators: real.length,
      clearlyHuman: real.filter((o) => o.hasIdentity).length,
      enteredEvent: real.filter((o) => o.entered).length,
      clearlyHumanWhoEntered: real.filter((o) => o.hasIdentity && o.entered).length,
      humanFundedCampaigns: Number(c0?.n ?? 0),
      humanFundedPoolUsdc: usdc6(intStr(c0?.pool)),
    },
    operators,
  });
});

// Which tier this token grants, so the console shows or hides the money actions.
app.get("/admin/whoami", (c) => {
  const level = adminLevel(c);
  if (!level) return c.json({ error: "unauthorized" }, 401);
  return c.json({ level });
});

// Settlement audit: recompute a contest/challenge payout merkle root from the
// PUBLIC payout record and compare it to the root posted on chain, so the console
// proves a settlement was not tampered with (P2) without a CLI. Read-only tier.
app.get("/admin/audit/:source/:id", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if ((source !== "contest" && source !== "challenge") || !Number.isFinite(id)) {
    return c.json({ error: "bad source/id" }, 400);
  }
  const table = source === "contest" ? "payouts" : "challenge_payouts";
  const idCol = source === "contest" ? "contest_id" : "challenge_id";
  const { rows: payouts } = await query<{ rank: number; operator: string; amount: string }>(
    `select rank, operator, amount from ${table} where ${idCol} = $1 order by rank`,
    [id],
  );
  if (payouts.length === 0) {
    return c.json({ source, id, settled: false, message: "no payouts persisted (not settled yet, or an empty field)" });
  }
  const toWei = (v: string) => BigInt(String(v).split(".")[0] || "0");
  const leaves = payouts.map((p) => payoutLeaf(p.operator as `0x${string}`, toWei(p.amount)));
  const recomputed = merkleRoot(leaves).toLowerCase();

  let onchain = "";
  try {
    if (source === "contest") {
      const cc = (await publicClient.readContract({
        address: config.contracts.ContestEngine,
        abi: getContestRootAbi,
        functionName: "getContest",
        args: [BigInt(id)],
      })) as { finalRoot: string };
      onchain = cc.finalRoot.toLowerCase();
    } else {
      const ch = (await publicClient.readContract({
        address: config.contracts.ChallengeArena,
        abi: getChallengeRootAbi,
        functionName: "getChallenge",
        args: [BigInt(id)],
      })) as { winnerRoot: string };
      onchain = ch.winnerRoot.toLowerCase();
    }
  } catch {
    return c.json({ error: "chain read failed" }, 502);
  }

  return c.json({
    source,
    id,
    settled: true,
    match: recomputed === onchain,
    recomputedRoot: recomputed,
    onchainRoot: onchain,
    leaves: payouts.map((p) => ({ rank: p.rank, operator: p.operator, amountUsdc: usdc6(toWei(p.amount)) })),
  });
});

// Withdraw treasury USDC to a destination. PrizeEscrow forwards fees straight
// to the treasury EOA, so this MUST sign with the treasury key. It falls back
// to the coordinator only when the coordinator IS the on-chain treasury;
// otherwise it refuses rather than silently moving coordinator funds (the bug
// this replaces). amount is a USDC decimal string; balance-checked.
app.post("/admin/treasury/withdraw", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ to?: string; amount?: string | number }>();
  const to = (body.to ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return c.json({ error: "invalid destination address" }, 400);
  const amountNum = Number(body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return c.json({ error: "amount must be positive" }, 400);
  const amount6 = BigInt(Math.round(amountNum * 1e6));

  // Where the contract actually sends fees.
  const onchainTreasury = (await publicClient
    .readContract({ address: config.contracts.PrizeEscrow, abi: treasuryViewAbi, functionName: "treasury" })
    .catch(() => null)) as `0x${string}` | null;

  // Pick the right signer: treasury key if present (and matching), else the
  // coordinator only when it is itself the treasury.
  const tre = treasurySigner();
  const coord = coordinatorSigner();
  let signer: NonNullable<ReturnType<typeof coordinatorSigner>>;
  if (tre) {
    if (onchainTreasury && tre.account.address.toLowerCase() !== onchainTreasury.toLowerCase()) {
      return c.json(
        { error: `TREASURY_PRIVATE_KEY is ${tre.account.address} but the on-chain treasury is ${onchainTreasury}` },
        400,
      );
    }
    signer = tre;
  } else if (coord && onchainTreasury && coord.account.address.toLowerCase() === onchainTreasury.toLowerCase()) {
    signer = coord;
  } else {
    return c.json(
      {
        error: onchainTreasury
          ? `treasury key not configured. set TREASURY_PRIVATE_KEY for ${onchainTreasury} to withdraw fees (the coordinator is a different wallet, so it cannot move treasury funds).`
          : "treasury address unreadable and no treasury key configured.",
      },
      503,
    );
  }

  const bal = (await publicClient.readContract({
    address: config.external.USDC,
    abi: usdcMinimalAbi,
    functionName: "balanceOf",
    args: [signer.account.address],
  })) as bigint;
  if (amount6 > bal) return c.json({ error: `insufficient treasury balance (have ${usdc6(bal)} USDC)` }, 400);

  try {
    const hash = await signer.wallet.writeContract({
      address: config.external.USDC,
      abi: usdcMinimalAbi,
      functionName: "transfer",
      args: [to as `0x${string}`, amount6],
    });
    await logEvent({
      level: "warn",
      kind: "admin_treasury_withdraw",
      message: `withdrew ${usdc6(amount6)} USDC from treasury ${signer.account.address} to ${to}`,
      source: "auth",
      context: { from: signer.account.address, to, amount6: amount6.toString(), hash },
    });
    return c.json({ ok: true, hash });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "withdraw failed" }, 500);
  }
});

// Cancel a wrongly-opened contest or challenge. The coordinator wallet holds
// COORDINATOR_ROLE, so it can cancel either. A cancelled contest refunds the
// sponsor's pool; a cancelled challenge lets entrants pull their stake back.
app.post("/admin/:source/:id/cancel", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ error: "bad source or id" }, 400);
  }
  const signer = coordinatorSigner();
  if (!signer) return c.json({ error: "no coordinator signer configured" }, 503);

  try {
    const hash =
      source === "contest"
        ? await signer.wallet.writeContract({
            address: config.contracts.ContestEngine,
            abi: cancelContestAbi,
            functionName: "cancelContest",
            args: [BigInt(id)],
          })
        : await signer.wallet.writeContract({
            address: config.contracts.ChallengeArena,
            abi: cancelChallengeAbi,
            functionName: "cancelChallenge",
            args: [BigInt(id)],
          });
    await logEvent({
      level: "warn",
      kind: "admin_cancel",
      message: `cancelled ${source} #${id}`,
      source: "auth",
      context: { source, id, hash },
    });
    return c.json({ ok: true, hash });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "cancel failed" }, 500);
  }
});

// ----- Admin ops queue -----
//
// The admin console enqueues a command here; the COORDINATOR process drains the
// admin_commands table and executes it there, so a manual force-settle/resolve
// runs with the coordinator's nonce owner, WS broadcast, and single-flight guard
// instead of racing the sweeper from this API process. Use this to unstick a
// contest whose window closed but never settled.
const ADMIN_COMMAND_KINDS = new Set([
  "settle_contest",
  "resolve_challenge",
  "cancel_contest",
  "cancel_challenge",
  // Mission ops (targetId optional: 0 = all, or a specific mission id).
  "refund_missions",
  "clear_missions",
  // Open a mission on demand (targetId ignored; params carry the shape).
  "open_mission",
  // Agon verification operations. These are executed by the coordinator
  // wallet only after the admin console explicitly queues them.
  "agon_grant_verifier",
  "agon_revoke_verifier",
  "agon_grant_arena_evaluator",
  "agon_revoke_arena_evaluator",
  "agon_verify_listing",
  "agon_recheck_listing",
]);

app.post("/admin/commands", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    kind?: string;
    targetId?: number | string;
    params?: Record<string, unknown>;
  };
  const kind = String(body.kind ?? "");
  // open_mission ignores targetId; default it to 0 so the shared validation passes.
  const targetId = kind === "open_mission" ? 0 : Number(body.targetId);
  if (!ADMIN_COMMAND_KINDS.has(kind)) return c.json({ error: "bad kind" }, 400);
  if (!Number.isFinite(targetId) || targetId < 0) return c.json({ error: "bad targetId" }, 400);
  const params = body.params && typeof body.params === "object" ? body.params : null;
  const { rows } = await query<{ id: string }>(
    "insert into admin_commands (kind, target_id, requested_by, params) values ($1, $2, $3, $4) returning id::text as id",
    [kind, targetId, "admin-console", params ? JSON.stringify(params) : null],
  );
  await logEvent({
    level: "warn",
    kind: "admin_command",
    message: `queued ${kind} #${targetId}`,
    source: "auth",
    context: { kind, targetId },
  });
  return c.json({ ok: true, id: rows[0]?.id });
});

app.get("/admin/commands", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const { rows } = await query<{
    id: string;
    kind: string;
    target_id: string;
    status: string;
    result: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `select id::text as id, kind, target_id::text as target_id, status, result, created_at, updated_at
       from admin_commands order by id desc limit 25`,
  );
  return c.json({
    commands: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      targetId: r.target_id,
      status: r.status,
      result: r.result,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

app.get("/admin/agon/jobs", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? "50") || 50, 200));
  const jobs = await monitorStore.recentJobs(limit);
  return c.json({
    jobs: jobs.map((j) => ({
      jobId: j.jobId, rootId: j.rootId, parentId: j.parentId, depth: j.depth, provider: j.providerLabel,
      buyer: j.buyerRef.startsWith("budget:op:") ? "web" : j.buyerRef.startsWith("budget:tg:") ? "telegram" : j.buyerRef.startsWith("agent:") ? j.buyerRef : "other",
      state: j.state, price: formatUsdc(j.priceAtomic), traceId: j.traceId, createdAt: j.createdAt.toISOString(), updatedAt: j.updatedAt.toISOString(),
      receiptUrl: `${stage.settings.siteUrl}/r/${j.rootId}`,
    })),
  });
});

app.get("/admin/agon/alerts", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const alerts = await agonOperationsAlerts.list(Number(c.req.query("limit") ?? 100));
  return c.json({
    alerts: alerts.map((alert) => ({
      ...alert,
      firstSeenAt: alert.firstSeenAt.toISOString(),
      lastSeenAt: alert.lastSeenAt.toISOString(),
      acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    })),
  });
});

app.post("/admin/agon/alert-subscriptions", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await c.req.json<Record<string, unknown>>(); }
  catch { return c.json({ error: "invalid JSON" }, 400); }
  const operatorAddress = typeof body.operatorAddress === "string" ? body.operatorAddress.toLowerCase() : "";
  const scopeType = body.scopeType;
  const scopeReference = typeof body.scopeReference === "string" ? body.scopeReference.trim().toLowerCase() : null;
  const source = body.source;
  const minimumSeverity = body.minimumSeverity;
  const inApp = body.inApp !== false;
  const telegram = body.telegram === true;
  const enabled = body.enabled !== false;
  if (!/^0x[0-9a-f]{40}$/.test(operatorAddress)) return c.json({ error: "operatorAddress must be a wallet address" }, 400);
  if (scopeType !== "platform" && scopeType !== "service") return c.json({ error: "invalid scopeType" }, 400);
  if (scopeType === "service" && !scopeReference) return c.json({ error: "service scope requires scopeReference" }, 400);
  if (!(["any", "certification", "arena", "stage"] as unknown[]).includes(source)) return c.json({ error: "invalid alert source" }, 400);
  if (!(["info", "warning", "critical"] as unknown[]).includes(minimumSeverity)) return c.json({ error: "invalid minimum severity" }, 400);
  if (!inApp && !telegram) return c.json({ error: "at least one alert channel is required" }, 400);
  const recipient = await query<{ telegram_linked: boolean }>(
    "select telegram_id is not null as telegram_linked from operators where address = $1",
    [operatorAddress],
  );
  if ((recipient.rowCount ?? 0) === 0) return c.json({ error: "operator does not exist" }, 404);
  if (telegram && recipient.rows[0]?.telegram_linked !== true) return c.json({ error: "operator must link Telegram first" }, 409);
  const subscription = await agonOperationsAlerts.upsertSubscription({
    operatorAddress,
    scopeType,
    scopeReference: scopeType === "platform" ? null : scopeReference,
    source: source as "any" | "certification" | "arena" | "stage",
    minimumSeverity: minimumSeverity as "info" | "warning" | "critical",
    inApp,
    telegram,
    enabled,
  });
  return c.json({ subscription });
});

app.post("/admin/agon/alerts/:alertId/acknowledge", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!adminAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const alert = await agonOperationsAlerts.acknowledge(c.req.param("alertId"), "admin-console");
  if (!alert) return c.json({ error: "open alert not found" }, 404);
  await logEvent({
    level: "warn",
    kind: "agon_alert_acknowledged",
    message: `acknowledged ${alert.severity} AGON alert ${alert.alertId}`,
    source: "auth",
    context: { alertId: alert.alertId, fingerprint: alert.fingerprint, source: alert.source },
  });
  return c.json({ ok: true, alertId: alert.alertId, status: alert.status, acknowledgedAt: alert.acknowledgedAt });
});

app.get("/admin/agon/evidence/:listingId", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const listingId = Number(c.req.param("listingId"));
  if (!Number.isSafeInteger(listingId) || listingId <= 0) return c.json({ error: "bad listingId" }, 400);
  const { rows } = await query<{ id: string; listing_id: string; agent_id: string; passed: boolean; evidence_hash: string; evidence: unknown; verifier: string; created_at: string }>(
    `select id::text, listing_id::text, agent_id::text, passed, evidence_hash, evidence, verifier, created_at
       from agon_verification_evidence where listing_id = $1 order by id desc limit 20`,
    [listingId],
  );
  return c.json({ evidence: rows.map((r) => ({ id: r.id, listingId: r.listing_id, agentId: r.agent_id, passed: r.passed, evidenceHash: r.evidence_hash, evidence: r.evidence, verifier: r.verifier, createdAt: r.created_at })) });
});

// The settlement ledger judges can read: every REAL on-chain payment the agent
// economy produced, both rails. A2A = agent-to-agent intel buys (USDC on Arc);
// x402 = operatives paying external data services (USDC on the seller chain,
// e.g. Base). Only settled rows with a tx hash count, so this is proof, not
// intent. The headline totals are the quotable traction number. Read-gated.
app.get("/admin/settlements", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const limit = Math.min(200, Math.max(10, Number(c.req.query("limit") ?? "100")));

  const usdc = (v: string | null) => (Number(v ?? "0") / 1e6).toFixed(4);

  const [a2a, x402, totals] = await Promise.all([
    query<{
      contest_id: string; buyer_agent_id: string; seller_agent_id: string;
      fragment_id: string; price_usdc_6: string; tx_hash: string; created_at: string;
    }>(
      `select contest_id::text, buyer_agent_id::text, seller_agent_id::text,
              fragment_id, price_usdc_6, tx_hash, created_at
         from a2a_trades
        where status = 'settled' and tx_hash is not null
        order by created_at desc limit $1`,
      [limit],
    ),
    query<{
      contest_id: string | null; agent_id: string; endpoint_label: string | null;
      usdc_amount_6: string; chain: string; tx_hash: string; created_at: string;
    }>(
      `select contest_id::text, agent_id::text, endpoint_label,
              usdc_amount_6, chain, tx_hash, created_at
         from nanopayments
        where status = 'settled' and tx_hash is not null
        order by created_at desc limit $1`,
      [limit],
    ),
    query<{ a2a_n: string; a2a_sum: string; x402_n: string; x402_sum: string }>(
      `select
         (select count(*) from a2a_trades where status='settled' and tx_hash is not null) as a2a_n,
         (select coalesce(sum(price_usdc_6::numeric),0) from a2a_trades where status='settled' and tx_hash is not null) as a2a_sum,
         (select count(*) from nanopayments where status='settled' and tx_hash is not null) as x402_n,
         (select coalesce(sum(usdc_amount_6::numeric),0) from nanopayments where status='settled' and tx_hash is not null) as x402_sum`,
    ),
  ]);

  const rows = [
    ...a2a.rows.map((r) => ({
      rail: "a2a" as const,
      contestId: r.contest_id,
      payer: `agent ${r.buyer_agent_id}`,
      payee: `agent ${r.seller_agent_id}`,
      label: `intel ${r.fragment_id}`,
      amountUsdc: usdc(r.price_usdc_6),
      chain: "arc",
      txHash: r.tx_hash,
      ts: r.created_at,
    })),
    ...x402.rows.map((r) => ({
      rail: "x402" as const,
      contestId: r.contest_id ?? "",
      payer: `agent ${r.agent_id}`,
      payee: r.endpoint_label ?? "data service",
      label: r.endpoint_label ?? "x402 call",
      amountUsdc: usdc(r.usdc_amount_6),
      chain: (r.chain ?? "base").toLowerCase(),
      txHash: r.tx_hash,
      ts: r.created_at,
    })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const t = totals.rows[0];
  const a2aSum = Number(t?.a2a_sum ?? "0") / 1e6;
  const x402Sum = Number(t?.x402_sum ?? "0") / 1e6;
  return c.json({
    totals: {
      a2aCount: Number(t?.a2a_n ?? "0"),
      a2aUsdc: a2aSum.toFixed(4),
      x402Count: Number(t?.x402_n ?? "0"),
      x402Usdc: x402Sum.toFixed(4),
      totalCount: Number(t?.a2a_n ?? "0") + Number(t?.x402_n ?? "0"),
      totalUsdc: (a2aSum + x402Sum).toFixed(4),
    },
    rows,
  });
});

// The mission economics an admin can tune, each with its current effective
// value and the env var that sets it — so the whole fee/price model is visible
// and clearly stated in one place. Read-gated. Set via .env (global) or per
// mission on the OPEN A MISSION NOW card.
app.get("/admin/mission-config", async (c) => {
  if (!config.adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (!readAuthed(c)) return c.json({ error: "unauthorized" }, 401);
  const m = config.mission;
  return c.json({
    economics: [
      { key: "MISSION_OPERATIVE_FEE_BPS", label: "Operative join fee", value: `${(m.operativeFeeBps / 100).toFixed(2)}%`, note: "charged to the treasury on entry; refunded if the mission cancels, on withdrawal, or when the operative earns it back (see below)" },
      { key: "MISSION_REFUND_MIN_SPEND_FRAC", label: "Fee-back threshold", value: `${Math.round(m.refundMinSpendFrac * 100)}%`, note: "an operative that spends at least this fraction of its float on real intel/data earns its full join fee back at settlement; idlers pay full freight" },
      { key: "MISSION_BASE_PRICE_MIN_USDC", label: "Platform intel min", value: `${m.basePriceMinUsdc} USDC`, note: "cheapest platform shelf price" },
      { key: "MISSION_BASE_PRICE_MAX_USDC", label: "Platform intel max", value: `${m.basePriceMaxUsdc} USDC`, note: "priciest platform shelf price (at max weight)" },
      { key: "MISSION_LISTING_PRICE_MAX_USDC", label: "Agent listing cap", value: `${m.listingPriceMaxUsdc} USDC`, note: "most an operator specialist may charge per piece" },
      { key: "MISSION_OPERATIVE_FLOAT_USDC", label: "Operative float floor", value: `${m.operativeFloatUsdc} USDC`, note: "min USDC funded to each operative to buy intel (auto-sized up to the intel cost)" },
      { key: "MISSION_FUND_MAX_USDC", label: "Per-operative float cap", value: `${m.fundMaxUsdc} USDC`, note: "ceiling on the float fronted per operative" },
      { key: "MISSION_MIN_SCORE", label: "Settlement bar", value: String(m.minScore), note: "if no operative clears this, the mission cancels and refunds" },
      { key: "MISSION_EXTERNAL_FRACTION", label: "External (x402) fraction", value: m.externalFraction.toFixed(2), note: "0 = always internal A2A market, 1 = always external x402" },
      { key: "MISSION_SPECIALIST_SEATS", label: "Specialist seats", value: String(m.specialistSeats), note: "supply-side seats (intel sellers)" },
      { key: "MISSION_OPERATIVE_SEATS", label: "Operative seats", value: String(m.operativeSeats), note: "competitor field size" },
      { key: "MISSION_INTEL_PIECES", label: "Intel pieces", value: String(m.intelPieces), note: "fragments minted per mission" },
      { key: "MISSION_PER_DAY", label: "Missions per day", value: process.env.MISSION_PER_DAY ?? "2", note: "autopilot cadence" },
      { key: "MISSION_JUDGE_MODEL", label: "Judge model", value: m.judgeModel ?? config.llm.model, note: "grades deliverable quality (Conduit → Anthropic)" },
      { key: "MISSION_JUDGE_FALLBACK_MODEL", label: "Judge fallback", value: config.llm.openrouterApiKey ? m.judgeFallbackModel : "(no OpenRouter key)", note: "OpenRouter model tried if the primary judge fails, then an offline ground-truth scorer" },
    ],
  });
});

// ----- Weekly syndicate reward pool -----
//
// The coordinator splits a config-funded pool across syndicate members each
// week (see computeSyndicatePool). These endpoints let a member see their
// unclaimed share and pull it. The payout is a dev-controlled USDC transfer
// from the coordinator/treasury wallet, the same path as withdrawals.

// Public read: an operator's unclaimed syndicate share total + per-week rows.
app.get("/operators/:address/syndicate-pool", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ error: "invalid address" }, 400);
  const { rows } = await query<{ week_id: string; share_usdc6: string; claimed: boolean; claim_tx: string | null }>(
    `select week_id, share_usdc6::text as share_usdc6, claimed, claim_tx
       from syndicate_pool_shares where operator = $1 order by week_id desc limit 20`,
    [address],
  );
  const unclaimed6 = rows
    .filter((r) => !r.claimed)
    .reduce((s, r) => s + BigInt(r.share_usdc6), 0n);
  return c.json({
    unclaimedUsdc6: unclaimed6.toString(),
    weeks: rows.map((r) => ({
      weekId: r.week_id,
      shareUsdc6: r.share_usdc6,
      claimed: r.claimed,
      claimTx: r.claim_tx,
    })),
  });
});

// Claim all of the caller's unclaimed syndicate shares in one transfer. Flips
// the rows to claimed first (atomic, so a concurrent call can't double-claim),
// then sends; on send failure it reverts the rows it just flipped.
app.post("/syndicate-pool/claim", requireAuth, async (c) => {
  const operator = (c.get("address") as string).toLowerCase();
  const signer = coordinatorSigner();
  if (!signer) return c.json({ error: "payouts unavailable (no signer configured)" }, 503);

  // Atomically claim the unclaimed rows and capture them.
  const claimed = await query<{ week_id: string; share_usdc6: string }>(
    `update syndicate_pool_shares set claimed = true, claimed_at = now()
      where operator = $1 and claimed = false
      returning week_id, share_usdc6::text as share_usdc6`,
    [operator],
  );
  if (claimed.rows.length === 0) return c.json({ error: "nothing to claim" }, 400);
  const weekIds = claimed.rows.map((r) => r.week_id);
  const total6 = claimed.rows.reduce((s, r) => s + BigInt(r.share_usdc6), 0n);

  const revert = async () => {
    await query(
      `update syndicate_pool_shares set claimed = false, claimed_at = null
        where operator = $1 and claim_tx is null and week_id = any($2::text[])`,
      [operator, weekIds],
    );
  };

  // Don't pay out more than the treasury wallet holds.
  const bal = (await publicClient.readContract({
    address: config.external.USDC,
    abi: usdcMinimalAbi,
    functionName: "balanceOf",
    args: [signer.account.address],
  })) as bigint;
  if (total6 > bal) {
    await revert();
    return c.json({ error: "treasury is funding the pool, try again shortly" }, 503);
  }

  try {
    const hash = await signer.wallet.writeContract({
      address: config.external.USDC,
      abi: usdcMinimalAbi,
      functionName: "transfer",
      args: [operator as `0x${string}`, total6],
    });
    await query(
      `update syndicate_pool_shares set claim_tx = $2
        where operator = $1 and claim_tx is null and week_id = any($3::text[])`,
      [operator, hash, weekIds],
    );
    return c.json({ ok: true, hash, amountUsdc6: total6.toString() });
  } catch (e) {
    await revert();
    return c.json({ error: e instanceof Error ? e.message : "claim transfer failed" }, 500);
  }
});

// Set the scoring_mode for a contest or challenge after creation. Called
// by the create-modal once the on-chain tx confirms. Accepts one of:
// pnl_mtm | pnl_realized | volume. Falls through to pnl_mtm if anything
// else is provided. Auth-gated so only the creator can set their event.
app.post("/events/:source/:id/scoring-mode", requireAuth, async (c) => {
  const operator = (c.get("address") as string).toLowerCase();
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ error: "bad source or id" }, 400);
  }
  const body = await c.req.json<{ mode?: string }>();
  const allowed = ["pnl_mtm", "pnl_realized", "volume"];
  const mode = body.mode && allowed.includes(body.mode) ? body.mode : "pnl_mtm";

  if (source === "contest") {
    const { rows } = await query<{ sponsor: string }>(
      "select sponsor from contests where id = $1",
      [id],
    );
    if (!rows[0]) return c.json({ error: "contest not found" }, 404);
    if (rows[0].sponsor.toLowerCase() !== operator) {
      return c.json({ error: "not the sponsor" }, 403);
    }
    await query("update contests set scoring_mode = $1 where id = $2", [mode, id]);
  } else {
    const { rows } = await query<{ creator: string }>(
      "select creator from challenges where id = $1",
      [id],
    );
    if (!rows[0]) return c.json({ error: "challenge not found" }, 404);
    if (rows[0].creator.toLowerCase() !== operator) {
      return c.json({ error: "not the creator" }, 403);
    }
    await query("update challenges set scoring_mode = $1 where id = $2", [mode, id]);
  }
  return c.json({ ok: true, mode });
});

// Set the prize distribution for a contest or challenge after creation.
// Creator-gated like scoring-mode. preset is one of the fixed keys, or
// 'custom' with a { winnersBps:[], restSharedBps } config that must sum to
// 10000 (basis points). Stored off-chain; settlement reads it to split the
// pool. Null preset keeps the legacy curve.
const PAYOUT_PRESET_KEYS = new Set([
  "standard",
  "winner_take_all",
  "top2",
  "top3",
  "top5_half_field",
  "even_all",
  "custom",
]);

function validCustomPayout(config: unknown): boolean {
  const c = config as { winnersBps?: unknown; restSharedBps?: unknown } | null;
  if (!c || !Array.isArray(c.winnersBps)) return false;
  const rest = typeof c.restSharedBps === "number" ? c.restSharedBps : 0;
  if (c.winnersBps.length > 20) return false;
  if (!c.winnersBps.every((n) => Number.isInteger(n) && n >= 0 && n <= 10000)) return false;
  if (!Number.isInteger(rest) || rest < 0 || rest > 10000) return false;
  const sum = (c.winnersBps as number[]).reduce((a, b) => a + b, 0) + rest;
  return sum === 10000;
}

app.post("/events/:source/:id/payout", requireAuth, async (c) => {
  const operator = (c.get("address") as string).toLowerCase();
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ error: "bad source or id" }, 400);
  }
  const body = await c.req.json<{ preset?: string; config?: unknown }>();
  const preset = body.preset && PAYOUT_PRESET_KEYS.has(body.preset) ? body.preset : null;
  if (!preset) return c.json({ error: "unknown payout preset" }, 400);
  const config = preset === "custom" ? body.config ?? null : null;
  if (preset === "custom" && !validCustomPayout(config)) {
    return c.json({ error: "custom shares must be whole basis points summing to 10000" }, 400);
  }
  // 'standard' clears the override back to the legacy curve.
  const storedPreset = preset === "standard" ? null : preset;

  const table = source === "contest" ? "contests" : "challenges";
  const ownerCol = source === "contest" ? "sponsor" : "creator";
  const { rows } = await query<{ owner: string }>(
    `select ${ownerCol} as owner from ${table} where id = $1`,
    [id],
  );
  if (!rows[0]) return c.json({ error: `${source} not found` }, 404);
  if (rows[0].owner.toLowerCase() !== operator) {
    return c.json({ error: source === "contest" ? "not the sponsor" : "not the creator" }, 403);
  }
  await query(
    `update ${table} set payout_preset = $1, payout_config = $2 where id = $3`,
    [storedPreset, config ? JSON.stringify(config) : null, id],
  );
  return c.json({ ok: true, preset: storedPreset, config });
});

// Read the prize distribution so the live / detail page can show "top 5 take
// 50%, rest shared" or similar. Public.
app.get("/events/:source/:id/payout", async (c) => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ preset: null, config: null });
  }
  const table = source === "contest" ? "contests" : "challenges";
  const { rows } = await query<{ payout_preset: string | null; payout_config: unknown }>(
    `select payout_preset, payout_config from ${table} where id = $1`,
    [id],
  );
  return c.json({ preset: rows[0]?.payout_preset ?? null, config: rows[0]?.payout_config ?? null });
});

// Read the scoring_mode for a contest or challenge so the live page can
// show "scored by mark-to-market PnL" or similar in the eyebrow.
app.get("/events/:source/:id/scoring-mode", async (c) => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ mode: "pnl_mtm" });
  }
  const table = source === "contest" ? "contests" : "challenges";
  const { rows } = await query<{ scoring_mode: string | null }>(
    `select scoring_mode from ${table} where id = $1`,
    [id],
  );
  const mode = rows[0]?.scoring_mode ?? "pnl_mtm";
  return c.json({ mode });
});

// Pinned Arcana markets for a specific event (contest or challenge). Returns
// the market list the coordinator pinned at open so the live page can show
// the round's menu before any agent has placed a trade. Works for both
// contests and challenges because contest_arcana_markets is id-agnostic
// (contest_id column holds either kind).
app.get("/events/:source/:id/arcana-pins", async (c) => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (!["contest", "challenge"].includes(source) || !Number.isFinite(id)) {
    return c.json({ markets: [] });
  }
  const { rows } = await query<{
    market_id: string;
    title: string;
    category: string;
    end_time: string;
  }>(
    `select market_id, title, category, extract(epoch from end_time)::bigint::text as end_time
       from contest_arcana_markets where contest_id = $1 order by market_id asc`,
    [id],
  );
  return c.json({
    markets: rows.map((r) => ({
      id: Number(r.market_id),
      title: r.title,
      category: r.category,
      endTime: Number(r.end_time),
    })),
  });
});

// Recent Arcana events feed. Returns the latest N rows from arcana_events
// for the WHAT'S HAPPENING line and any future debug/admin surface. Public
// read (events are already on chain).
app.get("/arcana/feed", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20), 1), 100);
  const { rows } = await query<{
    event_kind: string;
    market_id: string;
    args: Record<string, unknown>;
    tx_hash: string;
    block_number: string;
    created_at: string;
  }>(
    `select event_kind, market_id, args, tx_hash, block_number::text, created_at::text
       from arcana_events order by id desc limit $1`,
    [limit],
  );
  return c.json({
    events: rows.map((r) => ({
      kind: r.event_kind,
      market_id: Number(r.market_id),
      tx_hash: r.tx_hash,
      block_number: Number(r.block_number),
      created_at: r.created_at,
      args: r.args,
    })),
  });
});

// Arcana Markets heartbeat. Read-only public surface (no admin token needed)
// so the live page can render an "Arcana status" pip without privileged auth.
// Returns: contract address, indexer cursor, last reconcile timestamp, open
// market count, last 5 markets summary. Always responds in under 50ms because
// everything reads from arcana_markets + arcana_indexer_state (no chain calls).
app.get("/admin/arcana/state", async (c) => {
  const [cursorRows, openRows, latestRows, eventCountRows] = await Promise.all([
    query<{ last_block: string; updated_at: string }>(
      "select last_block, updated_at from arcana_indexer_state where id = 1",
    ),
    query<{ open_count: string }>(
      `select count(*)::text as open_count from arcana_markets
        where resolved = false and cancelled = false and end_time > now()`,
    ),
    query<{
      market_id: string;
      title: string;
      category: string;
      end_time: string;
      yes_pool: string;
      no_pool: string;
      resolved: boolean;
      cancelled: boolean;
      outcome: boolean | null;
    }>(
      `select market_id, title, category, end_time, yes_pool, no_pool, resolved, cancelled, outcome
         from arcana_markets order by market_id desc limit 5`,
    ),
    query<{ total: string; last_event_at: string | null }>(
      `select count(*)::text as total, max(created_at)::text as last_event_at from arcana_events`,
    ),
  ]);

  return c.json({
    address: config.arcana.address,
    indexing: config.arcana.indexing,
    cursor: cursorRows.rows[0]
      ? {
          last_block: cursorRows.rows[0].last_block,
          updated_at: cursorRows.rows[0].updated_at,
        }
      : null,
    open_markets: Number(openRows.rows[0]?.open_count ?? 0),
    latest: latestRows.rows.map((r) => ({
      market_id: Number(r.market_id),
      title: r.title,
      category: r.category,
      end_time: r.end_time,
      yes_pool_usdc: Number(r.yes_pool) / 1e6,
      no_pool_usdc: Number(r.no_pool) / 1e6,
      resolved: r.resolved,
      cancelled: r.cancelled,
      outcome: r.outcome,
    })),
    events: {
      total: Number(eventCountRows.rows[0]?.total ?? 0),
      last_event_at: eventCountRows.rows[0]?.last_event_at ?? null,
    },
  });
});

// ----- Claim proofs -----

// Returns the (amount, proof) a winner needs to call claimPrize, rebuilt from
// the stored payout tree. Public read: a proof is only useful to the operator
// it pays, and the contract verifies it on-chain.
app.get("/contests/:id/payout", async (c) => {
  const contestId = Number(c.req.param("id"));
  const operator = (c.req.query("operator") ?? "").toLowerCase();
  if (!Number.isFinite(contestId) || !/^0x[a-f0-9]{40}$/.test(operator)) {
    return c.json({ amount: null });
  }

  const { rows } = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from payouts where contest_id = $1 order by rank",
    [contestId],
  );
  if (rows.length === 0) return c.json({ amount: null });

  const leaves = rows.map((r) => payoutLeaf(r.operator as `0x${string}`, BigInt(r.amount)));
  const idx = rows.findIndex((r) => r.operator.toLowerCase() === operator);
  if (idx === -1) return c.json({ amount: null });

  return c.json({ amount: rows[idx]!.amount, proof: merkleProof(leaves, idx) });
});

// The (amount, proof) a challenge winner needs for claimChallengePayout, rebuilt
// from the stored challenge payout tree. Same shape as the contest endpoint.
app.get("/challenges/:id/payout", async (c) => {
  const challengeId = Number(c.req.param("id"));
  const operator = (c.req.query("operator") ?? "").toLowerCase();
  if (!Number.isFinite(challengeId) || !/^0x[a-f0-9]{40}$/.test(operator)) {
    return c.json({ amount: null });
  }

  const { rows } = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from challenge_payouts where challenge_id = $1 order by rank",
    [challengeId],
  );
  if (rows.length === 0) return c.json({ amount: null });

  const leaves = rows.map((r) => payoutLeaf(r.operator as `0x${string}`, BigInt(r.amount)));
  const idx = rows.findIndex((r) => r.operator.toLowerCase() === operator);
  if (idx === -1) return c.json({ amount: null });

  return c.json({ amount: rows[idx]!.amount, proof: merkleProof(leaves, idx) });
});

// ----- Results boards -----

// The full field for a contest: every entrant and, once settled, the ranked
// payouts. Public read, drives the contest detail page's results board.
app.get("/contests/:id/results", async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ entrants: [], winners: [] });

  const entrants = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from entries where contest_id = $1 order by agent_id",
    [contestId],
  );
  const winners = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from payouts where contest_id = $1 order by rank",
    [contestId],
  );
  return c.json({
    entrants: entrants.rows.map((r) => ({ agentId: Number(r.agent_id), operator: r.operator })),
    winners: winners.rows.map((r) => ({ rank: r.rank, operator: r.operator, amount: r.amount })),
  });
});

// Same board for a peer challenge, from the challenge entry and payout tables.
app.get("/challenges/:id/results", async (c) => {
  const challengeId = Number(c.req.param("id"));
  if (!Number.isFinite(challengeId)) return c.json({ entrants: [], winners: [] });

  const entrants = await query<{ agent_id: string; operator: string }>(
    "select agent_id, operator from challenge_entries where challenge_id = $1 order by agent_id",
    [challengeId],
  );
  const winners = await query<{ rank: number; operator: string; amount: string }>(
    "select rank, operator, amount from challenge_payouts where challenge_id = $1 order by rank",
    [challengeId],
  );
  return c.json({
    entrants: entrants.rows.map((r) => ({ agentId: Number(r.agent_id), operator: r.operator })),
    winners: winners.rows.map((r) => ({ rank: r.rank, operator: r.operator, amount: r.amount })),
  });
});

/// Final standings snapshot for replay. The coordinator saves the last live
/// standings frame (full per-agent progress) when an event settles; the live
/// page reads it so a settled event reconstructs its whole result — volumes,
/// ops, tx hashes, solver cells, research spend — for anyone who didn't watch
/// it live. Returns `{ entries: null }` until an event has settled.
async function serveStandingsSnapshot(source: "contest" | "challenge", id: number) {
  if (!Number.isFinite(id)) return { entries: null };
  const { rows } = await query<{ entries: unknown }>(
    "select entries from event_standings where source = $1 and event_id = $2",
    [source, id],
  );
  return { entries: rows[0]?.entries ?? null };
}

app.get("/contests/:id/standings", async (c) =>
  c.json(await serveStandingsSnapshot("contest", Number(c.req.param("id")))),
);
app.get("/challenges/:id/standings", async (c) =>
  c.json(await serveStandingsSnapshot("challenge", Number(c.req.param("id")))),
);

// ----- Missions (the agent labor market) -----

// Full state of a mission for the arena page: the brief, the operatives and
// their make-or-buy decisions, the deliverables and judge verdicts, and the
// economy tape (agent-to-agent trades + agent-to-service x402 payments). Public
// read. Deliberately omits the captured intel/truth (the answer an operative
// pays for) so the page can't leak it. Returns { mission: null } for a contest
// that is not a mission, which is how the UI decides whether to show the arena.
/// Mission index. Lists missions (open first, then newest) with light
/// per-mission aggregates for the cards: how many operatives ran, how many
/// on-chain payments fired, and the total USDC moved across the A2A + x402
/// rails. Omits brief/intel/truth; the arena page (/missions/:id) carries the
/// full detail. Capped so the list endpoint stays cheap.
app.get("/missions", async (c) => {
  const rows = await query<{
    contest_id: string;
    domain: string;
    title: string;
    status: string;
    contest_status: string | null;
    archetype: string;
    seq: string;
    created_at: string;
    operatives: string;
    payments: string;
    spent6: string;
    volume6: string;
  }>(
    `select
       m.contest_id,
       m.domain,
       m.title,
       m.status,
       c.status as contest_status,
       m.archetype,
       m.seq,
       m.created_at::text as created_at,
       (select count(*) from mission_submissions s where s.contest_id = m.contest_id) as operatives,
       (
         (select count(*) from a2a_trades t where t.contest_id = m.contest_id and t.status = 'settled')
         + (select count(*) from nanopayments n where n.contest_id = m.contest_id and n.status = 'settled')
       ) as payments,
       (
         (select coalesce(sum(price_usdc_6::numeric), 0) from a2a_trades t where t.contest_id = m.contest_id and t.status = 'settled')
         + (select coalesce(sum(usdc_amount_6::numeric), 0) from nanopayments n where n.contest_id = m.contest_id and n.status = 'settled')
       ) as spent6,
       (select coalesce(sum(volume_usdc_6::numeric), 0) from mission_actions a where a.contest_id = m.contest_id and a.status = 'settled') as volume6
     from missions m
     left join contests c on c.id = m.contest_id
     -- Hide the graveyard: a mission that CANCELLED WITH NOBODY IN IT is not a
     -- result, it is a non-event. The autopilot used to open funded missions into
     -- an empty room on a timer, so the board filled with dead entries (55 of the
     -- first 60) and read as a broken product. Those carry no information: no
     -- operative entered, no payment settled, the sponsor was refunded in full.
     --
     -- A mission that cancelled WITH operatives in it is kept. That IS a result:
     -- agents tried the commission and none cleared the bar, which is exactly the
     -- adversarial signal the arena exists to produce. Never hide a real failure,
     -- only an empty one.
     where not (
       m.status = 'cancelled'
       and not exists (select 1 from mission_submissions s where s.contest_id = m.contest_id)
       and not exists (select 1 from entries e where e.contest_id = m.contest_id)
     )
     order by (c.status in ('open','scoring')) desc, m.created_at desc
     limit 60`,
  );

  // A mission is live while its CONTEST is open (join window) or scoring (agents
  // running) — the missions.status text can lag a step behind, so the contest is
  // the source of truth for "is this live right now".
  const isLive = (contestStatus: string | null, missionStatus: string) =>
    contestStatus === "open" || contestStatus === "scoring" || (contestStatus == null && missionStatus === "open");

  return c.json({
    missions: rows.rows.map((r) => ({
      contestId: Number(r.contest_id),
      domain: r.domain,
      title: r.title,
      status: r.status,
      live: isLive(r.contest_status, r.status),
      archetype: r.archetype === "external" ? "external" : "internal",
      seq: Number(r.seq) || 0,
      createdAt: r.created_at,
      operatives: Number(r.operatives),
      payments: Number(r.payments),
      spent6: String(r.spent6),
      volume6: String(r.volume6),
    })),
  });
});

/// A mission's seat caps: the per-mission overrides if set, else the global
/// MISSION_*_SEATS config. So an admin can open a bigger or smaller field for a
/// single mission and the enforcement + display both honour it.
async function missionSeatCaps(contestId: number): Promise<{ operativeSeats: number; specialistSeats: number }> {
  const r = await query<{ operative_seats: number | null; specialist_seats: number | null }>(
    "select operative_seats, specialist_seats from missions where contest_id = $1",
    [contestId],
  );
  const row = r.rows[0];
  return {
    operativeSeats: row?.operative_seats ?? config.mission.operativeSeats,
    specialistSeats: row?.specialist_seats ?? config.mission.specialistSeats,
  };
}

/// Operator joins a mission on the SUPPLY side: registers one of their agents as
/// an intel specialist for a fragment at their own price. Operatives can then
/// buy that intel agent-to-agent, and the USDC lands in the operator's wallet.
/// Session-gated; only while the mission is open and the fragment is buyable.
app.post("/missions/:id/specialist", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ error: "bad mission id" }, 400);
  const operator = c.get("address").toLowerCase();

  let body: { agentId?: number; fragmentId?: string; priceUsdc?: number; intel?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const agentId = Number(body.agentId);
  const fragmentId = String(body.fragmentId ?? "");
  const priceUsdc = Number(body.priceUsdc);
  const intel = String(body.intel ?? "").trim();
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "pick an agent" }, 400);
  if (!fragmentId) return c.json({ error: "pick a fragment to supply" }, 400);
  const listingMax = config.mission.listingPriceMaxUsdc;
  if (!Number.isFinite(priceUsdc) || priceUsdc <= 0 || priceUsdc > listingMax)
    return c.json({ error: `price must be between 0 and ${listingMax} USDC` }, 400);
  if (intel.length < 10) return c.json({ error: "describe the intel you are selling (a sentence or two)" }, 400);

  const m = await query<{ status: string }>("select status from missions where contest_id = $1", [contestId]);
  if (!m.rows[0]) return c.json({ error: "not a mission" }, 404);
  if (m.rows[0].status !== "open") return c.json({ error: "this mission is no longer open" }, 409);

  const f = await query<{ kind: string }>(
    "select kind from mission_fragments where contest_id = $1 and fragment_id = $2",
    [contestId, fragmentId],
  );
  if (!f.rows[0]) return c.json({ error: "unknown fragment" }, 404);
  if (f.rows[0].kind === "action") return c.json({ error: "that fragment cannot be supplied as intel" }, 400);

  // Specialist seats are scarce and first come first served. Count the operators
  // already on the supply side; reject a NEW operator once the seats are full
  // (an operator already in keeps their seat and may add another listing).
  const seatRows = await query<{ operator: string }>(
    "select distinct operator from mission_specialists where contest_id = $1 and owner = 'operator' and operator is not null",
    [contestId],
  );
  const seatsTaken = seatRows.rows.length;
  const alreadyIn = seatRows.rows.some((r) => (r.operator ?? "").toLowerCase() === operator);
  const { specialistSeats: specialistCap } = await missionSeatCaps(contestId);
  if (!alreadyIn && seatsTaken >= specialistCap) {
    return c.json({ error: `specialist seats are full (${specialistCap} max, first come first served)` }, 409);
  }

  // The A2A payment lands in the operator's own wallet (address = operator), so
  // a registration can only ever earn to the caller. agentId is the seller label.
  await query(
    `insert into mission_specialists (contest_id, agent_id, address, fragment_id, price_usdc_6, intel, owner, operator)
     values ($1, $2, $3, $4, $5, $6, 'operator', $7)
     on conflict (contest_id, agent_id, fragment_id) do update set
       address = excluded.address, price_usdc_6 = excluded.price_usdc_6,
       intel = excluded.intel, owner = 'operator', operator = excluded.operator`,
    [contestId, agentId, operator, fragmentId, String(Math.round(priceUsdc * 1e6)), JSON.stringify(intel), operator],
  );
  void logEvent({ kind: "mission_specialist_join", address: operator, context: { contestId, fragmentId, agentId }, source: "auth" });
  return c.json({ ok: true });
});

/// Records the operative join fee for a mission. The client pays the fee to the
/// treasury on chain (after which it posts the tx here); the row lets the
/// coordinator refund it from the treasury if the mission cancels with no
/// qualifier. Session-gated; only while the mission is open.
app.post("/missions/:id/join-fee", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ error: "bad mission id" }, 400);
  const operator = c.get("address").toLowerCase();

  let body: { txHash?: string; amount6?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const txHash = (body.txHash ?? "").trim() || null;
  const amount6 = String(body.amount6 ?? "0");
  if (!/^[0-9]+$/.test(amount6) || amount6 === "0") return c.json({ error: "bad amount" }, 400);

  const m = await query<{ status: string }>("select status from missions where contest_id = $1", [contestId]);
  if (!m.rows[0]) return c.json({ error: "not a mission" }, 404);
  if (m.rows[0].status !== "open") return c.json({ error: "this mission is no longer open" }, 409);

  // One side per mission: a specialist cannot also be an operative.
  const asSpecialist = await query(
    "select 1 from mission_intel_buys where contest_id = $1 and operator = $2",
    [contestId, operator],
  );
  if (asSpecialist.rows.length > 0)
    return c.json({ error: "you entered this mission as a specialist; you cannot also be an operative" }, 409);

  await query(
    `insert into mission_operative_fees (contest_id, operator, amount_usdc_6, tx_hash)
     values ($1, $2, $3, $4)
     on conflict (contest_id, operator) do update set amount_usdc_6 = excluded.amount_usdc_6, tx_hash = excluded.tx_hash`,
    [contestId, operator, amount6, txHash],
  );
  void logEvent({ kind: "mission_join_fee", address: operator, context: { contestId, amount6, txHash }, source: "auth" });
  return c.json({ ok: true });
});

/// Operative WITHDRAWS from a mission within the join window (mission still
/// open) because they changed their mind. We cannot reverse the on-chain
/// registerEntry, so we record the withdrawal off-chain: from here on the
/// operator is excluded from grading, the concurrency cap, the my-role lock, and
/// the operative seat count. Any join fee they paid is returned from the
/// treasury. Idempotent; session-gated; only while the mission is open.
app.post("/missions/:id/withdraw", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ error: "bad mission id" }, 400);
  const operator = c.get("address").toLowerCase();

  const m = await query<{ status: string }>("select status from missions where contest_id = $1", [contestId]);
  if (!m.rows[0]) return c.json({ error: "not a mission" }, 404);
  if (m.rows[0].status !== "open")
    return c.json({ error: "the join window has closed — you can no longer withdraw from this mission" }, 409);

  // Already withdrawn: idempotent success so a double-click is harmless.
  const prior = await query("select 1 from mission_withdrawals where contest_id = $1 and lower(operator) = $2", [
    contestId,
    operator,
  ]);
  if (prior.rows.length > 0) return c.json({ ok: true, alreadyWithdrawn: true });

  // Must actually be an operative: an on-chain entry (any agent) or a paid join
  // fee. Specialists withdraw differently (they hold scarce intel) and aren't
  // covered here.
  const entryRow = await query<{ agent_id: string }>(
    "select agent_id from entries where contest_id = $1 and lower(operator) = $2 order by agent_id limit 1",
    [contestId, operator],
  );
  const feeRow = await query<{ amount_usdc_6: string; refunded: boolean }>(
    "select amount_usdc_6, refunded from mission_operative_fees where contest_id = $1 and operator = $2",
    [contestId, operator],
  );
  if (entryRow.rows.length === 0 && feeRow.rows.length === 0)
    return c.json({ error: "you have no operative entry to withdraw from this mission" }, 409);
  const agentId = entryRow.rows[0]?.agent_id ? Number(entryRow.rows[0].agent_id) : null;

  // Refund a paid, not-yet-refunded join fee from the treasury before recording
  // the withdrawal, so a failed transfer never leaves the operator out of pocket.
  let feeRefunded = false;
  let feeRefundTx: string | null = null;
  const feeAmount = feeRow.rows[0] && !feeRow.rows[0].refunded ? BigInt(feeRow.rows[0].amount_usdc_6 || "0") : 0n;
  if (feeAmount > 0n) {
    const signer = treasurySigner();
    if (!signer)
      return c.json(
        { error: "the treasury key is not configured, so the join fee cannot be refunded — withdrawal not processed" },
        503,
      );
    try {
      const hash = await signer.wallet.writeContract({
        address: config.external.USDC,
        abi: usdcMinimalAbi,
        functionName: "transfer",
        args: [operator as `0x${string}`, feeAmount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("refund tx reverted");
      feeRefunded = true;
      feeRefundTx = hash;
      await query(
        "update mission_operative_fees set refunded = true, refund_tx = $3 where contest_id = $1 and operator = $2",
        [contestId, operator, hash],
      );
      void notify(operator, {
        kind: "balance_credit",
        title: "Join fee refunded",
        body: `${usdc6(feeAmount)} USDC returned to your wallet — you withdrew from mission #${contestId} within the join window.`,
        href: `/missions/${contestId}`,
        context: { contestId, amount6: feeAmount.toString(), txHash: hash, kind: "withdraw_fee_refund" },
      });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "could not refund the join fee — withdrawal not processed" }, 500);
    }
  }

  await query(
    `insert into mission_withdrawals (contest_id, operator, agent_id, fee_refunded, fee_refund_tx)
     values ($1, $2, $3, $4, $5)
     on conflict (contest_id, operator) do nothing`,
    [contestId, operator, agentId, feeRefunded, feeRefundTx],
  );
  void logEvent({ kind: "mission_withdraw", address: operator, context: { contestId, agentId, feeRefunded, feeRefundTx }, source: "auth" });
  return c.json({ ok: true, feeRefunded, feeRefundTx });
});

/// Specialist BUYS a scarce intel piece from the platform shelf (v2). The
/// operator pays the base price `b` to the treasury on chain, then posts the
/// proof here. We claim the piece exclusively (one buyer per piece), carry the
/// platform's intel into the operator's resale listing at their chosen price,
/// and mark the platform row claimed so it leaves the shelf. Seat cap (3) and
/// the two-piece limit are enforced; session-gated; mission must be open.
app.post("/missions/:id/buy-intel", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ error: "bad mission id" }, 400);
  const operator = c.get("address").toLowerCase();

  let body: { fragmentId?: string; agentId?: number; resalePriceUsdc?: number; txHash?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const fragmentId = String(body.fragmentId ?? "");
  const agentId = Number(body.agentId);
  const resalePriceUsdc = Number(body.resalePriceUsdc);
  const txHash = (body.txHash ?? "").trim() || null;
  if (!fragmentId) return c.json({ error: "pick a piece to buy" }, 400);
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "pick an agent" }, 400);
  const resaleMax = config.mission.listingPriceMaxUsdc;
  if (!Number.isFinite(resalePriceUsdc) || resalePriceUsdc <= 0 || resalePriceUsdc > resaleMax)
    return c.json({ error: `set a resale price between 0 and ${resaleMax} USDC` }, 400);

  const mm = await query<{ status: string }>("select status from missions where contest_id = $1", [contestId]);
  if (!mm.rows[0]) return c.json({ error: "not a mission" }, 404);
  if (mm.rows[0].status !== "open") return c.json({ error: "this mission is no longer open" }, 409);

  // The seller agent must be one of the caller's own agents (the resolver already
  // enforces this, but the buy endpoint re-checks so it can't be bypassed), AND
  // it must clear the mission's tier gate — specialists are tier 3-4, same as
  // operatives. The agent's effective tier is the best across its domains.
  const owned = await query<{ solver_tier: number; analyst_tier: number; scout_tier: number }>(
    "select solver_tier, analyst_tier, scout_tier from agents where id = $1 and lower(owner) = $2",
    [agentId, operator],
  );
  if (owned.rows.length === 0) return c.json({ error: "that agent is not one of yours" }, 403);
  const at = owned.rows[0]!;
  const agentTier = Math.max(at.solver_tier ?? 0, at.analyst_tier ?? 0, at.scout_tier ?? 0);
  if (agentTier < config.mission.minTier) {
    return c.json(
      { error: `specialists must be tier ${config.mission.minTier}-4 — agent ${agentId} is tier ${agentTier}` },
      403,
    );
  }

  // One side per mission: an operative (with ANY of their agents) cannot also be
  // a specialist. The operative signal is the on-chain entry OR the paid fee —
  // checking both covers free/external missions (no fee) and the indexer lag
  // window right after entry.
  const asOperative = await query(
    `select 1 from entries where contest_id = $1 and lower(operator) = $2
     union all
     select 1 from mission_operative_fees where contest_id = $1 and operator = $2
     limit 1`,
    [contestId, operator],
  );
  if (asOperative.rows.length > 0)
    return c.json({ error: "you entered this mission as an operative; you cannot also be a specialist" }, 409);

  // Concurrency rules: the agent can't be busy elsewhere and the operator must be
  // under the event cap.
  const guard = await checkEntry(operator, agentId, { contestId });
  if (!guard.ok) return c.json({ error: guard.reason ?? "cannot enter" }, 409);

  // The platform piece for this fragment, still on the shelf.
  const plat = await query<{ price_usdc_6: string; intel: unknown }>(
    "select price_usdc_6, intel from mission_specialists where contest_id = $1 and fragment_id = $2 and owner = 'platform' and claimed_by is null",
    [contestId, fragmentId],
  );
  if (!plat.rows[0]) return c.json({ error: "that piece is already taken or not available" }, 409);
  const basePrice6 = plat.rows[0].price_usdc_6;
  const intel = plat.rows[0].intel;

  // Seat cap (distinct buyers) and the per-buyer two-piece limit.
  const buyRows = await query<{ operator: string }>(
    "select operator from mission_intel_buys where contest_id = $1",
    [contestId],
  );
  const distinctOps = new Set(buyRows.rows.map((r) => (r.operator ?? "").toLowerCase()));
  const myCount = buyRows.rows.filter((r) => (r.operator ?? "").toLowerCase() === operator).length;
  const { specialistSeats: specialistCap } = await missionSeatCaps(contestId);
  if (!distinctOps.has(operator) && distinctOps.size >= specialistCap) {
    return c.json({ error: `specialist seats are full (${specialistCap} max)` }, 409);
  }
  if (myCount >= config.mission.specialistMaxBuy) {
    return c.json({ error: `you already hold the max ${config.mission.specialistMaxBuy} pieces` }, 409);
  }

  const resalePrice6 = String(Math.round(resalePriceUsdc * 1e6));

  // Claim the piece. The PK makes this the single source of exclusivity: a
  // conflict means another specialist beat this caller to it.
  const claim = await query(
    `insert into mission_intel_buys (contest_id, fragment_id, operator, agent_id, base_price_6, resale_price_6, tx_hash)
     values ($1, $2, $3, $4, $5, $6, $7) on conflict (contest_id, fragment_id) do nothing`,
    [contestId, fragmentId, operator, agentId, basePrice6, resalePrice6, txHash],
  );
  if (claim.rowCount === 0) return c.json({ error: "that piece was just taken" }, 409);

  // Take the platform piece off the shelf and stand up the operator's resale
  // listing carrying the platform's intel.
  await query(
    "update mission_specialists set claimed_by = $3 where contest_id = $1 and fragment_id = $2 and owner = 'platform'",
    [contestId, fragmentId, operator],
  );
  await query(
    `insert into mission_specialists (contest_id, agent_id, address, fragment_id, price_usdc_6, intel, owner, operator)
     values ($1, $2, $3, $4, $5, $6, 'operator', $3)
     on conflict (contest_id, agent_id, fragment_id) do update set
       price_usdc_6 = excluded.price_usdc_6, intel = excluded.intel, owner = 'operator', operator = excluded.operator`,
    [contestId, agentId, operator, fragmentId, resalePrice6, JSON.stringify(intel ?? null)],
  );
  void logEvent({ kind: "mission_intel_buy", address: operator, context: { contestId, fragmentId, agentId, basePrice6, resalePrice6 }, source: "auth" });
  return c.json({ ok: true });
});

/// Which side, if any, the signed-in operator has already taken in this mission.
/// The UI uses it to lock the opposite role (one side per mission).
app.get("/missions/:id/my-role", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ role: null });
  const operator = c.get("address").toLowerCase();
  // Operative = an on-chain entry (any agent) OR a paid join fee, so the lock
  // engages even on free/external missions that charge no fee.
  const opv = await query(
    `select 1 from entries where contest_id = $1 and lower(operator) = $2
     union all
     select 1 from mission_operative_fees where contest_id = $1 and operator = $2
     limit 1`,
    [contestId, operator],
  );
  if (opv.rows.length > 0) {
    // The operative side stays "taken" even after a withdrawal (the on-chain
    // entry can't be undone, so they can't flip to the specialist side), but the
    // UI shows a terminal withdrawn state instead of the live "entered" panel.
    const wd = await query("select 1 from mission_withdrawals where contest_id = $1 and lower(operator) = $2", [
      contestId,
      operator,
    ]);
    return c.json({ role: "operative", withdrawn: wd.rows.length > 0 });
  }
  const spc = await query("select 1 from mission_intel_buys where contest_id = $1 and operator = $2", [contestId, operator]);
  if (spc.rows.length > 0) return c.json({ role: "specialist", withdrawn: false });
  return c.json({ role: null, withdrawn: false });
});

/// Whether the signed-in operator has already paid this mission's join fee, so
/// the entry flow does not charge it twice on a retry.
app.get("/missions/:id/fee-status", requireAuth, async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ paid: false });
  const operator = c.get("address").toLowerCase();
  const r = await query(
    "select 1 from mission_operative_fees where contest_id = $1 and operator = $2",
    [contestId, operator],
  );
  return c.json({ paid: r.rows.length > 0 });
});

app.get("/missions/:id", async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ mission: null });

  const m = await query<{
    domain: string;
    template_id: string;
    title: string;
    brief: string;
    deliverable: string;
    status: string;
    archetype: string;
    weight: string;
    base_price_usdc_6: string;
    pool_usdc_6: string;
    seq: string;
    operative_seats: number | null;
    specialist_seats: number | null;
    operative_fee_bps: number | null;
  }>(
    "select domain, template_id, title, brief, deliverable, status, archetype, weight, base_price_usdc_6, pool_usdc_6, seq, operative_seats, specialist_seats, operative_fee_bps from missions where contest_id = $1",
    [contestId],
  );
  const mission = m.rows[0];
  if (!mission) return c.json({ mission: null });

  const fragments = await query<{ fragment_id: string; kind: string; ask: string }>(
    "select fragment_id, kind, ask from mission_fragments where contest_id = $1 order by fragment_id",
    [contestId],
  );
  const specialists = await query<{
    agent_id: string;
    fragment_id: string;
    price_usdc_6: string;
    owner: string;
    operator: string | null;
    claimed_by: string | null;
  }>(
    "select agent_id, fragment_id, price_usdc_6, owner, operator, claimed_by from mission_specialists where contest_id = $1 order by agent_id",
    [contestId],
  );
  const decisions = await query<{
    agent_id: string;
    fragment_id: string;
    choice: string;
    reason: string | null;
    settled: boolean;
    tx_hash: string | null;
    spent_usdc_6: string;
    specialist_agent_id: string | null;
  }>(
    "select agent_id, fragment_id, choice, reason, settled, tx_hash, spent_usdc_6, specialist_agent_id from mission_decisions where contest_id = $1",
    [contestId],
  );
  const submissions = await query<{
    agent_id: string;
    operator: string;
    deliverable: string | null;
    elapsed_ms: number;
    score: string | null;
    judged: { quality?: number; verdict?: string; credited?: number; total?: number } | null;
  }>(
    "select agent_id, operator, deliverable, elapsed_ms, score, judged from mission_submissions where contest_id = $1",
    [contestId],
  );
  const trades = await query<{
    buyer_agent_id: string;
    seller_agent_id: string;
    fragment_id: string;
    price_usdc_6: string;
    tx_hash: string | null;
    created_at: string;
  }>(
    "select buyer_agent_id, seller_agent_id, fragment_id, price_usdc_6, tx_hash, created_at::text as created_at from a2a_trades where contest_id = $1 and status = 'settled' order by id",
    [contestId],
  );
  const nanopays = await query<{
    agent_id: string;
    endpoint_label: string | null;
    usdc_amount_6: string;
    tx_hash: string | null;
    chain: string;
    created_at: string;
  }>(
    "select agent_id, endpoint_label, usdc_amount_6, tx_hash, chain, created_at::text as created_at from nanopayments where contest_id = $1 and status = 'settled' order by id",
    [contestId],
  );
  const intelBuys = await query<{
    agent_id: string;
    fragment_id: string;
    base_price_6: string;
    tx_hash: string | null;
    created_at: string;
  }>(
    "select agent_id, fragment_id, base_price_6, tx_hash, created_at::text as created_at from mission_intel_buys where contest_id = $1 order by created_at",
    [contestId],
  );
  // SCOUT missions move real on-chain VOLUME (not a payment). Kept SEPARATE from
  // the payment tape/spent total so we never misrepresent volume as USDC spent;
  // surfaced as its own on-chain-volume figure on the mission.
  const scoutVol = await query<{ v: string }>(
    "select coalesce(sum(volume_usdc_6::numeric),0)::text as v from mission_actions where contest_id = $1 and status = 'settled'",
    [contestId],
  );
  const scoutVolume6 = scoutVol.rows[0]?.v ?? "0";

  // Naturalize the decision reason. The stored reason is the operative's raw
  // internal note and can name backend services (e.g. a data vendor); the UI
  // only shows the make/buy choice, so the public payload carries a clean,
  // vendor-free gloss derived from the choice instead of the raw text.
  const reasonFor = (choice: string): string =>
    choice === "buy"
      ? "Bought this piece from a specialist on the supply side."
      : choice === "make"
        ? "The operative gathered this piece itself."
        : choice === "skip"
          ? "Left this piece out of the deliverable."
          : choice === "action"
            ? "Executed real on-chain DeFi volume on the Scout rails."
            : "";

  // Group decisions under each operative.
  const decByAgent = new Map<number, unknown[]>();
  for (const d of decisions.rows) {
    const id = Number(d.agent_id);
    if (!decByAgent.has(id)) decByAgent.set(id, []);
    decByAgent.get(id)!.push({
      fragmentId: d.fragment_id,
      choice: d.choice,
      reason: reasonFor(d.choice),
      settled: d.settled,
      txHash: d.tx_hash,
      spent6: d.spent_usdc_6,
      specialistAgentId: d.specialist_agent_id ? Number(d.specialist_agent_id) : null,
    });
  }

  const operatives = submissions.rows
    .map((s) => {
      const judged = s.judged ?? {};
      return {
        agentId: Number(s.agent_id),
        operator: s.operator,
        score: s.score ? Number(s.score) : 0,
        quality: judged.quality ?? null,
        verdict: judged.verdict ?? "",
        credited: judged.credited ?? null,
        total: judged.total ?? fragments.rows.length,
        deliverable: s.deliverable ?? "",
        elapsedMs: s.elapsed_ms,
        decisions: decByAgent.get(Number(s.agent_id)) ?? [],
      };
    })
    .sort((a, b) => b.score - a.score);

  // The economy tape: agent-to-agent buys and agent-to-service x402 payments,
  // oldest first so the arena can render them as a ledger.
  const tape = [
    ...trades.rows.map((t) => ({
      kind: "a2a" as const,
      fromAgentId: Number(t.buyer_agent_id),
      toAgentId: Number(t.seller_agent_id),
      toLabel: `agent ${t.seller_agent_id}`,
      fragmentId: t.fragment_id,
      amount6: t.price_usdc_6,
      txHash: t.tx_hash,
      chain: "arc",
      ts: t.created_at,
    })),
    ...nanopays.rows.map((n) => ({
      kind: "x402" as const,
      fromAgentId: Number(n.agent_id),
      toAgentId: null,
      toLabel: n.endpoint_label ?? "data service",
      fragmentId: null,
      amount6: n.usdc_amount_6,
      txHash: n.tx_hash,
      chain: n.chain,
      ts: n.created_at,
    })),
    ...intelBuys.rows.map((b) => ({
      kind: "shelf" as const,
      fromAgentId: Number(b.agent_id),
      toAgentId: null,
      toLabel: "platform shelf",
      fragmentId: b.fragment_id,
      amount6: b.base_price_6,
      txHash: b.tx_hash,
      chain: "arc",
      ts: b.created_at,
    })),
  ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // v2 join economy: seats taken vs caps, and the operative join fee (% of pool).
  // A withdrawn operative frees their seat, so exclude them from the count.
  const opSeats = await query<{ n: string }>(
    `select count(*)::text as n from entries e
      where e.contest_id = $1
        and not exists (select 1 from mission_withdrawals w
                        where w.contest_id = e.contest_id and lower(w.operator) = lower(e.operator))`,
    [contestId],
  );
  const specSeats = await query<{ n: string }>(
    "select count(distinct operator)::text as n from mission_specialists where contest_id = $1 and owner = 'operator' and operator is not null",
    [contestId],
  );
  const poolUsdc6 = BigInt(mission.pool_usdc_6 || "0");
  // The fee is only live when there is a treasury to receive (and later refund)
  // it. Without a treasury key the join is free.
  const feeRecipient = config.treasury.address;
  const feeBps = mission.operative_fee_bps ?? config.mission.operativeFeeBps;
  const operativeFee6 = feeRecipient ? (poolUsdc6 * BigInt(feeBps)) / 10_000n : 0n;
  const feePaid = await query<{ n: string }>(
    "select count(*)::text as n from mission_operative_fees where contest_id = $1",
    [contestId],
  );

  return c.json({
    mission: {
      contestId,
      domain: mission.domain,
      templateId: mission.template_id,
      title: mission.title,
      brief: mission.brief,
      deliverable: mission.deliverable,
      status: mission.status,
      archetype: mission.archetype === "external" ? "external" : "internal",
      weight: Number(mission.weight) || 0,
      basePrice6: mission.base_price_usdc_6,
      seq: Number(mission.seq) || 0,
      // On-chain DeFi volume moved by scout-domain operatives (0 for solver/analyst).
      scoutVolume6,
    },
    join: {
      poolUsdc6: poolUsdc6.toString(),
      operativeFee6: operativeFee6.toString(),
      feeBps: feeRecipient ? feeBps : 0,
      feeRecipient,
      feesPaid: Number(feePaid.rows[0]?.n ?? 0),
      specialistSeats: { total: mission.specialist_seats ?? config.mission.specialistSeats, taken: Number(specSeats.rows[0]?.n ?? 0) },
      operativeSeats: { total: mission.operative_seats ?? config.mission.operativeSeats, taken: Number(opSeats.rows[0]?.n ?? 0) },
    },
    fragments: fragments.rows.map((f) => ({ id: f.fragment_id, kind: f.kind, ask: f.ask })),
    specialists: specialists.rows.map((s) => ({
      agentId: Number(s.agent_id),
      fragmentId: s.fragment_id,
      price6: s.price_usdc_6,
      owner: s.owner === "operator" ? "operator" : "platform",
      operator: s.operator,
      // A platform piece with a claimer has left the shelf (a specialist owns
      // it now). Unclaimed platform pieces are still buyable from the platform.
      claimed: s.owner === "platform" ? s.claimed_by != null : false,
    })),
    operatives,
    tape,
  });
});

// ----- Traits and mystery claims -----

// The pool of awardable traits, public read so the UI can render chip labels
// without duplicating the source of truth. The legendary entries are visible
// here even when no agent owns one yet so rarity is visible up front. The
// `rugChance` is surfaced too so the UI can show the odds.
app.get("/traits/pool", (c) => c.json({ traits: TRAITS, rugChance: RUG_CHANCE }));

// How many mystery boxes are left in today's global pool and when the next
// batch opens. Public read so the dashboard card can show the live count.
app.get("/mystery/pool", async (c) => {
  // Same UTC+1 day key as the claim writer above. The pool slot lives at
  // (((now at UTC) + 1 hour))::date so the read and the write agree.
  const { rows } = await query<{ claimed: string | null }>(
    "select claimed::text from mystery_pool_daily where day = (((now() at time zone 'utc') - interval '1 hour'))::date",
  );
  const claimed = Number(rows[0]?.claimed ?? 0);
  const remaining = Math.max(0, DAILY_POOL_MAX - claimed);
  // 100 claim spots a day. Each open rolls the fixed odds below; most rug, and
  // a legendary is the scarce prize. The UI shows the odds so the gamble reads.
  return c.json({
    max: DAILY_POOL_MAX,
    claimed,
    remaining,
    resetsAt: nextResetMs(),
    odds: MYSTERY_ODDS,
  });
});

// Traits an agent currently owns, in award order (oldest first). Public read.
// ----- Agent nicknames -----
//
// Names are stored on `agents.nickname` and shown to everyone, so renaming an
// agent in one place propagates to every surface that reads agents (live
// standings, contest stages, leaderboards, the picker, the profile pages).
// The localStorage path that used to back the rename UI is dead.

const NICK_RE = /^[\w .\-]{1,24}$/;

/// Set or clear the nickname for an agent. Requires a SIWE session and that
/// the connected wallet owns the agent on chain (we use the indexer's `agents`
/// table; if the agent isn't there yet, the rename is refused so we never
/// claim a name we couldn't verify).
app.post("/agents/:id/name", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { name } = await c.req.json<{ name?: string }>();
  const trimmed = (name ?? "").trim();
  if (trimmed && !NICK_RE.test(trimmed)) {
    return c.json({ error: "name must be 1-24 chars: letters, numbers, space, dot, dash, underscore" }, 400);
  }

  const { rows } = await query<{ owner: string; nickname: string | null; nickname_updated_at: string | null }>(
    "select owner, nickname, nickname_updated_at::text as nickname_updated_at from agents where id = $1",
    [agentId],
  );
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  const next = trimmed || null;
  const current = rows[0]?.nickname ?? null;
  const changing = next !== current;

  // Once-every-30-days rename cooldown, so names can't be spammed.
  if (changing && rows[0]?.nickname_updated_at) {
    const last = new Date(rows[0].nickname_updated_at).getTime();
    const days = (Date.now() - last) / 86_400_000;
    if (days < 30) {
      const nextDate = new Date(last + 30 * 86_400_000).toISOString().slice(0, 10);
      return c.json({ error: `you can rename an agent once every 30 days — next change after ${nextDate}` }, 429);
    }
  }

  // Names are unique (case-insensitive) across all agents.
  if (next) {
    const dup = await query("select 1 from agents where lower(nickname) = lower($1) and id <> $2 limit 1", [next, agentId]);
    if (dup.rows.length > 0) return c.json({ error: "agent name taken" }, 409);
  }

  await query("update agents set nickname = $2, nickname_updated_at = now() where id = $1", [agentId, next]);
  return c.json({ id: agentId, nickname: next });
});

// ----- Agent skins -----
//
// Custom image per agent. Stored as a base64 data URL in agents.skin (capped
// at 256KB encoded so a few rows don't bloat the operator profile response).
// Client downscales to 256x256 before upload so the column stays small.

const SKIN_MIME = /^data:image\/(png|jpeg|jpg|webp|gif);base64,/;
const SKIN_MAX_LEN = 256 * 1024;

app.post("/agents/:id/skin", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { image } = await c.req.json<{ image?: string }>();
  if (!image || typeof image !== "string") return c.json({ error: "image required" }, 400);
  if (!SKIN_MIME.test(image)) {
    return c.json({ error: "image must be a base64 data URL: png, jpeg, webp, or gif" }, 400);
  }
  if (image.length > SKIN_MAX_LEN) {
    return c.json({ error: `image too large (max ${SKIN_MAX_LEN / 1024}KB encoded)` }, 413);
  }

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set skin = $2 where id = $1", [agentId, image]);
  return c.json({ id: agentId, ok: true });
});

app.delete("/agents/:id/skin", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set skin = null where id = $1", [agentId]);
  return c.json({ id: agentId, ok: true });
});

/// Serves an agent's custom skin (stored as a base64 data URL) as a real,
/// cacheable image. Lists like the leaderboard link to this instead of inlining
/// the base64 blob per row, which had pushed the leaderboard JSON to ~1 MB. The
/// browser then caches and lazy-loads the image. 404 when the agent has no
/// custom skin so the caller falls back to its placeholder. Public read: skins
/// are already shown publicly, this only serves the same bytes more cheaply.
app.get("/agents/:id/avatar", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "invalid agent id" }, 400);
  const { rows } = await query<{ skin: string | null }>("select skin from agents where id = $1", [agentId]);
  const skin = rows[0]?.skin ?? null;
  const m = skin ? /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i.exec(skin) : null;
  const mimeRaw = m?.[1];
  const b64 = m?.[2];
  if (!mimeRaw || !b64) return c.json({ error: "no avatar" }, 404);
  const mime = mimeRaw.toLowerCase() === "image/jpg" ? "image/jpeg" : mimeRaw.toLowerCase();
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return c.json({ error: "bad avatar data" }, 404);
  }
  // Skins change rarely; a day of caching collapses the per-row image cost on a
  // list to one request the browser then reuses across rows and polls.
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
});

// ----- Agent display identity -----
//
// Which name + avatar an agent shows everywhere it appears:
//   'default' -> robot mascot + #id
//   'x'       -> owner's X handle + X avatar
//   'custom'  -> uploaded skin + nickname
// Resolved with graceful fallback to 'default' when the chosen source is
// missing (e.g. mode 'x' but the wallet never linked X).

const DISPLAY_MODES = new Set(["default", "x", "discord", "custom"]);

/// Switch an agent's display identity. Owner-gated like the name/skin routes.
app.post("/agents/:id/display-mode", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const { mode } = await c.req.json<{ mode?: string }>();
  if (!mode || !DISPLAY_MODES.has(mode)) {
    return c.json({ error: "mode must be default, x, discord, or custom" }, 400);
  }

  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return c.json({ error: "agent not found" }, 404);
  if (owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  await query("update agents set display_mode = $2 where id = $1", [agentId, mode]);
  return c.json({ id: agentId, mode });
});

// ----- Operator identity (leaderboard row + public profile) -----
//
// Operator-level choice of what shows on the leaderboard and profile header:
//   'auto'   -> X, then Discord, then masked wallet (default)
//   'x'      -> X handle + avatar
//   'discord'-> Discord username + avatar
//   'custom' -> first agent's skin + nickname
//   'wallet' -> masked address (opt out of socials)
// Distinct from per-agent display_mode, which only governs a live event.

const IDENTITY_MODES = new Set(["auto", "x", "discord", "custom", "wallet"]);

/// Set the operator's identity mode. Writes to the caller's own row.
app.post("/operators/identity-mode", requireAuth, async (c) => {
  const operator = c.get("address");
  const { mode } = await c.req.json<{ mode?: string }>();
  if (!mode || !IDENTITY_MODES.has(mode)) {
    return c.json({ error: "mode must be auto, x, discord, custom, or wallet" }, 400);
  }
  await query("update operators set identity_mode = $2 where lower(address) = lower($1)", [operator, mode]);
  return c.json({ operator, mode });
});

/// Bulk resolved display identity for agents. Public, like /agents/names and
/// /agents/skins. For each id returns { kind, name, avatar }: avatar is an
/// image URL (X) or data URL (custom), or null to render the robot mascot;
/// name is null to use the frontend's default (#id).
app.get("/agents/identities", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ identities: {} });

  const { rows } = await query<{
    id: string;
    display_mode: string | null;
    nickname: string | null;
    skin: string | null;
    x_handle: string | null;
    x_avatar: string | null;
    discord_username: string | null;
    discord_avatar: string | null;
    telegram_username: string | null;
    telegram_avatar: string | null;
  }>(
    `select a.id, a.display_mode, a.nickname, a.skin,
            o.x_handle, o.x_avatar, o.discord_username, o.discord_avatar,
            o.telegram_username, o.telegram_avatar
       from agents a
       left join operators o on lower(o.address) = lower(a.owner)
      where a.id = any($1::bigint[])`,
    [ids],
  );

  const identities: Record<string, { kind: string; name: string | null; avatar: string | null }> = {};
  for (const r of rows) {
    const mode = r.display_mode ?? "x";
    if (mode === "x" && r.x_handle) {
      // Prefer the avatar captured at link time; fall back to unavatar.io so an
      // X-linked agent always shows a picture even if it linked before we
      // started storing the profile image.
      const avatar = r.x_avatar ?? `https://unavatar.io/x/${r.x_handle}`;
      identities[r.id] = { kind: "x", name: `@${r.x_handle}`, avatar };
    } else if (mode === "discord" && r.discord_username) {
      // Discord avatar can be absent (default-avatar accounts). Fall back to the
      // operator's Telegram pfp before giving up, so the row still shows a face.
      identities[r.id] = {
        kind: "discord",
        name: r.discord_username,
        avatar: r.discord_avatar ?? r.telegram_avatar ?? null,
      };
    } else if (mode === "custom" && r.skin) {
      identities[r.id] = { kind: "custom", name: r.nickname ?? null, avatar: r.skin };
    } else if (r.telegram_avatar) {
      // No X / Discord / custom skin, but the operator linked Telegram and we
      // captured the pfp through the Bot API. Use it so Telegram-only operators
      // show their picture on every live surface instead of the robot.
      identities[r.id] = {
        kind: "telegram",
        name: r.telegram_username ? `@${r.telegram_username}` : null,
        avatar: r.telegram_avatar,
      };
    } else {
      identities[r.id] = { kind: "default", name: null, avatar: null };
    }
  }
  return c.json({ identities });
});

/// Pre-entry concurrency check: may the signed-in operator enter an event with
/// this agent? Enforces one-agent-per-event and the max-concurrent-events cap.
/// The UI calls this before any on-chain entry so a busy agent / over-cap
/// operator is stopped before money moves.
app.get("/entry/check", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  const agentId = Number(c.req.query("agentId"));
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ ok: false, reason: "bad agent id" }, 400);
  const contestId = c.req.query("contestId") ? Number(c.req.query("contestId")) : undefined;
  const res = await checkEntry(operator, agentId, { contestId });
  return c.json(res);
});

/// Resolves a free-text reference to one of the SIGNED-IN operator's agents, so
/// a specialist can identify their agent by whatever is convenient: the numeric
/// id, the agent's custom name, or the operator's linked X / Discord / Telegram
/// handle (with or without a leading @). Scoped to the caller's own agents, so
/// it doubles as an ownership check. Returns the matched agent, or 404 with the
/// caller's agent list so the UI can hint.
app.get("/agents/resolve", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ error: "enter an agent id, name, or handle" }, 400);

  const { rows: agents } = await query<{ id: string; nickname: string | null; display_mode: string | null }>(
    "select id, nickname, display_mode from agents where lower(owner) = $1 order by id",
    [operator],
  );
  if (agents.length === 0) return c.json({ error: "you have no agents yet" }, 404);

  const { rows: opRows } = await query<{ x_handle: string | null; discord_username: string | null; telegram_username: string | null }>(
    "select x_handle, discord_username, telegram_username from operators where lower(address) = $1",
    [operator],
  );
  const op = opRows[0] ?? { x_handle: null, discord_username: null, telegram_username: null };

  const norm = (s: string) => s.trim().replace(/^@/, "").toLowerCase();
  const nq = norm(q);
  const list = agents.map((a) => ({ agentId: Number(a.id), name: a.nickname, displayMode: a.display_mode }));

  // 1. a numeric id the caller owns.
  if (/^[0-9]+$/.test(q)) {
    const hit = list.find((a) => a.agentId === Number(q));
    if (hit) return c.json({ agentId: hit.agentId, name: hit.name });
    return c.json({ error: `agent ${q} is not one of yours`, agents: list }, 404);
  }
  // 2. an agent's custom name (exact).
  const byNick = list.find((a) => a.name && norm(a.name) === nq);
  if (byNick) return c.json({ agentId: byNick.agentId, name: byNick.name });
  // 3. the operator's linked handle -> the agent that reads as that identity,
  //    else the operator's first agent.
  const handle =
    (op.x_handle && norm(op.x_handle) === nq && "x") ||
    (op.discord_username && norm(op.discord_username) === nq && "discord") ||
    (op.telegram_username && norm(op.telegram_username) === nq && "telegram") ||
    null;
  if (handle) {
    const preferred = list.find((a) => a.displayMode === handle) ?? list[0]!;
    return c.json({ agentId: preferred.agentId, name: preferred.name });
  }
  // 4. a partial custom-name match.
  const byContains = list.find((a) => a.name && norm(a.name).includes(nq));
  if (byContains) return c.json({ agentId: byContains.agentId, name: byContains.name });

  return c.json({ error: `no agent of yours matches "${q}"`, agents: list }, 404);
});

/// Bulk raw display modes for agents (the chosen mode, not the resolved one).
/// Used by the owner's management view so the switcher shows the real
/// selection even when the chosen source isn't set yet. Public; harmless.
app.get("/agents/modes", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ modes: {} });
  const { rows } = await query<{ id: string; display_mode: string | null }>(
    "select id, display_mode from agents where id = any($1::bigint[])",
    [ids],
  );
  const modes: Record<string, string> = {};
  for (const r of rows) modes[r.id] = r.display_mode ?? "x";
  return c.json({ modes });
});

// ----- Admin: soft burn (delist) -----
//
// Hide an agent id from every public listing without touching the chain. The
// on-chain ERC-8004 NFT keeps existing on Arc; we just stop returning it from
// /agents/delisted (the frontend filter set) and every surface that calls
// fetchAgents drops it. Users see nothing. Reversible by DELETE on the same id.

app.post("/admin/agents/:id/delist", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : null;

  await query(
    `insert into delisted_agents (agent_id, reason) values ($1, $2)
       on conflict (agent_id) do update set delisted_at = now(), reason = excluded.reason`,
    [agentId, reason],
  );
  return c.json({ id: agentId, delisted: true });
});

app.delete("/admin/agents/:id/delist", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);

  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);
  await query("delete from delisted_agents where agent_id = $1", [agentId]);
  return c.json({ id: agentId, delisted: false });
});

/// Public read of the delist set. The frontend caches this and filters
/// fetchAgents results before returning. Returns an id array, ordered for
/// deterministic etag-friendly responses. No leak of reason or timestamp.
app.get("/agents/delisted", async (c) => {
  const { rows } = await query<{ agent_id: string }>(
    "select agent_id from delisted_agents order by agent_id asc",
  );
  return c.json({ ids: rows.map((r) => Number(r.agent_id)) });
});

/// Bulk skin lookup. Public, like /agents/names. Returns a map of id to data
/// URL for the agents in the query that have a skin set.
app.get("/agents/skins", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ skins: {} });
  const { rows } = await query<{ id: string; skin: string | null }>(
    "select id, skin from agents where id = any($1::bigint[]) and skin is not null",
    [ids],
  );
  const skins: Record<string, string> = {};
  for (const r of rows) {
    if (r.skin) skins[r.id] = r.skin;
  }
  return c.json({ skins });
});

// ----- Agent training -----
//
// Six numeric stats per agent, each 0..20, each level adds 1% to scoring
// through the coordinator's training multiplier pipeline. Funded by Cycles,
// time-gated. One active training slot per agent. See coordinator/training.ts
// for the multiplier math and combined cap.

async function ensureAgentOwnership(operator: string, agentId: number): Promise<string | null> {
  const { rows } = await query<{ owner: string }>("select owner from agents where id = $1", [agentId]);
  const owner = rows[0]?.owner;
  if (!owner) return "agent not found";
  if (owner.toLowerCase() !== operator.toLowerCase()) return "you do not own this agent";
  return null;
}

async function readAgentStats(agentId: number): Promise<Record<Stat, number>> {
  const { rows } = await query<{ stat: string; level: number }>(
    "select stat, level from agent_stats where agent_id = $1",
    [agentId],
  );
  const out: Record<string, number> = {};
  for (const s of STATS) out[s] = 0;
  for (const r of rows) {
    if (STATS.includes(r.stat as Stat)) out[r.stat] = r.level;
  }
  return out as Record<Stat, number>;
}

/// Read the agent's current training state: all six stat levels, plus the
/// active queue row if any. Lazy-promotes any expired queue row first so
/// reads always reflect the truth.
app.get("/agents/:id/training", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  await flushTrainingQueue(agentId).catch(() => 0);

  const stats = await readAgentStats(agentId);

  const queue = await query<{
    stat: string;
    from_level: number;
    to_level: number;
    cycles_spent: string;
    started_at: Date;
    completes_at: Date;
  }>(
    `select stat, from_level, to_level, cycles_spent::text, started_at, completes_at
       from training_queue where agent_id = $1`,
    [agentId],
  );

  const active = queue.rows[0]
    ? {
        stat: queue.rows[0].stat,
        fromLevel: queue.rows[0].from_level,
        toLevel: queue.rows[0].to_level,
        cyclesSpent: queue.rows[0].cycles_spent,
        startedAt: queue.rows[0].started_at.toISOString(),
        completesAt: queue.rows[0].completes_at.toISOString(),
      }
    : null;

  return c.json({
    id: agentId,
    stats,
    active,
    maxLevel: MAX_STAT_LEVEL,
    speedup: speedupParams(),
  });
});

/// Start training a stat. Atomically: validate, debit Cycles from the
/// operator's row (refused if balance is short), insert into the queue.
/// `speedupSteps` is optional (default 0): each step adds
/// TRAINING_SPEEDUP_CYCLES_PER_STEP cycles to the cost and shaves
/// TRAINING_SPEEDUP_SECONDS_PER_STEP seconds off the wait.
app.post("/agents/:id/training/start", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const body = await c.req.json<{ stat?: string; speedupSteps?: number }>();
  const stat = body.stat;
  if (!stat || !STATS.includes(stat as Stat)) {
    return c.json({ error: `stat must be one of: ${STATS.join(", ")}` }, 400);
  }
  const rawSpeedup = Number(body.speedupSteps ?? 0);
  if (!Number.isFinite(rawSpeedup) || rawSpeedup < 0) {
    return c.json({ error: "speedupSteps must be a non-negative integer" }, 400);
  }

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  // Promote any expired queue row first so the next checks are consistent.
  await flushTrainingQueue(agentId).catch(() => 0);

  // Reject if already training.
  const existing = await query("select 1 from training_queue where agent_id = $1", [agentId]);
  if (existing.rows.length > 0) {
    return c.json({ error: "agent is already training; cancel or finish-early first" }, 409);
  }

  const stats = await readAgentStats(agentId);
  const fromLevel = stats[stat as Stat];
  if (fromLevel >= MAX_STAT_LEVEL) {
    return c.json({ error: `${stat} is already at max level (${MAX_STAT_LEVEL})` }, 400);
  }

  // Clamp speedup to whatever still reduces wall-clock at this level. Beyond
  // the cap, extra cycles only burn budget without improving the time.
  const cap = maxSpeedupSteps(fromLevel);
  const speedupSteps = Math.min(Math.floor(rawSpeedup), cap);
  const cost = cyclesCost(fromLevel, speedupSteps);
  const secs = secondsCost(fromLevel, speedupSteps);

  // Atomic conditional decrement of Cycles. Refused if balance < cost.
  const debit = await query<{ cycles: string }>(
    `update operators
       set cycles = cycles - $1
       where address = $2 and cycles >= $1
       returning cycles::text`,
    [cost.toString(), operator],
  );
  if (debit.rows.length === 0) {
    return c.json({ error: `not enough cycles (need ${cost.toString()})` }, 402);
  }

  await query(
    `insert into training_queue (agent_id, stat, from_level, to_level, cycles_spent, completes_at)
       values ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [agentId, stat, fromLevel, fromLevel + 1, cost.toString(), secs],
  );

  return c.json({
    id: agentId,
    stat,
    fromLevel,
    toLevel: fromLevel + 1,
    cyclesSpent: cost.toString(),
    cyclesBalance: debit.rows[0]!.cycles,
    secondsTotal: secs,
    speedupStepsApplied: speedupSteps,
    speedupCapAtLevel: cap,
  });
});

/// Cancel an active training. Refunds 50% of Cycles (rounded down).
app.post("/agents/:id/training/cancel", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  const { rows } = await query<{ cycles_spent: string }>(
    "delete from training_queue where agent_id = $1 returning cycles_spent::text",
    [agentId],
  );
  if (rows.length === 0) return c.json({ error: "no active training to cancel" }, 404);

  const spent = BigInt(rows[0]!.cycles_spent);
  const refund = spent / 2n;
  await query("update operators set cycles = cycles + $1 where address = $2", [refund.toString(), operator]);
  return c.json({ id: agentId, refunded: refund.toString() });
});

/// Finish the active training immediately. Charges 2x the remaining time
/// fraction of the original cost.
app.post("/agents/:id/training/finish-early", requireAuth, async (c) => {
  const operator = c.get("address");
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "invalid agent id" }, 400);

  const ownerErr = await ensureAgentOwnership(operator, agentId);
  if (ownerErr) return c.json({ error: ownerErr }, ownerErr === "agent not found" ? 404 : 403);

  const { rows } = await query<{
    stat: string;
    from_level: number;
    to_level: number;
    cycles_spent: string;
    started_at: Date;
    completes_at: Date;
  }>(
    `select stat, from_level, to_level, cycles_spent::text, started_at, completes_at
       from training_queue where agent_id = $1`,
    [agentId],
  );
  if (rows.length === 0) return c.json({ error: "no active training to finish" }, 404);
  const row = rows[0]!;

  const now = Date.now();
  const started = row.started_at.getTime();
  const ends = row.completes_at.getTime();
  const remainingFrac = Math.max(0, Math.min(1, (ends - now) / Math.max(1, ends - started)));
  const original = BigInt(row.cycles_spent);
  // 2x the un-served fraction. Round up so we never charge less than 1.
  const surchargeNum = original * BigInt(Math.ceil(remainingFrac * 200));
  const surcharge = surchargeNum / 100n;

  if (surcharge > 0n) {
    const debit = await query<{ cycles: string }>(
      `update operators set cycles = cycles - $1 where address = $2 and cycles >= $1 returning cycles::text`,
      [surcharge.toString(), operator],
    );
    if (debit.rows.length === 0) {
      return c.json({ error: `not enough cycles for early finish (need ${surcharge.toString()})` }, 402);
    }
  }

  // Force completes_at into the past then flush.
  await query("update training_queue set completes_at = now() - interval '1 second' where agent_id = $1", [agentId]);
  await flushTrainingQueue(agentId);

  return c.json({ id: agentId, surcharge: surcharge.toString(), newLevel: row.to_level, stat: row.stat });
});

/// Bulk name lookup for surfaces that only know agent ids (live standings,
/// contest stages, anywhere a broadcast frame lacks names). Pass a comma-
/// separated id list; returns a name map (missing entries are simply absent).
app.get("/agents/names", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return c.json({ names: {} });
  const { rows } = await query<{ id: string; nickname: string | null }>(
    "select id, nickname from agents where id = any($1::bigint[]) and nickname is not null",
    [ids],
  );
  const names: Record<string, string> = {};
  for (const r of rows) {
    if (r.nickname) names[r.id] = r.nickname;
  }
  return c.json({ names });
});

app.get("/agents/:id/traits", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ traits: [] });
  const { rows } = await query<{ trait_id: string; source: string; source_ref: string | null; awarded_at: Date }>(
    "select trait_id, source, source_ref, awarded_at from agent_traits where agent_id = $1 order by awarded_at",
    [agentId],
  );
  return c.json({
    traits: rows.map((r) => {
      const def = traitById(r.trait_id);
      return {
        id: r.trait_id,
        name: def?.name ?? r.trait_id,
        rarity: def?.rarity ?? "common",
        body: def?.body ?? "",
        source: r.source,
        sourceRef: r.source_ref,
        awardedAt: r.awarded_at,
      };
    }),
  });
});

// Whether the connected operator can roll the mystery in the current UTC cycle.
// Returns `ready: true` when they haven't claimed today.
app.get("/mystery/cooldown", requireAuth, async (c) => {
  const operator = c.get("address");
  const { rows } = await query<{ last_claim: Date; total_claims: string }>(
    "select last_claim, total_claims from mystery_claims where operator = $1",
    [operator],
  );
  const last = rows[0]?.last_claim ? new Date(rows[0].last_claim) : null;
  const ready = !last || !sameUtcDay(last);
  return c.json({
    ready,
    lastClaim: last ? last.toISOString() : null,
    nextAvailable: nextResetMs(),
    totalClaims: Number(rows[0]?.total_claims ?? 0),
  });
});

// Roll the mystery. Picks a random trait weighted by rarity that the agent
// doesn't already own, binds it to the agent, and updates the cooldown row.
app.post("/mystery/claim", requireAuth, async (c) => {
  const operator = c.get("address");

  let agentId: number;
  try {
    const body = await c.req.json<{ agentId?: number }>();
    agentId = Number(body.agentId);
  } catch {
    return c.json({ error: "agentId required" }, 400);
  }
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "agentId required" }, 400);

  // Ownership check via the indexer's agents table. The indexer writes the
  // owner on AgentCreated, so any agent the operator owns is recorded.
  const ownerRow = await query<{ owner: string }>(
    "select owner from agents where id = $1",
    [String(agentId)],
  );
  const owner = ownerRow.rows[0]?.owner?.toLowerCase();
  if (!owner || owner !== operator.toLowerCase()) {
    return c.json({ error: "you don't own that agent" }, 403);
  }

  // Per-operator daily cap: one box per UTC day.
  const cd = await query<{ last_claim: Date }>(
    "select last_claim from mystery_claims where operator = $1",
    [operator],
  );
  const last = cd.rows[0]?.last_claim ? new Date(cd.rows[0].last_claim) : null;
  if (last && sameUtcDay(last)) {
    return c.json({ error: "already claimed today", nextAvailable: nextResetMs() }, 429);
  }

  // Filter out traits the agent already owns.
  const ownedRows = await query<{ trait_id: string }>(
    "select trait_id from agent_traits where agent_id = $1",
    [agentId],
  );
  const owned = new Set(ownedRows.rows.map((r) => r.trait_id));
  const available = TRAITS.filter((t) => !owned.has(t.id));
  if (available.length === 0) {
    return c.json({ error: "this agent has collected every trait" }, 409);
  }

  // Reserve a slot in today's global pool atomically. "Today" is the claim day
  // shifted -1h, so the boundary lands at 01:00 UTC. First-come-first-served:
  // when the row reaches dailyPoolFor() (0, 1, 2, or a bonus-day 3), the next
  // claim sees a false drain rollback and the pool stays full until the next
  // reset. On a dry day (pool 0) the very first claim rolls back to exhausted.
  const poolRes = await query<{ claimed: number }>(
    `insert into mystery_pool_daily (day, claimed)
       values ((((now() at time zone 'utc') - interval '1 hour'))::date, 1)
       on conflict (day) do update set claimed = mystery_pool_daily.claimed + 1
       returning claimed`,
  );
  const newClaimed = Number(poolRes.rows[0]?.claimed ?? 0);
  if (newClaimed > DAILY_POOL_MAX) {
    await query(
      "update mystery_pool_daily set claimed = claimed - 1 where day = (((now() at time zone 'utc') - interval '1 hour'))::date",
    );
    return c.json({ error: "today's pool is exhausted", nextAvailable: nextResetMs() }, 429);
  }

  // The operator burns their daily attempt as soon as the pool slot is taken,
  // even on a rug.
  await query(
    `insert into mystery_claims (operator, last_claim, total_claims) values ($1, now(), 1)
       on conflict (operator) do update set last_claim = now(), total_claims = mystery_claims.total_claims + 1`,
    [operator],
  );

  // Roll the box: 65% rug, else common / rare / legendary by the fixed odds.
  // The trait handed out is a random one of the rolled rarity the agent does
  // not already own (degrading a rarity down if it owns them all).
  const result = rollMystery(owned);
  if (result.rarity === "rugged" || !result.trait) {
    void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, rugged: true }, source: "auth" });
    return c.json({ rugged: true, trait: null, rarity: "rugged", agentId });
  }

  const trait: Trait = result.trait;
  await query(
    "insert into agent_traits (agent_id, trait_id, source) values ($1, $2, 'mystery') on conflict (agent_id, trait_id) do nothing",
    [agentId, trait.id],
  );
  void logEvent({ kind: "mystery_claim", address: operator, context: { agentId, traitId: trait.id, rarity: trait.rarity }, source: "auth" });
  void notify(operator, {
    kind: "mystery_win",
    title: "Mystery box: you won a trait",
    body: `${trait.name} (${trait.rarity}). equip it before your next entry.`,
    href: "/workshop",
    context: { traitId: trait.id, rarity: trait.rarity, agentId },
  });

  return c.json({ rugged: false, trait, rarity: result.trait.rarity, agentId });
});

// ----- Notifications -----

/// Per-operator notification feed. Newest first, capped. `?unreadOnly=1`
/// returns just the unread ones (used for the bell badge count).
app.get("/agon/alert-subscriptions", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  const [subscriptions, ownedListings, recipient] = await Promise.all([
    agonOperationsAlerts.listSubscriptions(operator),
    agonOperationsAlerts.listOwnedListings(operator),
    query<{ telegram_linked: boolean }>(
      "select telegram_id is not null as telegram_linked from operators where address = $1",
      [operator],
    ),
  ]);
  return c.json({
    subscriptions,
    ownedListings,
    telegramLinked: recipient.rows[0]?.telegram_linked === true,
  });
});

app.post("/agon/alert-subscriptions", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let body: Record<string, unknown>;
  try { body = await c.req.json<Record<string, unknown>>(); }
  catch { return c.json({ error: "invalid JSON" }, 400); }
  const allowed = new Set(["listingReference", "source", "minimumSeverity", "inApp", "telegram", "enabled"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return c.json({ error: "unknown subscription field" }, 400);
  const listingReference = typeof body.listingReference === "string" ? body.listingReference.trim().toLowerCase() : "";
  const source = body.source;
  const minimumSeverity = body.minimumSeverity;
  const inApp = body.inApp !== false;
  const telegram = body.telegram === true;
  const enabled = body.enabled !== false;
  if (!listingReference) return c.json({ error: "listingReference is required" }, 400);
  if (!(["any", "certification", "arena", "stage"] as unknown[]).includes(source)) return c.json({ error: "invalid alert source" }, 400);
  if (!(["info", "warning", "critical"] as unknown[]).includes(minimumSeverity)) return c.json({ error: "invalid minimum severity" }, 400);
  if (!inApp && !telegram) return c.json({ error: "at least one alert channel is required" }, 400);
  if (!await agonOperationsAlerts.ownsListing(operator, listingReference)) return c.json({ error: "only the indexed service provider can subscribe to this listing" }, 403);
  if (telegram) {
    const linked = await query("select 1 from operators where address = $1 and telegram_id is not null", [operator]);
    if ((linked.rowCount ?? 0) === 0) return c.json({ error: "link Telegram before enabling Telegram alerts" }, 409);
  }
  const subscription = await agonOperationsAlerts.upsertSubscription({
    operatorAddress: operator,
    scopeType: "service",
    scopeReference: listingReference,
    source: source as "any" | "certification" | "arena" | "stage",
    minimumSeverity: minimumSeverity as "info" | "warning" | "critical",
    inApp,
    telegram,
    enabled,
  });
  return c.json({ subscription });
});

app.delete("/agon/alert-subscriptions/:subscriptionId", requireAuth, async (c) => {
  const removed = await agonOperationsAlerts.deleteSubscription(c.get("address"), c.req.param("subscriptionId"));
  return removed ? c.json({ ok: true }) : c.json({ error: "subscription not found" }, 404);
});

app.get("/notifications", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  const unreadOnly = c.req.query("unreadOnly") === "1";
  const { rows } = await query<{
    id: string; kind: string; title: string; body: string | null;
    href: string | null; read: boolean; created_at: Date;
    alert_id: string | null; severity: string | null; alert_status: string | null;
  }>(
    `select n.id::text, n.kind, n.title, n.body, n.href, n.read, n.created_at,
            a.alert_id, a.severity, a.status as alert_status
       from notifications n
       left join agon_alert_recipients ar on ar.notification_id = n.id
       left join agon_operations_alerts a on a.alert_id = ar.alert_id
      where n.operator = $1 ${unreadOnly ? "and n.read = false" : ""}
      order by n.created_at desc
      limit 20`,
    [operator],
  );
  const unread = rows.filter((r) => !r.read).length;
  return c.json({
    unread,
    items: rows.map((r) => ({
      id: Number(r.id),
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      read: r.read,
      alertId: r.alert_id,
      severity: r.severity,
      alertStatus: r.alert_status,
      createdAt: r.created_at,
    })),
  });
});

/// Mark notifications read. Body { ids?: number[] }; omit ids to mark all.
app.post("/notifications/read", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let ids: number[] = [];
  try {
    const body = await c.req.json<{ ids?: number[] }>();
    ids = Array.isArray(body.ids) ? body.ids.filter((n) => Number.isFinite(n)) : [];
  } catch { /* mark-all */ }
  if (ids.length > 0) {
    await query(
      "update notifications set read = true where operator = $1 and id = any($2::bigint[])",
      [operator, ids],
    );
  } else {
    await query("update notifications set read = true where operator = $1 and read = false", [operator]);
  }
  return c.json({ ok: true });
});

/// Clear the feed. Body { ids?: number[] } removes those rows; omit ids to
/// clear all of the operator's notifications.
app.post("/notifications/clear", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let ids: number[] = [];
  try {
    const body = await c.req.json<{ ids?: number[] }>();
    ids = Array.isArray(body.ids) ? body.ids.filter((n) => Number.isFinite(n)) : [];
  } catch { /* clear-all */ }
  if (ids.length > 0) {
    await query(
      `delete from notifications n where operator = $1 and id = any($2::bigint[])
        and not exists (
          select 1 from agon_alert_recipients ar
          join agon_operations_alerts a on a.alert_id = ar.alert_id
          where ar.notification_id = n.id and a.severity = 'critical' and a.status = 'open'
        )`,
      [operator, ids],
    );
  } else {
    await query(
      `delete from notifications n where operator = $1
        and not exists (
          select 1 from agon_alert_recipients ar
          join agon_operations_alerts a on a.alert_id = ar.alert_id
          where ar.notification_id = n.id and a.severity = 'critical' and a.status = 'open'
        )`,
      [operator],
    );
  }
  return c.json({ ok: true });
});

// ----- Feedback -----

/// Lightweight global rate limit so the public feedback endpoint can't be
/// used to flood the team's Telegram. Allows a burst, then ~1 per 2s.
const feedbackHits: number[] = [];
function feedbackRateOk(): boolean {
  const now = Date.now();
  while (feedbackHits.length > 0 && now - feedbackHits[0]! > 60_000) feedbackHits.shift();
  if (feedbackHits.length >= 30) return false;
  feedbackHits.push(now);
  return true;
}

/// In-app feedback (bug reports / feature ideas) relayed to the team's
/// Telegram. Public on purpose: anyone using the app can report, signed in
/// or not. The page path and operator address ride along when available so
/// reports are actionable.
app.post("/feedback", async (c) => {
  if (!feedbackRateOk()) return c.json({ error: "rate limited" }, 429);

  let body: { type?: string; message?: string; path?: string; address?: string; image?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }

  const message = String(body.message ?? "").trim().slice(0, 2000);
  if (!message) return c.json({ error: "message required" }, 400);
  const type = body.type === "idea" ? "IDEA" : "BUG";
  const where = body.path ? String(body.path).slice(0, 200) : "";
  const who = body.address ? String(body.address).slice(0, 64) : "anonymous";

  const token = config.auth.telegram.botToken;
  const chatId = config.auth.telegram.feedbackChatId;
  if (!token || !chatId) {
    console.warn("[feedback] telegram not configured (TELEGRAM_BOT_TOKEN / FEEDBACK_TELEGRAM_CHAT_ID); dropping");
    return c.json({ ok: true, delivered: false });
  }

  const text = `[ARCRUN ${type}]\n\n${message}\n\npage: ${where || "?"}\nfrom: ${who}`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      console.warn(`[feedback] telegram HTTP ${res.status}`);
      return c.json({ ok: false }, 502);
    }
  } catch (err) {
    console.warn(`[feedback] relay failed: ${err instanceof Error ? err.message : err}`);
    return c.json({ ok: false }, 502);
  }

  // Optional screenshot: a data URL from the widget. Decode and forward to the
  // same chat via sendPhoto. Best-effort, so a bad image never fails the
  // report whose text already landed.
  await relayFeedbackPhoto(token, chatId, type, body.image);

  return c.json({ ok: true, delivered: true });
});

/// Decode a data-URL screenshot and post it to Telegram via sendPhoto.
async function relayFeedbackPhoto(
  token: string,
  chatId: string,
  type: string,
  dataUrl: string | undefined,
): Promise<void> {
  if (!dataUrl) return;
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return;
  const mime = m[1]!;
  const buf = Buffer.from(m[2]!, "base64");
  if (buf.length === 0 || buf.length > 6 * 1024 * 1024) return; // cap ~6MB
  try {
    const ext = mime.split("/")[1] ?? "png";
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", `[ARCRUN ${type}] screenshot`);
    form.append("photo", new Blob([buf], { type: mime }), `screenshot.${ext}`);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) console.warn(`[feedback] sendPhoto HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[feedback] sendPhoto failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ----- Tier gates -----

/// Record the tier gate a host chose for a contest or challenge they created.
/// Verifies the caller is the on-chain creator before storing, so one
/// operator can't re-gate another's campaign.
app.post("/tier-gates", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let body: { surface?: string; eventId?: number; minTier?: number; maxTier?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const surface: GateSurface = body.surface === "challenge" ? "challenge" : "contest";
  const eventId = Number(body.eventId);
  if (!Number.isFinite(eventId) || eventId <= 0) return c.json({ error: "eventId required" }, 400);

  // Creator check against chain truth.
  try {
    if (surface === "contest") {
      const c2 = (await publicClient.readContract({
        address: config.contracts.ContestEngine,
        abi: [{ name: "getContest", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
          { name: "contestType", type: "uint8" }, { name: "status", type: "uint8" }, { name: "winnerCutBps", type: "uint16" },
          { name: "topN", type: "uint16" }, { name: "platformFeeBps", type: "uint16" }, { name: "sponsor", type: "address" },
          { name: "protocolTarget", type: "address" }, { name: "metric", type: "bytes32" }, { name: "startTime", type: "uint64" },
          { name: "endTime", type: "uint64" }, { name: "prizePool", type: "uint256" }, { name: "finalRoot", type: "bytes32" },
        ] }] }] as const,
        functionName: "getContest",
        args: [BigInt(eventId)],
      })) as { sponsor: string };
      if (c2.sponsor.toLowerCase() !== operator) return c.json({ error: "only the host can gate this campaign" }, 403);
    } else {
      const ch = (await publicClient.readContract({
        address: config.contracts.ChallengeArena,
        abi: [{ name: "getChallenge", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "tuple", components: [
          { name: "creator", type: "address" }, { name: "kind", type: "uint8" }, { name: "status", type: "uint8" },
          { name: "isPrivate", type: "bool" }, { name: "platformFeeBps", type: "uint16" }, { name: "stake", type: "uint128" },
          { name: "maxEntrants", type: "uint64" }, { name: "joinDeadline", type: "uint64" }, { name: "resolveDeadline", type: "uint64" },
          { name: "winnerRoot", type: "bytes32" },
        ] }] }] as const,
        functionName: "getChallenge",
        args: [BigInt(eventId)],
      })) as { creator: string };
      if (ch.creator.toLowerCase() !== operator) return c.json({ error: "only the host can gate this challenge" }, 403);
    }
  } catch {
    return c.json({ error: "could not verify the campaign" }, 400);
  }

  await setTierGate(surface, eventId, Number(body.minTier ?? 0), Number(body.maxTier ?? 4));
  return c.json({ ok: true });
});

/// Public read of a campaign's tier gate. Null when open to all tiers.
app.get("/tier-gates/:surface/:id", async (c) => {
  const surface: GateSurface = c.req.param("surface") === "challenge" ? "challenge" : "contest";
  const eventId = Number(c.req.param("id"));
  if (!Number.isFinite(eventId)) return c.json({ gate: null });
  const gate = await getTierGate(surface, eventId);
  return c.json({ gate });
});

// ----- Custom contest/challenge requests -----

/// A project submits a custom-campaign request. ArcRun reviews it offline and
/// coordinates the wiring. Persists the request, confirms to the operator,
/// and flags it for admin review.
app.post("/custom-requests", requireAuth, async (c) => {
  const operator = c.get("address").toLowerCase();
  let body: { surface?: string; kind?: string; contact?: string; spec?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const surface = body.surface === "challenge" ? "challenge" : "contest";
  const contact = (body.contact ?? "").trim();
  const spec = (body.spec ?? "").trim();
  if (contact.length < 3) return c.json({ error: "add a contact so ArcRun can reach you" }, 400);
  if (spec.length < 20) return c.json({ error: "describe the metric and rules in a bit more detail" }, 400);

  const { rows } = await query<{ id: string }>(
    `insert into custom_requests (operator, surface, kind, contact, spec)
     values ($1, $2, $3, $4, $5) returning id::text`,
    [operator, surface, (body.kind ?? "").trim() || null, contact, spec.slice(0, 4000)],
  );
  const id = Number(rows[0]?.id ?? 0);
  void logEvent({ kind: "custom_request", address: operator, context: { id, surface }, source: "auth" });
  void notify(operator, {
    kind: "custom_request",
    title: "Custom campaign request received",
    body: "ArcRun will review it and reach out using the contact you gave.",
    href: "/contests",
    context: { id, surface },
  });
  return c.json({ ok: true, id });
});

/// Admin: list custom requests. Token-gated, newest first.
app.get("/admin/custom-requests", async (c) => {
  const adminToken = config.adminToken;
  if (!adminToken) return c.json({ error: "admin disabled (set ADMIN_TOKEN)" }, 503);
  if (c.req.header("x-admin-token") !== adminToken) return c.json({ error: "unauthorized" }, 401);
  const status = c.req.query("status");
  const { rows } = await query(
    `select id::text, operator, surface, kind, contact, spec, status, created_at
       from custom_requests
      ${status ? "where status = $1" : ""}
      order by created_at desc limit 200`,
    status ? [status] : [],
  );
  return c.json({ requests: rows });
});

// ----- Strength breakdown (workshop panel) -----

import { effectiveStrength, type ContestType, STAT_NAMES as STRENGTH_STAT_NAMES, type StatName as StrengthStatName } from "../scoring/strength.js";

/// Returns the agent's effective-strength breakdown per contest type so
/// the workshop can show "tier × training × traits" with the actual
/// numbers. Optional ?traits=lucky_charm,puzzle_savant query lets the
/// user preview a hypothetical loadout.
// Arcana positions for a single agent. Returns open (unresolved markets),
// settled (resolved markets with PnL), and aggregate stats. Used by the
// workshop UI later; safe to expose publicly since each row is already
// public on the Arcana contract.
app.get("/agents/:id/arcana-positions", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "bad agent id" }, 400);
  const { rows } = await query<{
    contest_id: string;
    market_id: string;
    side: "yes" | "no";
    stake_usdc: string;
    entry_yes_pool: string;
    entry_no_pool: string;
    tx_hash: string | null;
    claimed: boolean;
    claim_tx_hash: string | null;
    pnl_usdc: string | null;
    created_at: string;
    title: string | null;
    category: string | null;
    end_time: string | null;
    resolved: boolean | null;
    outcome: boolean | null;
    cur_yes_pool: string | null;
    cur_no_pool: string | null;
  }>(
    `select ap.contest_id, ap.market_id, ap.side, ap.stake_usdc,
            ap.entry_yes_pool, ap.entry_no_pool, ap.tx_hash, ap.claimed,
            ap.claim_tx_hash, ap.pnl_usdc, ap.created_at::text,
            m.title, m.category, m.end_time::text,
            m.resolved, m.outcome,
            m.yes_pool as cur_yes_pool, m.no_pool as cur_no_pool
       from agent_positions ap
       left join arcana_markets m on m.market_id = ap.market_id
      where ap.agent_id = $1
      order by ap.created_at desc
      limit 200`,
    [agentId],
  );

  // Format each row with implied probability deltas the UI can display.
  const positions = rows.map((r) => {
    const entryYes = BigInt(r.entry_yes_pool);
    const entryNo = BigInt(r.entry_no_pool);
    const entrySum = entryYes + entryNo;
    const entryYesProb = entrySum > 0n ? Number((entryYes * 10000n) / entrySum) / 10000 : 0.5;
    const curYes = BigInt(r.cur_yes_pool ?? "0");
    const curNo = BigInt(r.cur_no_pool ?? "0");
    const curSum = curYes + curNo;
    const curYesProb = curSum > 0n ? Number((curYes * 10000n) / curSum) / 10000 : entryYesProb;
    return {
      contest_id: Number(r.contest_id),
      market_id: Number(r.market_id),
      title: r.title ?? "",
      category: r.category ?? "",
      side: r.side,
      stake_usdc: Number(r.stake_usdc) / 1e6,
      entry_yes_prob: entryYesProb,
      current_yes_prob: curYesProb,
      tx_hash: r.tx_hash,
      claimed: r.claimed,
      claim_tx_hash: r.claim_tx_hash,
      pnl_usdc: r.pnl_usdc != null ? Number(r.pnl_usdc) / 1e6 : null,
      resolved: r.resolved ?? false,
      outcome: r.outcome,
      end_time: r.end_time,
      created_at: r.created_at,
    };
  });

  const open = positions.filter((p) => !p.resolved);
  const settled = positions.filter((p) => p.resolved);
  const totalStake = positions.reduce((acc, p) => acc + p.stake_usdc, 0);
  const realizedPnl = settled.reduce((acc, p) => acc + (p.pnl_usdc ?? 0), 0);
  const wins = settled.filter((p) => (p.pnl_usdc ?? 0) > 0).length;

  return c.json({
    agent_id: agentId,
    open,
    settled,
    summary: {
      positions_total: positions.length,
      open_count: open.length,
      settled_count: settled.length,
      total_stake_usdc: totalStake,
      realized_pnl_usdc: realizedPnl,
      win_count: wins,
      win_rate: settled.length > 0 ? wins / settled.length : null,
    },
  });
});

app.get("/agents/:id/strength", async (c) => {
  const agentId = Number(c.req.param("id"));
  if (!Number.isFinite(agentId)) return c.json({ error: "bad agent id" }, 400);
  const traitParam = (c.req.query("traits") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const traits = traitParam.slice(0, 3);

  const { rows: agentRows } = await query<{
    owner: string;
    scout_tier: number;
    analyst_tier: number;
    solver_tier: number;
  }>(
    "select owner, scout_tier, analyst_tier, solver_tier from agents where id = $1",
    [agentId],
  );
  if (!agentRows[0]) return c.json({ error: "agent not found" }, 404);

  const { rows: statRows } = await query<{ stat: string; level: number }>(
    "select stat, level from agent_stats where agent_id = $1",
    [agentId],
  );
  const stats: Partial<Record<StrengthStatName, number>> = {};
  for (const r of statRows) {
    if ((STRENGTH_STAT_NAMES as readonly string[]).includes(r.stat)) {
      stats[r.stat as StrengthStatName] = r.level;
    }
  }

  const tierFor: Record<ContestType, number> = {
    solver: agentRows[0].solver_tier,
    analyst: agentRows[0].analyst_tier,
    scout: agentRows[0].scout_tier,
  };

  const breakdown: Record<ContestType, ReturnType<typeof effectiveStrength>> = {
    solver: effectiveStrength(tierFor.solver, stats, traits, "solver"),
    analyst: effectiveStrength(tierFor.analyst, stats, traits, "analyst"),
    scout: effectiveStrength(tierFor.scout, stats, traits, "scout"),
  };

  return c.json({ agentId, traits, breakdown });
});

// ----- Private challenge invite list -----

/// Public read of who's been invited to a private challenge. The indexer
/// mirrors ChallengeInvited events into challenge_invites; the creator's
/// invite panel renders the list and the join page can show "you are
/// invited" when the connected wallet appears here.
app.get("/challenges/:id/invites", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ invitees: [] });
  const { rows } = await query<{ invitee: string; created_at: Date }>(
    "select invitee, created_at from challenge_invites where challenge_id = $1 order by created_at asc",
    [id],
  );
  return c.json({
    invitees: rows.map((r) => ({ address: r.invitee, invitedAt: r.created_at })),
  });
});

// ----- Claim-prep gate (off-chain 6-agent cap for web3 wallets) -----
//
// Web3 wallet users sign createAgent client-side, so the auth service
// never sees the tx until the indexer picks it up. We can't actually
// stop a determined user from skipping this check, but we expose a
// "are you allowed to claim" endpoint the frontend calls right before
// signing. Combined with the frontend disable/refetch race fixes, this
// catches the casual case where two clicks race past the on-chain
// limit. Permanent enforcement requires an AgentRegistry redeploy.

app.get("/agents/claim-prep", requireAuth, async (c) => {
  const operator = c.get("address");
  const { rows } = await query<{ n: string }>(
    "select count(*)::text as n from agents where owner = $1",
    [operator],
  );
  const owned = Number(rows[0]?.n ?? "0");
  const max = 6;
  return c.json({
    owned,
    max,
    canClaim: owned < max,
    reason: owned < max ? null : `${max} agent cap reached`,
  });
});

// ----- Trait loadouts (equip up to 3 traits per entry) -----

/// Public read of the operator's owned trait pool plus the catalogue. The
/// equip UI uses this to render which traits the user can pick from and
/// what each does.
app.get("/operators/:address/traits", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ owned: [], catalogue: TRAIT_CATALOGUE });
  const owned = await ownedTraitPool(address);
  return c.json({ owned, catalogue: TRAIT_CATALOGUE, maxEquipped: MAX_EQUIPPED });
});

/// Read the equipped loadout for a specific (source, event_id, agent_id).
app.get("/loadouts/:source/:eventId/:agentId", async (c) => {
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") {
    return c.json({ error: "source must be contest or challenge" }, 400);
  }
  const eventId = Number(c.req.param("eventId"));
  const agentId = Number(c.req.param("agentId"));
  if (!Number.isFinite(eventId) || !Number.isFinite(agentId)) {
    return c.json({ error: "bad event or agent id" }, 400);
  }
  const traitIds = await getLoadout(source, eventId, agentId);
  return c.json({ traitIds });
});

/// Set the equipped loadout for a specific entry. Validates max 3, no
/// clashes, no duplicates, and that every trait id is one the operator's
/// agents have collected. Auth-gated to the agent's owner.
app.post("/loadouts/:source/:eventId", requireAuth, async (c) => {
  const operator = c.get("address");
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") {
    return c.json({ error: "source must be contest or challenge" }, 400);
  }
  const eventId = Number(c.req.param("eventId"));
  if (!Number.isFinite(eventId)) return c.json({ error: "bad event id" }, 400);

  let body: { agentId?: number; traitIds?: string[] };
  try { body = await c.req.json(); } catch { return c.json({ error: "bad json" }, 400); }
  const agentId = Number(body.agentId);
  if (!Number.isFinite(agentId) || agentId <= 0) return c.json({ error: "agentId required" }, 400);
  const traitIds = Array.isArray(body.traitIds) ? body.traitIds.map((s) => String(s)) : [];

  // The agent must belong to the operator.
  const { rows: ownerRows } = await query<{ owner: string }>(
    "select owner from agents where id = $1",
    [agentId],
  );
  if (!ownerRows[0]) return c.json({ error: "agent not found" }, 404);
  if (ownerRows[0].owner.toLowerCase() !== operator.toLowerCase()) {
    return c.json({ error: "you do not own this agent" }, 403);
  }

  // Validate shape (max 3, no clash).
  const v = validateLoadout(traitIds);
  if (!v.ok) return c.json({ error: v.reason ?? "invalid loadout" }, 400);

  // Validate ownership of each trait.
  const owned = new Set(await ownedTraitPool(operator));
  for (const id of traitIds) {
    if (!owned.has(id)) return c.json({ error: `you don't own the trait ${id}` }, 403);
  }

  await setLoadout(source as "contest" | "challenge", eventId, agentId, operator, traitIds);
  return c.json({ ok: true, traitIds });
});

// ----- Entry caps (live + one-per-event) -----

/// How many live contests/challenges this operator currently has agents
/// in, plus a boolean for each cap rule so the frontend can disable the
/// ENTER button with a clear message instead of letting the tx fire.
app.get("/operators/:address/entry-caps", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  const maxLive = 3;
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ liveCount: 0, maxLive, atCap: false });
  }
  // The cap is 3 per surface (3 live contests AND 3 live challenges). When a
  // surface is given, count just that one; otherwise fall back to the
  // combined count for older callers.
  const surfaceParam = c.req.query("surface");
  if (surfaceParam === "contest" || surfaceParam === "challenge") {
    const liveCount = await liveEntryCountForSurface(address, surfaceParam);
    return c.json({ liveCount, maxLive, atCap: liveCount >= maxLive, surface: surfaceParam });
  }
  const liveCount = await liveEntryCount(address);
  return c.json({ liveCount, maxLive, atCap: liveCount >= maxLive });
});

/// Scout daily swap budget for one agent. The budget is shared across every
/// contest and challenge the agent runs, so an agent that has spent its swaps
/// elsewhere can't run another volume event until the UTC reset. `enabled` is
/// false when real swaps are off (Scout self-transfers, no budget to gate on).
app.get("/scout/swap-budget/:agentId", async (c) => {
  const agentId = Number(c.req.param("agentId"));
  const enabled = Boolean(config.scout.realSwaps && config.scout.kitKey);
  const cap = config.scout.dailySwapCap;
  if (!enabled || !Number.isFinite(agentId) || agentId <= 0) {
    return c.json({ enabled, remaining: cap, cap });
  }
  const { rows } = await query<{ used: string }>(
    "select used::text from scout_swap_budget where agent_id = $1 and day = (now() at time zone 'utc')::date",
    [agentId],
  );
  const used = Number(rows[0]?.used ?? 0);
  return c.json({ enabled, remaining: Math.max(0, cap - used), cap });
});

/// True if this operator already has any agent entered in (source, id).
app.get("/operators/:address/in-event/:source/:eventId", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ inEvent: false });
  const source = c.req.param("source");
  if (source !== "contest" && source !== "challenge") return c.json({ inEvent: false });
  const eventId = Number(c.req.param("eventId"));
  if (!Number.isFinite(eventId)) return c.json({ inEvent: false });
  const inEvent = await hasAgentInEvent(source, eventId, address);
  return c.json({ inEvent });
});

// ----- Real LLM run audit trail -----
//
// Public read of the per-puzzle solve history for a contest. Drives the
// solve-detail surface on the contest detail page: the exact puzzle text
// and each agent's answer. Limited so a curious viewer can't pull
// thousands of rows in one call.

app.get("/contests/:id/llm-runs", async (c) => {
  const contestId = Number(c.req.param("id"));
  if (!Number.isFinite(contestId)) return c.json({ runs: [] });
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100), 1), 500);
  const { rows } = await query<{
    agent_id: string;
    operator: string;
    round_idx: number;
    puzzle_idx: number;
    kind: string;
    model: string;
    prompt: string;
    response: string;
    expected: string | null;
    answer: string | null;
    verdict: string;
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    cost_usd: string;
    created_at: Date;
  }>(
    `select agent_id::text, operator, round_idx, puzzle_idx, kind, model, prompt, response, expected, answer,
            verdict, latency_ms, input_tokens, output_tokens, cost_usd::text, created_at
       from llm_runs
      where contest_id = $1
      order by round_idx asc, puzzle_idx asc, agent_id asc
      limit $2`,
    [contestId, limit],
  );
  return c.json({
    runs: rows.map((r) => ({
      agentId: Number(r.agent_id),
      operator: r.operator,
      roundIdx: r.round_idx,
      puzzleIdx: r.puzzle_idx,
      kind: r.kind,
      model: r.model,
      prompt: r.prompt,
      response: r.response,
      expected: r.expected,
      answer: r.answer,
      verdict: r.verdict,
      latencyMs: r.latency_ms,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      costUsd: r.cost_usd,
      createdAt: r.created_at,
    })),
  });
});

// ----- Pending winnings (claimable payouts) -----
//
// Lists every contest and challenge where this operator has an unclaimed
// payout. Frontend pairs each row with the on-chain claim check via
// hasClaimed / hasClaimedChallenge so already-claimed prizes drop out
// before render. Drives the dashboard's PRIZES PENDING surface so the
// user can claim from one place instead of finding each contest page.

app.get("/operators/:address/winnings-pending", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ contests: [], challenges: [] });

  // Project contests: payouts table is the source of truth.
  const contestRows = await query<{ id: string; amount: string; contest_type: number | null }>(
    `select p.contest_id::text as id, p.amount::text as amount, c.contest_type
       from payouts p
       left join contests c on c.id = p.contest_id
      where p.operator = $1
      order by p.contest_id desc`,
    [address],
  );

  // Peer challenges: challenge_payouts table.
  const challengeRows = await query<{ id: string; amount: string; kind: number | null }>(
    `select cp.challenge_id::text as id, cp.amount::text as amount, ch.kind
       from challenge_payouts cp
       left join challenges ch on ch.id = cp.challenge_id
      where cp.operator = $1
      order by cp.challenge_id desc`,
    [address],
  );

  return c.json({
    contests: contestRows.rows.map((r) => ({
      id: Number(r.id),
      amount: r.amount,
      contestType: r.contest_type,
    })),
    challenges: challengeRows.rows.map((r) => ({
      id: Number(r.id),
      amount: r.amount,
      kind: r.kind,
    })),
  });
});

// ----- Pending stake refunds (cancelled challenges) -----
//
// Lists challenges this operator joined that the contract has marked
// cancelled. The frontend pairs this with an on-chain refunded() check per
// row so it only renders rows the user can still claim back. Public read
// since the data is already on-chain; callers usually pass their own
// address but knowing somebody else's refund queue isn't sensitive.

app.get("/operators/:address/refunds-pending", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ challenges: [], contests: [] });
  }

  const [chRes, ctRes] = await Promise.all([
    // Return ALL non-settled challenges the operator joined, with the
    // indexer's known status as a hint. The frontend reads chain truth
    // via getChallenge(id) on each row to handle two real cases the
    // indexer misses:
    //   1. ChallengeCancelled event hasn't been processed yet (lag).
    //   2. Challenge is past joinDeadline / resolveDeadline but nobody
    //      has called cancelChallenge() yet, so status is still OPEN
    //      or LOCKED. The operator's stake is recoverable but needs a
    //      cancel tx first; the frontend renders a CANCEL + REFUND
    //      flow for these.
    query<{ id: string; stake: string; status: string }>(
      `select distinct ch.id::text as id, ch.stake::text as stake, ch.status
         from challenge_entries ce
         join challenges ch on ch.id = ce.challenge_id
        where ce.operator = $1
          and ch.status <> 'settled'
        order by ch.id desc`,
      [address],
    ),
    // Contests don't charge an entrant a stake (entry is free for agent
    // owners), so a cancelled contest the operator entered isn't a
    // refund claim; there's nothing to pull back. We still surface it
    // here so the dashboard can show "this contest was cancelled" and
    // the row doesn't vanish silently.
    query<{ id: string }>(
      `select distinct ct.id::text as id
         from entries en
         join contests ct on ct.id = en.contest_id
        where en.operator = $1
          and ct.status = 'cancelled'
        order by ct.id desc`,
      [address],
    ),
  ]);

  return c.json({
    challenges: chRes.rows.map((r) => ({
      id: Number(r.id),
      stake: r.stake,
      indexedStatus: r.status,
    })),
    contests: ctRes.rows.map((r) => ({ id: Number(r.id) })),
  });
});

/// Resolve a mixed list of invite recipients (wallet address, @X handle, or
/// Discord username) to operator wallet addresses. The private-challenge
/// invite flow calls this so a creator can invite by social handle instead of
/// pasting a 0x address; the on-chain ChallengeArena.invite still takes
/// addresses. Public read: it only maps a handle to a wallet, and wallets are
/// already public on-chain. An unmatched handle returns address: null so the
/// UI can tell the creator that person has not signed in yet.
app.post("/operators/resolve", async (c) => {
  const body = await c.req.json<{ recipients?: string[] }>().catch(() => ({ recipients: [] as string[] }));
  const recipients = Array.isArray(body.recipients) ? body.recipients.slice(0, 50) : [];
  const ADDR = /^0x[a-f0-9]{40}$/i;

  // Collect the non-address tokens (handles), @ stripped and lowercased, for
  // one batched lookup across both x_handle and discord_username.
  const handles: string[] = [];
  for (const raw of recipients) {
    const t = (raw ?? "").trim();
    if (t && !ADDR.test(t)) handles.push(t.replace(/^@/, "").toLowerCase());
  }

  const byX = new Map<string, string>();
  const byDiscord = new Map<string, string>();
  if (handles.length > 0) {
    const { rows } = await query<{ address: string; x_handle: string | null; discord_username: string | null }>(
      `select address, x_handle, discord_username
         from operators
        where lower(x_handle) = any($1::text[])
           or lower(discord_username) = any($1::text[])`,
      [handles],
    );
    for (const o of rows) {
      if (o.x_handle) byX.set(o.x_handle.toLowerCase(), o.address);
      if (o.discord_username) byDiscord.set(o.discord_username.toLowerCase(), o.address);
    }
  }

  const resolved = recipients.map((raw) => {
    const t = (raw ?? "").trim();
    if (!t) return { input: raw, address: null, via: null as null | "wallet" | "x" | "discord" };
    if (ADDR.test(t)) return { input: raw, address: t.toLowerCase(), via: "wallet" as const };
    const h = t.replace(/^@/, "").toLowerCase();
    if (byX.has(h)) return { input: raw, address: byX.get(h)!, via: "x" as const };
    if (byDiscord.has(h)) return { input: raw, address: byDiscord.get(h)!, via: "discord" as const };
    return { input: raw, address: null, via: null };
  });

  return c.json({ resolved });
});

// ----- Activity feed -----

// Recent on-chain activity across the arena, newest first, from the raw event
// log. Each row carries its tx hash so the UI can link to arcscan. Public read.
const FEED_EVENTS = [
  "ContestListed",
  "EntryRegistered",
  "ContestSettled",
  "ContestCancelled",
  "PrizeClaimed",
  "ChallengeCreated",
  "ChallengeJoined",
  "ChallengeSettled",
  "ChallengeCancelled",
  "AgentCreated",
];

app.get("/activity", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 30), 1), 100);
  const { rows } = await query<{
    event_name: string;
    args: Record<string, unknown>;
    tx_hash: string;
    block_number: string;
  }>(
    `select event_name, args, tx_hash, block_number
       from events_log
      where event_name = any($1::text[])
      order by block_number desc, log_index desc
      limit $2`,
    [FEED_EVENTS, limit],
  );
  return c.json({
    events: rows.map((r) => ({
      type: r.event_name,
      args: r.args,
      txHash: r.tx_hash,
      block: Number(r.block_number),
    })),
  });
});

// ----- Read surfaces: leaderboard and operator profiles -----

// Global leaderboard from the indexer tables. Participation from entries, wins
// and earnings from payouts, Cycles from operators, reputation summed across the
// operator's agents (raw, scaled 1e6). Public read.
app.get("/leaderboard", async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50), 1), 200);
  const { rows } = await query<{
    operator: string;
    entered: string;
    wins: string;
    earned: string | null;
    cycles: string;
    reputation: string;
    primary_agent_id: string | null;
    primary_skin: string | null;
    primary_display_mode: string | null;
    primary_nickname: string | null;
    discord_username: string | null;
    discord_avatar: string | null;
    x_handle: string | null;
    x_avatar: string | null;
    identity_mode: string | null;
  }>(
    // Primary agent is the operator's first non-delisted agent by id. Its
    // skin shows in the leaderboard row so identifiable operators (the
    // ones who bothered to upload a skin) read as themselves at a glance
    // instead of as a generic mascot. Falls back to a Robot variant
    // when no skin is set.
    `select
       op.address              as operator,
       coalesce(e.entered, 0)  as entered,
       coalesce(p.wins, 0)     as wins,
       coalesce(p.earned, 0)   as earned,
       op.cycles               as cycles,
       coalesce(ag.reputation, 0) as reputation,
       pa.id::text             as primary_agent_id,
       pa.skin                 as primary_skin,
       pa.display_mode         as primary_display_mode,
       pa.nickname             as primary_nickname,
       op.x_handle             as x_handle,
       op.x_avatar             as x_avatar,
       op.discord_username     as discord_username,
       op.discord_avatar       as discord_avatar,
       op.identity_mode        as identity_mode
     from operators op
     -- Entries: union of contest + challenge participation so the
     -- "ENTERED" column reflects everything the operator showed up for.
     left join (
       select operator, count(*) as entered from (
         select distinct operator, contest_id::text as event_id, 'c' as src from entries
         union all
         select distinct operator, challenge_id::text as event_id, 'h' as src from challenge_entries
       ) all_entries group by operator
     ) e on e.operator = op.address
     -- Wins + earnings: union of contest payouts and challenge payouts so
     -- challenge winners actually count toward WINS / EARNED.
     left join (
       select operator, count(*) as wins, sum(amount) as earned from (
         select operator, contest_id::text as event_id, amount from payouts
         union all
         select operator, challenge_id::text as event_id, amount from challenge_payouts
       ) all_payouts group by operator
     ) p on p.operator = op.address
     left join (select owner, sum(reputation) as reputation from agents group by owner) ag
       on ag.owner = op.address
     left join lateral (
       select a.id, a.skin, a.display_mode, a.nickname
         from agents a
         left join delisted_agents d on d.agent_id = a.id
        where a.owner = op.address and d.agent_id is null
        order by a.id
        limit 1
     ) pa on true
     -- Include anyone who entered a contest OR a challenge.
     where op.address in (
       select distinct operator from entries
       union
       select distinct operator from challenge_entries
     )
     order by wins desc nulls last, earned desc nulls last, cycles desc, entered desc
     limit $1`,
    [limit],
  );
  // The public origin we were reached on, so an avatar URL we hand back loads
  // cross-origin from the frontend. Honors the proxy's forwarded host/proto.
  const fwdHost = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "";
  const fwdProto = c.req.header("x-forwarded-proto") ?? "https";
  const origin = fwdHost ? `${fwdProto}://${fwdHost}` : "";
  return c.json({
    leaders: rows.map((r) => {
      // The leaderboard row shows the operator's chosen identity, not the
      // masked wallet. identity_mode lives on the operator ('auto' by default).
      // 'auto' prefers X, then Discord, then the first agent's custom skin, then
      // falls back to the masked wallet (primaryName null). Pinned modes resolve
      // their one source and only fall through to the wallet when it's empty.
      const xSkin = () => r.x_avatar ?? (r.x_handle ? `https://unavatar.io/x/${r.x_handle}` : null);
      const resolvers: Record<string, () => { skin: string | null; name: string | null } | null> = {
        x: () => (r.x_handle ? { skin: xSkin(), name: `@${r.x_handle}` } : null),
        discord: () => (r.discord_username ? { skin: r.discord_avatar ?? null, name: r.discord_username } : null),
        custom: () => (r.primary_skin ? { skin: r.primary_skin, name: r.primary_nickname ?? null } : null),
        wallet: () => null,
      };
      const mode = r.identity_mode ?? "auto";
      const order = mode === "auto" ? ["x", "discord", "custom"] : [mode];
      let resolved: { skin: string | null; name: string | null } | null = null;
      for (const key of order) {
        resolved = resolvers[key]?.() ?? null;
        if (resolved) break;
      }
      // A custom skin is a base64 data URL; serving it inline per row is what
      // bloated this payload, so hand back the cacheable avatar endpoint URL
      // instead. URL-based identities (X/Discord avatars) pass through as-is.
      let primarySkin: string | null = resolved?.skin ?? null;
      if (primarySkin && primarySkin.startsWith("data:") && r.primary_agent_id && origin) {
        primarySkin = `${origin}/agents/${r.primary_agent_id}/avatar`;
      }
      const primaryName: string | null = resolved?.name ?? null;
      return {
        operator: r.operator,
        entered: Number(r.entered),
        wins: Number(r.wins),
        earned: r.earned ?? "0",
        cycles: Number(r.cycles ?? "0"),
        reputation: r.reputation ?? "0",
        primaryAgentId: r.primary_agent_id ? Number(r.primary_agent_id) : null,
        primarySkin,
        primaryName,
        // Raw identity handles so the leaderboard search can match by wallet,
        // X, Discord, or custom name regardless of which one the operator
        // pinned as their primary display.
        xHandle: r.x_handle,
        discordUsername: r.discord_username,
        customName: r.primary_nickname,
      };
    }),
  });
});

// One operator's profile: their agents, lifetime stats, and recent contests.
app.get("/operators/:address", async (c) => {
  const address = (c.req.param("address") ?? "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return c.json({ error: "invalid address" }, 400);

  const op = await query<{
    address: string;
    x_handle: string | null;
    telegram_id: string | null;
    telegram_username: string | null;
    telegram_avatar: string | null;
    discord_id: string | null;
    discord_username: string | null;
    discord_avatar: string | null;
    identity_mode: string | null;
    current_syndicate_id: string | null;
    cycles: string;
  }>(
    "select address, x_handle, telegram_id, telegram_username, telegram_avatar, discord_id, discord_username, discord_avatar, identity_mode, current_syndicate_id, cycles from operators where address = $1",
    [address],
  );
  const agents = await query<{ id: string; scout_tier: number; analyst_tier: number; solver_tier: number; reputation: string; nickname: string | null; display_mode: string | null; has_skin: boolean }>(
    "select id, scout_tier, analyst_tier, solver_tier, reputation, nickname, display_mode, (skin is not null) as has_skin from agents where owner = $1 order by id",
    [address],
  );
  // Split by contests vs challenges so the dashboard can show the breakdown;
  // the totals (sum of the two) match the leaderboard, which counts both.
  const stats = await query<{
    c_entered: string; h_entered: string;
    c_wins: string; h_wins: string;
    c_earned: string; h_earned: string;
  }>(
    `select
       (select count(distinct contest_id) from entries where operator = $1)            as c_entered,
       (select count(distinct challenge_id) from challenge_entries where operator = $1) as h_entered,
       (select count(distinct contest_id) from payouts where operator = $1)            as c_wins,
       (select count(distinct challenge_id) from challenge_payouts where operator = $1) as h_wins,
       (select coalesce(sum(amount), 0) from payouts where operator = $1)              as c_earned,
       (select coalesce(sum(amount), 0) from challenge_payouts where operator = $1)     as h_earned`,
    [address],
  );
  const contests = await query<{ contest_id: string; contest_type: number | null; status: string | null; won: string | null; claimed: boolean }>(
    `select distinct on (e.contest_id)
       e.contest_id, c.contest_type, c.status, p.amount as won, e.claimed
     from entries e
     left join contests c on c.id = e.contest_id
     left join payouts p on p.contest_id = e.contest_id and p.operator = e.operator
     where e.operator = $1
     order by e.contest_id desc
     limit 20`,
    [address],
  );

  const s = stats.rows[0] ?? { c_entered: "0", h_entered: "0", c_wins: "0", h_wins: "0", c_earned: "0", h_earned: "0" };
  const cEarned = BigInt(s.c_earned ?? "0");
  const hEarned = BigInt(s.h_earned ?? "0");
  // Total reputation is the sum across the operator's agents (raw, scaled 1e6).
  const reputation = agents.rows.reduce((sum, a) => sum + BigInt(a.reputation ?? "0"), 0n).toString();
  return c.json({
    operator: op.rows[0]?.address ?? address,
    xHandle: op.rows[0]?.x_handle ?? null,
    telegramId: op.rows[0]?.telegram_id ?? null,
    telegramUsername: op.rows[0]?.telegram_username ?? null,
    telegramAvatar: op.rows[0]?.telegram_avatar ?? null,
    discordId: op.rows[0]?.discord_id ?? null,
    discordUsername: op.rows[0]?.discord_username ?? null,
    discordAvatar: op.rows[0]?.discord_avatar ?? null,
    identityMode: op.rows[0]?.identity_mode ?? "auto",
    syndicateId: op.rows[0]?.current_syndicate_id ?? null,
    cycles: Number(op.rows[0]?.cycles ?? "0"),
    reputation,
    stats: {
      entered: Number(s.c_entered) + Number(s.h_entered),
      wins: Number(s.c_wins) + Number(s.h_wins),
      earned: (cEarned + hEarned).toString(),
      contests: { entered: Number(s.c_entered), wins: Number(s.c_wins), earned: s.c_earned ?? "0" },
      challenges: { entered: Number(s.h_entered), wins: Number(s.h_wins), earned: s.h_earned ?? "0" },
    },
    agents: agents.rows.map((r) => ({
      id: Number(r.id),
      scoutTier: r.scout_tier,
      analystTier: r.analyst_tier,
      solverTier: r.solver_tier,
      reputation: r.reputation,
      nickname: r.nickname,
      displayMode: r.display_mode ?? "x",
      hasSkin: r.has_skin,
    })),
    contests: contests.rows.map((r) => ({
      contestId: Number(r.contest_id),
      contestType: r.contest_type,
      status: r.status,
      won: r.won,
      claimed: r.claimed,
    })),
  });
});

// ----- X (Twitter) OAuth2 with PKCE -----

function xConfigured() {
  return Boolean(config.auth.x.clientId && config.auth.x.clientSecret && config.auth.x.callbackUrl);
}

app.get("/auth/x/start", requireAuth, async (c) => {
  if (!xConfigured()) return c.json({ error: "X OAuth not configured" }, 501);
  const address = c.get("address");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  await redis.set(`xoauth:${state}`, JSON.stringify({ address, verifier }), "EX", STATE_TTL);

  // Use x.com, not twitter.com. After the rebrand, users are logged in on
  // x.com; the legacy twitter.com authorize page does not see that session and
  // shows "you have to be logged in to X" even when the user already is. The
  // token and users endpoints below stay on api.twitter.com (server-to-server,
  // no browser session involved, and that host still resolves).
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.auth.x.clientId!);
  url.searchParams.set("redirect_uri", config.auth.x.callbackUrl!);
  url.searchParams.set("scope", "tweet.read users.read");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return c.redirect(url.toString());
});

app.get("/auth/x/callback", async (c) => {
  if (!xConfigured()) return c.json({ error: "X OAuth not configured" }, 501);
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "missing code or state" }, 400);

  const stored = await redis.getdel(`xoauth:${state}`);
  if (!stored) return c.json({ error: "invalid or expired state" }, 401);
  const { address, verifier } = JSON.parse(stored) as { address: string; verifier: string };

  const basic = Buffer.from(`${config.auth.x.clientId}:${config.auth.x.clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.x.callbackUrl!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: "token exchange failed" }, 502);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "could not fetch X profile" }, 502);
  const me = (await meRes.json()) as { data: { username: string; profile_image_url?: string } };

  // X returns a 48px `_normal` avatar; swap to `_400x400` for a crisp one.
  const xAvatar = me.data.profile_image_url
    ? me.data.profile_image_url.replace("_normal", "_400x400")
    : null;
  await query(
    "update operators set x_handle = $2, x_avatar = $3 where address = $1",
    [address, me.data.username, xAvatar],
  );

  // Return the user to their own operator page so the freshly-linked X
  // handle is visible immediately; landing on the root makes the OAuth
  // look like it failed.
  const redirectTo = new URL(`/operators/${address}`, config.auth.appUrl);
  redirectTo.searchParams.set("x_bound", me.data.username);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/x/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query("update operators set x_handle = null, x_avatar = null where address = $1", [address]);
  return c.json({ ok: true });
});

// ----- Telegram Login Widget -----
//
// The widget runs client-side, opens Telegram for auth, and redirects to the
// callback below with id, first_name, last_name, username, photo_url, auth_date
// and hash query params. The hash is HMAC-SHA256 of the sorted data string,
// keyed by SHA256(bot_token). We verify the hash and a freshness window before
// linking the telegram_id and telegram_username onto the operator's row.

function telegramConfigured() {
  return Boolean(config.auth.telegram.botToken && config.auth.telegram.botUsername);
}

function verifyTelegramHash(data: Record<string, string>, botToken: string): boolean {
  const { hash, ...rest } = data;
  if (!hash) return false;
  const dataCheck = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const hmac = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return hmac === hash;
}

/// Fetch the user's Telegram profile photo through the Bot API and return it
/// as a self-contained data URL. The login widget only includes photo_url when
/// the user's privacy allows it, so this is the reliable path. We download the
/// bytes server-side (the file link carries the bot token, so it must never
/// reach the client) and inline them. Best-effort: returns null on any miss.
async function fetchTelegramAvatarDataUrl(userId: string, botToken: string): Promise<string | null> {
  try {
    const photosRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getUserProfilePhotos?user_id=${userId}&limit=1`,
    );
    const photos = (await photosRes.json()) as {
      result?: { photos?: Array<Array<{ file_id: string; width: number }>> };
    };
    const sizes = photos.result?.photos?.[0];
    if (!sizes || sizes.length === 0) return null;
    // Smallest size that is at least 160px, else the largest available, so the
    // 40px avatar stays crisp without bloating the row.
    const sorted = [...sizes].sort((a, b) => a.width - b.width);
    const pick = sorted.find((s) => s.width >= 160) ?? sorted[sorted.length - 1]!;

    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${pick.file_id}`);
    const fileJson = (await fileRes.json()) as { result?: { file_path?: string } };
    const path = fileJson.result?.file_path;
    if (!path) return null;

    const imgRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${path}`);
    if (!imgRes.ok) return null;
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (buf.length === 0 || buf.length > 200_000) return null;
    const mime = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

app.get("/auth/telegram/config", (c) =>
  c.json({ configured: telegramConfigured(), botUsername: config.auth.telegram.botUsername ?? null }),
);

app.get("/auth/telegram/callback", requireAuth, async (c) => {
  if (!telegramConfigured()) return c.json({ error: "Telegram OAuth not configured" }, 501);
  const address = c.get("address");
  const q = c.req.query() as Record<string, string>;

  if (!q.id || !q.auth_date || !q.hash) {
    return c.json({ error: "missing telegram fields" }, 400);
  }

  // Replay protection: the widget signs auth_date; reject anything older than
  // a day or sitting in the future (clock skew).
  const age = Math.floor(Date.now() / 1000) - Number(q.auth_date);
  if (!Number.isFinite(age) || age < -60 || age > 86400) {
    return c.json({ error: "telegram data outside acceptable freshness" }, 401);
  }

  if (!verifyTelegramHash(q, config.auth.telegram.botToken!)) {
    return c.json({ error: "invalid telegram signature" }, 401);
  }

  const username = q.username ?? null;
  // Prefer a self-hosted data URL fetched through the Bot API (works even when
  // the widget omits photo_url, e.g. the user's privacy hides it from the
  // widget). Fall back to the widget's photo_url string when the API misses.
  const fetched = await fetchTelegramAvatarDataUrl(q.id, config.auth.telegram.botToken!);
  const avatar = fetched ?? (typeof q.photo_url === "string" ? q.photo_url : null);
  await query(
    "update operators set telegram_id = $2, telegram_username = $3, telegram_avatar = $4 where address = $1",
    [address, q.id, username, avatar],
  );

  const redirectTo = new URL(config.auth.appUrl);
  redirectTo.pathname = `/operators/${address}`;
  redirectTo.searchParams.set("telegram_bound", username ?? q.id);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/telegram/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query(
    "update operators set telegram_id = null, telegram_username = null, telegram_avatar = null where address = $1",
    [address],
  );
  return c.json({ ok: true });
});

// Backfill the Telegram avatar for an already-linked operator via the Bot API.
// Recovers a pfp for users who linked before we captured photos (or whose
// photo wasn't fetchable then) without forcing a re-link. No-op when Telegram
// isn't linked or the photo still isn't fetchable (privacy / no photo set).
app.post("/auth/telegram/refresh-avatar", requireAuth, async (c) => {
  if (!telegramConfigured()) return c.json({ ok: false, hasAvatar: false });
  const address = c.get("address");
  const { rows } = await query<{ telegram_id: string | null }>(
    "select telegram_id from operators where address = $1",
    [address],
  );
  const tgId = rows[0]?.telegram_id;
  if (!tgId) return c.json({ ok: false, hasAvatar: false });
  const avatar = await fetchTelegramAvatarDataUrl(tgId, config.auth.telegram.botToken!);
  if (avatar) {
    await query("update operators set telegram_avatar = $2 where address = $1", [address, avatar]);
  }
  return c.json({ ok: true, hasAvatar: !!avatar });
});

// ----- Discord OAuth2 -----
//
// Mirrors the X flow with Discord's authorize/token/users endpoints. Confidential
// client (we hold a client secret) plus PKCE so the code exchange is double-bound
// to the original session. Scope is `identify` only; we don't ask for email.

function discordConfigured() {
  return Boolean(
    config.auth.discord.clientId && config.auth.discord.clientSecret && config.auth.discord.callbackUrl,
  );
}

app.get("/auth/discord/start", requireAuth, async (c) => {
  if (!discordConfigured()) return c.json({ error: "Discord OAuth not configured" }, 501);
  const address = c.get("address");
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  await redis.set(`discordoauth:${state}`, JSON.stringify({ address, verifier }), "EX", STATE_TTL);

  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.auth.discord.clientId!);
  url.searchParams.set("redirect_uri", config.auth.discord.callbackUrl!);
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return c.redirect(url.toString());
});

app.get("/auth/discord/callback", async (c) => {
  if (!discordConfigured()) return c.json({ error: "Discord OAuth not configured" }, 501);
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ error: "missing code or state" }, 400);

  const stored = await redis.getdel(`discordoauth:${state}`);
  if (!stored) return c.json({ error: "invalid or expired state" }, 401);
  const { address, verifier } = JSON.parse(stored) as { address: string; verifier: string };

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.auth.discord.clientId!,
      client_secret: config.auth.discord.clientSecret!,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.auth.discord.callbackUrl!,
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) return c.json({ error: "discord token exchange failed" }, 502);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!meRes.ok) return c.json({ error: "could not fetch discord profile" }, 502);
  const me = (await meRes.json()) as { id: string; username: string; avatar: string | null };

  // Discord avatars are keyed by user id + avatar hash, so build the CDN URL
  // now (animated avatars start with "a_" and serve as gif). Null avatar = the
  // default Discord avatar; we leave it null and the UI shows an initial.
  const discordAvatar = me.avatar
    ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.${me.avatar.startsWith("a_") ? "gif" : "png"}?size=128`
    : null;
  await query(
    "update operators set discord_id = $2, discord_username = $3, discord_avatar = $4 where address = $1",
    [address, me.id, me.username, discordAvatar],
  );

  const redirectTo = new URL(config.auth.appUrl);
  redirectTo.pathname = `/operators/${address}`;
  redirectTo.searchParams.set("discord_bound", me.username);
  return c.redirect(redirectTo.toString());
});

app.post("/auth/discord/unbind", requireAuth, async (c) => {
  const address = c.get("address");
  await query(
    "update operators set discord_id = null, discord_username = null, discord_avatar = null where address = $1",
    [address],
  );
  return c.json({ ok: true });
});

// Syndicate war board. Returns the most recently settled week's
// standings (rank, total, member count, syndicate name) plus the
// active week id so the frontend can show "last week's standings"
// alongside "this week's multiplier". Falls back to an empty array
// before any week has been settled (the scoring path uses the
// cumulative-rep fallback in that case).
app.get("/syndicates/war", async (c) => {
  const latest = await query<{ week_id: string }>(
    "select week_id from syndicate_war_results order by week_id desc limit 1",
  );
  const weekId = latest.rows[0]?.week_id ?? null;
  if (!weekId) {
    return c.json({ weekId: null, standings: [], multipliersByRank: { 1: 1.05, 2: 1.03, 3: 1.02 } });
  }
  const { rows } = await query<{
    syndicate_id: string;
    rank: string;
    total: string;
    member_count: string;
    name: string | null;
  }>(
    `select wr.syndicate_id::text, wr.rank::text, wr.total::text, wr.member_count::text, s.name
       from syndicate_war_results wr
       left join syndicates s on s.id = wr.syndicate_id
      where wr.week_id = $1
      order by wr.rank asc`,
    [weekId],
  );
  return c.json({
    weekId,
    standings: rows.map((r) => ({
      syndicateId: Number(r.syndicate_id),
      name: r.name,
      rank: Number(r.rank),
      total: r.total,
      memberCount: Number(r.member_count),
    })),
    multipliersByRank: { 1: 1.05, 2: 1.03, 3: 1.02 },
  });
});

/// Live "this week so far" standings: the CURRENT ISO-week's contributions
/// ranked on the fly, before the week settles. Lets the syndicates page show a
/// running rank instead of only the last settled week. Empty until this week's
/// contributions exist.
app.get("/syndicates/war/live", async (c) => {
  const now = new Date();
  // Back up to this week's Monday 00:00 UTC.
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const { rows } = await query<{
    syndicate_id: string;
    total: string;
    member_count: string;
    name: string | null;
  }>(
    `select sc.syndicate_id::text         as syndicate_id,
            sum(sc.amount)::text          as total,
            count(distinct sc.member)::text as member_count,
            s.name
       from syndicate_contributions sc
       left join syndicates s on s.id = sc.syndicate_id
      where sc.recorded_at >= $1
      group by sc.syndicate_id, s.name
      order by sum(sc.amount) desc`,
    [start.toISOString()],
  );

  // Top individual contributors this week — who is topping so far. These are
  // the operators whose agents earned the most reputation this week; they're
  // the ones who'd take the largest pool shares if their syndicate wins.
  const top = await query<{
    member: string;
    total: string;
    syndicate_id: string;
    name: string | null;
  }>(
    `select sc.member               as member,
            sum(sc.amount)::text    as total,
            sc.syndicate_id::text   as syndicate_id,
            max(s.name)             as name
       from syndicate_contributions sc
       left join syndicates s on s.id = sc.syndicate_id
      where sc.recorded_at >= $1
      group by sc.member, sc.syndicate_id
      order by sum(sc.amount) desc
      limit 12`,
    [start.toISOString()],
  );

  // Current ISO-8601 week id (e.g. "2026-W26").
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  const weekId = `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;

  return c.json({
    weekId,
    live: true,
    contributors: top.rows.map((r, i) => ({
      rank: i + 1,
      operator: r.member,
      syndicateId: Number(r.syndicate_id),
      syndicateName: r.name,
      total: r.total,
    })),
    standings: rows.map((r, i) => ({
      syndicateId: Number(r.syndicate_id),
      name: r.name,
      rank: i + 1,
      total: r.total,
      memberCount: Number(r.member_count),
    })),
    multipliersByRank: { 1: 1.05, 2: 1.03, 3: 1.02 },
  });
});

/// Weekly syndicate leaderboard: every syndicate ranked by the reputation its
/// members earned THIS ISO-week. It resets every Monday 00:00 UTC, so no
/// syndicate can ride an all-time lead forever; each week is a fresh race. The
/// war boost (top-3 of last week) is unchanged and applies on top. Backs the
/// SYNDICATES toggle on the leaderboard page.
app.get("/syndicates/leaderboard", async (c) => {
  // This week's Monday 00:00 UTC — the same window the live war board uses.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  // ISO-8601 week id for display ("2026-W26").
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThu.getTime()) / 86_400_000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  const weekId = `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;

  // Every syndicate with its this-week reputation (0 when it hasn't contributed
  // yet), ordered by the weekly sum. Ordering on the numeric aggregate avoids the
  // lexical-sort trap of casting to text before ORDER BY.
  const { rows } = await query<{
    id: string;
    name: string | null;
    reputation: string;
    member_count: number;
  }>(
    `select s.id::text                       as id,
            s.name                           as name,
            coalesce(w.rep, 0)::text         as reputation,
            coalesce(s.member_count, 0)::int as member_count
       from syndicates s
       left join (
         select syndicate_id, sum(amount) as rep
           from syndicate_contributions
          where recorded_at >= $1
          group by syndicate_id
       ) w on w.syndicate_id = s.id
      order by coalesce(w.rep, 0) desc, s.member_count desc nulls last, s.id asc`,
    [start.toISOString()],
  );
  return c.json({
    weekId,
    syndicates: rows.map((r, i) => ({
      rank: i + 1,
      syndicateId: Number(r.id),
      name: r.name,
      reputation: r.reputation,
      memberCount: Number(r.member_count),
    })),
  });
});

serve({ fetch: app.fetch, port: config.auth.port }, (info) => {
  console.log(`auth service on http://localhost:${info.port}`);
});

// ArcRun's own x402 seller: live market intel, priced in sub-cent USDC and
// settled through Circle Gateway's batched rail on Arc. Runs on its own port
// because Circle's middleware is a plain Node (req, res, next) handler, so it
// stays entirely off the Hono app. No-ops unless X402_SELLER_ENABLED=1.
void startArcX402Seller().catch((err) =>
  console.error("[x402-seller] failed to start:", err instanceof Error ? err.message : err),
);
