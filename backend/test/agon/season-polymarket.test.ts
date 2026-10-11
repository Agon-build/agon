import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createGammaClient, parseGammaMarket, selectSlate, type PolymarketMarket } from "../../src/agon/playground/seasons/polymarket.ts";

const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
// Field shapes copied from live Gamma responses on 2026-10-11: outcomes and
// outcomePrices are JSON strings; umaResolutionStatus can be absent.
function gamma(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: cid(1),
    question: "Will Bitcoin reach $84,000 October 12-18?",
    slug: "will-bitcoin-reach-84k-october-12-18",
    endDate: "2026-10-19T04:00:00Z",
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.3", "0.7"]',
    liquidityNum: 32492.1,
    closed: false,
    ...overrides,
  };
}

test("parses an open binary market", () => {
  const m = parseGammaMarket(gamma(), ["crypto", "crypto-prices"])!;
  assert.equal(m.conditionId, cid(1));
  assert.equal(m.yesPriceBps, 3000);
  assert.equal(m.resolution, "pending");
  assert.equal(m.endAt.toISOString(), "2026-10-19T04:00:00.000Z");
  assert.deepEqual(m.tags, ["crypto", "crypto-prices"]);
});

test("refuses non-binary or malformed markets", () => {
  assert.equal(parseGammaMarket(gamma({ outcomes: '["Up", "Down", "Flat"]', outcomePrices: '["0.3","0.3","0.4"]' })), null);
  assert.equal(parseGammaMarket(gamma({ outcomes: '["Over", "Under"]' })), null);
  assert.equal(parseGammaMarket(gamma({ conditionId: "0x1234" })), null);
  assert.equal(parseGammaMarket(gamma({ outcomePrices: "not json" })), null);
  assert.equal(parseGammaMarket({}), null);
});

test("only umaResolutionStatus resolved is final", () => {
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["1", "0"]' }))!.resolution, "yes");
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0", "1"]' }))!.resolution, "no");
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0.5", "0.5"]' }))!.resolution, "void");
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "proposed", outcomePrices: '["1", "0"]' }))!.resolution, "pending");
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "disputed", outcomePrices: '["1", "0"]' }))!.resolution, "pending");
  assert.equal(parseGammaMarket(gamma({ closed: false, umaResolutionStatus: "resolved", outcomePrices: '["1", "0"]' }))!.resolution, "pending");
  // A lagging read right at resolution must stay pending, never become a permanent void.
  assert.equal(parseGammaMarket(gamma({ closed: true, umaResolutionStatus: "resolved", outcomePrices: '["0.9995", "0.0005"]' }))!.resolution, "pending");
});

function candidate(n: number, overrides: Partial<PolymarketMarket> = {}): PolymarketMarket {
  return {
    conditionId: cid(n) as `0x${string}`,
    question: `q${n}`,
    slug: `q${n}`,
    endAt: new Date("2026-10-21T12:00:00Z"),
    yesPriceBps: 4000,
    liquidity: 10_000 + n,
    closed: false,
    resolution: "pending",
    tags: [],
    ...overrides,
  };
}

test("slate filters by window, price band and liquidity, then prefers crypto", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const pool = [
    candidate(1, { tags: ["crypto-prices"], liquidity: 50_000 }),
    candidate(2, { tags: ["crypto"], liquidity: 40_000 }),
    candidate(3, { liquidity: 90_000 }),
    candidate(4, { endAt: new Date("2026-10-20T05:00:00Z") }), // ends too soon
    candidate(5, { endAt: new Date("2026-10-28T00:00:00Z") }), // ends too late
    candidate(6, { yesPriceBps: 300 }), // trivial
    candidate(7, { yesPriceBps: 9600 }), // trivial
    candidate(8, { liquidity: 4_000 }), // thin
    candidate(9, { closed: true }),
  ];
  const slate = selectSlate(pool, now, { size: 3, cryptoMax: 2, minLiquidity: 5_000 });
  assert.deepEqual(slate.map((m) => m.question).sort(), ["q1", "q2", "q3"]);
});

test("slate respects cryptoMax and fills the rest by liquidity", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const pool = [1, 2, 3, 4].map((n) => candidate(n, { tags: ["crypto"], liquidity: 100_000 - n })).concat([candidate(5, { liquidity: 6_000 })]);
  const slate = selectSlate(pool, now, { size: 3, cryptoMax: 2, minLiquidity: 5_000 });
  assert.equal(slate.filter((m) => m.tags.includes("crypto")).length, 2);
  assert.ok(slate.some((m) => m.question === "q5"));
});

test("slate output is deterministic: sorted by end time, then condition id", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const pool = [candidate(2, { endAt: new Date("2026-10-22T00:00:00Z") }), candidate(1, { endAt: new Date("2026-10-22T00:00:00Z") }), candidate(3, { endAt: new Date("2026-10-21T00:00:00Z") })];
  assert.deepEqual(selectSlate(pool, now).map((m) => m.question), ["q3", "q1", "q2"]);
});

test("gamma client builds the expected requests and dedupes markets", async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.includes("/events")) {
      return new Response(JSON.stringify([{ tags: [{ slug: "crypto" }], markets: [gamma({ conditionId: cid(1) })] }]));
    }
    return new Response(JSON.stringify([gamma({ conditionId: cid(1) }), gamma({ conditionId: cid(2) })]));
  }) as typeof fetch;
  const client = createGammaClient({ fetchImpl, baseUrl: "https://gamma.test" });
  const markets = await client.listCandidates(new Date("2026-10-20T00:00:00Z"));
  assert.deepEqual(markets.map((m) => m.conditionId).sort(), [cid(1), cid(2)]);
  assert.ok(markets.find((m) => m.conditionId === cid(1))!.tags.includes("crypto"));
  assert.ok(urls[0]!.startsWith("https://gamma.test/events?"));
  assert.ok(urls[0]!.includes("tag_slug=crypto"));
  assert.ok(urls[0]!.includes("end_date_min=2026-10-20T06%3A00%3A00.000Z"));
  await client.getMarkets([cid(3) as `0x${string}`]);
  assert.ok(urls.at(-1)!.includes(`condition_ids=${cid(3)}`));
});

test("live sample captured from Gamma parses", async () => {
  const sample = JSON.parse(await readFile(new URL("./fixtures/polymarket-live-sample.json", import.meta.url), "utf8")) as unknown[];
  const parsed = sample.map((m) => parseGammaMarket(m)).filter(Boolean);
  assert.ok(parsed.length >= 1, "at least one live market must parse");
});
