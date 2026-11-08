import assert from "node:assert/strict";
import test from "node:test";

import { agentPageHrefs, arenaName, marketNote, roundClock, seasonProgress, seasonSpan, skillBarWidth } from "./arena-layout.ts";
import type { LeaderboardRow, SeasonInfo } from "./stage-types.ts";

const season = (over: Partial<SeasonInfo> = {}): SeasonInfo => ({
  seasonId: "9002", network: "Arc Testnet", commitsAddress: "0xabc", commitsUrl: "https://explorer.testnet.arc.io/address/0xabc",
  startsAt: "2026-10-22T00:00:00.000Z", endsAt: "2026-11-19T00:00:00.000Z", roundHours: 6, currentRound: "66", ...over,
});
const row = (displayName: string, meanSkill: number, forecastsResolved = 600): LeaderboardRow => ({
  agentAddress: `0x${displayName.slice(0, 3).toLowerCase()}`, displayName, house: true, slateResolved: 50, forecastsResolved, meanSkill, meanBrier: 0.16, rating: meanSkill, ranked: true, rank: 1,
});
const liveRows = [
  row("Mirror (house, market copy)", 0, 638), row("Kestrel (house)", -0.0003, 609), row("Drift (house)", -0.0063, 607),
  row("Atlas (house)", -0.0071, 607), row("Vesper (house)", -0.0081, 607), row("Beacon (house, evidence first)", -0.0093, 597),
];

test("season progress counts rounds from the season start", () => {
  assert.deepEqual(seasonProgress(season()), { round: 66, total: 112, nextRoundAt: "2026-11-07T18:00:00.000Z" });
  assert.deepEqual(seasonProgress(season({ currentRound: null })), { round: 0, total: 112, nextRoundAt: "2026-10-22T00:00:00.000Z" });
});

test("arena names drop the house tag and say what the agent is", () => {
  assert.deepEqual(arenaName("Kestrel (house)"), { name: "Kestrel", note: "Built by Agon", benchmark: false });
  assert.deepEqual(arenaName("Beacon (house, evidence first)"), { name: "Beacon", note: "Built by Agon. Evidence first.", benchmark: false });
  assert.deepEqual(arenaName("Mirror (house, market copy)"), { name: "Mirror", note: "Benchmark. Copies the market price.", benchmark: true });
  assert.deepEqual(arenaName("Outside Agent"), { name: "Outside Agent", note: "", benchmark: false });
});

test("the skill bar is visible for any non-zero skill and capped at half its width", () => {
  assert.equal(skillBarWidth(0), 0);
  assert.equal(skillBarWidth(-0.0003), 2);
  assert.equal(skillBarWidth(-0.0063), 50);
  assert.equal(skillBarWidth(0.0063), 50);
  assert.equal(skillBarWidth(-0.05), 80);
  assert.equal(skillBarWidth(Number.NaN), 0);
});

test("the market note names the closest agent, or the leaders when someone beats the market", () => {
  assert.equal(marketNote(liveRows), "No agent beats the market price yet this season. Kestrel is closest.");
  assert.equal(marketNote([]), "Not available right now");
  assert.equal(marketNote([row("Mirror (house, market copy)", 0)]), "No forecasts scored yet this season.");
  assert.equal(marketNote([...liveRows, row("Zeta", 0.002)]), "1 agent beats the market price this season. Zeta leads.");
  assert.equal(marketNote([row("Zeta", 0.002), row("Yolo", 0.004)]), "2 agents beat the market price this season. Yolo leads.");
});

test("the round clock and season span come from the season's own dates", () => {
  assert.equal(roundClock(season()), "Rounds open at 00, 06, 12 and 18 UTC.");
  assert.equal(roundClock(season({ roundHours: 12 })), "Rounds open at 00 and 12 UTC.");
  assert.equal(roundClock(season({ roundHours: 5 })), "A new round opens every 5 hours.");
  assert.equal(seasonSpan(season()), "Started 22 Oct. Four weeks.");
  assert.equal(seasonSpan(season({ endsAt: "2026-10-25T00:00:00.000Z" })), "Started 22 Oct. 3 days.");
});

test("agent page links go through the entry's ERC-8004 id to its listing", () => {
  const entries = [
    { agentAddress: "0xKES", erc8004AgentId: "41", displayName: "Kestrel (house)", house: true, forecastEndpoint: null, enteredRound: "0" },
    { agentAddress: "0xmir", erc8004AgentId: null, displayName: "Mirror (house, market copy)", house: true, forecastEndpoint: null, enteredRound: "0" },
  ];
  const hrefs = agentPageHrefs(entries, [{ agentId: "41", listingReference: "5042002:0xf01:1" }]);
  assert.deepEqual(hrefs, { "0xkes": "/agents/5042002%3A0xf01%3A1" });
});
