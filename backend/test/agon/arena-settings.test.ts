import assert from "node:assert/strict";
import test from "node:test";

import { opensAt, roundAt, seededPick } from "../../src/agon/arena/clock.ts";
import { readArenaSettings } from "../../src/agon/arena/settings.ts";
import type { ArenaSeason } from "../../src/agon/arena/types.ts";

const SEED = "a-long-enough-test-seed";
const on = { AGON_ARENA_RESEARCH: "on", AGON_ARENA_SEED: SEED, AGON_ARENA_RESEARCH_STARTS_AT: "2026-11-20T00:00:00Z" };
const season: ArenaSeason = {
  seasonId: 20001n, trackId: "research", network: "arc-testnet", commitsAddress: "0x1111111111111111111111111111111111111111",
  startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-12-18T00:00:00Z"), roundHours: 24,
};

test("the Arena is off unless it is switched on", () => {
  assert.deepEqual(readArenaSettings({}), { settings: null, problems: [] });
  assert.deepEqual(readArenaSettings({ ...on, AGON_ARENA_RESEARCH: "true" }), { settings: null, problems: [] });
});

test("defaults: season 20001, 0.50 a hire, 5 a day, 28 days", () => {
  const { settings, problems } = readArenaSettings(on);
  assert.deepEqual(problems, []);
  assert.equal(settings?.seasonId, 20001n);
  assert.equal(settings?.maxHire, 500_000n);
  assert.equal(settings?.maxDay, 5_000_000n);
  assert.equal(settings?.endsAt.toISOString(), "2026-12-18T00:00:00.000Z");
  assert.equal(settings?.seed, SEED);
});

test("a wrong value keeps the Arena off and says why", () => {
  const cases: [Record<string, string | undefined>, RegExp][] = [
    [{ ...on, AGON_ARENA_SEED: undefined }, /AGON_ARENA_SEED/],
    [{ ...on, AGON_ARENA_SEED: "short" }, /AGON_ARENA_SEED/],
    [{ ...on, AGON_ARENA_RESEARCH_STARTS_AT: undefined }, /STARTS_AT/],
    [{ ...on, AGON_ARENA_RESEARCH_STARTS_AT: "tomorrow" }, /STARTS_AT/],
    [{ ...on, AGON_ARENA_RESEARCH_ENDS_AT: "2026-11-19T00:00:00Z" }, /after the start/],
    [{ ...on, AGON_ARENA_RESEARCH_SEASON_ID: "0" }, /SEASON_ID/],
    [{ ...on, AGON_ARENA_MAX_HIRE_USDC: "free" }, /MAX_HIRE/],
    [{ ...on, AGON_ARENA_MAX_DAY_USDC: "0" }, /MAX_DAY/],
  ];
  for (const [env, why] of cases) {
    const out = readArenaSettings(env);
    assert.equal(out.settings, null);
    assert.equal(out.problems.length, 1);
    assert.match(out.problems[0]!, why);
  }
});

test("set ceilings are read in USDC", () => {
  const { settings } = readArenaSettings({ ...on, AGON_ARENA_MAX_HIRE_USDC: "0.05", AGON_ARENA_MAX_DAY_USDC: "1.5" });
  assert.equal(settings?.maxHire, 50_000n);
  assert.equal(settings?.maxDay, 1_500_000n);
});

test("a round is a day, and there is none outside the season", () => {
  assert.equal(roundAt(season, new Date("2026-11-19T23:59:59Z")), null);
  assert.equal(roundAt(season, new Date("2026-11-20T00:00:00Z")), 0n);
  assert.equal(roundAt(season, new Date("2026-11-20T23:59:59Z")), 0n);
  assert.equal(roundAt(season, new Date("2026-11-21T00:00:00Z")), 1n);
  assert.equal(roundAt(season, new Date("2026-12-17T23:00:00Z")), 27n);
  assert.equal(roundAt(season, new Date("2026-12-18T00:00:00Z")), null);
});

test("a round opens at the same time after a restart, inside its first 20 hours", () => {
  const seen = new Set<number>();
  for (let r = 0n; r < 28n; r += 1n) {
    const a = opensAt(season, r, SEED);
    assert.equal(a.getTime(), opensAt(season, r, SEED).getTime());
    const windowStart = season.startsAt.getTime() + Number(r) * 86_400_000;
    assert.ok(a.getTime() >= windowStart && a.getTime() < windowStart + 20 * 3_600_000);
    seen.add(a.getTime() - windowStart);
  }
  // The time of day is not the same every round, and another seed gives another time.
  assert.ok(seen.size > 20);
  assert.notEqual(opensAt(season, 3n, SEED).getTime(), opensAt(season, 3n, `${SEED}-other`).getTime());
});

test("a seeded pick stays inside its range and repeats", () => {
  for (let i = 0; i < 50; i += 1) {
    const p = seededPick(SEED, `k${i}`, 7);
    assert.ok(Number.isInteger(p) && p >= 0 && p < 7);
    assert.equal(p, seededPick(SEED, `k${i}`, 7));
  }
  assert.equal(seededPick(SEED, "k", 1), 0);
});
