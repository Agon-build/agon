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

test("final I1: a service whose address is not https, or names a private host, is left out", async () => {
  const good = page.items.find((i) => (i as { resource: string }).resource === "https://aero.lonestaroracle.xyz/pool")!;
  const items = ["http://aero.lonestaroracle.xyz/pool", "https://127.0.0.1/pool", "https://localhost/pool", "https://169.254.169.254/latest", "https://[::1]/x"].map((resource) => ({ ...(good as object), resource }));
  const source = createCircleSource({ fetchImpl: (async () => Response.json({ items, pagination: { limit: 200, offset: 0, total: items.length } })) as typeof fetch });
  await source.refresh();
  assert.deepEqual(source.entries(), []);
});
