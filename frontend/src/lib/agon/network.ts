import type { Chain } from "viem";
import { arcTestnet } from "viem/chains";

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
export type AgonNetworkKey = "arc-testnet";
export type AgonNetworkMode = "mainnet" | "testnet";
export type AgonNetworkReadiness = "configured" | "adapter_pending";
export type AgonChainId = typeof arcTestnet.id;

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
  brand: "ARC";
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

const AGON_API_URL = (
  process.env.NEXT_PUBLIC_AGON_API_URL ??
  process.env.NEXT_PUBLIC_AUTH_URL ??
  "http://localhost:8082"
).replace(/\/$/, "");

export const AGON_NETWORKS: Record<AgonNetworkKey, AgonNetworkDescriptor> = {
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
    explorerUrl: "https://explorer.testnet.arc.io",
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

// Agon is Arc-native: one network context. Old links that name another network reopen on Arc.
export const AGON_PUBLIC_NETWORK_KEY: AgonNetworkKey = "arc-testnet";
export const AGON_DEFAULT_NETWORK_KEY: AgonNetworkKey = AGON_PUBLIC_NETWORK_KEY;
export const AGON_TESTNET_NETWORK_KEYS: readonly AgonNetworkKey[] = [AGON_PUBLIC_NETWORK_KEY];

export function isAgonNetworkKey(value: string | null | undefined): value is AgonNetworkKey {
  return value === "arc-testnet";
}

export function getAgonNetworkKey(value: string | null | undefined): AgonNetworkKey {
  return isAgonNetworkKey(value) ? value : AGON_DEFAULT_NETWORK_KEY;
}

/** Resolve the network exposed by public Agon routes. Any other value reopens on Arc. */
export function getPublicAgonNetworkKey(_value: string | null | undefined): typeof AGON_PUBLIC_NETWORK_KEY {
  return AGON_PUBLIC_NETWORK_KEY;
}

export function getAgonNetwork(value: string | null | undefined): AgonNetworkDescriptor {
  return AGON_NETWORKS[getAgonNetworkKey(value)];
}

export type AgonBalanceTarget = {
  chainId: AgonChainId;
  tokenAddress: `0x${string}`;
  code: "ARC";
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

/** Compatibility export for modules that read the one Arc context directly. */
export const AGON_NETWORK = AGON_NETWORKS["arc-testnet"];
export const AGON_NETWORK_LABEL = `NETWORK ${AGON_NETWORK.chainId}`;
export const AGON_NETWORK_DETAIL = `${AGON_NETWORK.name} / CHAIN ${AGON_NETWORK.chainId}`;
