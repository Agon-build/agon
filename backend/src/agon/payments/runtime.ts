import { createPublicClient, fallback, http, parseAbi, type Address, type Hex } from "viem";
import type { Hono } from "hono";

import { pool } from "../../db/pool.js";
import { callModel } from "../../runners/llm/client.js";
import { createAgonWallet, createPlatformUsdcTransfer, executeContractCall, getTxState, seedTestnetUsdc, signTypedDataJson } from "../../chain/circleDev.ts";
import { runLeadForecast } from "../lead-agent/lead-agent.ts";
import { DEFAULT_HOUSE_AGENTS } from "../playground/seasons/house-agents.ts";
import { parseFirstPartyAgents, providerRefFor } from "../first-party.ts";
import { createHouseSellerRoutes } from "../playground/seasons/house-seller.ts";
import { stableUuid } from "../playground/seasons/committer.ts";
import { computeLeaderboard } from "../playground/seasons/scoring.ts";
import type { SeasonRuntime } from "../playground/seasons/runtime.ts";
import { dataServicesFor } from "../router/data-services.ts";
import { rankForecasters } from "../router/forecasters.ts";
import * as wallets from "./budget-wallets.ts";
import { waitForCircleTx } from "./circle-poll.ts";
import { createCircleExactSettler } from "./exact-seller.ts";
import { createGuardedSigner } from "./guarded-signer.ts";
import { completeApprovedHire, confirmHire, quoteHire, reconcileStuckHires, type HireDeps, type HireOutcome, type HireRequest } from "./hire.ts";
import { createPaymentRoutes } from "./routes.ts";
import { resolvePaymentSettings, type PaymentSettings, type WalletHandle } from "./settings.ts";
import { createStandinRoutes } from "./standin-seller.ts";
import { PostgresPaymentsStore } from "./store.ts";
import type { BudgetWallet } from "./types.ts";

/// Agon's own agents and the job provider ref their cards count.
function firstPartyActivity(env: Record<string, string | undefined>): { agentId: string; providerRef: string }[] {
  const parsed = parseFirstPartyAgents(env.AGON_FIRST_PARTY_AGENTS);
  const houseKeys = DEFAULT_HOUSE_AGENTS.map((a) => a.key);
  return parsed.ok ? parsed.agents.map((a) => ({ agentId: a.agentId, providerRef: providerRefFor(a.key, houseKeys) })) : [];
}

const AUTHORIZATION_STATE_ABI = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const USDC_BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export type HireService = {
  leadProviderUrl: string;
  network: PaymentSettings["network"];
  quoteHire(req: HireRequest): ReturnType<typeof quoteHire>;
  confirmHire(input: { ownerRef: string; code: string }): Promise<HireOutcome>;
  completeApprovedHire(input: { token: string }): Promise<HireOutcome>;
  reconcile(): ReturnType<typeof reconcileStuckHires>;
  wallets: {
    ensure(ownerRef: string): Promise<BudgetWallet>;
    lowerLimits(ownerRef: string, limits: { perHireCap?: bigint; dailyCap?: bigint }): ReturnType<typeof wallets.lowerLimits>;
    freeze(ownerRef: string): Promise<boolean>;
    requestUnfreeze(ownerRef: string): ReturnType<typeof wallets.requestUnfreeze>;
    completeUnfreeze(token: string): ReturnType<typeof wallets.completeUnfreeze>;
    requestWithdraw(ownerRef: string, to: Address, amount: bigint): ReturnType<typeof wallets.requestWithdraw>;
    completeWithdraw(token: string): ReturnType<typeof wallets.completeWithdraw>;
  };
};

export type PaymentsRuntime = {
  settings: PaymentSettings;
  store: PostgresPaymentsStore;
  hire: HireService;
  routes: { payments: Hono; house: Hono; standin: Hono | null };
  balanceOf(address: Address): Promise<bigint | null>;
};

/// Production wiring for the money path. Never throws: a disabled or broken
/// config logs why and returns null so the auth service always starts.
export function startPaymentsRuntime(input: {
  season: SeasonRuntime | null;
  env?: Record<string, string | undefined>;
  startLoops?: boolean;
  blockedProviders?: () => ReadonlySet<string>;
  wrapSignJson?: (fn: (walletId: string, json: string) => Promise<Hex>) => (walletId: string, json: string) => Promise<Hex>;
}): PaymentsRuntime | null {
  try {
    const resolved = resolvePaymentSettings(input.env ?? process.env);
    if (!resolved.enabled) return null;
    if (!resolved.ok) {
      console.error(`[payments] disabled: ${resolved.problems.join("; ")}`);
      return null;
    }
    const s = resolved.settings;
    const network = s.network;
    const log = (m: string) => console.log(`[payments] ${m}`);
    const client = createPublicClient({ transport: fallback(network.rpcHttp.map((url) => http(url))) });
    const store = new PostgresPaymentsStore(pool);
    const signJson = (input.wrapSignJson ?? ((fn) => fn))(signTypedDataJson);
    const settler = (w: WalletHandle) => createCircleExactSettler({ walletId: w.walletId, network, execute: (i) => executeContractCall(i), getTxState });
    const claimNonce = store.claimSellerNonce.bind(store);
    const walletDeps = {
      store, network, now: () => new Date(),
      ops: {
        createWallet: createAgonWallet,
        seedTestnet: seedTestnetUsdc,
        transfer: (i: { walletId: string; destinationAddress: Address; amountBaseUnits: bigint; idempotencyKey: string; refId: string }) => createPlatformUsdcTransfer({ ...i, blockchain: network.circleChain }),
      },
    };
    const hireDeps: HireDeps = {
      ...walletDeps,
      signJson,
      off: { all: s.off.all, budget: s.off.budget },
      authorizationUsed: async (authorizer, nonce) =>
        (await client.readContract({ address: network.usdc, abi: AUTHORIZATION_STATE_ABI, functionName: "authorizationState", args: [authorizer, nonce] })) as boolean,
    };

    const forecasters = async () => {
      if (!input.season) return [];
      const seasonId = input.season.season.seasonId;
      const [raw, entries] = await Promise.all([input.season.store.scoringRaw(seasonId), input.season.store.listEntries(seasonId)]);
      const blocked = input.blockedProviders?.() ?? new Set<string>();
      return rankForecasters({ rows: computeLeaderboard(raw), entries, publicApiUrl: s.publicApiUrl, hireableHouseKeys: Object.keys(s.houseSellers) })
        .filter((c) => !blocked.has(c.providerRef.toLowerCase()));
    };
    const leadRun = (run: { parentJobId: string | null; payer: Address; question: string; payment?: { txHash: Hex; amount: bigint } }) =>
      runLeadForecast(
        {
          store, network, leadAddress: s.lead.address, leadPrice: s.leadPrice, subHireBudget: s.subHireBudget, now: () => new Date(), log,
          data: dataServicesFor(network, s.publicApiUrl),
          forecasters,
          signerFor: (payTo, maxValue, onSigned) =>
            createGuardedSigner({ address: s.lead.address, walletId: s.lead.walletId, signJson, context: () => ({ network, from: s.lead.address, payTo, maxValue, now: new Date() }), onSigned }),
          authorizationUsed: hireDeps.authorizationUsed,
          refund: async (to, amount, key) => {
            const t = await createPlatformUsdcTransfer({ walletId: s.lead.walletId, destinationAddress: to, amountBaseUnits: amount, idempotencyKey: stableUuid(key), refId: key, blockchain: network.circleChain });
            return waitForCircleTx({ id: t.id, label: key, getTxState });
          },
        },
        run,
      );

    const routes = {
      payments: createPaymentRoutes({
        store, network, log, off: () => s.off.all || s.off.lead,
        activity: firstPartyActivity(input.env ?? process.env),
        lead: { address: s.lead.address, price: s.leadPrice, settle: settler(s.lead), run: leadRun },
      }) as unknown as Hono,
      house: createHouseSellerRoutes({
        network, store, ask: s.houseAsk, floor: s.houseFloor,
        sellers: Object.fromEntries(
          Object.entries(s.houseSellers).map(([key, w]) => [key, { spec: DEFAULT_HOUSE_AGENTS.find((a) => a.key === key)!, payTo: w.address, settle: settler(w) }]),
        ),
        callModel: async (p) => ({ text: (await callModel(p)).text }),
      }) as unknown as Hono,
      standin: s.standin ? (createStandinRoutes({ network, payTo: s.standin.address, settle: settler(s.standin), claimNonce }) as unknown as Hono) : null,
    };

    const hire: HireService = {
      leadProviderUrl: `${s.publicApiUrl}/agon/agents/lead/forecast`,
      network,
      quoteHire: (req) => quoteHire(hireDeps, req),
      confirmHire: (i) => confirmHire(hireDeps, i),
      completeApprovedHire: (i) => completeApprovedHire(hireDeps, i),
      reconcile: () => reconcileStuckHires(hireDeps),
      wallets: {
        ensure: (ownerRef) => wallets.ensureBudgetWallet(walletDeps, ownerRef),
        lowerLimits: (ownerRef, limits) => wallets.lowerLimits(walletDeps, ownerRef, limits),
        freeze: (ownerRef) => wallets.freeze(walletDeps, ownerRef),
        requestUnfreeze: (ownerRef) => wallets.requestUnfreeze(walletDeps, ownerRef),
        completeUnfreeze: (token) => wallets.completeUnfreeze(walletDeps, token),
        requestWithdraw: (ownerRef, to, amount) => wallets.requestWithdraw(walletDeps, ownerRef, to, amount),
        completeWithdraw: (token) => wallets.completeWithdraw(walletDeps, token),
      },
    };

    if (input.startLoops !== false) {
      setInterval(() => {
        hire.reconcile().then((t) => (t.settled || t.released ? log(`reconciled ${JSON.stringify(t)}`) : undefined)).catch((e) => log(`reconcile failed: ${(e as Error).message}`));
      }, 5 * 60_000).unref();
    }
    log(`payments on ${network.label}; lead agent ${s.lead.address}; ${Object.keys(s.houseSellers).length} house sellers`);
    const balanceOf = async (address: Address): Promise<bigint | null> => {
      try {
        return (await client.readContract({ address: network.usdc, abi: USDC_BALANCE_ABI, functionName: "balanceOf", args: [address] })) as bigint;
      } catch {
        return null;
      }
    };
    return { settings: s, store, hire, routes, balanceOf };
  } catch (error) {
    console.error(`[payments] disabled: ${(error as Error).message}`);
    return null;
  }
}
