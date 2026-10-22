import type { Context, MiddlewareHandler } from "hono";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { z } from "zod";
import { parseSignature, verifyTypedData, type Address, type Hex } from "viem";

import type { AgonNetwork, AgonNetworkId } from "../network.ts";
import { stableUuid } from "../playground/seasons/committer.ts";
import { waitForCircleTx } from "./circle-poll.ts";
import { TRANSFER_AUTHORIZATION_TYPES } from "./signing-policy.ts";

export type Eip3009Authorization = { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
export type ExactTerms = { network: AgonNetwork; payTo: Address; amount: bigint; resourceUrl: string; description: string; maxTimeoutSeconds?: number };
export type VerifiedPayment = { payer: Address; amount: bigint; authorization: Eip3009Authorization; signature: Hex };
export type ExactSettler = (payment: VerifiedPayment) => Promise<Hex>;
export type X402Paid = { payer: Address; amount: bigint; txHash: Hex; network: AgonNetwork };

const DEFAULT_TIMEOUT_SECONDS = 600;

export function paymentRequiredFor(terms: ExactTerms) {
  return {
    x402Version: 2 as const,
    resource: { url: terms.resourceUrl, description: terms.description, mimeType: "application/json" },
    accepts: [
      {
        scheme: "exact",
        network: terms.network.caip2,
        asset: terms.network.usdc,
        payTo: terms.payTo,
        amount: terms.amount.toString(),
        maxTimeoutSeconds: terms.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
        extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
      } as Record<string, unknown>,
    ],
  };
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const uint = z.string().regex(/^\d{1,78}$/);
const payloadShape = z.object({
  x402Version: z.literal(2),
  accepted: z.object({ scheme: z.string(), network: z.string(), asset: address, payTo: address, amount: uint }).passthrough(),
  payload: z.object({
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    authorization: z.object({ from: address, to: address, value: uint, validAfter: uint, validBefore: uint, nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  }),
});

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/// Checks everything a facilitator would before money moves: the buyer
/// accepted these exact terms, the authorization pays this seller at least the
/// price, it is valid now and not for too long, and the buyer really signed it.
export async function verifyExactPayment(decoded: unknown, terms: ExactTerms, now: Date): Promise<{ ok: true; payment: VerifiedPayment } | { ok: false; reason: string }> {
  const parsed = payloadShape.safeParse(decoded);
  if (!parsed.success) return { ok: false, reason: "invalid_payment_payload" };
  const { accepted, payload } = parsed.data;
  const auth = payload.authorization;
  if (accepted.scheme !== "exact" || accepted.network !== terms.network.caip2 || !same(accepted.asset, terms.network.usdc) || !same(accepted.payTo, terms.payTo) || BigInt(accepted.amount) !== terms.amount) {
    return { ok: false, reason: "terms_mismatch" };
  }
  if (!same(auth.to, terms.payTo)) return { ok: false, reason: "wrong_payee" };
  if (BigInt(auth.value) < terms.amount) return { ok: false, reason: "underpaid" };
  const nowSec = BigInt(Math.floor(now.getTime() / 1000));
  if (BigInt(auth.validAfter) > nowSec) return { ok: false, reason: "not_yet_valid" };
  if (BigInt(auth.validBefore) < nowSec + 10n) return { ok: false, reason: "expires_too_soon" };
  if (BigInt(auth.validBefore) > nowSec + BigInt((terms.maxTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) + 30)) return { ok: false, reason: "validity_too_long" };
  const signature = payload.signature as Hex;
  let valid = false;
  try {
    valid = await verifyTypedData({
      address: auth.from as Address,
      domain: { name: "USDC", version: "2", chainId: terms.network.chainId, verifyingContract: terms.network.usdc },
      types: TRANSFER_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as Address, to: auth.to as Address, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore), nonce: auth.nonce as Hex,
      },
      signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature" };
  return {
    ok: true,
    payment: {
      payer: auth.from.toLowerCase() as Address,
      amount: BigInt(auth.value),
      authorization: { ...auth, from: auth.from as Address, to: auth.to as Address, nonce: auth.nonce.toLowerCase() as Hex },
      signature,
    },
  };
}

/// Settles a verified authorization from the seller's own Circle wallet by
/// calling USDC.transferWithAuthorization. The refId and the Circle idempotency
/// key come from payee, payer and nonce together: a retried settlement never
/// sends twice, and another payer reusing a public nonce gets its own request
/// instead of the earlier settlement back.
export function createCircleExactSettler(deps: {
  walletId: string;
  network: AgonNetwork;
  execute: (input: { walletId: string; contractAddress: Address; abiFunctionSignature: string; abiParameters: string[]; refId: string; idempotencyKey: string }) => Promise<{ id: string; state: string }>;
  getTxState: (id: string) => Promise<{ state: string; txHash?: string | null; errorReason?: string | null }>;
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): ExactSettler {
  return async (p) => {
    const parts = parseSignature(p.signature);
    const v = parts.v ?? (parts.yParity === 1 ? 28n : 27n);
    const a = p.authorization;
    const key = stableUuid(`settle:${deps.network.id}:${a.to.toLowerCase()}:${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`);
    const submitted = await deps.execute({
      walletId: deps.walletId,
      contractAddress: deps.network.usdc,
      abiFunctionSignature: "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
      abiParameters: [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v.toString(), parts.r, parts.s],
      refId: `agon-x402-${key}`,
      idempotencyKey: key,
    });
    return waitForCircleTx({ id: submitted.id, label: `x402 settlement ${a.nonce}`, getTxState: deps.getTxState, pollMs: deps.pollMs, timeoutMs: deps.timeoutMs, sleep: deps.sleep });
  };
}

export function exactPayment(opts: {
  network: AgonNetwork;
  payTo: Address;
  price: (c: Context) => Promise<bigint>;
  settle: ExactSettler;
  claimNonce: (network: AgonNetworkId, payer: Address, nonce: Hex) => Promise<boolean>;
  description: string;
  beforeSettle?: (payment: VerifiedPayment, c: Context) => Promise<string | null>;
  now?: () => Date;
  maxTimeoutSeconds?: number;
  /** Where a failed settlement is reported (an unfunded seller wallet fails every sale). */
  log?: (message: string) => void;
}): MiddlewareHandler<{ Variables: { x402: X402Paid } }> {
  return async (c, next) => {
    const now = (opts.now ?? (() => new Date()))();
    const terms: ExactTerms = {
      network: opts.network, payTo: opts.payTo, amount: await opts.price(c), resourceUrl: c.req.url,
      description: opts.description, maxTimeoutSeconds: opts.maxTimeoutSeconds,
    };
    const required = paymentRequiredFor(terms);
    const demand = (error?: string) => {
      const body = error ? { ...required, error } : required;
      c.header("PAYMENT-REQUIRED", encodePaymentRequiredHeader(body as never));
      return c.json(body, 402);
    };
    const header = c.req.header("payment-signature") ?? c.req.header("x-payment");
    if (!header) return demand();
    let decoded: unknown;
    try {
      decoded = decodePaymentSignatureHeader(header);
    } catch {
      return demand("invalid_payment_header");
    }
    const verified = await verifyExactPayment(decoded, terms, now);
    if (!verified.ok) return demand(verified.reason);
    const payment = verified.payment;
    if (opts.beforeSettle) {
      const refusal = await opts.beforeSettle(payment, c);
      if (refusal) return demand(refusal);
    }
    if (!(await opts.claimNonce(opts.network.id, payment.payer, payment.authorization.nonce))) return demand("nonce_used");
    let txHash: Hex;
    try {
      txHash = await opts.settle(payment);
    } catch (error) {
      (opts.log ?? console.error)(`[x402] settlement failed for seller ${opts.payTo} on ${opts.network.id}: ${(error as Error)?.message ?? error}`);
      return demand("settlement_failed");
    }
    c.set("x402", { payer: payment.payer, amount: payment.amount, txHash, network: opts.network });
    await next();
    c.res.headers.set(
      "PAYMENT-RESPONSE",
      encodePaymentResponseHeader({ success: true, transaction: txHash, network: opts.network.caip2, payer: payment.payer } as never),
    );
  };
}
