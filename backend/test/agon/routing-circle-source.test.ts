import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createCircleSource } from "../../src/agon/routing/circle-source.ts";

const page = JSON.parse(readFileSync(new URL("./fixtures/circle-discovery-page.json", import.meta.url), "utf8")) as { items: unknown[] };
const okFetch = (async () => Response.json({ ...page, pagination: { limit: 200, offset: 0, total: page.items.length } })) as typeof fetch;
const query = (words: string[], circleCategories: string[] = []) => ({ words, agonCategories: [], circleCategories });

test("fixtures normalise to catalog entries with method, schema, price and payTo; Gateway-only services are left out", async () => {
  const source = createCircleSource({ fetchImpl: okFetch });
  await source.refresh();
  const all = source.entries();
  assert.equal(all.length, 4, "only services payable with plain x402 on Arc mainnet");
  const pool = all.find((e) => e.url === "https://aero.lonestaroracle.xyz/pool")!;
  assert.deepEqual([pool.source, pool.method, pool.network, pool.price, pool.category, pool.provider], ["circle", "GET", "arc", 50_000n, "FINANCIAL_ANALYSIS", "LoneStarOracle"]);
  assert.equal(pool.rating.tier, "unrated");
  assert.ok(pool.inputSchema && "properties" in pool.inputSchema);
  assert.equal(source.status(), "ok");
});

test("an item whose first option is another network uses its Arc option", async () => {
  const source = createCircleSource({ fetchImpl: okFetch });
  await source.refresh();
  const pool = source.entries().find((e) => e.url === "https://aero.lonestaroracle.xyz/pool")!;
  assert.equal(pool.payTo, "0xef2a4b6756895aaf1374640dcfcd4947959442ab", "the Arc mainnet payTo, not the Base one listed first");
});

test("search matches query words against name, description and provider, within the asked categories", async () => {
  const source = createCircleSource({ fetchImpl: okFetch });
  await source.refresh();
  const ratings = await source.search(query(["analyst", "ratings"], ["FINANCIAL_ANALYSIS"]));
  assert.equal(ratings[0]!.url, "https://analyst.lonestaroracle.xyz/ratings");
  assert.deepEqual(await source.search(query(["analyst"], ["CREATIVE"])), []);
});

test("a failed refresh keeps the last copy and reports unavailable", async () => {
  let fail = false;
  const source = createCircleSource({ fetchImpl: (async (...a: Parameters<typeof fetch>) => (fail ? new Response("down", { status: 503 }) : okFetch(...a))) as typeof fetch });
  await source.refresh();
  fail = true;
  await source.refresh();
  assert.equal(source.entries().length, 4);
  assert.equal(source.status(), "unavailable");
  const empty = createCircleSource({ fetchImpl: (async () => new Response("down", { status: 503 })) as typeof fetch });
  await empty.refresh();
  assert.deepEqual(await empty.search(query(["analyst"], ["FINANCIAL_ANALYSIS"])), []);
  assert.equal(empty.status(), "unavailable");
});

// Two pages of the same fixture items; `status(offset, call)` can turn a call into a 429.
function pagedFetch(status: (offset: number, call: number) => { code: number; retryAfter?: string } = () => ({ code: 200 })) {
  const calls: number[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    calls.push(offset);
    const s = status(offset, calls.length);
    if (s.code !== 200) return new Response("slow down", { status: s.code, headers: s.retryAfter ? { "retry-after": s.retryAfter } : {} });
    return Response.json({ ...page, pagination: { limit: 200, offset, total: 400 } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test("the refresh spaces out its page requests, since Circle answers 429 to a burst", async () => {
  const waits: number[] = [];
  const { calls, fetchImpl } = pagedFetch();
  const source = createCircleSource({ fetchImpl, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  await source.refresh();
  assert.deepEqual(calls, [0, 200]);
  assert.deepEqual(waits, [1_500], "one pause between the two pages");
  assert.equal(source.entries().length, 8);
  assert.equal(source.status(), "ok");
});

test("a 429 waits as long as Circle asks (Retry-After) and retries the same page", async () => {
  const waits: number[] = [];
  const { calls, fetchImpl } = pagedFetch((offset, call) => (offset === 200 && call === 2 ? { code: 429, retryAfter: "7" } : { code: 200 }));
  const source = createCircleSource({ fetchImpl, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  await source.refresh();
  assert.deepEqual(calls, [0, 200, 200]);
  assert.deepEqual(waits, [1_500, 7_000]);
  assert.equal(source.entries().length, 8);
  assert.equal(source.status(), "ok");
});

test("a 429 without Retry-After backs off, and a long Retry-After is capped", async () => {
  const waits: number[] = [];
  const { fetchImpl } = pagedFetch((offset, call) => (offset === 200 && call === 2 ? { code: 429 } : offset === 200 && call === 3 ? { code: 429, retryAfter: "3600" } : { code: 200 }));
  const source = createCircleSource({ fetchImpl, sleep: async (ms) => { waits.push(ms); }, log: () => {} });
  await source.refresh();
  assert.deepEqual(waits, [1_500, 5_000, 60_000]);
  assert.equal(source.status(), "ok");
});

test("a 429 that does not clear gives up, keeps the last catalog and logs why", async () => {
  const lines: string[] = [];
  let limited = false;
  const { fetchImpl } = pagedFetch((offset) => (limited && offset === 200 ? { code: 429 } : { code: 200 }));
  const source = createCircleSource({ fetchImpl, sleep: async () => {}, log: (line) => lines.push(line) });
  await source.refresh();
  limited = true;
  await source.refresh();
  assert.equal(source.entries().length, 8, "the last good catalog stays");
  assert.equal(source.status(), "unavailable");
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /Circle catalog refresh failed: page 2 HTTP 429/);
});

test("a refresh asked for while one is running shares it instead of starting another", async () => {
  const { calls, fetchImpl } = pagedFetch();
  const source = createCircleSource({ fetchImpl, sleep: async () => {}, log: () => {} });
  await Promise.all([source.refresh(), source.refresh()]);
  assert.deepEqual(calls, [0, 200]);
  await source.refresh();
  assert.deepEqual(calls, [0, 200, 0, 200], "a later refresh runs again");
});

test("final I1: a service whose address is not https, or names a private host, is left out", async () => {
  const good = page.items.find((i) => (i as { resource: string }).resource === "https://aero.lonestaroracle.xyz/pool")!;
  const items = ["http://aero.lonestaroracle.xyz/pool", "https://127.0.0.1/pool", "https://localhost/pool", "https://169.254.169.254/latest", "https://[::1]/x"].map((resource) => ({ ...(good as object), resource }));
  const source = createCircleSource({ fetchImpl: (async () => Response.json({ items, pagination: { limit: 200, offset: 0, total: items.length } })) as typeof fetch });
  await source.refresh();
  assert.deepEqual(source.entries(), []);
});
