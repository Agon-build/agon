import type { AgonNetwork } from "../network.ts";

export type DataServices = { price(coinIds: string[]): string; marketSearch(query: string): string; priceLabel: string; searchLabel: string };

/// On Arc mainnet the lead agent buys from BlockRun on the Circle Agent
/// Marketplace (prices verified 2026-10-11: 0.002 and 0.0085 USDC). On testnet,
/// where Circle lists no services, AGON's stand-in sells the same data.
export function dataServicesFor(network: AgonNetwork, publicApiUrl: string): DataServices {
  if (network.id === "arc") {
    return {
      price: (ids) => `https://arc.blockrun.ai/api/v1/defillama/prices/${ids.join(",")}`,
      marketSearch: (q) => `https://arc.blockrun.ai/api/v1/pm/markets/search?${new URLSearchParams({ q })}`,
      priceLabel: "BlockRun (Circle Agent Marketplace)",
      searchLabel: "BlockRun (Circle Agent Marketplace)",
    };
  }
  return {
    price: (ids) => `${publicApiUrl}/agon/standin/price/${ids.join(",")}`,
    marketSearch: (q) => `${publicApiUrl}/agon/standin/markets?${new URLSearchParams({ q })}`,
    priceLabel: "Agon test data seller",
    searchLabel: "Agon test data seller",
  };
}

const COINS: [RegExp, string][] = [
  [/\b(bitcoin|btc)\b/i, "coingecko:bitcoin"],
  [/\b(ethereum|eth|ether)\b/i, "coingecko:ethereum"],
  [/\b(solana|sol)\b/i, "coingecko:solana"],
  [/\b(xrp|ripple)\b/i, "coingecko:ripple"],
];

export function coinIdsForQuestion(question: string): string[] {
  return COINS.filter(([pattern]) => pattern.test(question)).map(([, id]) => id);
}
