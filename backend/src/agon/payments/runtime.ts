import { createPublicClient, fallback, http, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import type { Hono } from "hono";

import { pool } from "../../db/pool.js";
import { callModel } from "../../runners/llm/client.js";
import { createAgonWallet, createPlatformUsdcTransfer, executeContractCall, getTxState, seedTestnetUsdc, signTypedDataJson } from "../../chain/circleDev.ts";
import { runLeadForecast } from "../lead-agent/lead-agent.ts";
import { DEFAULT_HOUSE_AGENTS } from "../playground/seasons/house-agents.ts";
import { parseFirstPartyAgents, providerRefFor } from "../first-party.ts";
import { createHouseSellerRoutes } from "../playground/seasons/house-seller.ts";
import { createMarketLookup } from "../agents/market-lookup.ts";
import { createPolymarket } from "../polymarket/index.ts";
import { createSpecialistRoutes } from "../agents/routes.ts";
import { createReadQuestion } from "../agents/research/lookup.ts";
import { RESEARCH_MODEL, createResearchRoutes, researchWalletsFrom } from "../agents/research/routes.ts";
import { createEvidenceSearch } from "../playground/seasons/evidence.ts";
import { PostgresWatchStore } from "../agents/watch-store.ts";
import { createGammaWatchReader, startWatchWorker } from "../agents/watch-worker.ts";
import { parseOwnerRef } from "../stage/settings.ts";
import { notify } from "../../notifications/index.js";
import { sendEmail } from "../../email/client.js";
import { deliveryEmail } from "../deliveries/email.ts";
import { bellDelivery } from "../deliveries/rate-links.ts";
import { rateButtons, ratableJobOf } from "../channels/telegram/rate-tap.ts";
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
import { refundUndeliveredAgonHires } from "./auto-refund.ts";
import { completeApprovedHire, confirmHire, quoteHire, reconcileStuckHires, settleFeeTab, type HireDeps, type HireOutcome, type HireRequest } from "./hire.ts";
import { createPaymentRoutes } from "./routes.ts";
import { resolveOutsideSettings, resolvePaymentSettings, type PaymentSettings, type WalletHandle } from "./settings.ts";
import { createStandinRoutes } from "./standin-seller.ts";
import { PostgresPaymentsStore } from "./store.ts";
import { createProviderFetch } from "./provider-fetch.ts";
import type { BudgetWallet } from "./types.ts";

/// Agon's own agents and the job provider ref their cards count.
export function firstPartyActivity(env: Record<string, string | undefined>): { agentId: string; providerRef: string }[] {
  const parsed = parseFirstPartyAgents(env.AGON_FIRST_PARTY_AGENTS);
  const houseKeys = DEFAULT_HOUSE_AGENTS.map((a) => a.key);
  return parsed.ok ? parsed.agents.map((a) => ({ agentId: a.agentId, providerRef: providerRefFor(a.key, houseKeys) })) : [];
}

const AUTHORIZATION_STATE_ABI = parseAbi(["function authorizationState(address authorizer, bytes32 nonce) view returns (bool)"]);
const providerFetch = createProviderFetch();
const USDC_BALANCE_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

/// The USDC balance on the ERC-20 interface (6 decimals), or null when the RPC cannot answer.
async function usdcBalance(client: Pick<PublicClient, "readContract">, usdc: Address, address: Address): Promise<bigint | null> {
  try {
    return (await client.readContract({ address: usdc, abi: USDC_BALANCE_ABI, functionName: "balanceOf", args: [address] })) as bigint;
  } catch {
    return null;
  }
}

export type HireService = {
  leadProviderUrl: string;
  network: PaymentSettings["network"];
  quoteHire(req: HireRequest): ReturnType<typeof quoteHire>;
  confirmHire(input: { ownerRef: string; code: string }): Promise<HireOutcome>;
  completeApprovedHire(input: { token: string }): Promise<HireOutcome>;
  reconcile(): ReturnType<typeof reconcileStuckHires>;
  wallets: {
    ensure(ownerRef: string): Promise<BudgetWallet>;
    lowerLimits(ownerRef: string, limits: { perHireCap?: bigint; dailyCap?: bigint }, options?: { allowRaise?: boolean }): ReturnType<typeof wallets.lowerLimits>;
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
  routes: { payments: Hono; house: Hono; specialists: Hono; research: Hono; standin: Hono | null };
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
      store, network, now: () => new Date(), balanceOf: (address: Address) => usdcBalance(client, network.usdc, address),
      ops: {
        createWallet: createAgonWallet,
        seedTestnet: seedTestnetUsdc,
        transfer: (i: { walletId: string; destinationAddress: Address; amountBaseUnits: bigint; idempotencyKey: string; refId: string }) => createPlatformUsdcTransfer({ ...i, blockchain: network.circleChain }),
      },
    };
    const hireDeps: HireDeps = {
      ...walletDeps,
      // Paid provider calls connect only to the public address that was just checked (audit B9).
      fetchImpl: providerFetch,
      signJson,
      off: { all: s.off.all, budget: s.off.budget },
      feeTxState: getTxState,
      feeMin: s.routingFeeMin,
      feeTab: s.feeTabThreshold,
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
    /// Sends USDC back out of one of Agon's own seller wallets. The Circle
    /// idempotency key comes from `refund:<jobId>`, so a retry never pays twice.
    const refundFrom = (w: WalletHandle) => async (to: Address, amount: bigint, key: string): Promise<Hex> => {
      const t = await createPlatformUsdcTransfer({ walletId: w.walletId, destinationAddress: to, amountBaseUnits: amount, idempotencyKey: stableUuid(key), refId: key, blockchain: network.circleChain });
      return waitForCircleTx({ id: t.id, label: key, getTxState });
    };
    const leadRefund = refundFrom(s.lead);
    /// Every seller wallet Agon runs, for the automatic refund of paid but undelivered hires.
    const agonSellers = [s.lead, ...Object.values(s.houseSellers), ...Object.values(s.specialistSellers)]
      .filter((w): w is WalletHandle => Boolean(w))
      .map((w) => ({ address: w.address, refund: refundFrom(w) }));
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
    // The house research agents sell one fact per call. With no wallets set they sell nothing.
    const research = researchWalletsFrom(input.env ?? process.env);
    if (research.problem) log(`research agents off: ${research.problem}`);
    const researchPolymarket = createPolymarket();
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
        // Scout prices a size against the live order book and reads flow, holders and history.
        polymarket: createPolymarket(),
        callModel: async (p) => ({ text: (await callModel(p)).text }),
        // Pitch reads recent news with the same search the Arena's evidence forecaster uses.
        ...((input.env ?? process.env).EXA_API_KEY?.trim() ? { evidence: createEvidenceSearch({ apiKey: (input.env ?? process.env).EXA_API_KEY!.trim(), log: (m) => console.warn(`[agon-pitch] ${m}`) }) } : {}),
        watch: { store: watchStore, ownerOf: ownerOfWallet, statusBase: input.siteUrl ? `${input.siteUrl}/watch` : `${s.publicApiUrl}/agon/agents/specialists/watch` },
      }) as unknown as Hono,
      research: createResearchRoutes({
        network, store,
        sellers: Object.fromEntries(Object.entries(research.wallets).map(([key, w]) => [key, { payTo: w.address, settle: settler(w) }])),
        readQuestion: createReadQuestion(async (p) => ({ text: (await callModel(p)).text }), RESEARCH_MODEL),
        chain: {
          latest: () => client.getBlockNumber(),
          block: async (n) => {
            const block = await client.getBlock({ blockNumber: n }).catch((error: unknown) => { if (error instanceof Error && error.name === "BlockNotFoundError") return null; throw error; });
            return block ? { gasUsed: block.gasUsed, txCount: block.transactions.length, timestamp: new Date(Number(block.timestamp) * 1000) } : null;
          },
        },
        markets: {
          candidates: async () => [],
          record: async (ref) => {
            const found = await researchPolymarket.resolve(ref);
            if (!found.ok) { if (found.code === "market_unavailable") throw new Error(found.code); return null; }
            return { slug: found.market.slug, question: found.market.question, endDate: found.market.endAt, outcomes: found.market.outcomes.map((o) => o.label), yesNo: found.market.yesNo };
          },
        },
        callModel: async (p) => ({ text: (await callModel({ model: p.model, systemPrompt: p.system, userPrompt: p.prompt, maxTokens: p.maxTokens, temperature: 0.2 })).text }),
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
        lowerLimits: (ownerRef, limits, options) => wallets.lowerLimits(walletDeps, ownerRef, limits, options),
        freeze: (ownerRef) => wallets.freeze(walletDeps, ownerRef),
        requestUnfreeze: (ownerRef) => wallets.requestUnfreeze(walletDeps, ownerRef),
        completeUnfreeze: (token) => wallets.completeUnfreeze(walletDeps, token),
        requestWithdraw: (ownerRef, to, amount) => wallets.requestWithdraw(walletDeps, ownerRef, to, amount),
        completeWithdraw: (token) => wallets.completeWithdraw({ ...walletDeps, settleOwed: (w) => settleFeeTab(hireDeps, w, { force: true }) }, token),
      },
    };

    if (input.startLoops !== false) {
      setInterval(() => {
        hire.reconcile()
          .then((t) => (t.settled || t.released ? log(`reconciled ${JSON.stringify(t)}`) : undefined))
          .then(() => refundUndeliveredAgonHires({ store, sellers: agonSellers, network: network.id, now: () => new Date(), log }))
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
        bell: (operator, m) => { const b = bellDelivery(m); return notify(operator, { kind: "agon_delivery", title: b.title.slice(0, 180), body: b.body, href: b.href }); },
        email: deliveryFrom ? (to, m) => sendEmail({ to, ...deliveryEmail(m), from: deliveryFrom }) : undefined,
        telegram: agonBot ? async (chatId, m) => {
          const ratable = m.eventKey ? ratableJobOf(m.eventKey) : null;
          const sent = await agonBot.send(Number(chatId), { text: `${m.title}

${m.body}${ratable ? "\n\nRate this job:" : ""}`, buttons: [[{ label: "Open on Agon", url: m.href }], ...(ratable ? [rateButtons(ratable)] : [])] });
          if (sent === null) throw new Error("telegram did not take the message");
        } : undefined,
      });
      log(`deliveries on: bell${deliveryFrom ? ", email" : ""}${agonBot ? ", telegram" : ""}`);
    }
    const balanceOf = (address: Address) => usdcBalance(client, network.usdc, address);
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
      store, network, now: () => new Date(), defaults: OUTSIDE_WALLET_DEFAULTS, balanceOf: (address: Address) => usdcBalance(client, network.usdc, address),
      ops: {
        createWallet: createAgonWallet,
        seedTestnet: async () => ({}),
        transfer: (i: { walletId: string; destinationAddress: Address; amountBaseUnits: bigint; idempotencyKey: string; refId: string }) => createPlatformUsdcTransfer({ ...i, blockchain: network.circleChain }),
      },
    };
    const hireDeps: HireDeps = {
      ...walletDeps,
      // Paid provider calls connect only to the public address that was just checked (audit B9).
      fetchImpl: providerFetch,
      // Mainnet wallets live under the live Circle keys.
      signJson: (walletId: string, json: string) => signTypedDataJson(walletId, json, network.circleChain),
      off: { all: false, budget: false },
      feeTxState: (id: string) => getTxState(id, network.circleChain),
      feeMin: resolved.settings.routingFeeMin,
      feeTab: resolved.settings.feeTabThreshold,
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
        lowerLimits: (ownerRef, limits, options) => wallets.lowerLimits(walletDeps, ownerRef, limits, options),
        freeze: (ownerRef) => wallets.freeze(walletDeps, ownerRef),
        requestUnfreeze: (ownerRef) => wallets.requestUnfreeze(walletDeps, ownerRef),
        completeUnfreeze: (token) => wallets.completeUnfreeze(walletDeps, token),
        requestWithdraw: (ownerRef, to, amount) => wallets.requestWithdraw(walletDeps, ownerRef, to, amount),
        completeWithdraw: (token) => wallets.completeWithdraw({ ...walletDeps, settleOwed: (w) => settleFeeTab(hireDeps, w, { force: true }) }, token),
      },
    };
    if (input.startLoops !== false) {
      setInterval(() => { hire.reconcile().catch((e) => console.warn(`[outside] reconcile failed: ${(e as Error).message}`)); }, 5 * 60_000).unref();
    }
    const balanceOf = (address: Address) => usdcBalance(client, network.usdc, address);
    console.log(`[outside] Circle routes on ${network.label}`);
    return { hire, balanceOf, feeAddress };
  } catch (error) {
    console.error(`[outside] disabled: ${(error as Error).message}`);
    return null;
  }
}

/// Lower starting limits for the real-USDC wallet; people may raise them up to BUDGET_DEFAULTS.
export const OUTSIDE_WALLET_DEFAULTS = { perHireCap: 250_000n, dailyCap: 1_000_000n } as const;
