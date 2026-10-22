import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";

import { blindPrompt, combineWithMarket, createEvidenceSearch, parseBlind, type EvidenceItem } from "../../src/agon/playground/seasons/evidence.ts";
import { DEFAULT_HOUSE_AGENTS, forecastSlate, type ModelCaller } from "../../src/agon/playground/seasons/house-agents.ts";
import type { RoundMarket } from "../../src/agon/playground/seasons/types.ts";

const NOW = new Date("2026-10-22T06:00:00Z");
const market = (n: number, baselineBps = 4100): RoundMarket => ({
  seasonId: 9002n, round: 1n, marketId: `0x${n.toString(16).padStart(64, "0")}` as Hex,
  question: "Will the Fed cut rates in December 2026?", slug: "fed-dec", endAt: new Date("2026-12-10T19:00:00Z"), baselineBps,
});
const beacon = DEFAULT_HOUSE_AGENTS.find((a) => a.key === "beacon")!;
const item = (n: number): EvidenceItem => ({ n, title: `Fed note ${n}`, url: `https://news.example/${n}`, published: "2026-10-20", text: "Officials signalled a hike, not a cut, in December." });

function exa(results: unknown[], seen: { body?: Record<string, unknown>; headers?: Headers } = {}) {
  return (async (_url: string, init?: RequestInit) => {
    seen.body = JSON.parse(String(init?.body));
    seen.headers = new Headers(init?.headers);
    return Response.json({ results });
  }) as unknown as typeof fetch;
}

test("evidence is recent news, numbered, and never from a prediction market or an article quoting its odds", async () => {
  const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
  const search = createEvidenceSearch({ apiKey: "k", fetchImpl: exa([
    { title: "Reuters poll: Fed seen hiking in December", url: "https://finance.yahoo.com/a", publishedDate: "2026-10-20T00:00:00.000Z", text: "Most economists expect a hike in December." },
    { title: "Fed December odds", url: "https://prediction.com/news/fed", publishedDate: "2026-10-18T00:00:00.000Z", text: "Odds are 30%." },
    { title: "Traders on Polymarket price a cut", url: "https://blog.example/x", publishedDate: "2026-10-18T00:00:00.000Z", text: "Polymarket gives 41% to a cut." },
    { title: "Kalshi market", url: "https://kalshi.com/markets/fed", publishedDate: "2026-10-18T00:00:00.000Z", text: "x" },
    { title: "", url: "https://empty.example", publishedDate: null, text: "" },
  ], seen) });
  const items = await search("Will the Fed cut rates in December 2026?", NOW);
  assert.deepEqual(items.map((i) => [i.n, i.url]), [[1, "https://finance.yahoo.com/a"]]);
  assert.equal(seen.headers!.get("x-api-key"), "k");
  assert.equal(seen.body!.category, "news");
  assert.equal(seen.body!.startPublishedDate, "2026-09-22T06:00:00.000Z", "the last 30 days");
});

test("a failed search gives no evidence instead of throwing", async () => {
  const down = createEvidenceSearch({ apiKey: "k", fetchImpl: (async () => new Response("no", { status: 500 })) as unknown as typeof fetch });
  assert.deepEqual(await down("q", NOW), []);
  const thrown = createEvidenceSearch({ apiKey: "k", fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
  assert.deepEqual(await thrown("q", NOW), []);
});

test("the blind prompt carries the question and evidence but never the market price", () => {
  const p = blindPrompt(market(1, 4100), NOW, [item(1), item(2)]);
  assert.match(p.userPrompt, /\[1\] Fed note 1/);
  assert.match(p.userPrompt, /Will the Fed cut rates/);
  assert.doesNotMatch(p.userPrompt + p.systemPrompt, /41(\.0)?%|crowd|market price/i);
});

test("a blind answer keeps only reasons that cite real evidence numbers", () => {
  const out = parseBlind('{"probability":0.2,"reasons":["[1] officials signal a hike","[7] made up","no citation"]}', 2);
  assert.deepEqual(out, { probabilityBps: 2000, reasons: ["[1] officials signal a hike"] });
  assert.equal(parseBlind("not json", 2), null);
});

test("code moves halfway from the market toward the blind forecast, and not at all without evidence", () => {
  assert.equal(combineWithMarket(2000, 4100, 3), 3050);
  assert.equal(combineWithMarket(2000, 4100, 0), 4100);
  assert.equal(combineWithMarket(9999, 9900, 2), 9900, "stays within 1% and 99%");
});

test("Beacon gathers evidence, forecasts blind, then moves halfway from the price, and says so", async () => {
  const prompts: string[] = [];
  const caller: ModelCaller = async (p) => { prompts.push(p.userPrompt); return { text: '{"probability":0.2,"reasons":["[1] officials signal a hike","[2] inflation sticky"]}' }; };
  const out = await forecastSlate(caller, beacon, [market(1, 4100)], NOW, undefined, async () => [item(1), item(2)]);
  assert.equal(out[0]!.probabilityBps, 3050);
  assert.ok(out[0]!.reasons.some((r) => r.includes("20.0%") && r.includes("41.0%")), out[0]!.reasons.join(" | "));
  assert.doesNotMatch(prompts[0]!, /41/);
});

test("with no evidence or no search, Beacon repeats the price and never calls the model", async () => {
  let calls = 0;
  const caller: ModelCaller = async () => { calls += 1; return { text: "{}" }; };
  const none = await forecastSlate(caller, beacon, [market(1, 4100)], NOW, undefined, async () => []);
  const unset = await forecastSlate(caller, beacon, [market(2, 6000)], NOW);
  assert.deepEqual([none[0]!.probabilityBps, unset[0]!.probabilityBps, calls], [4100, 6000, 0]);
  assert.match(none[0]!.reasons[0]!, /No recent evidence/);
});

test("an article that quotes a prediction market without naming it is left out", async () => {
  const search = createEvidenceSearch({ apiKey: "k", fetchImpl: exa([
    { title: "Election guide", url: "https://blic.example/a", publishedDate: "2026-10-04T00:00:00.000Z", text: "Najveća svetska platforma za predikcije daje Vučiću 69 odsto šansi da bude novi premijer, while polls differ." },
    { title: "Odds talk", url: "https://news.example/b", publishedDate: "2026-10-04T00:00:00.000Z", text: "The leading prediction market puts the chance at 69 percent according to traders this week." },
    { title: "Poll: Student List 44.4%", url: "https://news.example/c", publishedDate: "2026-10-14T00:00:00.000Z", text: "NSPM poll shows the Student List at 44.4% and United Serbia at 41.7% ahead of the vote." },
  ]) });
  assert.deepEqual((await search("q", NOW)).map((i) => i.url), ["https://news.example/c"]);
});
