import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { loadAgonDeployment } from "./deployments.js";
import { productionSecretProblems } from "./secret-guard.ts";

/// Loads and validates all backend configuration in one place. Secrets come
/// from the environment; public contract addresses come from the committed
/// deployments file the contracts package writes.

/// Split a comma-separated URL list into trimmed, non-empty entries.
function parseUrlList(s: string): string[] {
  return s.split(",").map((u) => u.trim()).filter(Boolean);
}

/// True when every comma-separated entry parses as a URL (allows the RPC vars to
/// carry a primary + fallback list, e.g. "https://dedicated,https://public").
function isCommaSeparatedUrls(s: string): boolean {
  const parts = parseUrlList(s);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    try {
      new URL(p);
      return true;
    } catch {
      return false;
    }
  });
}

function parsePlaygroundProviderEndpoints(value: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("AGON_PLAYGROUND_PROVIDER_ENDPOINTS must be a JSON object");
  }
  const result = z.record(z.string().min(1)).safeParse(parsed);
  if (!result.success) throw new Error("AGON_PLAYGROUND_PROVIDER_ENDPOINTS must map service keys to HTTPS endpoints");
  return result.data;
}

function parseAddressList(value: string): `0x${string}`[] {
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const address of parts) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error("AGON_X402_ALLOWED_RECIPIENTS must be comma-separated EVM addresses");
    }
  }
  return parts as `0x${string}`[];
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // One or more comma-separated URLs (primary first). Multiple URLs enable a
  // fallback transport: the read clients try the primary, then fail over to the
  // next on error, so a dedicated endpoint and the public RPC back each other up.
  ARC_RPC_HTTP: z.string().refine(isCommaSeparatedUrls, "must be one or more comma-separated URLs"),
  ARC_RPC_WS: z.string().refine(isCommaSeparatedUrls, "must be one or more comma-separated URLs"),
  CHAIN_ID: z.coerce.number().int().positive(),
  START_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  DEPLOYMENTS_FILE: z.string().default("../contracts/deployments/arc-testnet.json"),
  AGON_DEPLOYMENTS_FILE: z.string().default("../contracts/deployments/agon-arc-testnet.json"),
  AGON_PUBLIC_API_URL: z.string().url().optional(),
  AGON_INDEXER_START_BLOCK: z.coerce.bigint().nonnegative().optional(),
  AGON_WRITES_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_MCP_MANAGED_PUBLISHING_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_READINESS_CACHE_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  AGON_JOB_ESCROW_READS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Circle x402 settlement is a separately gated rail. Keep it disabled until
  // the facilitator, recipient allowlist, and reconciliation path are approved.
  AGON_X402_EXECUTION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_X402_VERIFICATION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_X402_RECONCILIATION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_X402_EXECUTION_MAX_BASE_UNITS: z.string().regex(/^(0|[1-9]\d*)$/).default("0"),
  // Direct x402 execution must be pinned to an explicit recipient set. Leave
  // empty while execution is disabled; the runtime will remain fail-closed
  // until a controlled test recipient is configured.
  AGON_X402_ALLOWED_RECIPIENTS: z.string().default(""),
  // Agent-to-agent x402 remains a disabled testnet seam until durable policy
  // persistence and a separately approved Circle adapter are wired.
  AGON_X402_AGENT_POLICY_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_X402_AGENT_PER_CALL_MAX_BASE_UNITS: z.string().regex(/^(0|[1-9]\d*)$/).default("0"),
  AGON_X402_AGENT_DAILY_MAX_BASE_UNITS: z.string().regex(/^(0|[1-9]\d*)$/).default("0"),
  // ERC-8004 Arena verification writes remain disabled until the validator
  // identity, evidence policy, and external registry adapter are approved.
  AGON_ARENA_VALIDATION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_ARENA_VALIDATOR_ADDRESS: z.string().optional(),
  // Escrow and syndicate prize writes remain disabled until a durable Agon
  // intent store, release/refund reconciliation, and approved controller are
  // wired to the deployed PrizeEscrow contracts.
  AGON_ESCROW_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_ESCROW_EXECUTION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_ESCROW_RECONCILIATION_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_ESCROW_CONTROLLER_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "expected an escrow controller address").optional(),
  AGON_ESCROW_MAX_POOL_BASE_UNITS: z.string().regex(/^(0|[1-9]\d*)$/).default("0"),
  AGON_SYNDICATE_PRIZE_POOL_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // Only operator-reviewed provider challenge endpoints are callable from the
  // Playground. A static map avoids turning permissionless listing URLs into an
  // SSRF primitive. Keys pin chain:registry:listing@version to one endpoint.
  AGON_PLAYGROUND_PROVIDER_ENDPOINTS: z.string().default("{}"),
  // Endpoint QA uses a separate operator-reviewed map for x402 payment
  // challenge preflights. It never submits a payment or settles a request.
  AGON_ENDPOINT_QA_ENDPOINTS: z.string().default("{}"),
  // Certification scheduling is durable but the worker is opt-in. Scheduling
  // remains safe with this off; enabling it permits bounded calls to the same
  // allowlisted providers used by Playground and never enables Arena writes.
  AGON_CERTIFICATION_WORKER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_CERTIFICATION_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(300).max(604800).default(21600),
  AGON_CERTIFICATION_WARNING_RETRY_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  AGON_CERTIFICATION_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(10).default(3),
  AGON_CERTIFICATION_ENDPOINT_QA_REQUIRED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  AGON_CERTIFICATION_ALERT_OPERATOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  // Plan 3f ratings: the 6-hourly Agon check and the score snapshot job, both off until the owner turns them on.
  AGON_TESTS_WORKER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_SCORES_WORKER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // JSON like {"paid":0.5,"arena":0.3,"playground":0.2}; invalid or missing uses those defaults.
  AGON_SCORE_WEIGHTS: z.string().max(200).optional(),
  AGON_OPERATIONS_ALERTS_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  AGON_OPERATIONS_ALERT_WORKER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_OPERATIONS_ALERT_OPERATOR_ADDRESS: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  AGON_OPERATIONS_ALERT_RETRY_BASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),

  // Auth service
  JWT_SECRET: z.string().default("dev-insecure-secret-change-me"),
  ADMIN_TOKEN: z.string().optional(), // gates GET /admin/events; unset = read endpoint disabled
  SUPPORT_TOKEN: z.string().optional(), // read-only admin tier (Members/Events/Audit, no money actions)
  AGON_SUPPORT_AI_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  AGON_SUPPORT_AI_DAILY_USD: z.coerce.number().min(0).max(100).default(2),
  AGON_SUPPORT_AI_MODEL: z.string().optional(),
  AUTH_PORT: z.coerce.number().int().positive().default(8082),
  AUTH_DOMAIN: z.string().default("localhost:3003"),
  APP_URL: z.string().url().default("http://localhost:3003"),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_CALLBACK_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  // Telegram chat the in-app feedback widget relays bug/idea reports to.
  FEEDBACK_TELEGRAM_CHAT_ID: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_CALLBACK_URL: z.string().optional(),

  // Email OTP at first signup. When enabled, a never-seen email must
  // prove ownership via a 6-digit code before the passkey-enrollment
  // path runs. Returning passkey users skip this; the passkey itself
  // is the proof. OTP_PEPPER salts the at-rest code hash so a DB leak
  // doesn't expose live codes.
  EMAIL_OTP_ENABLED: z.coerce.boolean().default(false),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  OTP_PEPPER: z.string().optional(),

  // Circle Developer-Controlled Wallets. Used to back ArcRun email logins so
  // operators can ENTER, JOIN, and CLAIM without holding their own keys. The
  // entity secret is registered once via scripts/circle-bootstrap.ts; the
  // wallet set id is written back to the env after that run.
  CIRCLE_API_KEY: z.string().optional(),
  CIRCLE_ENTITY_SECRET: z.string().optional(),
  CIRCLE_WALLET_SET_ID: z.string().optional(),
  CIRCLE_BLOCKCHAIN: z.string().default("ARC-TESTNET"),
  // When true, every newly minted Circle wallet is auto-seeded with USDC
  // from Circle's testnet faucet. Off for mainnet.
  CIRCLE_AUTO_SEED_USDC: z.coerce.boolean().default(true),
  // Circle User-Controlled Wallets. Disabled until the Web3 Services Console
  // app is configured and the browser onboarding path has been reviewed.
  CIRCLE_USER_CONTROLLED_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CIRCLE_USER_CONTROLLED_APP_ID: z.string().optional(),
  CIRCLE_USER_CONTROLLED_API_BASE_URL: z.string().url().default("https://api.circle.com"),

  // WebAuthn (passkey) configuration. RP_ID is the registrable domain the
  // passkey is bound to (no port, no protocol). ORIGIN must include the
  // protocol and port. For local dev RP_ID="localhost" and
  // ORIGIN="http://localhost:3003". For the canonical AGON deployment, use
  // RP_ID="agon.surf" and ORIGIN="https://agon.surf". A passkey is scoped to
  // this relying-party domain, so changing it silently invalidates credentials
  // from the old domain; email-code login remains the recovery path.
  WEBAUTHN_RP_NAME: z.string().default("Agon"),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_ORIGIN: z.string().default("http://localhost:3003"),

  // Anthropic. Empty key disables real LLM runners; the coordinator falls
  // back to the synthetic tier-curve simulation so dev environments don't
  // require a paid API key. LLM_DAILY_KILL_USD is a hard daily ceiling on
  // LLM spend; when exceeded, runners stop calling Anthropic mid-round and
  // surface a clear error.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Conduit is a drop-in for the Anthropic Messages API (same endpoint, auth,
  // body, and response shape; keys are sk-cdt-…). When CONDUIT_API_KEY and
  // CONDUIT_BASE_URL are set it becomes the PRIMARY for every claude-* call and
  // ANTHROPIC_API_KEY is the fallback. CONDUIT_BASE_URL is the base only; the
  // SDK appends /v1/messages, so set it without that suffix.
  // CONDUIT_API_KEY_2 / _3 are extra free-tier keys: when the key before is rate
  // limited the next is tried, all on the same base URL, before Anthropic. This
  // spreads load across keys and saves Anthropic credit.
  CONDUIT_API_KEY: z.string().optional(),
  CONDUIT_API_KEY_2: z.string().optional(),
  CONDUIT_API_KEY_3: z.string().optional(),
  CONDUIT_BASE_URL: z.string().optional(),
  LLM_DAILY_KILL_USD: z.coerce.number().nonnegative().default(5),
  // Default LLM model used by every LLM-enabled tier. Tier 0/1 don't call
  // the LLM at all; tier 2 and up share this model. Defaults to Haiku 4.5
  // to keep testnet cost predictable.
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Optional override applied ONLY to tier 4 agents. When set, tier 4 calls
  // use this model while tiers 2 and 3 stay on LLM_MODEL. Typical values
  // are claude-sonnet-4-6 or claude-opus-4-7. Leave unset on testnet to
  // keep costs low.
  LLM_MODEL_TIER4: z.string().optional(),
  // OpenRouter routes the per-tier reasoning models for missions (llama / gpt /
  // claude) through one OpenAI-compatible endpoint. Required for tiers 0-3.
  OPENROUTER_API_KEY: z.string().optional(),
  // Per-tier reasoning models. Tiers 0-3 are OpenRouter slugs (have a "/");
  // tier 4 is the Anthropic Haiku id (uses ANTHROPIC_API_KEY). Override per env.
  TIER0_MODEL: z.string().default("meta-llama/llama-3.2-1b-instruct"),
  TIER1_MODEL: z.string().default("meta-llama/llama-3.2-3b-instruct"),
  TIER2_MODEL: z.string().default("meta-llama/llama-3.1-8b-instruct"),
  TIER3_MODEL: z.string().default("openai/gpt-4o-mini"),
  TIER4_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  // Fallback model used when a call has no tier context (the judge, the mission
  // generator). Cheap but capable; the tier-aware ladder below covers the runner.
  LLM_FALLBACK_MODEL: z.string().default("meta-llama/llama-3.3-70b-instruct"),
  // RANKED per-tier fallback ladder (index = tier 0..4), tried when a tier's
  // primary model fails across every provider. All cheap OpenRouter models, but
  // ASCENDING in capability so a higher-tier agent still falls back to a stronger
  // model than a lower-tier one — the tier advantage survives an outage. Runs
  // ~cents per Mtok, far below gpt-4o / sonnet. Needs OPENROUTER_API_KEY.
  //   0-1: llama 3.1 8B · 2-3: llama 3.3 70B · 4: deepseek v3 (strongest cheap)
  LLM_FALLBACK_MODELS: z
    .string()
    .default(
      "meta-llama/llama-3.1-8b-instruct,meta-llama/llama-3.1-8b-instruct,meta-llama/llama-3.3-70b-instruct,meta-llama/llama-3.3-70b-instruct,deepseek/deepseek-chat",
    ),
  // Live-data mission sources (v2 diversity). Each is optional; the generator
  // uses whichever are set and falls back to LLM/canned otherwise.
  EXA_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  GRAPH_API_KEY: z.string().optional(),
  // Comma-separated The Graph gateway subgraph ids to draw on-chain subjects
  // from. Default is the Uniswap v3 mainnet subgraph (deep, reliable data).
  GRAPH_SUBGRAPH_IDS: z.string().default("5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"),
  // Testing safety belt. When true:
  //  - web_search tool is stripped from every tier (avoids $0.01/search)
  //  - max_tokens is clamped to 200 regardless of POWER stat
  //  - retries are disabled
  // Use during test runs so the cost ceiling stays predictable.
  LLM_TESTING: z.coerce.boolean().default(false),

  // Agent training. Cost to go from level N to N+1 is (N+1) × 50 Cycles and
  // (N+1) × this many real seconds. Default 3600 = 60 minutes per level base
  // (so level 5 takes 6h). Long enough that the speedup ladder is worth
  // paying for. Set low (e.g. 30) in test environments so a training cycle
  // finishes quickly.
  TRAINING_BASE_SECONDS_PER_LEVEL: z.coerce.number().int().positive().default(3600),
  // Speedup ladder: each +50 cycles spent at start time shaves 15 min off
  // the queue duration. Lets operators trade Cycles for wall-clock when
  // they want to enter the next contest without waiting an hour.
  TRAINING_SPEEDUP_CYCLES_PER_STEP: z.coerce.number().int().positive().default(50),
  TRAINING_SPEEDUP_SECONDS_PER_STEP: z.coerce.number().int().positive().default(900),
  // Hard floor so a fully sped-up training still takes 60 seconds (visible
  // wait, audit row gets a sensible duration).
  TRAINING_MIN_SECONDS: z.coerce.number().int().positive().default(60),
  // Scales the whole per-level time ladder (level 1 present, 2 = 24h, 3 = 72h,
  // 4 = 5d, 5 = 7d). 1 = production. Set small (e.g. 0.002) to shrink waits in
  // test environments.
  TRAINING_TIME_SCALE: z.coerce.number().positive().default(1),

  // Coordinator service
  COORDINATOR_PRIVATE_KEY: z.string().optional(),
  // Treasury EOA key. PrizeEscrow sends listing fees and platform-fee skims
  // straight to the treasury address, so the admin treasury withdraw must sign
  // with THIS key, not the coordinator's. Optional: when unset, the withdraw
  // only works if the on-chain treasury equals the coordinator address.
  TREASURY_PRIVATE_KEY: z.string().optional(),
  WS_PORT: z.coerce.number().int().positive().default(8788),

  // Scout runner: master mnemonic for deriving per-agent hot wallets
  SCOUT_MASTER_MNEMONIC: z.string().optional(),
  // Scout real DEX swaps (Circle App Kit Swap on Arc). Needs CIRCLE_KIT_KEY
  // and the @circle-fin/adapter-viem-v2 package installed. When off or
  // unconfigured, Scout self-transfers USDC instead.
  SCOUT_REAL_SWAPS: z.coerce.boolean().default(false),
  CIRCLE_KIT_KEY: z.string().optional(),
  SCOUT_SWAP_TOKEN_IN: z.string().default("USDC"),
  SCOUT_SWAP_TOKEN_OUT: z.string().default("EURC"),
  // Generic daily swap budget shared by every tier.
  SCOUT_DAILY_SWAP_CAP: z.coerce.number().int().positive().default(5000),
  // How many swaps a single contest run performs (bounded by the daily cap).
  SCOUT_SWAPS_PER_RUN: z.coerce.number().int().positive().default(24),
  // Per-tier hot-wallet funding in whole USDC, comma-separated, index 0..4.
  // This is how much USDC the coordinator puts into each agent's hot wallet
  // before a Scout/Volume round, so it sets the size of swaps and transfers.
  // The float is swept back after settlement, so a higher number costs only
  // gas/swap fees, not the principal. Custom campaigns can raise an agent's
  // working balance further when their requirements are wired in.
  SCOUT_FUNDING_BY_TIER: z
    .string()
    .default("10,25,40,70,100")
    .transform((s) => s.split(",").map((n) => Number(n.trim()))),
  // Per-tier SIZE of each swap/transfer in whole USDC, index 0..4. Separate from
  // funding so the wallet can hold more than one swap's worth, which is what
  // lets the whale-type size traits actually buy bigger trades. Trait size
  // multipliers scale this up (clamped by the wallet's spendable balance and
  // SCOUT_SWAP_MAX_USDC), so a higher tier or a whale agent moves more per op.
  //
  // EVERY VALUE HERE MUST BE FILLABLE BY THE POOL, or that tier cannot swap at
  // all. This ladder used to be "2,5,10,15,25", but Arc Testnet's USDC/EURC pool
  // fills a round trip up to about 10 USDC and has NO ROUTE at 15 or above. So
  // tiers 3 and 4 failed every single swap and fell back to self-transfers: the
  // two best tiers were the two guaranteed never to trade. Re-measure with
  // `npx tsx -r dotenv/config scripts/swap-depth-probe.ts` before raising these.
  SCOUT_SWAP_SIZE_BY_TIER: z
    .string()
    .default("2,4,6,8,10")
    .transform((s) => s.split(",").map((n) => Number(n.trim()))),
  // Safety ceiling on the per-round transfer, so a misconfigured tier value
  // can't drain the coordinator wallet before the sweep returns the float.
  // Set above the largest tier amount so it never clips normal funding.
  SCOUT_FUND_MAX_USDC: z.coerce.number().nonnegative().default(200),

  // ERC-8004 validator wallet for on-chain reputation feedback. Must be a
  // separate address from the agent NFT owner (the AgentRegistry contract).
  VALIDATOR_PRIVATE_KEY: z.string().optional(),

  // Arcana Markets (external prediction-market integration). Live contract
  // on Arc Testnet; owner is a single EOA. The indexer subscribes to its
  // events; the Analyst runner reads open markets here.
  ARCANA_MARKETS_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x443a47eF1025e047879b1BA08c94e6dedB354D54")
    .transform((v) => v as `0x${string}`),
  ARCANA_START_BLOCK: z.coerce.bigint().nonnegative().default(43667548n),
  ARCANA_INDEXING: z.coerce.boolean().default(true),

  // Weekly syndicate reward pool, in whole USDC. At each ISO-week close the
  // coordinator splits this across every member by their contribution share
  // that week, and members claim their slice from the dashboard (paid from the
  // treasury/coordinator wallet, same dev-controlled path as withdrawals).
  // Default 0 disables the pool, so it ships dark until funded.
  SYNDICATE_POOL_WEEKLY_USDC: z.coerce.number().nonnegative().default(0),
  // Preferred sizing: the weekly pool is this percent of the platform fees
  // collected that week (e.g. 20 = 20%). When > 0 it wins over the fixed
  // amount above. The pool goes to the winning syndicate (war rank 1); its
  // members claim a share weighted by their contribution that week.
  SYNDICATE_POOL_FEE_PCT: z.coerce.number().min(0).max(100).default(0),

  // Analyst autofund. Coordinator drips USDC to an agent's hot wallet when
  // it enters an Analyst contest and is under-funded, so agents can actually
  // trade on Arcana. Per-agent: one drip per UTC day. Global: a daily cap so
  // a misconfigured loop can't drain the coordinator wallet.
  //
  // The Circle Arc Testnet faucet refreshes ~$20 USDC per 2 hours
  // (~$240/day capacity), so the $50/day default cap is well within budget.
  // PREDICTION events hold for Arcana when this is false (default): if no
  // open Arcana markets exist at settlement time, the runner returns empty
  // results and the coordinator cancels the contest/challenge and refunds.
  // Set ANALYST_ALLOW_SYNTHETIC=1 to keep the legacy synthetic Brier
  // fallback (dev / no-Arcana environments only).
  ANALYST_ALLOW_SYNTHETIC: z.coerce.boolean().default(false),
  ANALYST_AUTOFUND: z.coerce.boolean().default(true),
  // Per-tier drip amounts in whole USDC. Four comma-separated values for
  // tiers 1..4 (tier 0 is ineligible for Analyst Arcana contests). Defaults
  // match the tier-cap ladder: T1=5, T2=10, T3=15, T4=25.
  ANALYST_AUTOFUND_USDC_BY_TIER: z.string().default("5,10,15,25"),
  // Legacy single-value fallback. If ANALYST_AUTOFUND_USDC_BY_TIER is unset
  // and this is set, every tier gets the same amount. Kept for back-compat.
  ANALYST_AUTOFUND_USDC: z.coerce.number().nonnegative().optional(),
  ANALYST_AUTOFUND_DAILY_USD: z.coerce.number().nonnegative().default(50),
  ANALYST_AUTOFUND_MIN_BALANCE: z.coerce.number().nonnegative().default(1),

  // Nanopayments (Circle Gateway + x402). Lets the Solver runner pay for
  // research per puzzle. Shells to `circle services pay` so the CLI must be
  // installed on the runtime image (`npm i -g @circle-fin/cli`). Per-tier
  // budgets cap spend per puzzle. Tier 0 is the cheapest; tier 4 has the
  // biggest research budget. Caps are enforced in the runner because
  // Circle's `wallet limit set` policy is mainnet-only.
  NANOPAY_ENABLED: z.coerce.boolean().default(false),
  // Which x402 payment path to use:
  //   "sdk" - @circle-fin/x402-batching GatewayClient (container-native, real
  //           payments, signs from NANOPAY_WALLET_PRIVATE_KEY). Recommended.
  //   "exact" - standard x402 "exact" scheme via x402-fetch, signed from
  //           NANOPAY_WALLET_PRIVATE_KEY. Pays normal x402 sellers (Gloria,
  //           Exa) directly on their chain (Base). Container-native, real USDC.
  //   "cli" - shell out to `circle services pay` (needs the Circle CLI + local
  //           auth state). The legacy default.
  // "auto" routes PER SELLER: GatewayWalletBatched sellers (Predexon) settle via
  // the Gateway batching client, standard "exact" sellers (Exa, Gloria) via the
  // exact client, so one mission round can pay several services correctly.
  // Default "auto": route per seller by reading its 402 quote. It used to default
  // to "cli", which shells out to the Circle CLI binary — a binary we do NOT ship in
  // the container. So a deploy that never set this landed on a provider that cannot
  // work, isCliPresent() came back false, and (with NANOPAY_HTTP_FALLBACK on) every
  // x402 call silently degraded to an UNPAID plain-HTTPS fetch. No payment means no
  // credit, and the mission credit gate is multiplicative, so every operative scored
  // exactly 0 and the mission cancelled. Six missions died that way with real agents
  // in them. A default that cannot possibly work is not a default.
  NANOPAY_PROVIDER: z.enum(["cli", "sdk", "exact", "auto"]).default("auto"),
  // Network the exact-scheme sellers settle on (x402 network name), e.g.
  // base | base-sepolia | polygon. Gloria/Exa declare "base" (mainnet).
  NANOPAY_EXACT_NETWORK: z.string().default("base"),
  // Private key of the Gateway-funded agent wallet that pays for research via
  // the SDK. Only used when NANOPAY_PROVIDER=sdk.
  NANOPAY_WALLET_PRIVATE_KEY: z.string().optional(),
  // Gateway chain the agent wallet deposited into (where its Gateway balance
  // lives). One of @circle-fin/x402-batching's SupportedChainName, e.g.
  // baseSepolia / polygonAmoy / arcTestnet. Default matches the BASE deposit
  // flow in the setup docs.
  NANOPAY_GATEWAY_CHAIN: z.string().default("baseSepolia"),
  NANOPAY_CLI_PATH: z.string().default("circle"),
  // When the Circle CLI isn't installed (e.g. a slim container), fetch the
  // research endpoint directly over HTTPS so the agent still gets real data.
  // The x402 paid call stays primary; this is the fallback when it can't run.
  // Off by default so behavior is unchanged unless explicitly enabled.
  NANOPAY_HTTP_FALLBACK: z.coerce.boolean().default(false),
  // Optional per-host API keys for the direct-HTTP fallback, as a JSON object
  // keyed by hostname, e.g. {"api.exa.ai":"...","api.itsgloria.ai":"..."}.
  // Sent as `Authorization: Bearer <key>` and `x-api-key: <key>`.
  NANOPAY_API_KEYS: z.string().default("{}"),
  // Circle Agent wallet address that pays for x402 research. Created via
  // `circle wallet create --type agent`, funded via `circle gateway deposit`.
  // The wallet's keys live with the operator's CLI login session; the backend
  // shells to `circle services pay --address <this>` and the CLI signs.
  // Distinct identity system from Circle Dev-Controlled wallets (the SDK
  // path used for email-login operators). Required when NANOPAY_ENABLED=true.
  NANOPAY_WALLET_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "expected an address")
    .optional()
    .transform((v) => (v ? (v as `0x${string}`) : undefined)),
  // Per-puzzle research budget in USDC (decimal). Tier 0 cheapest, tier 4
  // most. Defaults reflect the "agents that can afford better data win"
  // mechanic.
  NANOPAY_TIER_0_BUDGET_USDC: z.coerce.number().nonnegative().default(0.01),
  NANOPAY_TIER_1_BUDGET_USDC: z.coerce.number().nonnegative().default(0.05),
  NANOPAY_TIER_2_BUDGET_USDC: z.coerce.number().nonnegative().default(0.25),
  NANOPAY_TIER_3_BUDGET_USDC: z.coerce.number().nonnegative().default(1.0),
  NANOPAY_TIER_4_BUDGET_USDC: z.coerce.number().nonnegative().default(5.0),
  // Chain to settle x402 payments on. Most paid endpoints accept Polygon
  // (MATIC) via Gateway; the tier-pool wallets deposit on Arc and Gateway
  // routes the spend. Override per-environment as the marketplace shifts.
  NANOPAY_SETTLEMENT_CHAIN: z.string().default("MATIC"),
  // Hard ceiling per call so a runaway prompt can't burn the pool.
  NANOPAY_MAX_PER_CALL_USDC: z.coerce.number().positive().default(2.0),
  // Research spend is a premium ability: only agents at this tier or above
  // pay for outside data.
  NANOPAY_MIN_RESEARCH_TIER: z.coerce.number().int().min(0).max(4).default(3),
  // Session-lifetime research budget per tier pool in USDC (decimal). The
  // in-memory pool starts at this number and drains as calls settle; the
  // CLI's Gateway balance check is the hard backstop behind it.
  NANOPAY_SESSION_BUDGET_USDC: z.coerce.number().nonnegative().default(2.0),
  // Default chain for solver web-search research (Exa sells on Base).
  NANOPAY_RESEARCH_CHAIN: z.string().default("BASE"),
  // Analyst research: paid crypto news headlines fetched before trade
  // picks. Gloria AI sells 20 sentiment-tagged headlines per keyword for
  // $0.05, settled as plain on-chain USDC on Base (the agent wallet's
  // Base USDC balance pays, NOT the Gateway pool; keep it topped up).
  NANOPAY_ANALYST_NEWS_ENDPOINT: z.string().optional(),
  NANOPAY_ANALYST_NEWS_LABEL: z.string().default("Gloria AI news"),
  NANOPAY_ANALYST_NEWS_CHAIN: z.string().default("BASE"),
  // Scout research: paid spot prices fetched before the volume strategy.
  // AIsa's CoinGecko proxy sells prices for $0.008 and settles on Polygon
  // (MATIC), the same Gateway domain the eco deposit funds, so it draws
  // from the existing pool.
  NANOPAY_SCOUT_PRICE_ENDPOINT: z.string().optional(),
  NANOPAY_SCOUT_PRICE_LABEL: z.string().default("AIsa market prices"),
  NANOPAY_SCOUT_PRICE_CHAIN: z.string().default("MATIC"),

  // Prediction-tick scheduler. When true (default), agents make
  // multiple tier-gated decisions across the trade window via the
  // coordinator's tick scheduler. The legacy single-pass analyst runner
  // gates its own trade-creation logic so we don't double-trade. Set to
  // 0 to disable the scheduler and revert to single-pass behavior.
  PREDICTION_TICKS: z.coerce.boolean().default(true),

  // Missions (the agent labor market — full spec in docs/missions.md). A mission
  // is a SOLVER-type contest tagged in the `missions` table: platform-run
  // specialist agents sell intel, operatives (tier 3/4) autonomously decide
  // make (pay an x402 service) vs buy (an on-chain A2A payment to a specialist),
  // synthesize a deliverable, and the top deliverables split the pool. Off by
  // default so the feature ships dark until a coordinator wallet is funded.
  MISSION_ENABLED: z.coerce.boolean().default(false),
  // Default platform mission knobs (used by the autopilot open path).
  // Missions are the headline, heavily-funded events: default 100 USDC, well
  // above ordinary contests (1-10). The coordinator wallet must hold at least
  // this much per mission to fund the pool.
  MISSION_POOL_USDC: z.coerce.number().nonnegative().default(100),
  MISSION_DURATION_SECONDS: z.coerce.number().int().positive().default(900),
  // Operatives need research access, so missions gate to tier 3 and up.
  MISSION_MIN_TIER: z.coerce.number().int().min(0).max(4).default(3),
  // How many fragments a mission's brief asks for (single-source pieces the
  // operative must make or buy before synthesizing).
  MISSION_FRAGMENT_COUNT: z.coerce.number().int().positive().default(3),
  // FLOOR on the USDC float funded into each operative hot wallet before the run
  // so it can BUY fragments from specialists. The actual float is sized per
  // mission to the sum of the intel prices it will be quoted (see
  // operativeFloatUsdcFor); this is just the minimum. Swept back after
  // settlement, so a higher number costs only gas, not principal.
  MISSION_OPERATIVE_FLOAT_USDC: z.coerce.number().nonnegative().default(2),
  // How many platform specialist (intel-seller) agents to seed per mission.
  MISSION_SPECIALIST_COUNT: z.coerce.number().int().positive().default(2),
  // Reserved agentId base for deriving specialist hot wallets, kept far above
  // any real agent id so specialist wallets never collide with operator agents.
  MISSION_SPECIALIST_AGENT_ID_BASE: z.coerce.number().int().positive().default(900000),
  // Base price (whole USDC, decimal) a specialist quotes for one fragment in the
  // A2A handshake. The specialist may scale this by fragment kind.
  MISSION_INTEL_PRICE_USDC: z.coerce.number().nonnegative().default(0.5),
  // PER-OPERATIVE ceiling on the mission float, so a runaway operator listing
  // price can't front an absurd sum to one operative. The total the coordinator
  // fronts scales with the field size (float is working capital, recovered by the
  // post-run sweep), so this does NOT starve a large field the way a field-wide
  // total cap did. Sized to cover a few fragments at real intel prices; raise it
  // if the run logs "operative float capped".
  MISSION_FUND_MAX_USDC: z.coerce.number().nonnegative().default(60),
  // Optional model override for the judge that grades deliverables. Falls back to
  // LLM_MODEL when unset. Pin it for determinism on the grading path.
  MISSION_JUDGE_MODEL: z.string().optional(),
  // Second-choice judge model, an OpenRouter slug, tried when the primary
  // (Anthropic/Conduit) judge fails — so an Anthropic outage doesn't drop the
  // judge to the offline scorer. Only used when OPENROUTER_API_KEY is set.
  MISSION_JUDGE_FALLBACK_MODEL: z.string().default("openai/gpt-4o-mini"),
  // The bar a mission must clear: if no operative's graded deliverable scores at
  // least this, NOBODY is paid — the pool is cancelled and refunded to the
  // sponsor with "no agent could fulfill it within the window". Keeps missions
  // hard and meaningful (a junk deliverable scores near zero). Set 0 to disable.
  MISSION_MIN_SCORE: z.coerce.number().nonnegative().default(150),

  // ----- v2 mission economy (docs/missions.md section 1c) ---------------------
  // Probability a mission is the EXTERNAL (x402) archetype rather than INTERNAL
  // (the scarce-intel market). 0 = always internal, 1 = always external.
  MISSION_EXTERNAL_FRACTION: z.coerce.number().min(0).max(1).default(0.4),
  // Platform intel base price band (whole USDC). The mission's weight (pool x
  // difficulty x subject) lerps between these for the platform shelf price `b`.
  // Deliberately a FRACTION of a dollar: platform intel is the cheap floor, so a
  // losing operative's outlay stays tiny relative to the pool.
  MISSION_BASE_PRICE_MIN_USDC: z.coerce.number().nonnegative().default(0.1),
  MISSION_BASE_PRICE_MAX_USDC: z.coerce.number().nonnegative().default(0.5),
  // Operator listing price cap (whole USDC): the most an operator specialist may
  // charge for one intel piece. Keeps a single seller from pricing the mission
  // out of reach and blowing up the total spend.
  MISSION_LISTING_PRICE_MAX_USDC: z.coerce.number().positive().default(5),
  // Operative join fee, basis points of the pool (350 = 3.5%). Platform-funded
  // missions only; project-funded missions set their own at listing.
  MISSION_OPERATIVE_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(350),
  // Participation refund: an operative that put at least this FRACTION of its
  // funded float to work on real settled spend (A2A intel buys + x402 makes) gets
  // its FULL join fee back at settlement. Idlers keep paying full freight. 0.4 =
  // 40%. Set to 0 to disable (nobody earns the fee back).
  MISSION_REFUND_MIN_SPEND_FRAC: z.coerce.number().min(0).max(1).default(0.4),
  // Scarce-intel market caps. SEATS = first-come specialist slots; MAX_BUY =
  // pieces one specialist may take; PIECES = total intel pieces minted per
  // mission; OPERATIVE_SEATS = the K cap, sized so a winner profits after fee.
  MISSION_SPECIALIST_SEATS: z.coerce.number().int().positive().default(3),
  MISSION_SPECIALIST_MAX_BUY: z.coerce.number().int().positive().default(2),
  MISSION_INTEL_PIECES: z.coerce.number().int().positive().default(5),
  MISSION_OPERATIVE_SEATS: z.coerce.number().int().positive().default(8),

  // SCOUT-domain missions (intel-then-act): the operative buys best-venue intel
  // via A2A, then executes real on-chain DeFi. MISSION_SCOUT_OPS is how many swap
  // round-trips the action fragment runs; MISSION_SCOUT_VOLUME_TARGET_USDC is the
  // volume that maps to full quality in the scout grade (bounded by the shallow
  // ~10 USDC pool, so keep it modest until a deeper DEX is wired).
  MISSION_SCOUT_OPS: z.coerce.number().int().positive().default(4),
  MISSION_SCOUT_VOLUME_TARGET_USDC: z.coerce.number().positive().default(20),

  // Autonomous agents. Each one is an agent that OWNS ITSELF: a Circle
  // Developer-Controlled Wallet holds its ERC-8004 identity NFT, so it is its own
  // operator on chain and can register its own entries. It decides for itself,
  // with its own tier model, whether to enter a contest or spend its earnings
  // upgrading its own brain. BUDGET is a hard lifetime ceiling on what one agent
  // may ever spend; it is checked before every call. Off by default.
  AGENT_AUTONOMY_ENABLED: z.coerce.boolean().default(false),
  AGENT_AUTONOMY_COUNT: z.coerce.number().int().nonnegative().default(5),
  AGENT_AUTONOMY_BUDGET_USDC: z.coerce.number().nonnegative().default(80),
  AGENT_AUTONOMY_TICK_SECONDS: z.coerce.number().int().positive().default(180),
});

const addr = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "expected an address")
  .transform((v) => v as `0x${string}`);

const deploymentsSchema = z.object({
  network: z.string(),
  chainId: z.number(),
  contracts: z.object({
    PrizeEscrow: addr,
    AgentRegistry: addr,
    ContestEngine: addr,
    ChallengeArena: addr,
    SyndicateFactory: addr,
    PointsLedger: addr,
  }),
  external: z.object({
    USDC: addr,
    IdentityRegistry: addr,
    ReputationRegistry: addr,
    ValidationRegistry: addr,
  }),
});

/// Shout about any key set MORE THAN ONCE in the env file.
///
/// dotenv keeps the LAST assignment and says nothing, so a duplicated key is a
/// silent config override. This has now broken a payment path TWICE:
///   - NANOPAY_GATEWAY_CHAIN was set to arcTestnet and then polygonAmoy, so the
///     Gateway client pointed at a chain with no balance.
///   - NANOPAY_PROVIDER was set to `auto` and then `exact`, so every x402 call took
///     the exact scheme, and with the HTTP fallback on it degraded to unpaid fetches.
///     Six missions cancelled because nothing could be paid for.
/// Both were invisible: the file LOOKS right if you read the first assignment.
///
/// process.env is already deduplicated by the time we see it, so read the raw file.
function warnOnDuplicateEnvKeys(): void {
  const path = process.env.DOTENV_CONFIG_PATH ?? ".env";
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return; // no local env file (container envs come from compose); nothing to check
  }
  const seen = new Map<string, number[]>();
  raw.split(/\r?\n/).forEach((line, i) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m) return; // comment, blank, or continuation
    const key = m[1]!;
    seen.set(key, [...(seen.get(key) ?? []), i + 1]);
  });
  for (const [key, lines] of seen) {
    if (lines.length > 1) {
      console.error(
        `[config] DUPLICATE ENV KEY: ${key} is set ${lines.length} times (lines ${lines.join(", ")}). ` +
          `dotenv keeps the LAST one, so the value in use is the one on line ${lines[lines.length - 1]}. ` +
          `Delete the others: a duplicated key silently overrides the value you meant.`,
      );
    }
  }
}

function loadEnv() {
  warnOnDuplicateEnvKeys();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid backend environment:\n${issues}`);
  }
  const secretProblems = productionSecretProblems({ ...parsed.data, NODE_ENV: process.env.NODE_ENV });
  if (secretProblems.length > 0) {
    throw new Error(`Refusing to start with unsafe production secrets:\n  ${secretProblems.join("\n  ")}`);
  }
  return parsed.data;
}

function loadDeployments(file: string) {
  const path = resolve(process.cwd(), file);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Could not read deployments file at ${path}. Set DEPLOYMENTS_FILE.`);
  }
  return deploymentsSchema.parse(JSON.parse(raw));
}

/// Sanitize a private key from the environment. Env files (especially with CRLF
/// line endings on Windows, or values pasted with quotes) often carry a trailing
/// \r or surrounding quotes that make viem reject the key. Trim those, add the 0x
/// prefix if missing, and validate the shape. An invalid key returns undefined so
/// the coordinator runs in log-only mode with a clear warning instead of crash-looping.
function normalizePrivateKey(raw?: string, name = "COORDINATOR_PRIVATE_KEY"): `0x${string}` | undefined {
  if (!raw) return undefined;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  if (!v) return undefined;
  if (!v.startsWith("0x")) v = `0x${v}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    console.warn(
      `${name} is set but is not a 32-byte hex key (got ${v.length} chars after cleanup). ` +
        "Ignoring it. Expected 0x followed by 64 hex characters.",
    );
    return undefined;
  }
  return v as `0x${string}`;
}

/// The address for a private key env var, or null when unset / malformed.
function addressOfKey(raw: string | undefined, name: string): `0x${string}` | null {
  const key = normalizePrivateKey(raw, name);
  return key ? privateKeyToAccount(key).address : null;
}

const env = loadEnv();
const deployments = loadDeployments(env.DEPLOYMENTS_FILE);
const agonDeployment = loadAgonDeployment(env.AGON_DEPLOYMENTS_FILE);

if (deployments.chainId !== env.CHAIN_ID) {
  throw new Error(
    `Chain mismatch: deployments file is chain ${deployments.chainId}, env CHAIN_ID is ${env.CHAIN_ID}.`,
  );
}

if (env.AGON_WRITES_ENABLED && !agonDeployment.deployment) {
  console.error(`[agon] writes requested but deployment receipt is unavailable: ${agonDeployment.error}`);
}

export const config = {
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  // rpcHttp/rpcWs are the PRIMARY (first) URL, used directly by wallet clients
  // that take a single endpoint. rpcHttpList/rpcWsList carry every configured URL
  // so the read clients can build a fallback transport (primary, then backups).
  rpcHttp: parseUrlList(env.ARC_RPC_HTTP)[0]!,
  rpcWs: parseUrlList(env.ARC_RPC_WS)[0]!,
  rpcHttpList: parseUrlList(env.ARC_RPC_HTTP),
  rpcWsList: parseUrlList(env.ARC_RPC_WS),
  chainId: env.CHAIN_ID,
  startBlock: env.START_BLOCK,
  contracts: deployments.contracts,
  external: deployments.external,
  agon: {
    publicApiUrl: env.AGON_PUBLIC_API_URL,
    writesEnabled: env.AGON_WRITES_ENABLED,
    managedPublisherEnabled: env.AGON_MCP_MANAGED_PUBLISHING_ENABLED,
    jobEscrowReadsEnabled: env.AGON_JOB_ESCROW_READS_ENABLED,
    deployment: agonDeployment.deployment,
    deploymentError: agonDeployment.error,
    deploymentPath: agonDeployment.path,
    indexerStartBlock: env.AGON_INDEXER_START_BLOCK ?? BigInt(agonDeployment.deployment?.deployBlock ?? 0),
    readinessCacheMs: env.AGON_READINESS_CACHE_MS,
    x402: {
      executionEnabled: env.AGON_X402_EXECUTION_ENABLED,
      verificationEnabled: env.AGON_X402_VERIFICATION_ENABLED,
      reconciliationEnabled: env.AGON_X402_RECONCILIATION_ENABLED,
      network: "eip155:5042002" as const,
      maxAmountBaseUnits: BigInt(env.AGON_X402_EXECUTION_MAX_BASE_UNITS),
      allowedRecipients: parseAddressList(env.AGON_X402_ALLOWED_RECIPIENTS),
      agentPolicy: {
        enabled: env.AGON_X402_AGENT_POLICY_ENABLED,
        network: "eip155:5042002" as const,
        perCallCapBaseUnits: BigInt(env.AGON_X402_AGENT_PER_CALL_MAX_BASE_UNITS),
        dailyCapBaseUnits: BigInt(env.AGON_X402_AGENT_DAILY_MAX_BASE_UNITS),
      },
      validation: {
        enabled: env.AGON_ARENA_VALIDATION_ENABLED,
        validatorAddress: env.AGON_ARENA_VALIDATOR_ADDRESS,
      },
    },
    escrow: {
      enabled: env.AGON_ESCROW_ENABLED,
      executionEnabled: env.AGON_ESCROW_EXECUTION_ENABLED,
      reconciliationEnabled: env.AGON_ESCROW_RECONCILIATION_ENABLED,
      controllerAddress: env.AGON_ESCROW_CONTROLLER_ADDRESS as `0x${string}` | undefined,
      network: "eip155:5042002" as const,
      asset: "0x3600000000000000000000000000000000000000" as const,
      maxPoolBaseUnits: BigInt(env.AGON_ESCROW_MAX_POOL_BASE_UNITS),
      syndicatePrizePoolEnabled: env.AGON_SYNDICATE_PRIZE_POOL_ENABLED,
    },
    playground: {
      providerEndpoints: parsePlaygroundProviderEndpoints(env.AGON_PLAYGROUND_PROVIDER_ENDPOINTS),
      endpointQaEndpoints: parsePlaygroundProviderEndpoints(env.AGON_ENDPOINT_QA_ENDPOINTS),
    },
    certification: {
      workerEnabled: env.AGON_CERTIFICATION_WORKER_ENABLED,
      checkIntervalMs: env.AGON_CERTIFICATION_CHECK_INTERVAL_SECONDS * 1000,
      warningRetryMs: env.AGON_CERTIFICATION_WARNING_RETRY_SECONDS * 1000,
      failureThreshold: env.AGON_CERTIFICATION_FAILURE_THRESHOLD,
      endpointQaRequired: env.AGON_CERTIFICATION_ENDPOINT_QA_REQUIRED,
      alertOperatorAddress: env.AGON_CERTIFICATION_ALERT_OPERATOR_ADDRESS?.toLowerCase(),
    },
    ratings: {
      testsWorkerEnabled: env.AGON_TESTS_WORKER_ENABLED,
      scoresWorkerEnabled: env.AGON_SCORES_WORKER_ENABLED,
      weights: env.AGON_SCORE_WEIGHTS,
    },
    operationsAlerts: {
      enabled: env.AGON_OPERATIONS_ALERTS_ENABLED,
      workerEnabled: env.AGON_OPERATIONS_ALERT_WORKER_ENABLED,
      operatorAddress: (env.AGON_OPERATIONS_ALERT_OPERATOR_ADDRESS ?? env.AGON_CERTIFICATION_ALERT_OPERATOR_ADDRESS)?.toLowerCase(),
      retryBaseMs: env.AGON_OPERATIONS_ALERT_RETRY_BASE_SECONDS * 1000,
    },
  },
  adminToken: env.ADMIN_TOKEN,
  supportToken: env.SUPPORT_TOKEN,
  support: {
    aiEnabled: env.AGON_SUPPORT_AI_ENABLED,
    aiDailyUsd: env.AGON_SUPPORT_AI_DAILY_USD,
    aiModel: env.AGON_SUPPORT_AI_MODEL?.trim() || env.LLM_MODEL,
  },
  syndicatePoolWeeklyUsdc: env.SYNDICATE_POOL_WEEKLY_USDC,
  syndicatePoolFeePct: env.SYNDICATE_POOL_FEE_PCT,
  auth: {
    jwtSecret: env.JWT_SECRET,
    port: env.AUTH_PORT,
    domain: env.AUTH_DOMAIN,
    appUrl: env.APP_URL,
    x: {
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      callbackUrl: env.X_CALLBACK_URL,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN,
      botUsername: env.TELEGRAM_BOT_USERNAME,
      feedbackChatId: env.FEEDBACK_TELEGRAM_CHAT_ID,
    },
    discord: {
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      callbackUrl: env.DISCORD_CALLBACK_URL,
    },
    emailOtp: {
      enabled: env.EMAIL_OTP_ENABLED,
      provider: env.EMAIL_PROVIDER,
      from: env.EMAIL_FROM,
      resendApiKey: env.RESEND_API_KEY,
      pepper: env.OTP_PEPPER,
    },
  },
  training: {
    baseSecondsPerLevel: env.TRAINING_BASE_SECONDS_PER_LEVEL,
    speedupCyclesPerStep: env.TRAINING_SPEEDUP_CYCLES_PER_STEP,
    speedupSecondsPerStep: env.TRAINING_SPEEDUP_SECONDS_PER_STEP,
    minSeconds: env.TRAINING_MIN_SECONDS,
    timeScale: env.TRAINING_TIME_SCALE,
  },
  coordinator: {
    privateKey: normalizePrivateKey(env.COORDINATOR_PRIVATE_KEY),
    address: addressOfKey(env.COORDINATOR_PRIVATE_KEY, "COORDINATOR_PRIVATE_KEY"),
    wsPort: env.WS_PORT,
  },
  treasury: {
    privateKey: normalizePrivateKey(env.TREASURY_PRIVATE_KEY, "TREASURY_PRIVATE_KEY"),
    // The on-chain treasury address, derived from the key. Operative join fees
    // are paid here, and refunded from here when a mission cancels. Null when no
    // treasury key is set, in which case the join fee is disabled.
    address: addressOfKey(env.TREASURY_PRIVATE_KEY, "TREASURY_PRIVATE_KEY"),
  },
  scout: {
    masterMnemonic: env.SCOUT_MASTER_MNEMONIC?.trim() || undefined,
    // Real DEX swaps via Circle App Kit Swap (USDC/EURC/cirBTC on Arc).
    // When off, or the kit key / adapter are missing, Scout falls back to
    // USDC self-transfers so the runner always produces volume.
    realSwaps: env.SCOUT_REAL_SWAPS,
    kitKey: env.CIRCLE_KIT_KEY,
    swapTokenIn: env.SCOUT_SWAP_TOKEN_IN,
    swapTokenOut: env.SCOUT_SWAP_TOKEN_OUT,
    dailySwapCap: env.SCOUT_DAILY_SWAP_CAP,
    swapsPerRun: env.SCOUT_SWAPS_PER_RUN,
    fundMaxUsdc: env.SCOUT_FUND_MAX_USDC,
    // Per-agent funding ceiling by tier (index 0..4), in whole USDC. Tier
    // caps how much an agent can put to work; the daily swap budget is the
    // same for every tier, so a smaller agent must swap more to match the
    // volume of a higher tier.
    fundingByTier: env.SCOUT_FUNDING_BY_TIER,
    swapSizeByTier: env.SCOUT_SWAP_SIZE_BY_TIER,
  },
  validator: {
    privateKey: normalizePrivateKey(env.VALIDATOR_PRIVATE_KEY, "VALIDATOR_PRIVATE_KEY"),
  },
  circle: {
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
    walletSetId: env.CIRCLE_WALLET_SET_ID,
    blockchain: env.CIRCLE_BLOCKCHAIN,
    autoSeedUsdc: env.CIRCLE_AUTO_SEED_USDC,
    userControlled: {
      enabled: env.CIRCLE_USER_CONTROLLED_ENABLED,
      appId: env.CIRCLE_USER_CONTROLLED_APP_ID,
      apiBaseUrl: env.CIRCLE_USER_CONTROLLED_API_BASE_URL,
      blockchain: env.CIRCLE_BLOCKCHAIN,
    },
  },
  webauthn: {
    rpName: env.WEBAUTHN_RP_NAME,
    rpId: env.WEBAUTHN_RP_ID,
    origin: env.WEBAUTHN_ORIGIN,
  },
  llm: {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    // Conduit keys in priority order: primary, then the extra free-tier keys.
    // Each is tried in turn when the one before is rate limited, before Anthropic.
    conduitApiKeys: [env.CONDUIT_API_KEY, env.CONDUIT_API_KEY_2, env.CONDUIT_API_KEY_3]
      .map((k) => k?.trim())
      .filter((k): k is string => Boolean(k)),
    conduitBaseUrl: env.CONDUIT_BASE_URL?.trim() || undefined,
    openrouterApiKey: env.OPENROUTER_API_KEY?.trim() || undefined,
    dailyKillUsd: env.LLM_DAILY_KILL_USD,
    model: env.LLM_MODEL,
    modelTier4: env.LLM_MODEL_TIER4,
    // Per-tier reasoning models (index = tier 0..4). Slugs with a "/" route
    // through OpenRouter; bare claude-* ids use the Anthropic key. Drives the
    // mission runner's make-vs-buy reasoning, so tier differentiates capability.
    tierModels: [env.TIER0_MODEL, env.TIER1_MODEL, env.TIER2_MODEL, env.TIER3_MODEL, env.TIER4_MODEL],
    fallbackModel: env.LLM_FALLBACK_MODEL?.trim() || undefined,
    // Per-tier ranked fallback ladder (index = tier). Padded/clamped at read time.
    fallbackModels: env.LLM_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean),
    testing: env.LLM_TESTING,
  },
  arcana: {
    address: env.ARCANA_MARKETS_ADDRESS,
    startBlock: env.ARCANA_START_BLOCK,
    indexing: env.ARCANA_INDEXING,
  },
  analyst: {
    allowSyntheticFallback: env.ANALYST_ALLOW_SYNTHETIC,
    predictionTicks: env.PREDICTION_TICKS,
  },
  nanopay: {
    enabled: env.NANOPAY_ENABLED,
    provider: env.NANOPAY_PROVIDER,
    walletPrivateKey: normalizePrivateKey(env.NANOPAY_WALLET_PRIVATE_KEY, "NANOPAY_WALLET_PRIVATE_KEY"),
    gatewayChain: env.NANOPAY_GATEWAY_CHAIN,
    exactNetwork: env.NANOPAY_EXACT_NETWORK,
    cliPath: env.NANOPAY_CLI_PATH,
    httpFallback: env.NANOPAY_HTTP_FALLBACK,
    apiKeysByHost: ((): Record<string, string> => {
      try {
        const parsed = JSON.parse(env.NANOPAY_API_KEYS);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
      } catch {
        return {};
      }
    })(),
    /// Per-tier per-puzzle research budget in USDC (decimal). Index 0 = tier 0.
    perPuzzleByTier: [
      env.NANOPAY_TIER_0_BUDGET_USDC,
      env.NANOPAY_TIER_1_BUDGET_USDC,
      env.NANOPAY_TIER_2_BUDGET_USDC,
      env.NANOPAY_TIER_3_BUDGET_USDC,
      env.NANOPAY_TIER_4_BUDGET_USDC,
    ] as const,
    settlementChain: env.NANOPAY_SETTLEMENT_CHAIN,
    maxPerCallUsdc: env.NANOPAY_MAX_PER_CALL_USDC,
    walletAddress: env.NANOPAY_WALLET_ADDRESS,
    minResearchTier: env.NANOPAY_MIN_RESEARCH_TIER,
    sessionBudgetUsdc: env.NANOPAY_SESSION_BUDGET_USDC,
    researchChain: env.NANOPAY_RESEARCH_CHAIN,
    analystNewsEndpoint: env.NANOPAY_ANALYST_NEWS_ENDPOINT,
    analystNewsLabel: env.NANOPAY_ANALYST_NEWS_LABEL,
    analystNewsChain: env.NANOPAY_ANALYST_NEWS_CHAIN,
    scoutPriceEndpoint: env.NANOPAY_SCOUT_PRICE_ENDPOINT,
    scoutPriceLabel: env.NANOPAY_SCOUT_PRICE_LABEL,
    scoutPriceChain: env.NANOPAY_SCOUT_PRICE_CHAIN,
  },
  autonomy: {
    enabled: env.AGENT_AUTONOMY_ENABLED,
    count: env.AGENT_AUTONOMY_COUNT,
    budgetUsdc: env.AGENT_AUTONOMY_BUDGET_USDC,
    tickSeconds: env.AGENT_AUTONOMY_TICK_SECONDS,
  },
  mission: {
    enabled: env.MISSION_ENABLED,
    poolUsdc: env.MISSION_POOL_USDC,
    durationSeconds: env.MISSION_DURATION_SECONDS,
    minTier: env.MISSION_MIN_TIER,
    fragmentCount: env.MISSION_FRAGMENT_COUNT,
    operativeFloatUsdc: env.MISSION_OPERATIVE_FLOAT_USDC,
    specialistCount: env.MISSION_SPECIALIST_COUNT,
    specialistAgentIdBase: env.MISSION_SPECIALIST_AGENT_ID_BASE,
    intelPriceUsdc: env.MISSION_INTEL_PRICE_USDC,
    fundMaxUsdc: env.MISSION_FUND_MAX_USDC,
    judgeModel: env.MISSION_JUDGE_MODEL,
    judgeFallbackModel: env.MISSION_JUDGE_FALLBACK_MODEL,
    minScore: env.MISSION_MIN_SCORE,
    // v2 economy
    externalFraction: env.MISSION_EXTERNAL_FRACTION,
    basePriceMinUsdc: env.MISSION_BASE_PRICE_MIN_USDC,
    basePriceMaxUsdc: env.MISSION_BASE_PRICE_MAX_USDC,
    listingPriceMaxUsdc: env.MISSION_LISTING_PRICE_MAX_USDC,
    operativeFeeBps: env.MISSION_OPERATIVE_FEE_BPS,
    refundMinSpendFrac: env.MISSION_REFUND_MIN_SPEND_FRAC,
    specialistSeats: env.MISSION_SPECIALIST_SEATS,
    specialistMaxBuy: env.MISSION_SPECIALIST_MAX_BUY,
    intelPieces: env.MISSION_INTEL_PIECES,
    operativeSeats: env.MISSION_OPERATIVE_SEATS,
    scoutOps: env.MISSION_SCOUT_OPS,
    scoutVolumeTargetUsdc: env.MISSION_SCOUT_VOLUME_TARGET_USDC,
  },
  liveData: {
    exaApiKey: env.EXA_API_KEY?.trim() || undefined,
    firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() || undefined,
    graphApiKey: env.GRAPH_API_KEY?.trim() || undefined,
    graphSubgraphIds: env.GRAPH_SUBGRAPH_IDS.split(",").map((s) => s.trim()).filter(Boolean),
  },
  analystAutofund: {
    enabled: env.ANALYST_AUTOFUND,
    /// Per-tier USDC drip amounts. Index 0 = tier 1, index 3 = tier 4.
    /// Parsed from ANALYST_AUTOFUND_USDC_BY_TIER (4 comma-separated whole
    /// USDC values). Falls back to the legacy flat value if the per-tier
    /// var was left at its default and the legacy var is set.
    dripUsdcByTier: parseDripsByTier(
      env.ANALYST_AUTOFUND_USDC_BY_TIER,
      env.ANALYST_AUTOFUND_USDC,
    ),
    dailyCapUsd: env.ANALYST_AUTOFUND_DAILY_USD,
    minBalanceUsdc: env.ANALYST_AUTOFUND_MIN_BALANCE,
  },
} as const;

function parseDripsByTier(byTier: string, legacy?: number): [number, number, number, number] {
  // If the legacy flat var is explicitly set and the per-tier var is at the
  // default, treat the legacy value as canonical for all tiers.
  if (legacy !== undefined && byTier === "5,10,15,25") {
    return [legacy, legacy, legacy, legacy];
  }
  const parts = byTier
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  // Pad / truncate to exactly four entries so callers can index by tier-1.
  const t1 = parts[0] ?? 5;
  const t2 = parts[1] ?? 10;
  const t3 = parts[2] ?? 15;
  const t4 = parts[3] ?? 25;
  return [t1, t2, t3, t4];
}

export type AppConfig = typeof config;
