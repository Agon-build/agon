import { keccak256, stringToHex } from "viem";

import type { ListedPlaygroundProvider } from "./playground-provider.ts";

const MAX_RESPONSE_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export type AgonEndpointQaEvidence = {
  endpointUrl: string;
  endpointStatus: number | null;
  checkedAt: string;
  /** The listing version the check was made for; the payee is compared within one version. */
  listingVersion?: string;
  checks: {
    x402_payment: {
      passed: boolean;
      detail: string;
      header: "PAYMENT-REQUIRED" | null;
    };
    /** Present when the listing's own terms are known: the 402 must ask the published price, to the payee seen before. */
    steady_terms?: { passed: boolean; detail: string; amount: string | null; payTo: string | null };
  };
  error?: string;
};

/// What a listing's 402 is held to: its published price (USDC base units), on its network, and the
/// payee Agon first saw for this listing version (null on the first check, when it is recorded).
export type ExpectedTerms = { priceAtomic: bigint | null; caip2: string; usdc: string; payTo: string | null };

function challengeAccepts(value: string | null): Record<string, unknown>[] | null {
  if (!value || value.length > 16 * 1024) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { accepts?: unknown };
    return Array.isArray(parsed.accepts) ? parsed.accepts.filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === "object") : null;
  } catch {
    return null;
  }
}

/// Fixed rules: the same 402 and the same expected terms always give the same verdict.
export function steadyTerms(accepts: Record<string, unknown>[], expected: ExpectedTerms): NonNullable<AgonEndpointQaEvidence["checks"]["steady_terms"]> {
  const offers = accepts.filter((a) => a.scheme === "exact" && a.network === expected.caip2 && typeof a.asset === "string" && a.asset.toLowerCase() === expected.usdc.toLowerCase()
    && typeof a.amount === "string" && /^\d+$/.test(a.amount) && typeof a.payTo === "string" && /^0x[0-9a-fA-F]{40}$/.test(a.payTo));
  if (offers.length === 0) return { passed: false, detail: "The payment challenge offers no USDC payment on the listing's network.", amount: null, payTo: null };
  const priced = expected.priceAtomic === null ? offers : offers.filter((a) => BigInt(a.amount as string) <= expected.priceAtomic!);
  const first = offers[0]!;
  if (priced.length === 0) {
    return { passed: false, detail: `The payment challenge asks ${first.amount} USDC base units, more than the ${expected.priceAtomic} the listing publishes.`, amount: first.amount as string, payTo: (first.payTo as string).toLowerCase() };
  }
  const paid = expected.payTo === null ? priced : priced.filter((a) => (a.payTo as string).toLowerCase() === expected.payTo!.toLowerCase());
  if (paid.length === 0) {
    return { passed: false, detail: "The payment challenge names a different payee than the one this listing version was first checked with.", amount: priced[0]!.amount as string, payTo: (priced[0]!.payTo as string).toLowerCase() };
  }
  return { passed: true, detail: "The payment challenge asks no more than the published price, to the same payee as before.", amount: paid[0]!.amount as string, payTo: (paid[0]!.payTo as string).toLowerCase() };
}

export type AgonEndpointQaResult = {
  passed: boolean;
  evidenceHash: `0x${string}`;
  evidence: AgonEndpointQaEvidence;
};

export interface AgonEndpointQaRunner {
  scopes(): readonly string[];
  supports(provider: ListedPlaygroundProvider): boolean;
  run(input: { provider: ListedPlaygroundProvider }): Promise<AgonEndpointQaResult>;
}

export class AgonEndpointQaError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AgonEndpointQaError";
  }
}

function endpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Agon endpoint QA URLs must be valid URLs.");
  }
  const host = url.hostname.toLowerCase();
  const blockedHost = host === "localhost"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === "::1"
    || host === "0.0.0.0";
  if (url.protocol !== "https:" || url.username || url.password || url.hash || blockedHost) {
    throw new Error("Agon endpoint QA URLs must use public HTTPS URLs without credentials or fragments.");
  }
  return url;
}

function scope(provider: ListedPlaygroundProvider): string {
  return `${provider.listingReference}@${provider.listingVersion}`.toLowerCase();
}

function evidenceHash(evidence: AgonEndpointQaEvidence): `0x${string}` {
  return keccak256(stringToHex(JSON.stringify(evidence))) as `0x${string}`;
}

function failureResult(target: URL, code: string, detail: string): AgonEndpointQaResult {
  const evidence: AgonEndpointQaEvidence = {
    endpointUrl: target.toString(),
    endpointStatus: null,
    checkedAt: new Date().toISOString(),
    checks: { x402_payment: { passed: false, detail, header: null } },
    error: code,
  };
  return { passed: false, evidenceHash: evidenceHash(evidence), evidence };
}

function validPaymentChallenge(value: string | null): boolean {
  if (!value || value.length > 16 * 1024) return false;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as { accepts?: unknown };
    return Array.isArray(parsed.accepts) && parsed.accepts.length > 0;
  } catch {
    return false;
  }
}

async function readBoundedBody(response: Response): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel("AGON endpoint QA response limit exceeded");
        throw new AgonEndpointQaError("response_too_large", "The endpoint QA response exceeded 32 KiB.");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createHttpAgonEndpointQaRunner(
  configuredEndpoints: Readonly<Record<string, string>>,
  options: { fetch?: typeof fetch; timeoutMs?: number; expected?: (provider: ListedPlaygroundProvider) => Promise<ExpectedTerms | null> | ExpectedTerms | null; /** When false or unset the terms check is recorded but never fails the endpoint check. */ enforceTerms?: boolean } = {},
): AgonEndpointQaRunner {
  const targets = new Map<string, URL>();
  for (const [key, value] of Object.entries(configuredEndpoints)) {
    if (!/^[1-9]\d*:0x[0-9a-fA-F]{40}:[1-9]\d*@[1-9]\d*$/.test(key)) {
      throw new Error(`Invalid endpoint QA listing scope: ${key}`);
    }
    targets.set(key.toLowerCase(), endpoint(value));
  }
  const runFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("Agon endpoint QA timeout must be between 100ms and 60s.");
  }

  return {
    scopes() {
      return [...targets.keys()].sort();
    },
    supports(provider) {
      return targets.has(scope(provider));
    },
    async run({ provider }) {
      const target = targets.get(scope(provider));
      if (!target) throw new AgonEndpointQaError("endpoint_not_enabled", "This provider endpoint is not enabled for QA.");
      const checkedAt = new Date().toISOString();
      let response: Response;
      try {
        response = await runFetch(target, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", "user-agent": "agon-endpoint-qa/1" },
          body: JSON.stringify({
            protocol: "agon-x402-preflight/1",
            category: "analysis",
            input: { probe: "payment-challenge", writes: false },
            scope: { listingReference: provider.listingReference, listingVersion: provider.listingVersion },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return failureResult(target, "endpoint_unavailable", "The endpoint did not answer within the QA time limit.");
      }

      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > MAX_RESPONSE_BYTES) {
        return failureResult(target, "response_too_large", "The endpoint returned more than 32 KiB.");
      }
      try {
        await readBoundedBody(response);
      } catch (error) {
        return failureResult(
          target,
          error instanceof AgonEndpointQaError ? error.code : "response_read_failed",
          error instanceof Error ? error.message : "The endpoint response could not be read.",
        );
      }
      const rawPaymentHeader = response.headers.get("PAYMENT-REQUIRED") ?? response.headers.get("payment-required");
      const header = rawPaymentHeader !== null
        ? "PAYMENT-REQUIRED" as const
        : null;
      const challenged = response.status === 402 && header !== null && validPaymentChallenge(rawPaymentHeader);
      // With a valid challenge and the listing's own terms known, the challenge is held to them.
      const expected = challenged && options.expected ? await Promise.resolve(options.expected(provider)).catch(() => null) : null;
      const steady = expected ? steadyTerms(challengeAccepts(rawPaymentHeader) ?? [], expected) : null;
      const passed = challenged;
      const evidence: AgonEndpointQaEvidence = {
        endpointUrl: target.toString(),
        endpointStatus: response.status,
        checkedAt,
        listingVersion: provider.listingVersion,
        checks: {
          ...(steady ? { steady_terms: steady } : {}),
          x402_payment: {
            passed,
            detail: passed
              ? "The provider returned HTTP 402 with a payment challenge and no payment was submitted."
              : response.status === 402 && header !== null
                ? "The provider returned HTTP 402 with an invalid PAYMENT-REQUIRED challenge."
                : response.status === 402
                  ? "The provider returned HTTP 402 without a PAYMENT-REQUIRED header."
                : `The provider returned HTTP ${response.status}; expected HTTP 402 before payment.`,
            header,
          },
        },
      };
      return { passed: passed && (!options.enforceTerms || steady === null || steady.passed), evidenceHash: evidenceHash(evidence), evidence };
    },
  };
}
