import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";

import { arenaPercentiles, windowRaw } from "../../src/agon/tests/arena-part.ts";
import type { MarketResult, ScoringRaw, StoredForecast } from "../../src/agon/playground/seasons/types.ts";

const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const addr = (c: string) => `0x${c.repeat(40)}` as Address;
const OLD = new Date("2026-10-10T00:00:00Z");
const RECENT = new Date("2026-10-16T06:00:00Z");

/// 30 markets, all outcome 1, baseline 50%. Agent a forecasts 90%, b 70%, c 55%, d (unlinked) 90%, e enters but forecasts 5 times.
function raw(resolvedAt: (i: number) => Date | null = () => RECENT): ScoringRaw {
  const markets = Array.from({ length: 30 }, (_, i) => ({
    seasonId: 1n, round: 0n, marketId: hex(i + 1), question: "q", slug: "q", endAt: new Date("2026-10-30T00:00:00Z"), baselineBps: 5000, category: "crypto" as never,
  }));
  const results: MarketResult[] = markets.map((m, i) => ({ marketId: m.marketId, status: "resolved", outcome: 1, checkedAt: RECENT, resolvedAt: resolvedAt(i) }));
  const entries = [
    { c: "a", id: 41n }, { c: "b", id: 42n }, { c: "c", id: 43n }, { c: "d", id: null }, { c: "e", id: 45n },
  ].map(({ c, id }) => ({ seasonId: 1n, agentAddress: addr(c), erc8004AgentId: id, displayName: c, house: false, forecastEndpoint: null, enteredRound: 0n }));
  const p: Record<string, number> = { a: 9000, b: 7000, c: 5500, d: 9000 };
  const forecasts: StoredForecast[] = [];
  for (const [c, bps] of Object.entries(p)) for (const m of markets) forecasts.push({ seasonId: 1n, round: 0n, marketId: m.marketId, agentAddress: addr(c), probabilityBps: bps, salt: hex(0), signature: "0x" as Hex, leaf: hex(0) });
  for (const m of markets.slice(0, 5)) forecasts.push({ seasonId: 1n, round: 0n, marketId: m.marketId, agentAddress: addr("e"), probabilityBps: 9000, salt: hex(0), signature: "0x" as Hex, leaf: hex(0) });
  const rounds = [{ seasonId: 1n, round: 0n, openedAt: OLD, intakeClosesAt: OLD, state: "committed" as const, commitRoot: null, commitCount: 1, commitTx: null, commitBlockTime: OLD }];
  return { entries, rounds, markets, forecasts, results };
}

test("ranked linked agents get percentiles 100, then evenly down to 0; unranked and unlinked agents are absent", () => {
  const out = arenaPercentiles(raw(), null);
  // a and d tie on skill, so there are 4 ranked agents: a/d, b, c. d has no ERC-8004 id.
  assert.deepEqual([...out.keys()].sort(), ["41", "42", "43"]);
  assert.equal(out.get("41")!.forecasts, 30);
  assert.ok(out.get("41")!.percentile >= 66);
  assert.ok(out.get("41")!.percentile > out.get("42")!.percentile);
  assert.ok(out.get("42")!.percentile > out.get("43")!.percentile);
  assert.equal(out.get("43")!.percentile, 0);
  assert.equal(out.has("45"), false);
});

test("a window keeps only markets resolved inside it", () => {
  const mixed = raw((i) => (i < 5 ? OLD : RECENT));
  assert.equal(windowRaw(mixed, null).results.length, 30);
  assert.equal(windowRaw(mixed, new Date("2026-10-15T00:00:00Z")).results.length, 25);
  const out = arenaPercentiles(mixed, new Date("2026-10-15T00:00:00Z"));
  assert.equal(out.get("41")!.forecasts, 25);
  const noneRecent = arenaPercentiles(raw(() => OLD), new Date("2026-10-15T00:00:00Z"));
  assert.equal(noneRecent.size, 0, "nothing resolved in the window means nobody is ranked");
  assert.equal(arenaPercentiles(raw(() => null), new Date("2026-10-15T00:00:00Z")).size, 0, "unknown resolution time is outside every window");
  const earlier = raw((i) => (i < 25 ? OLD : RECENT));
  assert.equal(windowRaw(earlier, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-15T00:00:00Z")).results.length, 25, "until bounds the previous window");
  assert.equal(arenaPercentiles(earlier, new Date("2026-10-01T00:00:00Z"), new Date("2026-10-15T00:00:00Z")).get("41")!.forecasts, 25);
});

test("a single ranked agent is at the top", () => {
  const r = raw();
  r.entries = r.entries.filter((e) => e.agentAddress === addr("b"));
  assert.deepEqual(arenaPercentiles(r, null).get("42"), { percentile: 100, forecasts: 30 });
});
