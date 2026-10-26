import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { ClientEvmSigner } from "@x402/evm";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { SigningRefusedError } from "./guarded-signer.ts";

export type ExactOption = { amount: bigint; payTo: Address; maxTimeoutSeconds: number; raw: Record<string, unknown> };

export type ExactPurchase =
  | { ok: true; amount: bigint; payTo: Address | null; txHash: Hex | null; status: number; data: unknown }
  | {
      ok: false;
      code: "no_matching_option" | "price_over_limit" | "payee_mismatch" | "signing_refused" | "payment_creation_failed" | "paid_request_failed" | "unexpected_status" | "network_error";
      detail: string;
      status?: number;
      data?: unknown;
      txHash?: Hex | null;
      /// True once the signed payment has left this process: money may have moved.
      sent?: boolean;
    };

/// Picks the plain EIP-3009 USDC option on our network. Circle Gateway
/// (GatewayWalletBatched) options are skipped: they need a Gateway deposit.
export function selectExactOption(accepts: unknown[], network: AgonNetwork): ExactOption | null {
  const options = accepts
    .map((a) => a as Record<string, unknown>)
    .filter((a) => a.scheme === "exact" && a.network === network.caip2 && typeof a.asset === "string" && a.asset.toLowerCase() === network.usdc.toLowerCase())
    .filter((a) => {
      const extra = (a.extra ?? {}) as Record<string, unknown>;
      return extra.name !== "GatewayWalletBatched" && (extra.name === "USDC" || extra.assetTransferMethod === "eip3009");
    })
    .filter((a) => typeof a.payTo === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.payTo) && typeof a.amount === "string" && /^\d+$/.test(a.amount) && BigInt(a.amount) > 0n)
    .map((a) => ({ amount: BigInt(a.amount as string), payTo: (a.payTo as string).toLowerCase() as Address, maxTimeoutSeconds: Number(a.maxTimeoutSeconds ?? 300), raw: a }))
    .sort((x, y) => (x.amount < y.amount ? -1 : x.amount > y.amount ? 1 : 0));
  return options[0] ?? null;
}

const parser = () => new x402HTTPClient(new x402Client());

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

const MAX_TEXT_ANSWER = 20_000;

/// The paid answer: JSON as parsed, text kept (capped) with its type, other
/// bodies described by type and size. An empty body is null.
async function readAnswer(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await res.arrayBuffer().catch(() => new ArrayBuffer(0)));
  if (bytes.byteLength === 0) return null;
  const text = new TextDecoder().decode(bytes);
  if (/json/i.test(type) || type === "") {
    try { return JSON.parse(text) as unknown; } catch { if (/json/i.test(type)) return null; }
  }
  if (/^text\/|xml|csv|markdown/i.test(type) || type === "") return { contentType: type || "text/plain", text: text.slice(0, MAX_TEXT_ANSWER) };
  return { contentType: type, bytes: bytes.byteLength };
}

function requiredFrom(res: Response, body: unknown): { accepts: unknown[]; full: Record<string, unknown> } | null {
  try {
    const required = parser().getPaymentRequiredResponse((name) => res.headers.get(name), body) as unknown as Record<string, unknown>;
    return { accepts: Array.isArray(required.accepts) ? required.accepts : [], full: required };
  } catch {
    return null;
  }
}

export async function peekExactTerms(input: {
  url: string;
  init?: RequestInit;
  network: AgonNetwork;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; option: ExactOption } | { ok: true; free: true; status: number; data: unknown } | { ok: false; code: "no_matching_option" | "unexpected_status" | "network_error"; detail: string; reason?: string }> {
  let res: Response;
  try {
    res = await (input.fetchImpl ?? fetch)(input.url, { ...input.init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return { ok: false, code: "network_error", detail: (error as Error).message };
  }
  const body = await readJson(res);
  if (res.status !== 402) {
    if (res.ok) return { ok: true, free: true, status: res.status, data: body };
    // A provider that refuses the request says why in an error code, such as market_closed.
    const reason = (body as { error?: unknown } | null)?.error;
    return { ok: false, code: "unexpected_status", detail: `status ${res.status}`, ...(typeof reason === "string" && /^[a-z][a-z0-9_]{2,40}$/.test(reason) ? { reason } : {}) };
  }
  const required = requiredFrom(res, body);
  const option = required ? selectExactOption(required.accepts, input.network) : null;
  return option ? { ok: true, option } : { ok: false, code: "no_matching_option", detail: "no plain USDC exact option on this network" };
}

/// One paid call: read the 402, choose the plain USDC option, check it against
/// the caller's limit and quoted payee, clamp its validity, let the caller's
/// (policy-guarded) signer sign, retry with the payment, and report the
/// settlement transaction. A refused signature means no money moved.
export async function buyExact(input: {
  url: string;
  init?: RequestInit;
  network: AgonNetwork;
  maxAmount: bigint;
  expectedPayTo?: Address;
  signerFor: (option: ExactOption) => ClientEvmSigner;
  fetchImpl?: typeof fetch;
  maxValiditySeconds?: number;
  paidTimeoutMs?: number;
}): Promise<ExactPurchase> {
  const doFetch = input.fetchImpl ?? fetch;
  let first: Response;
  try {
    first = await doFetch(input.url, { ...input.init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    return { ok: false, code: "network_error", detail: (error as Error).message };
  }
  const firstBody = await readJson(first);
  if (first.status !== 402) {
    return first.ok
      ? { ok: true, amount: 0n, payTo: null, txHash: null, status: first.status, data: firstBody }
      : { ok: false, code: "unexpected_status", detail: `status ${first.status}`, status: first.status, data: firstBody };
  }
  const required = requiredFrom(first, firstBody);
  const option = required ? selectExactOption(required.accepts, input.network) : null;
  if (!required || !option) return { ok: false, code: "no_matching_option", detail: "no plain USDC exact option on this network" };
  if (option.amount > input.maxAmount) return { ok: false, code: "price_over_limit", detail: `price ${option.amount} over limit ${input.maxAmount}` };
  if (input.expectedPayTo && option.payTo !== input.expectedPayTo.toLowerCase()) return { ok: false, code: "payee_mismatch", detail: `payee ${option.payTo} is not the quoted one` };

  const clamped = { ...option.raw, maxTimeoutSeconds: Math.min(option.maxTimeoutSeconds, input.maxValiditySeconds ?? 600) };
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: input.signerFor(option) } as never);
  const http = new x402HTTPClient(client);
  let headers: Record<string, string>;
  try {
    const payload = await http.createPaymentPayload({ ...required.full, accepts: [clamped] } as never);
    // The signature is good for at most the clamp, but the seller matches the
    // terms it offered field by field, so it gets them back unchanged.
    if (payload.x402Version === 2) (payload as { accepted: unknown }).accepted = option.raw;
    headers = http.encodePaymentSignatureHeader(payload) as Record<string, string>;
  } catch (error) {
    const refused = error instanceof SigningRefusedError ? error.code : /signing refused: (\w+)/.exec(String((error as Error)?.message ?? error))?.[1];
    return refused
      ? { ok: false, code: "signing_refused", detail: refused }
      : { ok: false, code: "payment_creation_failed", detail: (error as Error).message };
  }

  let second: Response;
  try {
    second = await doFetch(input.url, { ...input.init, redirect: "manual", headers: { ...((input.init?.headers as Record<string, string>) ?? {}), ...headers }, signal: AbortSignal.timeout(input.paidTimeoutMs ?? 60_000) });
  } catch (error) {
    return { ok: false, code: "network_error", detail: `paid request failed in transit: ${(error as Error).message}`, txHash: null, sent: true };
  }
  let txHash: Hex | null = null;
  try {
    const settled = http.getPaymentSettleResponse((name) => second.headers.get(name)) as unknown as { transaction?: string };
    if (typeof settled?.transaction === "string" && /^0x[0-9a-fA-F]{64}$/.test(settled.transaction)) txHash = settled.transaction.toLowerCase() as Hex;
  } catch {
    txHash = null;
  }
  const data = second.ok ? await readAnswer(second) : await readJson(second);
  if (!second.ok) {
    // A seller that refuses the payment says why in the error of its new 402.
    const reason = second.status === 402 ? (requiredFrom(second, data)?.full.error ?? (data as { error?: unknown } | null)?.error) : undefined;
    const why = typeof reason === "string" && reason.length > 0 ? `: ${reason.slice(0, 120)}` : "";
    return { ok: false, code: "paid_request_failed", detail: `status ${second.status}${why}`, status: second.status, data, txHash, sent: true };
  }
  return { ok: true, amount: option.amount, payTo: option.payTo, txHash, status: second.status, data };
}
