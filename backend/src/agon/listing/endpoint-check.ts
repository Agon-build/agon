import { assertPublicHttpsDestination } from "../manifest-inspector.ts";
import type { AgonNetwork } from "../network.ts";
import { peekExactTerms } from "../payments/exact-buyer.ts";
import { PREFLIGHT_PROTOCOL } from "../payments/listing-protocols.ts";
import { createHttpPlaygroundProviderRunner } from "../playground-provider.ts";
import { defaultPlaygroundInput, getPlaygroundTask } from "../playground.ts";

/// The live listing checks a builder runs before publishing, on the web and over MCP.
export type ListingCheckName = "secure_endpoint" | "asks_for_payment" | "price_matches" | "certification";
export type ListingCheck = { name: ListingCheckName; status: "passed" | "failed" | "skipped"; required: boolean; detail: string };
export type ListingCheckResult = { checks: ListingCheck[]; requiredPassed: boolean; certificationScore: number | null; checkedAt: string };
export type ListingCheckDeps = {
  assertPublic(url: string): Promise<URL>;
  peek(url: string, init: RequestInit): ReturnType<typeof peekExactTerms>;
  certify(url: string): Promise<{ passed: boolean; score: number }>;
};

export const CHECK_TIMEOUT_MS = 15_000;
/// Category ids that have an automatic certification task today ("3" is Analysis).
const CERTIFIABLE = new Set(["3"]);

export function normalizeEndpoint(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
}

export function priceAtomic(priceUSDC: string): bigint {
  const [whole, frac = ""] = priceUSDC.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

const usdc = (atomic: bigint) => `${atomic / 1_000_000n}.${(atomic % 1_000_000n).toString().padStart(6, "0").replace(/0{1,4}$/, "")}`;

export async function runListingChecks(input: { endpoint: string; priceUSDC: string; category: string; deps: ListingCheckDeps; now?: () => Date }): Promise<ListingCheckResult> {
  const checks: ListingCheck[] = [];
  const add = (name: ListingCheckName, status: ListingCheck["status"], required: boolean, detail: string) => checks.push({ name, status, required, detail });

  let secure = false;
  try {
    await input.deps.assertPublic(input.endpoint);
    secure = true;
    add("secure_endpoint", "passed", true, "Public HTTPS endpoint.");
  } catch {
    add("secure_endpoint", "failed", true, "Use a public HTTPS address. Private, local and plain HTTP addresses are refused.");
  }

  let offered: bigint | null = null;
  if (!secure) {
    add("asks_for_payment", "skipped", true, "Not called: the address is not a public HTTPS endpoint.");
  } else {
    const init: RequestInit = {
      method: "POST", redirect: "error", headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol: PREFLIGHT_PROTOCOL, category: "analysis", input: { probe: "payment-challenge", writes: false } }),
    };
    const out = await input.deps.peek(input.endpoint, init);
    if (out.ok && "option" in out) {
      offered = out.option.amount;
      add("asks_for_payment", "passed", true, `Answered 402 asking for ${usdc(out.option.amount)} USDC on Arc.`);
    } else if (out.ok) {
      add("asks_for_payment", "failed", true, "It answered without asking for payment. An unpaid call must answer 402 with payment terms.");
    } else if (out.code === "no_matching_option") {
      add("asks_for_payment", "failed", true, "It answered 402, but no option pays in USDC on Arc with the exact scheme.");
    } else if (out.code === "unexpected_status") {
      add("asks_for_payment", "failed", true, `It answered ${out.detail}. An unpaid call must answer 402 with payment terms.`);
    } else {
      add("asks_for_payment", "failed", true, "No answer within 15 seconds, or a redirect. Answer directly and quickly.");
    }
  }

  const listed = priceAtomic(input.priceUSDC);
  if (offered === null) add("price_matches", "skipped", true, "Needs a 402 answer first.");
  else if (offered === listed) add("price_matches", "passed", true, `The endpoint asks ${usdc(offered)} USDC, the listed price.`);
  else add("price_matches", "failed", true, `The endpoint asks ${usdc(offered)} USDC but the listing says ${usdc(listed)} USDC. Make them match.`);

  let certificationScore: number | null = null;
  if (!CERTIFIABLE.has(input.category)) {
    add("certification", "skipped", false, "Automatic certification opens for Analysis first. This agent lists as Listed.");
  } else if (!secure) {
    add("certification", "skipped", false, "Not called: the address is not a public HTTPS endpoint.");
  } else {
    try {
      const c = await input.deps.certify(input.endpoint);
      certificationScore = c.score;
      add("certification", c.passed ? "passed" : "failed", false, c.passed
        ? `Scored ${c.score} of 100. It becomes Verified after publishing.`
        : `Scored ${c.score} of 100; 80 is needed for Verified. It can still list as Listed.`);
    } catch {
      add("certification", "failed", false, "It did not answer the certification task. See Docs, Make your endpoint listable.");
    }
  }

  return {
    checks,
    requiredPassed: checks.filter((c) => c.required).every((c) => c.status === "passed"),
    certificationScore,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
  };
}

/// Most of an endpoint's answer the checker will read.
export const CHECK_MAX_BODY_BYTES = 64 * 1024;

/// Wraps fetch so a response body larger than maxBytes is refused instead of read into memory.
export function cappedFetch(fetchImpl: typeof fetch, maxBytes: number): typeof fetch {
  return async (url, init) => {
    const res = await fetchImpl(url, init);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response too large");
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error("response too large"); }
        chunks.push(value);
      }
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export function defaultListingCheckDeps(network: AgonNetwork): ListingCheckDeps {
  const timed: typeof fetch = cappedFetch((url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }), CHECK_MAX_BODY_BYTES);
  return {
    assertPublic: (url) => assertPublicHttpsDestination(url),
    peek: (url, init) => peekExactTerms({ url, init, network, fetchImpl: timed }),
    async certify(url) {
      // The runner keys endpoints by a listing scope; a draft has none yet, so it uses a fixed placeholder scope.
      const reference = `${network.chainId}:0x0000000000000000000000000000000000000001:1`;
      const run = await createHttpPlaygroundProviderRunner({ [`${reference}@1`]: url }, { timeoutMs: CHECK_TIMEOUT_MS }).run({
        provider: { agentId: "0", serviceKey: `0x${"0".repeat(64)}`, listingReference: reference, listingVersion: "1" },
        task: getPlaygroundTask("analysis", "evidence-under-pressure"),
        taskInput: defaultPlaygroundInput("evidence-under-pressure"),
      });
      return { passed: run.passed, score: run.score };
    },
  };
}
