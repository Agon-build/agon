import assert from "node:assert/strict";
import test from "node:test";

import { matchCount, type CatalogEntry } from "../../src/agon/routing/catalog.ts";
import { judgeFit, shortlist } from "../../src/agon/routing/fit.ts";
import type { Intent } from "../../src/agon/routing/intent.ts";

const entry = (over: Partial<CatalogEntry>): CatalogEntry => ({
  source: "circle", reference: "circle:x", name: "x", provider: "BlockRun.AI", category: "CREATIVE", description: "", url: "https://arc.example/api/v1/x",
  method: "POST", inputSchema: null, price: 10_000n, payTo: null, network: "arc", rating: { tier: "unrated", score: null }, latencyMs: null, tags: [], ...over,
});
const images = entry({ reference: "circle:images", description: "Generate images with GPT Image 1, Nano Banana, or Grok Imagine.", url: "https://arc.blockrun.ai/api/v1/images/generations" });
const prices = entry({ reference: "circle:prices", category: "FINANCIAL_ANALYSIS", description: "Token price lookup. Pass coin identifiers such as coingecko:bitcoin or ethereum.", url: "https://arc.blockrun.ai/api/v1/defillama/prices/{coins}" });
const ratings = entry({ reference: "circle:ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS", description: "Analyst ratings and price target upgrades/downgrades", url: "https://analyst.lonestaroracle.xyz/ratings" });
const rpc = entry({ reference: "circle:rpc", provider: "Quicknode", category: "INFRASTRUCTURE", description: "Ethereum JSON-RPC eth_getBalance", url: "https://quicknode.example/eth" });

test("word forms and common short names match: image generation, generate images, ETH and Ethereum", () => {
  assert.equal(matchCount(images, ["image", "generation"]), 2);
  assert.equal(matchCount(images, ["logo", "picture"]), 1, "a picture is an image");
  assert.equal(matchCount(prices, ["eth", "price"]), 2);
});

test("the shortlist searches every category, the fitting category first among equal matches", () => {
  const research: Intent = { kind: "research", query: "AAPL analyst ratings", values: {} };
  const out = shortlist([images, ratings, prices, rpc], research, "Give me analyst ratings for AAPL");
  assert.equal(out[0]!.reference, "circle:ratings", "found although analyst ratings sit under FINANCIAL_ANALYSIS, not research");
  assert.ok(!out.some((e) => e.reference === "circle:images"), "a service sharing no word is left out");
  const price: Intent = { kind: "market_data", query: "ETH current price", values: {} };
  assert.equal(shortlist([rpc, prices], price, "What is the current price of ETH?")[0]!.reference, "circle:prices");
});

test("the model names the services that do the job; code keeps only shortlisted ones, in its order", async () => {
  const list = [ratings, prices, images];
  const reply = (text: string) => async () => ({ text });
  assert.deepEqual(await judgeFit("Give me analyst ratings for AAPL", list, reply('{"fits":[1]}'), "m"), ["circle:ratings"]);
  assert.deepEqual(await judgeFit("x", list, reply('Sure: {"fits":[3, 9, 1, 3]}'), "m"), ["circle:images", "circle:ratings"], "unknown and repeated numbers are dropped");
  assert.deepEqual(await judgeFit("Find the CEO of Stripe's email", list, reply('{"fits":[]}'), "m"), [], "none is an answer");
  assert.equal(await judgeFit("x", list, reply("no idea"), "m"), null, "an unreadable answer leaves the choice to the word scores");
  assert.equal(await judgeFit("x", list, async () => { throw new Error("down"); }, "m"), null);
  assert.deepEqual(await judgeFit("x", [], reply('{"fits":[1]}'), "m"), [], "an empty shortlist is never sent to the model");
});
