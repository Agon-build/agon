import assert from "node:assert/strict";
import test from "node:test";

import { createHttpAgonEndpointQaRunner } from "../../src/agon/endpoint-qa.ts";

const provider = {
  agentId: "886270",
  serviceKey: `0x${"11".repeat(32)}`,
  listingReference: `5042002:0x${"22".repeat(20)}:2`,
  listingVersion: "3",
};

test("endpoint QA accepts a payment challenge without submitting payment", async () => {
  let request: Request | null = null;
  const runner = createHttpAgonEndpointQaRunner(
    { [`${provider.listingReference}@${provider.listingVersion}`]: "https://provider.example/x402/analyze" },
    {
      fetch: async (input, init) => {
        request = new Request(input, init);
        return new Response("payment required", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ accepts: [{ scheme: "exact" }] })).toString("base64url") } });
      },
    },
  );
  const result = await runner.run({ provider });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.checks.x402_payment.passed, true);
  assert.equal(request?.method, "POST");
  assert.equal(request?.headers.get("payment-signature"), null);
});

test("endpoint QA records a failed preflight when the provider does not challenge", async () => {
  const runner = createHttpAgonEndpointQaRunner(
    { [`${provider.listingReference}@${provider.listingVersion}`]: "https://provider.example/x402/analyze" },
    { fetch: async () => new Response("ok", { status: 200 }) },
  );
  const result = await runner.run({ provider });
  assert.equal(result.passed, false);
  assert.equal(result.evidence.endpointStatus, 200);
  assert.equal(result.evidence.checks.x402_payment.header, null);
});

test("endpoint QA rejects private or non-HTTPS endpoint maps", () => {
  assert.throws(
    () => createHttpAgonEndpointQaRunner({ [`${provider.listingReference}@${provider.listingVersion}`]: "http://127.0.0.1/x402" }),
    /public HTTPS/,
  );
});

// Phase 5B (2026-11-11): the 402 is held to the listing's own terms.
import { steadyTerms } from "../../src/agon/endpoint-qa.ts";

const USDC = "0x3600000000000000000000000000000000000000";
const PAYEE = `0x${"ab".repeat(20)}`;
const offer = (over: Record<string, unknown> = {}) => ({ scheme: "exact", network: "eip155:5042002", asset: USDC, payTo: PAYEE, amount: "220000", ...over });
const want = (over: Record<string, unknown> = {}) => ({ priceAtomic: 220_000n, caip2: "eip155:5042002", usdc: USDC, payTo: PAYEE, ...over });

test("a 402 keeps steady terms when it asks no more than the published price, to the same payee", () => {
  assert.deepEqual(steadyTerms([offer()], want()), { passed: true, detail: "The payment challenge asks no more than the published price, to the same payee as before.", amount: "220000", payTo: PAYEE });
  assert.equal(steadyTerms([offer({ amount: "200000" })], want()).passed, true, "cheaper than published harms no buyer");
  assert.equal(steadyTerms([offer({ payTo: PAYEE.toUpperCase().replace("0X", "0x") })], want()).passed, true, "the payee is compared without letter case");
  assert.equal(steadyTerms([offer()], want({ payTo: null })).passed, true, "the first check records the payee");
  assert.equal(steadyTerms([offer()], want({ priceAtomic: null })).passed, true, "a listing with no readable price is held to its payee only");
  assert.equal(steadyTerms([offer({ network: "eip155:8453" }), offer()], want()).passed, true, "another network's offer beside it does not matter");
});

test("a 402 that asks more, names another payee, or offers no USDC on the network has changed its terms", () => {
  const dearer = steadyTerms([offer({ amount: "500000" })], want());
  assert.deepEqual([dearer.passed, dearer.amount], [false, "500000"]);
  assert.match(dearer.detail, /more than the 220000 the listing publishes/);
  const moved = steadyTerms([offer({ payTo: `0x${"cd".repeat(20)}` })], want());
  assert.deepEqual([moved.passed, moved.payTo], [false, `0x${"cd".repeat(20)}`]);
  assert.match(moved.detail, /different payee/);
  for (const none of [[], [offer({ network: "eip155:8453" })], [offer({ scheme: "upto" })], [offer({ asset: "0x0000000000000000000000000000000000000001" })], [offer({ amount: "1.5" })], [offer({ payTo: "nobody" })]]) {
    assert.deepEqual([steadyTerms(none, want()).passed, steadyTerms(none, want()).payTo], [false, null]);
  }
});

const challenge = (accepts: unknown[]) => new Response("payment required", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ accepts })).toString("base64url") } });
const qa = (accepts: unknown[], enforceTerms: boolean | undefined, expected: unknown = want()) => createHttpAgonEndpointQaRunner(
  { [`${provider.listingReference}@${provider.listingVersion}`]: "https://provider.example/x402/analyze" },
  { fetch: async () => challenge(accepts), expected: async () => expected as never, ...(enforceTerms === undefined ? {} : { enforceTerms }) },
).run({ provider });

test("the endpoint check records the terms it saw, and fails on changed terms only when told to enforce them", async () => {
  const steady = await qa([offer()], true);
  assert.deepEqual([steady.passed, steady.evidence.checks.steady_terms?.passed, steady.evidence.checks.steady_terms?.payTo, steady.evidence.listingVersion], [true, true, PAYEE, "3"]);
  const changedEnforced = await qa([offer({ amount: "900000" })], true);
  assert.deepEqual([changedEnforced.passed, changedEnforced.evidence.checks.x402_payment.passed, changedEnforced.evidence.checks.steady_terms?.passed], [false, true, false]);
  const changedObserved = await qa([offer({ amount: "900000" })], undefined);
  assert.deepEqual([changedObserved.passed, changedObserved.evidence.checks.steady_terms?.passed], [true, false], "recorded, and the check still passes");
  // With no expected terms known, nothing is compared and the evidence carries no terms check.
  const plain = await qa([offer()], true, null);
  assert.deepEqual([plain.passed, "steady_terms" in plain.evidence.checks], [true, false]);
});
