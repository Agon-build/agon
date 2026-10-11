/// Typed Arc network context. Every AGON subsystem that reads or writes chain
/// state takes one of these values instead of a raw env string, so a network
/// switch changes chain id, RPC, explorer, Circle chain code and addresses
/// together. Values verified against docs.arc.io and developers.circle.com on
/// 2026-10-11.

export type AgonNetworkId = "arc-testnet" | "arc";

export type AgonNetwork = {
  id: AgonNetworkId;
  chainId: number;
  caip2: `eip155:${number}`;
  circleChain: "ARC-TESTNET" | "ARC";
  label: string;
  rpcHttp: readonly string[];
  explorer: string;
  usdc: `0x${string}`;
  identityRegistry: `0x${string}`;
};

const NETWORKS: Record<AgonNetworkId, AgonNetwork> = {
  "arc-testnet": {
    id: "arc-testnet",
    chainId: 5_042_002,
    caip2: "eip155:5042002",
    circleChain: "ARC-TESTNET",
    label: "Arc Testnet",
    rpcHttp: ["https://rpc.testnet.arc.io"],
    explorer: "https://explorer.testnet.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  },
  arc: {
    id: "arc",
    chainId: 5042,
    caip2: "eip155:5042",
    circleChain: "ARC",
    label: "Arc",
    rpcHttp: ["https://rpc.mainnet.arc.io"],
    explorer: "https://explorer.arc.io",
    usdc: "0x3600000000000000000000000000000000000000",
    identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  },
};

export function agonNetwork(id: string, rpcOverride: readonly string[] = []): AgonNetwork {
  if (id !== "arc-testnet" && id !== "arc") throw new Error(`unknown AGON network: ${id}`);
  const base = NETWORKS[id];
  if (rpcOverride.length === 0) return base;
  for (const url of rpcOverride) {
    if (!url.startsWith("https://")) throw new Error(`AGON network RPC must use https: ${url}`);
  }
  return { ...base, rpcHttp: [...rpcOverride] };
}

export function explorerTxUrl(network: AgonNetwork, hash: string): string {
  return `${network.explorer}/tx/${hash}`;
}

export function explorerAddressUrl(network: AgonNetwork, address: string): string {
  return `${network.explorer}/address/${address}`;
}
