"use client";

import { useCallback, useState } from "react";
import type { Abi, AbiFunction } from "viem";

/// Mirror of wagmi's `useWriteContract` surface, but routed through the ArcRun
/// backend's /wallet/execute endpoint instead of an injected wallet. Used by
/// Circle Developer-Controlled wallet users (email logins) who don't have a
/// private key on the device. The hook converts the (abi, functionName, args)
/// shape callers already use into Circle's (abiFunctionSignature,
/// abiParameters) shape so the call sites don't have to change.
///
/// The promise resolves once the on-chain transaction hash is known. It polls
/// the backend with a 1.2s cadence and gives up after ~120s with an error.

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_URL ?? "http://localhost:8082";
const POLL_MS = 1200;
const POLL_TIMEOUT_MS = 120_000;

export type CircleWriteArgs = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: ReadonlyArray<unknown>;
  /// Optional native-value transfer in human-decimal form. ArcRun's writes are
  /// all USDC + custom calls with no native value so this stays undefined.
  value?: string;
  /// Prepared operation reference for endpoints that require a backend proof
  /// before Circle is allowed to sign the exact call.
  refId?: string;
};

export interface UseCircleExecute {
  /// Submit a contract call. Resolves with the on-chain tx hash once Circle
  /// reports the transaction is broadcast or confirmed.
  writeContractAsync: (args: CircleWriteArgs) => Promise<`0x${string}`>;
  isPending: boolean;
  error: Error | null;
  lastTxHash: `0x${string}` | null;
}

export function useCircleExecute(): UseCircleExecute {
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | null>(null);

  const writeContractAsync = useCallback(async (args: CircleWriteArgs): Promise<`0x${string}`> => {
    setPending(true);
    setError(null);
    try {
      const sig = abiFunctionSignature(args.abi, args.functionName);
      const params = serializeAbiArgs(args.args ?? []);

      const submitRes = await fetch(`${AUTH_URL}/wallet/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          contractAddress: args.address,
          abiFunctionSignature: sig,
          abiParameters: params,
          ...(args.value ? { amount: args.value } : {}),
          ...(args.refId ? { refId: args.refId } : {}),
        }),
      });
      const submitBody = (await submitRes.json().catch(() => ({}))) as {
        id?: string;
        state?: string;
        error?: string;
      };
      if (!submitRes.ok || !submitBody.id) {
        throw new Error(submitBody.error ?? "could not submit transaction");
      }

      const txHash = await waitForTxHash(submitBody.id);
      setLastTxHash(txHash);
      return txHash;
    } catch (err) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped);
      throw wrapped;
    } finally {
      setPending(false);
    }
  }, []);

  return { writeContractAsync, isPending, error, lastTxHash };
}

/// Polls /wallet/tx/:id until Circle reports a txHash or terminal failure.
async function waitForTxHash(circleTxId: string): Promise<`0x${string}`> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${AUTH_URL}/wallet/tx/${circleTxId}`, { credentials: "include" });
    const body = (await res.json().catch(() => ({}))) as {
      state?: string;
      txHash?: string | null;
      errorReason?: string | null;
      error?: string;
    };
    if (!res.ok) throw new Error(body.error ?? "could not check tx state");
    if (body.txHash) return body.txHash as `0x${string}`;
    if (body.state === "FAILED" || body.state === "DENIED" || body.state === "CANCELLED") {
      throw new Error(body.errorReason ?? `transaction ${body.state.toLowerCase()}`);
    }
    await sleep(POLL_MS);
  }
  throw new Error("transaction is still pending after 2 minutes; check the Arc explorer or try again");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/// Build an ABI function signature ("name(type1,type2,...)") from a viem ABI
/// plus a function name. Handles tuple and array types so the string matches
/// Circle's expected `abiFunctionSignature`.
function abiFunctionSignature(abi: Abi, functionName: string): string {
  const fn = abi.find(
    (item): item is AbiFunction => item.type === "function" && item.name === functionName,
  );
  if (!fn) throw new Error(`function ${functionName} not found in ABI`);
  const inputs = fn.inputs.map((i) => abiTypeString(i)).join(",");
  return `${fn.name}(${inputs})`;
}

function abiTypeString(param: { type: string; components?: ReadonlyArray<{ type: string; components?: unknown }> }): string {
  if (param.type === "tuple" || param.type.startsWith("tuple")) {
    const inner = (param.components ?? []).map((c) => abiTypeString(c as { type: string })).join(",");
    return `(${inner})${param.type.slice("tuple".length)}`;
  }
  return param.type;
}

/// Convert wagmi-shaped args (bigints, bytes, addresses) to Circle's
/// abiParameters shape: primitives stringified, arrays kept as arrays. Circle
/// accepts string for uint/int/address/bytes and boolean for bool.
function serializeAbiArgs(args: ReadonlyArray<unknown>): Array<unknown> {
  return args.map((a) => serializeAbiArg(a));
}

function serializeAbiArg(a: unknown): unknown {
  if (typeof a === "bigint") return a.toString();
  if (Array.isArray(a)) return a.map((x) => serializeAbiArg(x));
  if (typeof a === "boolean") return a;
  if (typeof a === "string") return a;
  if (typeof a === "number") return a.toString();
  if (a === null || a === undefined) return null;
  if (typeof a === "object") {
    // Tuple-as-object => convert each key. Most ArcRun calls don't use object
    // tuples; this stays for safety.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(a as object)) out[k] = serializeAbiArg(v);
    return out;
  }
  return String(a);
}
