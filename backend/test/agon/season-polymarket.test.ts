import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { createGammaClient, parseGammaMarket, selectSlate, type PolymarketMarket } from "../../src/agon/playground/seasons/polymarket.ts";
import { CATEGORY_QUERY_TAGS, categoryFor } from "../../src/agon/playground/seasons/categories.ts";

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

const NOW = new Date("2026-10-20T00:00:00Z");
const TAGS = { sports: ["sports"], crypto: ["crypto"], economics: ["economy"], politics: ["politics"], world: ["geopolitics"], culture: ["pop-culture"] };

test("slate filters by window, price band, liquidity and status", () => {
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
  assert.deepEqual(selectSlate(pool, NOW).map((m) => m.question).sort(), ["q1", "q2", "q3"]);
});

test("slate takes the two most liquid markets of each category", () => {
  let n = 0;
  const pool = Object.values(TAGS).flatMap((tags) => [1, 2, 3].map((k) => candidate(++n, { tags, liquidity: 10_000 * k })));
  const slate = selectSlate(pool, NOW);
  assert.equal(slate.length, 12);
  for (const tags of Object.values(TAGS)) {
    const picked = slate.filter((m) => m.tags[0] === tags[0]).map((m) => m.liquidity).sort((a, b) => b - a);
    assert.deepEqual(picked, [30_000, 20_000], tags[0]);
  }
});

test("short categories are filled from the most liquid remaining markets, Other included", () => {
  // No economics or world markets at all; crypto has four; 13 eligible in total.
  const pool = [
    ...[1, 2, 3, 4].map((k) => candidate(k, { tags: ["crypto"], liquidity: 100_000 - k })),
    candidate(5, { tags: ["politics"] }), candidate(6, { tags: ["politics"] }),
    candidate(7, { tags: ["sports"] }), candidate(8, { tags: ["sports"] }),
    candidate(9, { tags: ["pop-culture"] }), candidate(10, { tags: ["pop-culture"] }),
    candidate(11, { liquidity: 99_000 }), candidate(12, { liquidity: 5_500 }), candidate(13, { liquidity: 5_100 }),
  ];
  const slate = selectSlate(pool, NOW);
  assert.equal(slate.length, 12);
  assert.equal(slate.filter((m) => categoryFor(m.tags) === "economics").length, 0);
  assert.ok(!slate.some((m) => m.question === "q13"), "the least liquid surplus market is left out");
  assert.ok(["q3", "q4", "q11", "q12"].every((q) => slate.some((m) => m.question === q)), "refill takes the most liquid rest");
});

test("slate output is deterministic: sorted by end time, then condition id", () => {
  const now = new Date("2026-10-20T00:00:00Z");
  const pool = [candidate(2, { endAt: new Date("2026-10-22T00:00:00Z") }), candidate(1, { endAt: new Date("2026-10-22T00:00:00Z") }), candidate(3, { endAt: new Date("2026-10-21T00:00:00Z") })];
  assert.deepEqual(selectSlate(pool, now).map((m) => m.question), ["q3", "q1", "q2"]);
});

test("gamma client asks for each category's events plus the most liquid markets, keeps event tags and dedupes", async () => {
  const urls: string[] = [];
  const queryTags = Object.values(CATEGORY_QUERY_TAGS);
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    if (url.includes("/events")) {
      const tag = new URL(url).searchParams.get("tag_slug")!;
      return new Response(JSON.stringify([{ tags: [{ slug: tag }], markets: [gamma({ conditionId: cid(queryTags.indexOf(tag) + 1) })] }]));
    }
    return new Response(JSON.stringify([gamma({ conditionId: cid(1) }), gamma({ conditionId: cid(50) })]));
  }) as typeof fetch;
  const client = createGammaClient({ fetchImpl, baseUrl: "https://gamma.test" });
  const markets = await client.listCandidates(NOW);
  const eventUrls = urls.filter((u) => u.startsWith("https://gamma.test/events?"));
  assert.deepEqual(eventUrls.map((u) => new URL(u).searchParams.get("tag_slug")).sort(), [...queryTags].sort());
  assert.ok(eventUrls.every((u) => u.includes("order=liquidity") && u.includes("end_date_min=2026-10-20T06%3A00%3A00.000Z")));
  assert.equal(markets.length, 7, "six event markets plus one market-only result; the duplicate keeps its event tags");
  assert.deepEqual(markets.find((m) => m.conditionId === cid(1))!.tags, [queryTags[0]]);
  assert.deepEqual(markets.find((m) => m.conditionId === cid(50))!.tags, []);
  await client.getMarkets([cid(3) as `0x${string}`]);
  assert.ok(urls.at(-1)!.includes(`condition_ids=${cid(3)}`));
  // 2026-10-20: Gamma leaves closed markets out unless asked, so no Season 9001 market ever resolved.
  assert.equal(new URL(urls.at(-1)!).searchParams.get("closed"), "true", "results ask for closed markets");
});

test("one failed Gamma request does not lose the others; every request failing throws", async () => {
  const lines: string[] = [];
  const partly = (async (url: string) =>
    url.includes("tag_slug=politics") ? new Response("down", { status: 503 }) : new Response(JSON.stringify(url.includes("/events") ? [] : [gamma({ conditionId: cid(9) })]))) as typeof fetch;
  const markets = await createGammaClient({ fetchImpl: partly, baseUrl: "https://gamma.test", log: (m) => lines.push(m) }).listCandidates(NOW);
  assert.deepEqual(markets.map((m) => m.conditionId), [cid(9)]);
  assert.match(lines[0]!, /gamma \/events 503/);
  const down = (async () => new Response("down", { status: 503 })) as typeof fetch;
  await assert.rejects(createGammaClient({ fetchImpl: down, baseUrl: "https://gamma.test", log: () => {} }).listCandidates(NOW), /gamma/);
});

test("live sample captured from Gamma parses", async () => {
  const sample = JSON.parse(await readFile(new URL("./fixtures/polymarket-live-sample.json", import.meta.url), "utf8")) as unknown[];
  const parsed = sample.map((m) => parseGammaMarket(m)).filter(Boolean);
  assert.ok(parsed.length >= 1, "at least one live market must parse");
});
