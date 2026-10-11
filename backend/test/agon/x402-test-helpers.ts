import type { ClientEvmSigner } from "@x402/evm";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

import { TRANSFER_AUTHORIZATION_TYPES, type TypedDataInput } from "../../src/agon/payments/signing-policy.ts";
import type { AgonNetwork } from "../../src/agon/network.ts";

// Well-known Anvil keys. Never funded on Arc.
export const BUYER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const OTHER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
export const SELLER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const;

export function localSigner(account: PrivateKeyAccount): ClientEvmSigner {
  return { address: account.address, signTypedData: (td) => account.signTypedData(td as never) };
}

const UINT_FIELDS = new Set(["value", "validAfter", "validBefore", "chainId"]);

/// Stands in for Circle's signTypedData: parses the JSON document the guarded
/// signer sends and signs it with a local key, restoring integer fields.
export function circleSignJson(account: PrivateKeyAccount): (walletId: string, json: string) => Promise<Hex> {
  return async (_walletId, json) => {
    const doc = JSON.parse(json) as TypedDataInput;
    const types = { ...(doc.types as Record<string, unknown>) };
    delete types.EIP712Domain;
    const message: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc.message)) message[k] = UINT_FIELDS.has(k) ? BigInt(v as string) : v;
    return account.signTypedData({
      domain: { ...doc.domain, chainId: Number(doc.domain.chainId) } as never,
      types: types as never,
      primaryType: doc.primaryType as never,
      message: message as never,
    });
  };
}

export function authorizationTypedData(input: {
  network: AgonNetwork;
  from: Address;
  to: Address;
  value: bigint;
  validBefore: bigint;
  validAfter?: bigint;
  nonce?: Hex;
  domainOverrides?: Record<string, unknown>;
}): TypedDataInput {
  return {
    domain: { name: "USDC", version: "2", chainId: input.network.chainId, verifyingContract: input.network.usdc, ...input.domainOverrides },
    types: TRANSFER_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: input.from,
      to: input.to,
      value: input.value,
      validAfter: input.validAfter ?? 0n,
      validBefore: input.validBefore,
      nonce: input.nonce ?? `0x${"11".repeat(32)}`,
    },
  };
}

import { randomBytes } from "node:crypto";
import { encodePaymentSignatureHeader } from "@x402/core/http";

import { paymentRequiredFor, type ExactSettler, type VerifiedPayment } from "../../src/agon/payments/exact-seller.ts";

/// Builds the PAYMENT-SIGNATURE header a buyer would send, with overrides for
/// every field a malicious or broken buyer could get wrong.
export async function signedPaymentHeader(
  account: PrivateKeyAccount,
  terms: { network: AgonNetwork; payTo: Address; amount: bigint; maxTimeoutSeconds?: number },
  o: { to?: Address; value?: bigint; validAfter?: bigint; validitySeconds?: number; chainId?: number; nonce?: Hex; signer?: PrivateKeyAccount; acceptedAmount?: bigint } = {},
): Promise<string> {
  const accepted = { ...paymentRequiredFor({ ...terms, resourceUrl: "http://seller.test/", description: "test" }).accepts[0]! };
  if (o.acceptedAmount !== undefined) accepted.amount = o.acceptedAmount.toString();
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const message = {
    from: account.address,
    to: o.to ?? terms.payTo,
    value: o.value ?? terms.amount,
    validAfter: o.validAfter ?? 0n,
    validBefore: nowSec + BigInt(o.validitySeconds ?? 300),
    nonce: o.nonce ?? (`0x${randomBytes(32).toString("hex")}` as Hex),
  };
  const signature = await (o.signer ?? account).signTypedData({
    domain: { name: "USDC", version: "2", chainId: o.chainId ?? terms.network.chainId, verifyingContract: terms.network.usdc },
    types: TRANSFER_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  });
  const authorization = {
    from: message.from, to: message.to, value: message.value.toString(), validAfter: message.validAfter.toString(),
    validBefore: message.validBefore.toString(), nonce: message.nonce,
  };
  return encodePaymentSignatureHeader({ x402Version: 2, accepted, payload: { authorization, signature } } as never);
}

export function fakeSettler(txHash: Hex = `0x${"ab".repeat(32)}`): { settle: ExactSettler; calls: VerifiedPayment[]; fail: (on: boolean) => void } {
  const calls: VerifiedPayment[] = [];
  let failing = false;
  return {
    calls,
    fail: (on) => {
      failing = on;
    },
    settle: async (p) => {
      if (failing) throw new Error("settlement rpc down");
      calls.push(p);
      return txHash;
    },
  };
}

/// JSON for assertion messages; bigint amounts would otherwise throw.
export const show = (value: unknown) => JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
