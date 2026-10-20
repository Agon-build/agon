import type { AgonListing, X402CallIntentRequest } from "./types";

export type X402Readiness = {
  eligible: boolean;
  label: "READY" | "BLOCKED";
  reason: string;
};

/**
 * Mirrors the backend's fail-closed eligibility boundary for the UI. This is
 * intentionally a display aid, never an authorization decision.
 */
export function assessX402Readiness(listing: AgonListing): X402Readiness {
  if (listing.status !== "Listed") {
    return { eligible: false, label: "BLOCKED", reason: `Listing is ${listing.status.toLowerCase()}.` };
  }
  if (listing.risk.quarantineReason) {
    return { eligible: false, label: "BLOCKED", reason: "This service is unavailable because a safety check failed." };
  }
  if (listing.payment.rail !== "X402" || !listing.payment.directX402) {
    return { eligible: false, label: "BLOCKED", reason: "This service does not support pay-per-use delivery." };
  }
  if (listing.verification.status !== "Verified") {
    return { eligible: false, label: "BLOCKED", reason: "This version must pass an Agon test before paid use." };
  }
  if (listing.endpointQa.status !== "passed") {
    return { eligible: false, label: "BLOCKED", reason: "The service endpoint has not passed its availability check." };
  }
  if (!listing.endpointQa.endpointUrl) {
    return { eligible: false, label: "BLOCKED", reason: "AGON needs to recheck this service endpoint before paid use." };
  }
  return { eligible: true, label: "READY", reason: "This version passed testing and its service endpoint is available." };
}

/// The method the agent's published service file declares; GET or POST, POST when unstated.
export function manifestMethod(body: unknown): X402CallIntentRequest["method"] {
  const method = (body as { invocation?: { method?: unknown } } | null | undefined)?.invocation?.method;
  return typeof method === "string" && method.toUpperCase() === "GET" ? "GET" : "POST";
}

export function parseCallInput(raw: string): { input: unknown } | { error: string } {
  try {
    const input = JSON.parse(raw);
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { error: "Input must be a JSON object." };
    }
    return { input };
  } catch {
    return { error: "Enter valid JSON before preparing the call." };
  }
}

export function buildCallIntentRequest(
  idempotencyKey: string,
  method: X402CallIntentRequest["method"],
  rawInput: string,
  maxAmountUSDC: string,
  endpointUrl?: string,
): X402CallIntentRequest | { error: string } {
  const parsed = parseCallInput(rawInput);
  if ("error" in parsed) return parsed;
  if (!/^\d+(?:\.\d{1,6})?$/.test(maxAmountUSDC) || Number(maxAmountUSDC) <= 0) {
    return { error: "Spend cap must be a positive USDC amount with up to 6 decimals." };
  }
  if (endpointUrl !== undefined) {
    try {
      const url = new URL(endpointUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || endpointUrl.length > 2048) throw new Error();
    } catch {
      return { error: "Provider endpoint must be a valid HTTPS URL." };
    }
  }
  return { idempotencyKey, method, input: parsed.input, maxAmountUSDC, ...(endpointUrl ? { endpointUrl } : {}) };
}

export function newCallIntentKey(): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `agon-call-${suffix}`;
}
