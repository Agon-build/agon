import { createHash } from "node:crypto";
import type { Address } from "viem";

import type { AgonNetwork } from "../network.ts";
import { stableUuid } from "../playground/seasons/committer.ts";
import { BUDGET_DEFAULTS, issueApproval, redeemApproval } from "./limits.ts";
import type { BudgetWallet, PaymentsStore } from "./types.ts";

export type WalletOps = {
  createWallet(input: { refId: string; idempotencyKey: string; circleChain: "ARC-TESTNET" | "ARC" }): Promise<{ walletId: string; address: Address }>;
  seedTestnet(address: Address): Promise<unknown>;
  transfer(input: { walletId: string; destinationAddress: Address; amountBaseUnits: bigint; idempotencyKey: string; refId: string }): Promise<{ id: string; state: string }>;
};

export type WalletDeps = {
  store: PaymentsStore; ops: WalletOps; network: AgonNetwork; now: () => Date;
  /** Starting limits for new wallets; the mainnet wallet for outside services starts lower. */
  defaults?: { perHireCap: bigint; dailyCap: bigint };
};

export const budgetWalletRef = (ownerRef: string) => `budget:${ownerRef}`;
export const ownerRefFromWalletRef = (walletRef: string) => (walletRef.startsWith("budget:") ? walletRef.slice("budget:".length) : null);

/// One Circle wallet per owner and network, created on first use. The Circle
/// refId is a hash so a phone-based owner reference never reaches Circle.
export async function ensureBudgetWallet(deps: WalletDeps, ownerRef: string): Promise<BudgetWallet> {
  const existing = await deps.store.getBudgetWallet(ownerRef, deps.network.id);
  if (existing) return existing;
  const refId = `agon-budget-${deps.network.id}-${createHash("sha256").update(ownerRef).digest("hex").slice(0, 24)}`;
  const created = await deps.ops.createWallet({ refId, idempotencyKey: stableUuid(refId), circleChain: deps.network.circleChain });
  const wallet = await deps.store.insertBudgetWallet({
    ownerRef,
    network: deps.network.id,
    walletId: created.walletId,
    address: created.address.toLowerCase() as Address,
    perHireCap: deps.defaults?.perHireCap ?? BUDGET_DEFAULTS.perHireCap,
    dailyCap: deps.defaults?.dailyCap ?? BUDGET_DEFAULTS.dailyCap,
    frozen: false,
    createdAt: deps.now(),
  });
  if (deps.network.id === "arc-testnet" && wallet.walletId === created.walletId) await deps.ops.seedTestnet(wallet.address);
  return wallet;
}

export async function lowerLimits(
  deps: WalletDeps,
  ownerRef: string,
  limits: { perHireCap?: bigint; dailyCap?: bigint },
): Promise<{ ok: true; wallet: BudgetWallet } | { ok: false; code: "no_wallet" | "above_default" | "not_positive" }> {
  if ((limits.perHireCap !== undefined && limits.perHireCap <= 0n) || (limits.dailyCap !== undefined && limits.dailyCap <= 0n)) return { ok: false, code: "not_positive" };
  if ((limits.perHireCap ?? 0n) > BUDGET_DEFAULTS.perHireCap || (limits.dailyCap ?? 0n) > BUDGET_DEFAULTS.dailyCap) return { ok: false, code: "above_default" };
  const wallet = await deps.store.updateBudgetWallet(ownerRef, deps.network.id, limits);
  return wallet ? { ok: true, wallet } : { ok: false, code: "no_wallet" };
}

export async function freeze(deps: WalletDeps, ownerRef: string): Promise<boolean> {
  return Boolean(await deps.store.updateBudgetWallet(ownerRef, deps.network.id, { frozen: true }));
}

export async function requestUnfreeze(deps: WalletDeps, ownerRef: string): Promise<{ token: string; expiresAt: Date } | null> {
  if (!(await deps.store.getBudgetWallet(ownerRef, deps.network.id))) return null;
  return issueApproval(deps.store, { walletRef: budgetWalletRef(ownerRef), action: "unfreeze", payload: { network: deps.network.id }, now: deps.now() });
}

export async function completeUnfreeze(deps: WalletDeps, token: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const approval = await redeemApproval(deps.store, { token, action: "unfreeze", now: deps.now() });
  if (!approval.ok) return approval;
  const ownerRef = ownerRefFromWalletRef(approval.walletRef);
  if (!ownerRef) return { ok: false, code: "unknown" };
  await deps.store.updateBudgetWallet(ownerRef, deps.network.id, { frozen: false });
  return { ok: true };
}

export async function requestWithdraw(
  deps: WalletDeps,
  ownerRef: string,
  to: Address,
  amount: bigint,
): Promise<{ ok: true; token: string; expiresAt: Date } | { ok: false; code: "no_wallet" | "bad_amount" | "bad_address" }> {
  if (amount <= 0n) return { ok: false, code: "bad_amount" };
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return { ok: false, code: "bad_address" };
  if (!(await deps.store.getBudgetWallet(ownerRef, deps.network.id))) return { ok: false, code: "no_wallet" };
  const link = await issueApproval(deps.store, {
    walletRef: budgetWalletRef(ownerRef), action: "withdraw", payload: { to: to.toLowerCase(), amount: amount.toString(), network: deps.network.id }, now: deps.now(),
  });
  return { ok: true, ...link };
}

export async function completeWithdraw(deps: WalletDeps, token: string): Promise<{ ok: true; transferId: string } | { ok: false; code: string }> {
  const approval = await redeemApproval(deps.store, { token, action: "withdraw", now: deps.now() });
  if (!approval.ok) return approval;
  const ownerRef = ownerRefFromWalletRef(approval.walletRef);
  const wallet = ownerRef ? await deps.store.getBudgetWallet(ownerRef, deps.network.id) : null;
  if (!wallet) return { ok: false, code: "no_wallet" };
  const refId = `agon-withdraw-${token.slice(0, 16)}`;
  const transfer = await deps.ops.transfer({
    walletId: wallet.walletId,
    destinationAddress: String(approval.payload.to) as Address,
    amountBaseUnits: BigInt(String(approval.payload.amount)),
    idempotencyKey: stableUuid(refId),
    refId,
  });
  return { ok: true, transferId: transfer.id };
}
