import assert from "node:assert/strict";
import test from "node:test";

import { createLiveness } from "../../src/agon/routing/alive.ts";
import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "circle", reference: "circle:a", name: "A", provider: "P", category: "INFERENCE", description: "",
  url: "https://a.example/run", method: "POST", inputSchema: null, price: 1_000n, payTo: null, network: "arc",
  rating: { tier: "unrated", score: null }, latencyMs: null, tags: [], ...over,
});

// 2026-11-10: Agon calls a service unpaid before offering it. Any answer below 500 means it is up:
// a paid service answers 402 to an unpaid call.
test("a service that answers, even to ask for payment, is up; an error or no answer is not", async () => {
  for (const [status, up] of [[402, true], [200, true], [400, true], [404, true], [500, false], [503, false]] as const) {
    const alive = createLiveness({ fetchImpl: async () => new Response("{}", { status }), safe: async () => true });
    assert.equal(await alive(entry({})), up, `status ${status}`);
  }
  const dead = createLiveness({ fetchImpl: async () => { throw new Error("fetch failed"); }, safe: async () => true });
  assert.equal(await dead(entry({})), false);
});

test("the unpaid call uses the service's own method and never follows a redirect", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const alive = createLiveness({ fetchImpl: async (url, init) => { seen.push({ url: String(url), init: init! }); return new Response("{}", { status: 402 }); }, safe: async () => true });
  await alive(entry({}));
  await alive(entry({ reference: "circle:g", url: "https://g.example/price", method: "GET" }));
  assert.deepEqual(seen.map((s) => [s.url, s.init.method, s.init.redirect, s.init.body ?? null]), [["https://a.example/run", "POST", "manual", "{}"], ["https://g.example/price", "GET", "manual", null]]);
});

test("one answer is kept for a minute, so a busy Hire does not call a service again and again", async () => {
  let calls = 0;
  let t = 0;
  const alive = createLiveness({ fetchImpl: async () => { calls += 1; return new Response("{}", { status: 402 }); }, safe: async () => true, now: () => t });
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
  assert.equal(await createLiveness({ fetchImpl, safe: async () => true })(entry({ url: "https://a.example/items/{id}" })), true, "an address with an input in it");
  assert.equal(await createLiveness({ fetchImpl, safe: async () => true })(entry({ price: 0n })), true, "a free call may act without payment");
  assert.equal(await createLiveness({ fetchImpl, safe: async () => false })(entry({})), true, "a private address is refused at the quote, not here");
  assert.equal(calls, 0);
});
