import {
  initiateDeveloperControlledWalletsClient,
  type CreateContractExecutionTransactionInput,
  type CreateTransferTransactionInput,
} from "@circle-fin/developer-controlled-wallets";
import { config } from "../config/index.js";
import { platformTransferInput } from "./circle-transfer-input.ts";

/// Backend integration with Circle Developer-Controlled Wallets. ArcRun email
/// users sign in with an email, the backend mints a Circle wallet for them,
/// and every on-chain write (ENTER / JOIN / CLAIM / mint / train) is executed
/// by Circle on the user's behalf. The user never touches a private key, the
/// passkey ceremony, or a wallet extension.
///
/// This module is the seam for that custody trade-off: a future swap to
/// user-controlled (MPC) wallets only has to replace this file.

let cachedClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;

function getClient() {
  if (cachedClient) return cachedClient;
  const { apiKey, entitySecret } = config.circle;
  if (!apiKey || !entitySecret) {
    throw new Error(
      "Circle Dev-Controlled wallets are not configured. Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET. " +
        "Run scripts/circle-bootstrap.ts once to register the entity secret and create a wallet set.",
    );
  }
  cachedClient = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  return cachedClient;
}

export function circleDevConfigured(): boolean {
  return Boolean(config.circle.apiKey && config.circle.entitySecret && config.circle.walletSetId);
}

/// Mints a new wallet for `userRef` (we pass the email so future Circle
/// console lookups by refId are searchable). Returns the wallet id and EVM
/// address.
export async function createUserWallet(userRef: string): Promise<{
  walletId: string;
  address: `0x${string}`;
}> {
  const walletSetId = config.circle.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set. Run scripts/circle-bootstrap.ts first.");

  const client = getClient();
  const res = await client.createWallets({
    blockchains: [config.circle.blockchain] as unknown as ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    metadata: [{ refId: userRef }],
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) {
    throw new Error("Circle createWallets returned no wallet");
  }
  return {
    walletId: wallet.id,
    address: wallet.address.toLowerCase() as `0x${string}`,
  };
}

/// Seeds a new wallet with testnet USDC from Circle's faucet so the operator
/// can immediately stake into a contest. Called after `createUserWallet`.
/// Best-effort: if the faucet refuses or is rate-limited we still return the
/// wallet to the user; they can request USDC themselves through the Arc
/// faucet flow.
export async function seedTestnetUsdc(address: `0x${string}`): Promise<{ requested: boolean }> {
  if (!config.circle.autoSeedUsdc) return { requested: false };
  const client = getClient();
  try {
    await client.requestTestnetTokens({
      address,
      blockchain: config.circle.blockchain as "ARC-TESTNET",
      usdc: true,
      native: false,
    });
    return { requested: true };
  } catch (err) {
    console.warn("[circleDev] testnet seed failed for", address, err);
    return { requested: false };
  }
}

/// App Kit chain name -> Circle DCW blockchain code (testnet). Verified against
/// @circle-fin/developer-controlled-wallets configuration types. Used for
/// cross-chain TOP UP: we provision a per-user wallet on the source chain, the
/// user funds it, then we bridge to their Arc wallet.
const APPKIT_TO_DCW: Record<string, string> = {
  Arc_Testnet: "ARC-TESTNET",
  Ethereum_Sepolia: "ETH-SEPOLIA",
  Base_Sepolia: "BASE-SEPOLIA",
  Arbitrum_Sepolia: "ARB-SEPOLIA",
  Optimism_Sepolia: "OP-SEPOLIA",
  Polygon_Amoy_Testnet: "MATIC-AMOY",
  Avalanche_Fuji: "AVAX-FUJI",
  Unichain_Sepolia: "UNI-SEPOLIA",
};

/// Map an App Kit chain name to its Circle DCW blockchain code, or null when the
/// chain isn't one we provision deposit wallets on.
export function dcwBlockchainFor(appKitChain: string): string | null {
  return APPKIT_TO_DCW[appKitChain] ?? null;
}

/// Provision a dev-controlled wallet for the user on a specific blockchain. The
/// caller caches the (operator, chain) -> wallet mapping, so this only runs once
/// per user per source chain. `refId` is the operator:chain key for searchability
/// in the Circle console.
export async function createWalletOnChain(
  refId: string,
  dcwBlockchain: string,
): Promise<{ walletId: string; address: `0x${string}` }> {
  const walletSetId = config.circle.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set. Run scripts/circle-bootstrap.ts first.");
  const client = getClient();
  const res = await client.createWallets({
    blockchains: [dcwBlockchain] as unknown as ["ARC-TESTNET"],
    count: 1,
    walletSetId,
    metadata: [{ refId }],
  });
  const wallet = res.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) throw new Error("Circle createWallets returned no wallet");
  return { walletId: wallet.id, address: wallet.address.toLowerCase() as `0x${string}` };
}

/** A separate EOA for one AGON provider draft. Circle's key stays in AGON custody. */
export async function createPublisherWallet(refId: string, idempotencyKey: string): Promise<{
  walletId: string;
  address: `0x${string}`;
}> {
  const walletSetId = config.circle.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set");
  const response = await getClient().createWallets({
    blockchains: ["ARC-TESTNET"],
    accountType: "EOA",
    count: 1,
    walletSetId,
    metadata: [{ refId }],
    idempotencyKey,
  });
  const wallet = response.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) {
    throw new Error("Circle did not return a valid publisher wallet");
  }
  return { walletId: wallet.id, address: wallet.address.toLowerCase() as `0x${string}` };
}

/** Submit only the caller's pinned calldata. Reusing the key recovers uncertain Circle responses. */
export async function executePublisherCall(input: {
  walletId: string;
  contractAddress: `0x${string}`;
  callData: `0x${string}`;
  idempotencyKey: string;
  refId: string;
  fee: { gasLimit: string; gasPrice: string };
}): Promise<{ id: string; state: string }> {
  const response = await getClient().createContractExecutionTransaction({
    walletId: input.walletId,
    contractAddress: input.contractAddress,
    callData: input.callData,
    idempotencyKey: input.idempotencyKey,
    refId: input.refId,
    fee: { type: "gas", config: input.fee },
  });
  if (!response.data?.id) throw new Error("Circle did not return a publisher transaction ID");
  return { id: response.data.id, state: response.data.state };
}

/// USDC balance (human units) for a dev-controlled wallet, summed across any
/// USDC token entries. Drives the top-up deposit poll: once this clears the
/// requested amount we fire the bridge to Arc.
export async function walletUsdcBalance(walletId: string): Promise<number> {
  const client = getClient();
  const res = await client.getWalletTokenBalance({ id: walletId });
  const balances = (res.data?.tokenBalances ?? []) as Array<{ amount?: string; token?: { symbol?: string } }>;
  let total = 0;
  for (const b of balances) {
    if ((b.token?.symbol ?? "").toUpperCase().includes("USDC")) total += Number(b.amount ?? "0");
  }
  return total;
}

export type ExecuteParams = {
  walletId: string;
  contractAddress: `0x${string}`;
  abiFunctionSignature: string;
  abiParameters: ReadonlyArray<string | number | boolean | string[]>;
  refId?: string;
  // The value transfer amount in human-decimal form (e.g. "0.01"). Most ArcRun
  // calls are pure ERC20 + custom contract calls with no native value, so this
  // stays undefined for the common path.
  amount?: string;
  /// UUID. Reusing it returns the original transaction instead of a new one.
  idempotencyKey?: string;
};

/// Submits a contract execution from `walletId`. Returns the Circle tx id and
/// initial state; the caller polls `getTxState` until COMPLETE / CONFIRMED or
/// FAILED. Always uses level-based MEDIUM fee since Arc gas is denominated in
/// USDC and stays small.
export async function executeContractCall(params: ExecuteParams): Promise<{
  id: string;
  state: string;
}> {
  const client = getClient();
  const input: CreateContractExecutionTransactionInput = {
    walletId: params.walletId,
    contractAddress: params.contractAddress,
    abiFunctionSignature: params.abiFunctionSignature,
    abiParameters: params.abiParameters as unknown as (string | number | boolean)[],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    ...(params.refId ? { refId: params.refId } : {}),
    ...(params.amount ? { amount: params.amount } : {}),
    ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
  };
  const res = await client.createContractExecutionTransaction(input);
  const data = res.data;
  if (!data?.id) throw new Error("Circle createContractExecutionTransaction returned no id");
  return { id: data.id, state: data.state };
}

/// Polls a single transaction by Circle's internal id. The on-chain tx hash
/// arrives once the transaction is broadcast; we surface both so the frontend
/// can link to arcscan as soon as it's available.
export async function getTxState(id: string): Promise<{
  state: string;
  txHash?: string | null;
  errorReason?: string | null;
}> {
  const client = getClient();
  const res = await client.getTransaction({ id });
  const tx = res.data?.transaction;
  if (!tx) throw new Error(`Circle transaction ${id} not found`);
  return {
    state: tx.state,
    txHash: tx.txHash ?? null,
    errorReason: tx.errorReason ?? null,
  };
}

/**
 * Circle Developer-Controlled Wallets 9.6.0, installed in
 * backend/node_modules/@circle-fin/developer-controlled-wallets (types read
 * 2026-09-15). This is a platform/operator transfer seam, separate from the
 * Circle Agent Wallet CLI used for autonomous buyer spending.
 */
export async function createPlatformUsdcTransfer(params: {
  walletId: string;
  destinationAddress: `0x${string}`;
  amountBaseUnits: bigint;
  idempotencyKey: string;
  refId?: string;
  blockchain: "ARC-TESTNET" | "ARC";
}): Promise<{ id: string; state: string }> {
  // The installed SDK types list only ARC-TESTNET; Circle's API accepts ARC too (see createAgonWallet).
  const input = platformTransferInput(params) as unknown as CreateTransferTransactionInput;
  const response = await getClient().createTransaction(input);
  const data = response.data;
  if (!data?.id) throw new Error("Circle createTransaction returned no id");
  return { id: data.id, state: data.state };
}

/// Creates one EOA on an explicit Circle chain. The refId makes the wallet
/// findable in the Circle console; the idempotency key makes a retried create
/// return the same wallet instead of minting a second one. The installed SDK
/// (9.6.0) types only list ARC-TESTNET; Circle's API accepts ARC (Arc mainnet,
/// release note 2026-09-16), so the chain code is cast, as createUserWallet does.
export async function createAgonWallet(input: {
  refId: string;
  idempotencyKey: string;
  circleChain: "ARC-TESTNET" | "ARC";
}): Promise<{ walletId: string; address: `0x${string}` }> {
  const walletSetId = config.circle.walletSetId;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID is not set");
  const response = await getClient().createWallets({
    blockchains: [input.circleChain] as unknown as ["ARC-TESTNET"],
    accountType: "EOA",
    count: 1,
    walletSetId,
    metadata: [{ refId: input.refId }],
    idempotencyKey: input.idempotencyKey,
  });
  const wallet = response.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address || !/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) {
    throw new Error("Circle did not return a valid wallet");
  }
  return { walletId: wallet.id, address: wallet.address.toLowerCase() as `0x${string}` };
}

/// Signs an EIP-712 JSON document with a developer-controlled wallet. Callers
/// must only pass documents built by an AGON module that checks what is being
/// signed (season forecasts here; USDC authorizations behind the signing
/// policy in plan 2). Never pass caller-supplied JSON straight through.
export async function signTypedDataJson(walletId: string, typedDataJson: string): Promise<`0x${string}`> {
  const response = await getClient().signTypedData({ walletId, data: typedDataJson });
  const signature = response.data?.signature;
  if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error("Circle returned no signature");
  return signature as `0x${string}`;
}

/// Finds an earlier transaction from this wallet submitted with this refId, so
/// a retry after an uncertain response reuses it instead of sending a second
/// transaction. SDK 9.6.0 does not expose the refId query filter, so this
/// reads the wallet's recent transactions and matches refId locally.
export async function findTransactionByRefId(
  refId: string,
  walletId: string,
): Promise<{ id: string; state: string; txHash: string | null } | null> {
  const response = await getClient().listTransactions({ walletIds: [walletId] });
  const tx = (response.data?.transactions ?? []).find((t) => (t as { refId?: string }).refId === refId);
  if (!tx?.id) return null;
  return { id: tx.id, state: tx.state, txHash: tx.txHash ?? null };
}
