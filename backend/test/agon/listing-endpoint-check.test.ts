import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEndpoint, priceAtomic, runListingChecks, type ListingCheckDeps } from "../../src/agon/listing/endpoint-check.ts";

const PAY_TO = `0x${"a".repeat(40)}` as const;
const deps = (over: Partial<ListingCheckDeps> = {}): ListingCheckDeps => ({
  assertPublic: async (u) => new URL(u),
  peek: async () => ({ ok: true, option: { amount: 220_000n, payTo: PAY_TO, maxTimeoutSeconds: 60, raw: {} } }),
  certify: async () => ({ passed: true, score: 100 }),
  ...over,
});
const run = (d: ListingCheckDeps, priceUSDC = "0.22", category = "3") => runListingChecks({ endpoint: "https://agent.example/run", priceUSDC, category, deps: d, now: () => new Date("2026-10-16T12:00:00Z") });
const status = (r: Awaited<ReturnType<typeof run>>) => Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
const detail = (r: Awaited<ReturnType<typeof run>>, name: string) => r.checks.find((c) => c.name === name)!.detail;

test("a payable endpoint at the listed price passes every required check, with a certification score", async () => {
  const r = await run(deps());
  assert.deepEqual(status(r), { secure_endpoint: "passed", asks_for_payment: "passed", price_matches: "passed", certification: "passed" });
  assert.equal(r.requiredPassed, true);
  assert.equal(r.certificationScore, 100);
  assert.equal(r.checkedAt, "2026-10-16T12:00:00.000Z");
  assert.deepEqual(r.checks.filter((c) => c.required).map((c) => c.name), ["secure_endpoint", "asks_for_payment", "price_matches"]);
});

test("the unpaid test call is the Agon preflight body, sent without following redirects", async () => {
  let seen: RequestInit | null = null;
  await run(deps({ peek: async (_u, init) => { seen = init; return { ok: true, option: { amount: 220_000n, payTo: PAY_TO, maxTimeoutSeconds: 60, raw: {} } }; } }));
  assert.ok(seen);
  const init = seen as RequestInit;
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "error");
  assert.deepEqual(JSON.parse(String(init.body)), { protocol: "agon-x402-preflight/1", category: "analysis", input: { probe: "payment-challenge", writes: false } });
});

test("each failure says what to fix", async () => {
  const blocked = await run(deps({ assertPublic: async () => { throw new Error("private"); } }));
  assert.equal(status(blocked).secure_endpoint, "failed");
  assert.equal(status(blocked).asks_for_payment, "skipped", "no call to a blocked address");
  assert.equal(status(blocked).certification, "skipped");
  assert.equal(blocked.requiredPassed, false);

  const free = await run(deps({ peek: async () => ({ ok: true, free: true, status: 200, data: {} }) }));
  assert.match(detail(free, "asks_for_payment"), /answered without asking for payment/i);
  assert.equal(status(free).price_matches, "skipped");

  const http400 = await run(deps({ peek: async () => ({ ok: false, code: "unexpected_status", detail: "HTTP 400" }) }));
  assert.match(detail(http400, "asks_for_payment"), /must answer 402/i);

  const wrongNet = await run(deps({ peek: async () => ({ ok: false, code: "no_matching_option", detail: "no exact USDC option" }) }));
  assert.match(detail(wrongNet, "asks_for_payment"), /USDC on Arc/);

  const price = await run(deps(), "0.30");
  assert.equal(status(price).price_matches, "failed");
  assert.match(detail(price, "price_matches"), /0\.22 USDC.*0\.30 USDC/);
  assert.equal(price.requiredPassed, false);

  const timeout = await run(deps({ peek: async () => ({ ok: false, code: "network_error", detail: "timeout" }) }));
  assert.equal(status(timeout).asks_for_payment, "failed");
  assert.match(detail(timeout, "asks_for_payment"), /15 seconds|redirect/);
});

test("certification is shown but never required, and only Analysis can be certified today", async () => {
  const failing = await run(deps({ certify: async () => ({ passed: false, score: 40 }) }));
  assert.equal(status(failing).certification, "failed");
  assert.equal(failing.requiredPassed, true);
  assert.equal(failing.certificationScore, 40);
  const thrown = await run(deps({ certify: async () => { throw new Error("down"); } }));
  assert.equal(status(thrown).certification, "failed");
  assert.equal(thrown.certificationScore, null);
  const other = await run(deps({ certify: async () => { throw new Error("should not be called"); } }), "0.22", "1");
  assert.equal(status(other).certification, "skipped");
  assert.match(detail(other, "certification"), /Analysis/);
});

test("endpoints and prices compare the same way however they are written", () => {
  assert.equal(normalizeEndpoint("https://Agent.Example/run/"), normalizeEndpoint("https://agent.example/run"));
  assert.equal(normalizeEndpoint("https://agent.example/run#x"), normalizeEndpoint("https://agent.example/run"));
  assert.notEqual(normalizeEndpoint("https://agent.example/run"), normalizeEndpoint("https://agent.example/other"));
  assert.notEqual(normalizeEndpoint("https://agent.example/run?a=1"), normalizeEndpoint("https://agent.example/run"));
  assert.equal(priceAtomic("0.2"), priceAtomic("0.20"));
  assert.equal(priceAtomic("0.22"), 220_000n);
  assert.equal(priceAtomic("12"), 12_000_000n);
});

test("the probe never reads more than 64 KiB of an endpoint's answer", async () => {
  const { cappedFetch } = await import("../../src/agon/listing/endpoint-check.ts");
  const big = new Uint8Array(200 * 1024).fill(97);
  const huge = cappedFetch(async () => new Response(big, { status: 402, headers: { "x-test": "1" } }), 64 * 1024);
  await assert.rejects(async () => (await huge("https://x")).text(), /too large/);
  const small = cappedFetch(async () => new Response("{\"ok\":true}", { status: 402, headers: { "PAYMENT-REQUIRED": "abc" } }), 64 * 1024);
  const res = await small("https://x");
  assert.equal(res.status, 402);
  assert.equal(res.headers.get("PAYMENT-REQUIRED"), "abc");
  assert.deepEqual(await res.json(), { ok: true });
});

test("task calls wait long enough for a reasoning model, while the unpaid probe stays quick", async () => {
  const { CERTIFY_TIMEOUT_MS, CHECK_TIMEOUT_MS } = await import("../../src/agon/listing/endpoint-check.ts");
  // Kestrel (Grok 4.7) took 14 to 16 s of model time and 21 s end to end on 17 Oct 2026.
  assert.equal(CHECK_TIMEOUT_MS, 15_000);
  assert.ok(CERTIFY_TIMEOUT_MS >= 45_000, `certification waits ${CERTIFY_TIMEOUT_MS} ms`);
});
