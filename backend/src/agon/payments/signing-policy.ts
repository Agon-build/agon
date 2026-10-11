import type { Address } from "viem";

import type { AgonNetwork } from "../network.ts";

export const TRANSFER_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export type TypedDataInput = {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type SigningContext = {
  network: AgonNetwork;
  from: Address;
  payTo: Address;
  maxValue: bigint;
  now: Date;
  maxValiditySeconds?: number;
};

export type SigningRefusal =
  | "not_transfer_authorization"
  | "wrong_domain"
  | "wrong_from"
  | "payee_not_quoted"
  | "over_limit"
  | "not_yet_valid"
  | "expired"
  | "validity_too_long";

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "");

function int(v: unknown): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    return null;
  } catch {
    return null;
  }
}

function sameFields(actual: unknown): boolean {
  const expected = TRANSFER_AUTHORIZATION_TYPES.TransferWithAuthorization;
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return expected.every((f, i) => {
    const a = actual[i] as { name?: unknown; type?: unknown };
    return a?.name === f.name && a?.type === f.type;
  });
}

/// The only thing an AGON wallet will sign: a USDC transfer authorization on
/// the active network, to the payee the router quoted, within the limit, for
/// at most ten minutes. Anything else (a permit, another token, another chain,
/// a swapped payee, a long-lived authorization) is refused by name.
export function checkTransferAuthorization(td: TypedDataInput, ctx: SigningContext): { ok: true } | { ok: false; code: SigningRefusal } {
  const typeKeys = Object.keys(td.types).filter((k) => k !== "EIP712Domain");
  if (td.primaryType !== "TransferWithAuthorization" || typeKeys.length !== 1 || !sameFields(td.types.TransferWithAuthorization)) {
    return { ok: false, code: "not_transfer_authorization" };
  }
  const value = int(td.message.value);
  const validAfter = int(td.message.validAfter);
  const validBefore = int(td.message.validBefore);
  if (value === null || validAfter === null || validBefore === null) return { ok: false, code: "not_transfer_authorization" };

  const chainId = int(td.domain.chainId);
  if (td.domain.name !== "USDC" || td.domain.version !== "2" || chainId !== BigInt(ctx.network.chainId) || lower(td.domain.verifyingContract) !== lower(ctx.network.usdc)) {
    return { ok: false, code: "wrong_domain" };
  }
  if (lower(td.message.from) !== lower(ctx.from)) return { ok: false, code: "wrong_from" };
  if (lower(td.message.to) !== lower(ctx.payTo)) return { ok: false, code: "payee_not_quoted" };
  if (value <= 0n || value > ctx.maxValue) return { ok: false, code: "over_limit" };
  const nowSec = BigInt(Math.floor(ctx.now.getTime() / 1000));
  if (validAfter > nowSec) return { ok: false, code: "not_yet_valid" };
  if (validBefore <= nowSec) return { ok: false, code: "expired" };
  if (validBefore > nowSec + BigInt(ctx.maxValiditySeconds ?? 600)) return { ok: false, code: "validity_too_long" };
  return { ok: true };
}
