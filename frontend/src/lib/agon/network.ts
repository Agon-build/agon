import type { Chain } from "viem";
import { arcTestnet, bsc, bscTestnet } from "viem/chains";

import {
  AGON_CONTRACTS as ARC_AGON_CONTRACTS,
  ERC8004_IDENTITY_REGISTRY as ARC_IDENTITY_REGISTRY,
  USDC as ARC_USDC,
} from "../arc.ts";

/**
 * A network is a product context, not a label next to a wallet address.
 * Every context carries the chain, explorer, payment asset, and deployment
 * state that downstream catalog, proof, and write adapters must honor.
 */
export type AgonNetworkKey = "bnb-mainnet" | "bnb-testnet" | "arc-testnet";
export type AgonNetworkMode = "mainnet" | "testnet";
export type AgonNetworkReadiness = "configured" | "adapter_pending";
export type AgonChainId = typeof bsc.id | typeof bscTestnet.id | typeof arcTestnet.id;

export type AgonContractAddresses = {
  ProfileRegistry?: `0x${string}`;
  ServiceRegistry?: `0x${string}`;
  JobEscrow?: `0x${string}`;
  Arena?: `0x${string}`;
  SyndicateRegistry?: `0x${string}`;
  PrizeVault?: `0x${string}`;
};

export type AgonNetworkDescriptor = {
  key: AgonNetworkKey;
  mode: AgonNetworkMode;
  chain: Chain;
  chainId: AgonChainId;
  brand: "BNB" | "ARC";
  name: string;
  environment: string;
  gasAsset: string;
  paymentAsset: string;
  explorerUrl: string;
  faucetUrl: string | null;
  docsUrl: string;
  apiUrl: string | null;
  identityRegistry: `0x${string}` | null;
  paymentAssetAddress: `0x${string}` | null;
  contracts: AgonContractAddresses | null;
  readiness: AgonNetworkReadiness;
};

function readAddress(key: string): `0x${string}` | undefined {
  const value = process.env[key]?.trim();
  return value && /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : undefined;
}

function hasContracts(contracts: AgonContractAddresses | null): boolean {
  return Boolean(contracts && contracts.ProfileRegistry && contracts.ServiceRegistry);
}

function bnbContractsOrNull(contracts: AgonContractAddresses): AgonContractAddresses | null {
  return hasContracts(contracts) ? contracts : null;
}

const AGON_API_URL = (
  process.env.NEXT_PUBLIC_AGON_API_URL ??
  process.env.NEXT_PUBLIC_AUTH_URL ??
  "http://localhost:8082"
).replace(/\/$/, "");

const bnbMainnetContracts: AgonContractAddresses = {
  ProfileRegistry: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_PROFILE_REGISTRY"),
  ServiceRegistry: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_SERVICE_REGISTRY"),
  JobEscrow: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_JOB_ESCROW"),
  Arena: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_ARENA"),
  SyndicateRegistry: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_SYNDICATE_REGISTRY"),
  PrizeVault: readAddress("NEXT_PUBLIC_BNB_MAINNET_AGON_PRIZE_VAULT"),
};

const bnbTestnetContracts: AgonContractAddresses = {
  ProfileRegistry: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_PROFILE_REGISTRY"),
  ServiceRegistry: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_SERVICE_REGISTRY"),
  JobEscrow: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_JOB_ESCROW"),
  Arena: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_ARENA"),
  SyndicateRegistry: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_SYNDICATE_REGISTRY"),
  PrizeVault: readAddress("NEXT_PUBLIC_BNB_TESTNET_AGON_PRIZE_VAULT"),
};

export const AGON_NETWORKS: Record<AgonNetworkKey, AgonNetworkDescriptor> = {
  "bnb-mainnet": {
    key: "bnb-mainnet",
    mode: "mainnet",
    chain: bsc,
    chainId: bsc.id,
    brand: "BNB",
    name: "BNB Smart Chain",
    environment: "MAINNET",
    gasAsset: "BNB",
    paymentAsset: "USDC",
    explorerUrl: "https://bscscan.com",
    faucetUrl: null,
    docsUrl: "https://docs.bnbchain.org",
    apiUrl: process.env.NEXT_PUBLIC_BNB_MAINNET_AGON_API_URL?.trim() || null,
    identityRegistry: readAddress("NEXT_PUBLIC_BNB_MAINNET_ERC8004_IDENTITY_REGISTRY") ?? null,
    paymentAssetAddress: readAddress("NEXT_PUBLIC_BNB_MAINNET_USDC_ADDRESS") ?? null,
    contracts: bnbContractsOrNull(bnbMainnetContracts),
    readiness: process.env.NEXT_PUBLIC_BNB_MAINNET_AGON_ENABLED === "1" ? "configured" : "adapter_pending",
  },
  "bnb-testnet": {
    key: "bnb-testnet",
    mode: "testnet",
    chain: bscTestnet,
    chainId: bscTestnet.id,
    brand: "BNB",
    name: "BNB Smart Chain Testnet",
    environment: "TESTNET",
    gasAsset: "tBNB",
    paymentAsset: "USDC",
    explorerUrl: "https://testnet.bscscan.com",
    faucetUrl: "https://www.bnbchain.org/en/testnet-faucet",
    docsUrl: "https://docs.bnbchain.org",
    apiUrl: process.env.NEXT_PUBLIC_BNB_TESTNET_AGON_API_URL?.trim() || null,
    identityRegistry: readAddress("NEXT_PUBLIC_BNB_TESTNET_ERC8004_IDENTITY_REGISTRY") ?? null,
    paymentAssetAddress: readAddress("NEXT_PUBLIC_BNB_TESTNET_USDC_ADDRESS") ?? null,
    contracts: bnbContractsOrNull(bnbTestnetContracts),
    readiness: process.env.NEXT_PUBLIC_BNB_TESTNET_AGON_ENABLED === "1" ? "configured" : "adapter_pending",
  },
  "arc-testnet": {
    key: "arc-testnet",
    mode: "testnet",
    chain: arcTestnet,
    chainId: arcTestnet.id,
    brand: "ARC",
    name: "Arc Testnet",
    environment: "TESTNET",
    gasAsset: "USDC",
    paymentAsset: "USDC",
    explorerUrl: "https://testnet.arcscan.app",
    faucetUrl: "https://faucet.circle.com",
    docsUrl: "https://docs.arc.network",
    apiUrl: AGON_API_URL,
    identityRegistry: ARC_IDENTITY_REGISTRY,
    paymentAssetAddress: ARC_USDC,
    contracts: {
      ProfileRegistry: ARC_AGON_CONTRACTS.ProfileRegistry,
      ServiceRegistry: ARC_AGON_CONTRACTS.ServiceRegistry,
      JobEscrow: ARC_AGON_CONTRACTS.JobEscrow,
      Arena: ARC_AGON_CONTRACTS.Arena,
      SyndicateRegistry: ARC_AGON_CONTRACTS.SyndicateRegistry,
      PrizeVault: ARC_AGON_CONTRACTS.PrizeVault,
    },
    readiness: "configured",
  },
};

// The public product currently has one deliberate network context. The BNB
// descriptors remain typed and dormant so they can be reintroduced behind a
// reviewed release decision without changing the Arc adapter.
export const AGON_PUBLIC_NETWORK_KEY: AgonNetworkKey = "arc-testnet";
export const AGON_DEFAULT_NETWORK_KEY: AgonNetworkKey = AGON_PUBLIC_NETWORK_KEY;
export const AGON_TESTNET_NETWORK_KEYS: readonly AgonNetworkKey[] = [AGON_PUBLIC_NETWORK_KEY];

export function isAgonNetworkKey(value: string | null | undefined): value is AgonNetworkKey {
  return value === "bnb-mainnet" || value === "bnb-testnet" || value === "arc-testnet";
}

export function getAgonNetworkKey(value: string | null | undefined): AgonNetworkKey {
  return isAgonNetworkKey(value) ? value : AGON_DEFAULT_NETWORK_KEY;
}

/** Resolve the network exposed by public Agon routes. Old BNB links reopen on Arc. */
export function getPublicAgonNetworkKey(_value: string | null | undefined): typeof AGON_PUBLIC_NETWORK_KEY {
  return AGON_PUBLIC_NETWORK_KEY;
}

export function getAgonNetwork(value: string | null | undefined): AgonNetworkDescriptor {
  return AGON_NETWORKS[getAgonNetworkKey(value)];
}

export type AgonBalanceTarget = {
  chainId: AgonChainId;
  tokenAddress: `0x${string}`;
  code: "BNB" | "ARC";
  symbol: string;
  decimals: number;
  label: string;
};

/** Resolve a balance target from the selected context without cross-chain fallback. */
export function getAgonBalanceTarget(key: AgonNetworkKey): AgonBalanceTarget | null {
  const network = AGON_NETWORKS[key];
  if (!network.paymentAssetAddress) return null;
  return {
    chainId: network.chainId,
    tokenAddress: network.paymentAssetAddress,
    code: network.brand,
    symbol: network.paymentAsset,
    decimals: 6,
    label: network.name,
  };
}

export function networkHref(pathname: string, key: AgonNetworkKey, search = ""): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set("network", key);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

/** Keep a same-site return destination on the selected network. */
export function marketReturnHref(key: AgonNetworkKey, returnTo?: string | null): string {
  const safeReturn = returnTo && /^\/(?![/\\])/.test(returnTo) && !returnTo.includes("\\")
    ? returnTo
    : "/";
  const [pathAndQuery, hash = ""] = safeReturn.split("#", 2);
  const [pathname, search = ""] = pathAndQuery.split("?", 2);
  return `${networkHref(pathname, key, search)}${hash ? `#${hash}` : ""}`;
}

/** Keep a marketplace return destination on the same network as sign-in. */
export function loginHref(key: AgonNetworkKey, returnTo?: string | null): string {
  const networkReturn = marketReturnHref(key, returnTo);
  return networkHref("/login", key, `returnTo=${encodeURIComponent(networkReturn)}`);
}

/**
 * Compatibility export for Arc-native modules that have not moved to an
 * explicit context yet. New Agon UI must use `getAgonNetwork` or
 * `useAgonNetwork`; this value must not be used as a BNB fallback.
 */
export const AGON_NETWORK = AGON_NETWORKS["arc-testnet"];
export const AGON_NETWORK_LABEL = `NETWORK ${AGON_NETWORK.chainId}`;
export const AGON_NETWORK_DETAIL = `${AGON_NETWORK.name} / CHAIN ${AGON_NETWORK.chainId}`;
