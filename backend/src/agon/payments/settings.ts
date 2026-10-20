import { z } from "zod";
import type { Address } from "viem";

import { agonNetwork, type AgonNetwork } from "../network.ts";

/// The specialist agents that can have a seller wallet (agents/routes.ts SPECIALISTS).
const SPECIALIST_KEYS = ["pitch", "scout", "rules"] as const;
type SpecialistKey = (typeof SPECIALIST_KEYS)[number];

export const HIREABLE_HOUSE_KEYS = ["atlas", "vesper", "kestrel", "drift"] as const;

export type WalletHandle = { walletId: string; address: Address };

export type PaymentSettings = {
  network: AgonNetwork;
  publicApiUrl: string;
  lead: WalletHandle;
  standin: WalletHandle | null;
  houseSellers: Record<string, WalletHandle>;
  /** Pitch, Scout and Rules Check, the specialist agents Agon sells per call; empty when not set up. */
  specialistSellers: Partial<Record<SpecialistKey, WalletHandle>>;
  leadPrice: bigint;
  subHireBudget: bigint;
  houseAsk: bigint;
  houseFloor: bigint;
  off: { all: boolean; budget: boolean; lead: boolean };
  /** Agon routing fee in basis points of the agent price; 0 turns it off. */
  routingFeeBps: number;
  /** Where routing fees go on this network; null means fees are not collected. */
  feeAddress: Address | null;
};

export type PaymentSettingsResult =
  | { enabled: false }
  | { enabled: true; ok: true; settings: PaymentSettings }
  | { enabled: true; ok: false; problems: string[] };

const handleShape = z.object({ walletId: z.string().min(1), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

function parseHandle(raw: string | undefined): WalletHandle | null {
  try {
    const parsed = handleShape.parse(JSON.parse(raw ?? ""));
    return { walletId: parsed.walletId, address: parsed.address.toLowerCase() as Address };
  } catch {
    return null;
  }
}

function atomic(raw: string | undefined, fallback: bigint): bigint | null {
  if (raw === undefined || raw === "") return fallback;
  return /^[1-9]\d{0,17}$/.test(raw) ? BigInt(raw) : null;
}

/// Reads payment settings without ever throwing, so a typo can only switch
/// payments off, never stop the service that hosts them.
export function resolvePaymentSettings(env: Record<string, string | undefined>): PaymentSettingsResult {
  if (env.AGON_PAYMENTS_ENABLED !== "true") return { enabled: false };
  const problems: string[] = [];

  let network: AgonNetwork | null = null;
  try {
    network = agonNetwork(env.AGON_PAYMENT_NETWORK ?? "arc-testnet");
    const rpc = (env.AGON_PAYMENT_RPC_HTTP ?? "").split(",").map((u) => u.trim()).filter(Boolean);
    if (rpc.length > 0) {
      try {
        network = agonNetwork(network.id, rpc);
      } catch {
        problems.push("AGON_PAYMENT_RPC_HTTP must be comma-separated https URLs");
      }
    }
  } catch {
    problems.push("AGON_PAYMENT_NETWORK must be arc-testnet or arc");
  }

  const publicApiUrl = (env.AGON_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
  if (!/^https:\/\/[^\s/]+/.test(publicApiUrl)) problems.push("AGON_PUBLIC_API_URL must be an https URL");

  const lead = parseHandle(env.AGON_LEAD_WALLET);
  if (!lead) problems.push('AGON_LEAD_WALLET must be JSON like {"walletId":"...","address":"0x..."}');

  let standin: WalletHandle | null = null;
  if (network?.id === "arc-testnet") {
    standin = parseHandle(env.AGON_STANDIN_SELLER_WALLET);
    if (!standin) problems.push("AGON_STANDIN_SELLER_WALLET is required on arc-testnet");
  }

  const houseSellers: Record<string, WalletHandle> = {};
  try {
    const raw = z.record(handleShape).parse(JSON.parse(env.AGON_HOUSE_SELLER_WALLETS ?? "{}"));
    for (const [key, value] of Object.entries(raw)) {
      if (!(HIREABLE_HOUSE_KEYS as readonly string[]).includes(key)) throw new Error(key);
      houseSellers[key] = { walletId: value.walletId, address: value.address.toLowerCase() as Address };
    }
  } catch {
    problems.push(`AGON_HOUSE_SELLER_WALLETS must map ${HIREABLE_HOUSE_KEYS.join(", ")} to wallet handles`);
  }

  const specialistSellers: Partial<Record<SpecialistKey, WalletHandle>> = {};
  try {
    const raw = z.record(handleShape).parse(JSON.parse(env.AGON_SPECIALIST_WALLETS ?? "{}"));
    for (const [key, value] of Object.entries(raw)) {
      if (!SPECIALIST_KEYS.includes(key as SpecialistKey)) throw new Error(key);
      specialistSellers[key as SpecialistKey] = { walletId: value.walletId, address: value.address.toLowerCase() as Address };
    }
  } catch {
    problems.push("AGON_SPECIALIST_WALLETS must map pitch, scout or rules to wallet handles");
  }

  let routingFeeBps = 150;
  if (env.AGON_ROUTING_FEE_BPS !== undefined && env.AGON_ROUTING_FEE_BPS.trim() !== "") {
    const raw = env.AGON_ROUTING_FEE_BPS.trim();
    if (/^\d{1,4}$/.test(raw) && Number(raw) <= 1000) routingFeeBps = Number(raw);
    else problems.push("AGON_ROUTING_FEE_BPS must be a whole number of basis points from 0 to 1000");
  }
  let feeAddress: Address | null = null;
  if (env.AGON_FEE_ADDRESS?.trim()) {
    if (/^0x[0-9a-fA-F]{40}$/.test(env.AGON_FEE_ADDRESS.trim())) feeAddress = env.AGON_FEE_ADDRESS.trim().toLowerCase() as Address;
    else problems.push("AGON_FEE_ADDRESS must be a 0x address");
  }

  const leadPrice = atomic(env.AGON_LEAD_PRICE, 300_000n);
  const subHireBudget = atomic(env.AGON_LEAD_SUBHIRE_BUDGET, 250_000n);
  const houseAsk = atomic(env.AGON_HOUSE_ASK, 220_000n);
  const houseFloor = atomic(env.AGON_HOUSE_FLOOR, 160_000n);
  if (leadPrice === null) problems.push("AGON_LEAD_PRICE must be a positive integer of USDC base units");
  if (subHireBudget === null) problems.push("AGON_LEAD_SUBHIRE_BUDGET must be a positive integer of USDC base units");
  if (houseAsk === null) problems.push("AGON_HOUSE_ASK must be a positive integer of USDC base units");
  if (houseFloor === null) problems.push("AGON_HOUSE_FLOOR must be a positive integer of USDC base units");
  if (leadPrice !== null && subHireBudget !== null && subHireBudget >= leadPrice) {
    problems.push("AGON_LEAD_SUBHIRE_BUDGET must be below AGON_LEAD_PRICE");
  }
  if (houseAsk !== null && houseFloor !== null && houseFloor > houseAsk) problems.push("AGON_HOUSE_FLOOR must not exceed AGON_HOUSE_ASK");

  const offTokens = (env.AGON_PAYMENTS_OFF ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const off = { all: false, budget: false, lead: false };
  for (const token of offTokens) {
    if (token === "all" || token === "budget" || token === "lead") off[token] = true;
    else problems.push("AGON_PAYMENTS_OFF accepts only all, budget, lead");
  }

  if (problems.length > 0 || !network || !lead || leadPrice === null || subHireBudget === null || houseAsk === null || houseFloor === null) {
    return { enabled: true, ok: false, problems };
  }
  return {
    enabled: true,
    ok: true,
    settings: { network, publicApiUrl, lead, standin, houseSellers, specialistSellers, leadPrice, subHireBudget, houseAsk, houseFloor, off, routingFeeBps, feeAddress },
  };
}

export type OutsideSettings = { network: AgonNetwork; feeAddress: Address | null; routingFeeBps: number };

/// The slim Arc mainnet runtime that pays outside (Circle) services. Off unless
/// AGON_OUTSIDE_ENABLED is exactly true; it shares the routing fee rate.
export function resolveOutsideSettings(env: Record<string, string | undefined>): { enabled: false } | { enabled: true; ok: true; settings: OutsideSettings } | { enabled: true; ok: false; problems: string[] } {
  if (env.AGON_OUTSIDE_ENABLED !== "true") return { enabled: false };
  const problems: string[] = [];
  let routingFeeBps = 150;
  const rawBps = env.AGON_ROUTING_FEE_BPS?.trim();
  if (rawBps) {
    if (/^\d{1,4}$/.test(rawBps) && Number(rawBps) <= 1000) routingFeeBps = Number(rawBps);
    else problems.push("AGON_ROUTING_FEE_BPS must be a whole number of basis points from 0 to 1000");
  }
  let feeAddress: Address | null = null;
  const rawFee = env.AGON_OUTSIDE_FEE_ADDRESS?.trim();
  if (rawFee) {
    if (/^0x[0-9a-fA-F]{40}$/.test(rawFee)) feeAddress = rawFee.toLowerCase() as Address;
    else problems.push("AGON_OUTSIDE_FEE_ADDRESS must be a 0x address");
  }
  if (problems.length > 0) return { enabled: true, ok: false, problems };
  return { enabled: true, ok: true, settings: { network: agonNetwork("arc"), feeAddress, routingFeeBps } };
}
