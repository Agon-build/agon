import { createPublicClient, fallback, http, parseAbi, type Address, type Hex } from "viem";
import type { Hono } from "hono";

import { pool } from "../../db/pool.js";
import { callModel } from "../../runners/llm/client.js";
import { createAgonWallet, createPlatformUsdcTransfer, executeContractCall, getTxState, seedTestnetUsdc, signTypedDataJson } from "../../chain/circleDev.ts";
import { runLeadForecast } from "../lead-agent/lead-agent.ts";
import { DEFAULT_HOUSE_AGENTS } from "../playground/seasons/house-agents.ts";
import { parseFirstPartyAgents, providerRefFor } from "../first-party.ts";
import { createHouseSellerRoutes } from "../playground/seasons/house-seller.ts";
import { createMarketLookup } from "../agents/market-lookup.ts";
import { createSpecialistRoutes } from "../agents/routes.ts";
import { PostgresWatchStore } from "../agents/watch-store.ts";
import { createGammaWatchReader, startWatchWorker } from "../agents/watch-worker.ts";
import { parseOwnerRef } from "../stage/settings.ts";
import { notify } from "../../notifications/index.js";
import { sendEmail } from "../../email/client.js";
import { deliveryEmail } from "../deliveries/email.ts";
import { PostgresDeliveryStore } from "../deliveries/store.ts";
import { startDeliveryWorker } from "../deliveries/worker.ts";
import { createTelegramApi } from "../channels/telegram/api.ts";
import { stableUuid } from "../playground/seasons/committer.ts";
import { computeLeaderboard } from "../playground/seasons/scoring.ts";
import type { SeasonRuntime } from "../playground/seasons/runtime.ts";
import { dataServicesFor } from "../router/data-services.ts";
import { rankForecasters } from "../router/forecasters.ts";
import * as wallets from "./budget-wallets.ts";
import { waitForCircleTx } from "./circle-poll.ts";
import { createCircleExactSettler } from "./exact-seller.ts";
import { createGuardedSigner } from "./guarded-signer.ts";
import { refundUndeliveredLeadHires } from "./auto-refund.ts";
import { completeApprovedHire, confirmHire, quoteHire, reconcileStuckHires, type HireDeps, type HireOutcome, type HireRequest } from "./hire.ts";
import { createPaymentRoutes } from "./routes.ts";
import { resolveOutsideSettings, resolvePaymentSettings, type PaymentSettings, type WalletHandle } from "./settings.ts";
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
  routes: { payments: Hono; house: Hono; specialists: Hono; standin: Hono | null };
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
  /** The web app, for links people open: a watch's page lives at <siteUrl>/watch/<id>. */
  siteUrl?: string;
  /** The AGON bot, for deliveries to linked Telegram chats. */
  telegramBotToken?: string | null;
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
      feeTxState: getTxState,
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
    const leadRefund = async (to: Address, amount: bigint, key: string): Promise<Hex> => {
      const t = await createPlatformUsdcTransfer({ walletId: s.lead.walletId, destinationAddress: to, amountBaseUnits: amount, idempotencyKey: stableUuid(key), refId: key, blockchain: network.circleChain });
      return waitForCircleTx({ id: t.id, label: key, getTxState });
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
          refund: leadRefund,
        },
        run,
      );

    const lookupMarket = createMarketLookup();
    const watchStore = new PostgresWatchStore(pool);
    /// The Agon account behind an agent wallet, for bell and Telegram alerts; outside payers have none.
    const ownerOfWallet = async (address: Address): Promise<string | null> => {
      const { rows } = await pool.query<{ owner_ref: string }>("select owner_ref from agon_budget_wallets where lower(address) = $1 and network = $2", [address.toLowerCase(), network.id]);
      const owner = rows[0] ? parseOwnerRef(rows[0].owner_ref) : null;
      return owner?.kind === "operator" ? owner.address.toLowerCase() : null;
    };
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
        lookupMarket,
      }) as unknown as Hono,
      specialists: createSpecialistRoutes({
        network, store,
        sellers: Object.fromEntries(Object.entries(s.specialistSellers).map(([key, w]) => [key, { payTo: w.address, settle: settler(w) }])),
        lookup: lookupMarket,
        callModel: async (p) => ({ text: (await callModel(p)).text }),
        watch: { store: watchStore, ownerOf: ownerOfWallet, statusBase: input.siteUrl ? `${input.siteUrl}/watch` : `${s.publicApiUrl}/agon/agents/specialists/watch` },
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
        hire.reconcile()
          .then((t) => (t.settled || t.released ? log(`reconciled ${JSON.stringify(t)}`) : undefined))
          .then(() => refundUndeliveredLeadHires({ store, leadAddress: s.lead.address, network: network.id, now: () => new Date(), refund: leadRefund, log }))
          .then((r) => (r.refunded || r.skipped ? log(`automatic refunds ${JSON.stringify(r)}`) : undefined))
          .catch((e) => log(`reconcile failed: ${(e as Error).message}`));
      }, 5 * 60_000).unref();
    }
    log(`payments on ${network.label}; lead agent ${s.lead.address}; ${Object.keys(s.houseSellers).length} house sellers`);
    if (s.specialistSellers.watch) {
      startWatchWorker({
        store: watchStore, readMarkets: createGammaWatchReader(), now: () => new Date(), log: (m) => console.log(`[watch] ${m}`),
        notify: (owner, a) => notify(owner, { kind: "agon_resolution_watch", title: a.title.slice(0, 180), body: a.body, href: input.siteUrl ? `${input.siteUrl}/watch/${a.watchId}` : a.href, context: { watchId: a.watchId, alert: a.kind, market: a.href } }),
      });
      log("resolution watch worker on");
    }
    // Every finished hire reaches the person who paid: the bell always, and email once a delivery sender is set.
    if (input.siteUrl && input.startLoops !== false) {
      const deliveryFrom = (input.env ?? process.env).AGON_DELIVERY_EMAIL_FROM?.trim() || null;
      const agonBot = input.telegramBotToken ? createTelegramApi({ token: input.telegramBotToken, log: (m) => console.warn(`[deliveries] ${m}`) }) : null;
      startDeliveryWorker({
        store: new PostgresDeliveryStore(pool), siteUrl: input.siteUrl, now: () => new Date(), log: (m) => console.log(`[deliveries] ${m}`),
        bell: (operator, m) => notify(operator, { kind: "agon_delivery", title: m.title.slice(0, 180), body: m.body, href: m.href }),
        email: deliveryFrom ? (to, m) => sendEmail({ to, ...deliveryEmail(m), from: deliveryFrom }) : undefined,
        telegram: agonBot ? async (chatId, m) => {
          const sent = await agonBot.send(Number(chatId), { text: `${m.title}

${m.body}`, buttons: [[{ label: "Open on Agon", url: m.href }]] });
          if (sent === null) throw new Error("telegram did not take the message");
        } : undefined,
      });
      log(`deliveries on: bell${deliveryFrom ? ", email" : ""}${agonBot ? ", telegram" : ""}`);
    }
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

/// The slim Arc mainnet runtime for outside services (Circle routes): budget
/// wallets and the hire engine only, no lead agent or house sellers. Off unless
/// AGON_OUTSIDE_ENABLED is true. When Agon itself moves to mainnet this goes away.
export function startOutsideRuntime(input: { env?: Record<string, string | undefined>; startLoops?: boolean } = {}): { hire: HireService; balanceOf(address: Address): Promise<bigint | null>; feeAddress: Address | null } | null {
  try {
    const resolved = resolveOutsideSettings(input.env ?? process.env);
    if (!resolved.enabled) return null;
    if (!resolved.ok) {
      console.error(`[outside] disabled: ${resolved.problems.join("; ")}`);
      return null;
    }
    const { network, feeAddress } = resolved.settings;
    const client = createPublicClient({ transport: fallback(network.rpcHttp.map((url) => http(url))) });
    const store = new PostgresPaymentsStore(pool);
    const walletDeps = {
      store, network, now: () => new Date(), defaults: OUTSIDE_WALLET_DEFAULTS,
      ops: {
        createWallet: createAgonWallet,
        seedTestnet: async () => ({}),
        transfer: (i: { walletId: string; destinationAddress: Address; amountBaseUnits: bigint; idempotencyKey: string; refId: string }) => createPlatformUsdcTransfer({ ...i, blockchain: network.circleChain }),
      },
    };
    const hireDeps: HireDeps = {
      ...walletDeps,
      // Mainnet wallets live under the live Circle keys.
      signJson: (walletId: string, json: string) => signTypedDataJson(walletId, json, network.circleChain),
      off: { all: false, budget: false },
      feeTxState: (id: string) => getTxState(id, network.circleChain),
      authorizationUsed: async (authorizer, nonce) =>
        (await client.readContract({ address: network.usdc, abi: AUTHORIZATION_STATE_ABI, functionName: "authorizationState", args: [authorizer, nonce] })) as boolean,
    };
    const hire: HireService = {
      leadProviderUrl: "",
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
      setInterval(() => { hire.reconcile().catch((e) => console.warn(`[outside] reconcile failed: ${(e as Error).message}`)); }, 5 * 60_000).unref();
    }
    const balanceOf = async (address: Address): Promise<bigint | null> => {
      try {
        return (await client.readContract({ address: network.usdc, abi: USDC_BALANCE_ABI, functionName: "balanceOf", args: [address] })) as bigint;
      } catch {
        return null;
      }
    };
    console.log(`[outside] Circle routes on ${network.label}`);
    return { hire, balanceOf, feeAddress };
  } catch (error) {
    console.error(`[outside] disabled: ${(error as Error).message}`);
    return null;
  }
}

/// Lower starting limits for the real-USDC wallet; people may raise them up to BUDGET_DEFAULTS.
export const OUTSIDE_WALLET_DEFAULTS = { perHireCap: 250_000n, dailyCap: 1_000_000n } as const;
