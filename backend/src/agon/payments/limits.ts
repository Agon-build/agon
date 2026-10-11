import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Address, Hex } from "viem";

import type { ApprovalAction, PaymentsStore } from "./types.ts";

export const BUDGET_DEFAULTS = { perHireCap: 500_000n, dailyCap: 2_000_000n } as const;
export const LEAD_LIMITS = { perData: 50_000n, daily: 3_000_000n } as const;
export const CONFIRMATION_TTL_MS = 300_000;
export const MAX_CODE_ATTEMPTS = 5;
export const APPROVAL_TTL_MS = 900_000;

const sha256 = (input: string): Hex => `0x${createHash("sha256").update(input).digest("hex")}`;
const codeHash = (walletRef: string, jobId: string, code: string) => sha256(`code|${walletRef}|${jobId}|${code}`);

export async function issueConfirmation(
  store: PaymentsStore,
  input: { walletRef: string; jobId: string; amount: bigint; payee: Address; now: Date; digits?: () => number },
): Promise<{ code: string; expiresAt: Date }> {
  const code = String((input.digits ?? (() => randomInt(0, 10_000)))()).padStart(4, "0");
  const expiresAt = new Date(input.now.getTime() + CONFIRMATION_TTL_MS);
  await store.insertConfirmation({
    codeHash: codeHash(input.walletRef, input.jobId, code),
    walletRef: input.walletRef,
    jobId: input.jobId,
    amount: input.amount,
    payee: input.payee,
    expiresAt,
    usedAt: null,
    attempts: 0,
    createdAt: input.now,
  });
  return { code, expiresAt };
}

/// Only the most recent code for a wallet can be redeemed; issuing a new quote
/// silently retires the older one.
export async function redeemConfirmation(
  store: PaymentsStore,
  input: { walletRef: string; code: string; now: Date },
): Promise<{ ok: true; jobId: string; amount: bigint; payee: Address } | { ok: false; code: "no_pending" | "already_used" | "expired" | "too_many_attempts" | "wrong_code" }> {
  const latest = await store.latestConfirmation(input.walletRef);
  if (!latest) return { ok: false, code: "no_pending" };
  if (latest.usedAt) return { ok: false, code: "already_used" };
  if (latest.expiresAt <= input.now) return { ok: false, code: "expired" };
  if (latest.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, code: "too_many_attempts" };
  if (!/^\d{4}$/.test(input.code) || codeHash(input.walletRef, latest.jobId, input.code) !== latest.codeHash) {
    await store.updateConfirmation(latest.codeHash, { attempts: latest.attempts + 1 });
    return { ok: false, code: "wrong_code" };
  }
  await store.updateConfirmation(latest.codeHash, { usedAt: input.now });
  return { ok: true, jobId: latest.jobId, amount: latest.amount, payee: latest.payee };
}

export async function issueApproval(
  store: PaymentsStore,
  input: { walletRef: string; action: ApprovalAction; payload: Record<string, unknown>; now: Date; token?: () => string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = (input.token ?? (() => randomBytes(32).toString("base64url")))();
  const expiresAt = new Date(input.now.getTime() + APPROVAL_TTL_MS);
  await store.insertApproval({ tokenHash: sha256(`approval|${token}`), walletRef: input.walletRef, action: input.action, payload: input.payload, expiresAt, usedAt: null });
  return { token, expiresAt };
}

export async function redeemApproval(
  store: PaymentsStore,
  input: { token: string; action: ApprovalAction; now: Date },
): Promise<{ ok: true; walletRef: string; payload: Record<string, unknown> } | { ok: false; code: "unknown" | "wrong_action" | "used" | "expired" }> {
  const tokenHash = sha256(`approval|${input.token}`);
  const approval = await store.getApproval(tokenHash);
  if (!approval) return { ok: false, code: "unknown" };
  if (approval.action !== input.action) return { ok: false, code: "wrong_action" };
  if (approval.usedAt) return { ok: false, code: "used" };
  if (approval.expiresAt <= input.now) return { ok: false, code: "expired" };
  if (!(await store.useApproval(tokenHash, input.now))) return { ok: false, code: "used" };
  return { ok: true, walletRef: approval.walletRef, payload: approval.payload };
}
