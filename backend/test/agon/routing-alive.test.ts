import assert from "node:assert/strict";
import test from "node:test";
import { encodePaymentRequiredHeader } from "@x402/core/http";

import { agonNetwork } from "../../src/agon/network.ts";
import { createLiveness } from "../../src/agon/routing/alive.ts";
import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";

const arc = agonNetwork("arc");
const PAY_TO = `0x${"c1".repeat(20)}` as const;
const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "circle", reference: "circle:a", name: "A", provider: "P", category: "INFERENCE", description: "",
  url: "https://a.example/run", method: "POST", inputSchema: null, price: 1_000n, payTo: PAY_TO, network: "arc",
  rating: { tier: "unrated", score: null }, latencyMs: null, tags: [], ...over,
});

/// A 402 as a paid service sends it: the terms in the PAYMENT-REQUIRED header.
function asks(over: Record<string, unknown> = {}, url = "https://a.example/run"): Response {
  const offer = { scheme: "exact", network: arc.caip2, asset: arc.usdc, payTo: PAY_TO, amount: "1000", maxTimeoutSeconds: 300, extra: { name: "USDC", version: "2" }, ...over };
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader({ x402Version: 2, resource: { url, description: "r", mimeType: "application/json" }, accepts: [offer] } as never) } });
}
const answering = (res: () => Response) => createLiveness({ fetchImpl: async () => res(), safe: async () => true });

// Owner decision 2026-11-11: an outside service is up only when it asks for a payment Agon can
// make, to the payee and at the price the catalogue shows. Before, any answer below 500 passed,
// so a dead address answering 404 was offered.
test("an outside service is up only when it asks for a payment Agon can make", async () => {
  assert.equal(await answering(() => asks())(entry({})), true, "a well-formed 402");
  assert.equal(await answering(() => asks({ amount: "900" }))(entry({})), true, "cheaper than the catalogue shows");
  for (const status of [200, 400, 401, 404, 500, 503]) {
    assert.equal(await answering(() => new Response("{}", { status }))(entry({})), false, `status ${status}`);
  }
  assert.equal(await answering(() => new Response("{}", { status: 402 }))(entry({})), false, "a 402 with no terms");
  assert.equal(await answering(() => asks({ amount: "1500" }))(entry({})), false, "dearer than the catalogue shows");
  assert.equal(await answering(() => asks({ payTo: `0x${"d2".repeat(20)}` }))(entry({})), false, "another payee");
  assert.equal(await answering(() => asks({ extra: { name: "GatewayWalletBatched", version: "1" } }))(entry({})), false, "only a batched Gateway payment, which Agon cannot make");
  assert.equal(await answering(() => asks({ network: "eip155:8453" }))(entry({})), false, "only another network");
  const dead = createLiveness({ fetchImpl: async () => { throw new Error("fetch failed"); }, safe: async () => true });
  assert.equal(await dead(entry({})), false);
  assert.equal(await answering(() => asks())(entry({ payTo: null })), true, "no payee in the catalogue to compare");
});

// Agon's own agents refuse an empty request with 400 before they ask for payment.
test("an Agon listing is up when it answers below 500", async () => {
  const own = (status: number) => answering(() => new Response("{}", { status }))(entry({ source: "agon", reference: `agon:${status}`, network: "arc-testnet", payTo: null }));
  for (const [status, up] of [[402, true], [400, true], [422, true], [500, false], [503, false]] as const) assert.equal(await own(status), up, `status ${status}`);
});

test("the unpaid call uses the service's own method and never follows a redirect", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const alive = createLiveness({ fetchImpl: async (url, init) => { seen.push({ url: String(url), init: init! }); return asks(); }, safe: async () => true });
  await alive(entry({}));
  await alive(entry({ reference: "circle:g", url: "https://g.example/price", method: "GET" }));
  assert.deepEqual(seen.map((s) => [s.url, s.init.method, s.init.redirect, s.init.body ?? null]), [["https://a.example/run", "POST", "manual", "{}"], ["https://g.example/price", "GET", "manual", null]]);
});

test("one answer is kept for a minute, so a busy Hire does not call a service again and again", async () => {
  let calls = 0;
  let t = 0;
  const alive = createLiveness({ fetchImpl: async () => { calls += 1; return asks(); }, safe: async () => true, now: () => t });
  await alive(entry({}));
  t = 59_000;
  await alive(entry({}));
  assert.equal(calls, 1);
  t = 61_000;
  await alive(entry({}));
  assert.equal(calls, 2);
});

test("a service Agon cannot call safely unpaid is not called, and is not marked down for it", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  assert.equal(await createLiveness({ fetchImpl, safe: async () => true })(entry({ url: "https://a.example/items/{id}" })), true, "an address with an input in it is checked at the quote, with the input filled");
  assert.equal(await createLiveness({ fetchImpl, safe: async () => true })(entry({ price: 0n })), true, "a free call may act without payment");
  assert.equal(await createLiveness({ fetchImpl, safe: async () => false })(entry({})), true, "a private address is refused at the quote, not here");
  assert.equal(calls, 0);
});
