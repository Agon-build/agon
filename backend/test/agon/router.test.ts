import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { houseKeyFor, rankForecasters } from "../../src/agon/router/forecasters.ts";
import { coinIdsForQuestion, dataServicesFor } from "../../src/agon/router/data-services.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import type { LeaderboardRow } from "../../src/agon/playground/seasons/scoring.ts";
import type { SeasonEntry } from "../../src/agon/playground/seasons/types.ts";

const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const row = (a: Address, name: string, house: boolean, rating: number, ranked: boolean, rank: number | null, n: number, skill = rating): LeaderboardRow => ({
  agentAddress: a, displayName: name, house, slateResolved: n, forecastsResolved: n, meanSkill: skill, meanBrier: 0.2, rating, ranked, rank,
});
const entry = (a: Address, name: string, house: boolean, endpoint: string | null = null): SeasonEntry => ({
  seasonId: 1n, agentAddress: a, erc8004AgentId: null, displayName: name, house, forecastEndpoint: endpoint, enteredRound: 0n,
});

test("house keys come from the model house agents only", () => {
  assert.equal(houseKeyFor("Atlas (house)"), "atlas");
  assert.equal(houseKeyFor("Mirror (house, market copy)"), null);
  assert.equal(houseKeyFor("Somebody"), null);
});

test("ranked forecasters come first by rating; the benchmark and unreachable agents are left out", () => {
  const rows = [
    row(addr("1"), "Vesper (house)", true, 0.01, true, 2, 120),
    row(addr("2"), "Atlas (house)", true, 0.02, true, 1, 140, 0.031),
    row(addr("3"), "Mirror (house, market copy)", true, 0, true, 3, 150),
    row(addr("4"), "Outside Bot", false, 0.05, false, null, 12),
    row(addr("5"), "Silent Bot", false, 0.04, true, 4, 60),
  ];
  const entries = [
    entry(addr("1"), "Vesper (house)", true), entry(addr("2"), "Atlas (house)", true), entry(addr("3"), "Mirror (house, market copy)", true),
    entry(addr("4"), "Outside Bot", false, "https://bot.example/forecast"), entry(addr("5"), "Silent Bot", false, null),
  ];
  const ranked = rankForecasters({ rows, entries, publicApiUrl: "https://api.agon.surf", hireableHouseKeys: ["atlas", "vesper"] });
  assert.deepEqual(ranked.map((c) => c.displayName), ["Atlas (house)", "Vesper (house)", "Outside Bot"]);
  assert.equal(ranked[0]!.forecastUrl, "https://api.agon.surf/agon/agents/house/atlas/forecast");
  assert.equal(ranked[0]!.quoteUrl, "https://api.agon.surf/agon/agents/house/atlas/quote");
  assert.equal(ranked[0]!.providerRef, "house:atlas");
  assert.equal(ranked[0]!.reason, "Season 1 rank #1, beats the market by 0.031 over 140 forecasts");
  assert.equal(ranked[2]!.quoteUrl, null);
  assert.equal(ranked[2]!.providerRef, `agent:${addr("4")}`);
  assert.equal(ranked[2]!.reason, "12 scored forecasts so far, not ranked yet");
  const fresh = rankForecasters({ rows: [row(addr("6"), "Drift (house)", true, 0, false, null, 0)], entries: [entry(addr("6"), "Drift (house)", true)], publicApiUrl: "https://api.agon.surf", hireableHouseKeys: ["drift"] });
  assert.equal(fresh[0]!.reason, "No scored forecasts yet");
});

test("data services: BlockRun on mainnet, the stand-in on testnet", () => {
  const main = dataServicesFor(agonNetwork("arc"), "https://api.agon.surf");
  assert.equal(main.price(["coingecko:bitcoin"]), "https://arc.blockrun.ai/api/v1/defillama/prices/coingecko:bitcoin");
  assert.equal(main.marketSearch("bitcoin 82000"), "https://arc.blockrun.ai/api/v1/pm/markets/search?q=bitcoin+82000");
  const testnet = dataServicesFor(agonNetwork("arc-testnet"), "https://api.agon.surf");
  assert.equal(testnet.price(["coingecko:bitcoin", "coingecko:ethereum"]), "https://api.agon.surf/agon/standin/price/coingecko:bitcoin,coingecko:ethereum");
  assert.equal(testnet.marketSearch("btc"), "https://api.agon.surf/agon/standin/markets?q=btc");
});

test("coin ids are read from the question", () => {
  assert.deepEqual(coinIdsForQuestion("What's the real chance BTC closes above $82k on Friday?"), ["coingecko:bitcoin"]);
  assert.deepEqual(coinIdsForQuestion("Will Ethereum or Solana go higher?"), ["coingecko:ethereum", "coingecko:solana"]);
  assert.deepEqual(coinIdsForQuestion("Will it rain in Dubai?"), []);
});
