import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

import { agonNetwork } from "../../src/agon/network.ts";
import { createForecastVerifier, forecastDomain } from "../../src/agon/playground/seasons/forecast.ts";
import { DEFAULT_HOUSE_AGENTS } from "../../src/agon/playground/seasons/house-agents.ts";
import type { PolymarketMarket } from "../../src/agon/playground/seasons/polymarket.ts";
import { createSeasonRoutes } from "../../src/agon/playground/seasons/routes.ts";
import { activeSeason, nextSeasonProblems, previousSeason, scoringRawWithCarry, upcomingSeason } from "../../src/agon/playground/seasons/schedule.ts";
import { resolveSeasonSettings } from "../../src/agon/playground/seasons/settings.ts";
import type { ScoringRaw, Season } from "../../src/agon/playground/seasons/types.ts";
import { seasonScheduleLoop, type SeasonWorkerDeps } from "../../src/agon/playground/seasons/worker.ts";
import { MemorySeasonStore } from "./season-memory-store.ts";

const COMMITS = "0x1111111111111111111111111111111111111111" as const;
const domain = forecastDomain(5_042_002, COMMITS);
const accounts = ["0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"].map((k) => privateKeyToAccount(k as Hex));
const cid = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
// Season 2 as it runs on Arc Testnet, and the Season 3 that follows it at the same instant.
const s2: Season = { seasonId: 9002n, network: "arc-testnet", commitsAddress: COMMITS, startsAt: new Date("2026-10-22T00:00:00Z"), endsAt: new Date("2026-11-19T00:00:00Z"), roundHours: 6 };
const s3: Season = { ...s2, seasonId: 9003n, startsAt: new Date("2026-11-19T00:00:00Z"), endsAt: new Date("2026-12-17T00:00:00Z") };
const at = (iso: string) => new Date(iso);

test("the running season is the latest one that has started", () => {
  assert.equal(activeSeason([s2, s3], at("2026-11-18T23:59:59Z")).seasonId, 9002n);
  assert.equal(activeSeason([s3, s2], at("2026-11-19T00:00:00Z")).seasonId, 9003n, "the next season takes over at the very instant the first ends");
  assert.equal(activeSeason([s2, s3], at("2026-10-01T00:00:00Z")).seasonId, 9002n, "before any has started, the first");
  assert.equal(activeSeason([s2, s3], at("2027-01-01T00:00:00Z")).seasonId, 9003n, "after the last has ended, still the last");
  assert.equal(activeSeason([s2], at("2026-11-20T00:00:00Z")).seasonId, 9002n);
  assert.throws(() => activeSeason([], at("2026-11-20T00:00:00Z")));
  assert.deepEqual([previousSeason([s2, s3], at("2026-11-18T00:00:00Z")), upcomingSeason([s2, s3], at("2026-11-18T00:00:00Z"))?.seasonId], [null, 9003n]);
  assert.deepEqual([previousSeason([s2, s3], at("2026-11-20T00:00:00Z"))?.seasonId, upcomingSeason([s2, s3], at("2026-11-20T00:00:00Z"))], [9002n, null]);
});

test("a next season must be another season that starts no earlier than this one ends", () => {
  assert.deepEqual(nextSeasonProblems(s2, s3), []);
  assert.match(nextSeasonProblems(s2, { ...s3, seasonId: 9002n }).join(), /must differ/);
  assert.match(nextSeasonProblems(s2, { ...s3, startsAt: at("2026-11-18T00:00:00Z") }).join(), /cannot start before/);
  assert.match(nextSeasonProblems(s2, { ...s3, endsAt: s3.startsAt }).join(), /must be after/);
});

const env = {
  AGON_SEASON_ENABLED: "true", AGON_SEASON_ID: "9002", AGON_SEASON_NETWORK: "arc-testnet", AGON_SEASON_COMMITS_ADDRESS: COMMITS, AGON_SEASON_COMMITTER_WALLET_ID: "w-committer",
  AGON_SEASON_HOUSE_WALLETS: "{}", AGON_SEASON_STARTS_AT: "2026-10-22T00:00:00Z", AGON_SEASON_ENDS_AT: "2026-11-19T00:00:00Z",
};
const settings = (extra: Record<string, string>) => {
  const out = resolveSeasonSettings({ ...env, ...extra });
  if (!out.enabled || !out.ok) throw new Error("the running season must stay enabled");
  return out.settings;
};

test("the next season is read from settings, starts when this one ends, and a mistake never stops the running season", () => {
  assert.deepEqual([settings({}).next, settings({}).nextProblems], [null, []]);
  const set = settings({ AGON_SEASON_NEXT_ID: "9003", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" });
  assert.deepEqual(set.next, { seasonId: 9003n, startsAt: at("2026-11-19T00:00:00Z"), endsAt: at("2026-12-17T00:00:00Z") });
  assert.deepEqual(set.nextProblems, []);
  const later = settings({ AGON_SEASON_NEXT_ID: "9003", AGON_SEASON_NEXT_STARTS_AT: "2026-11-20T00:00:00Z", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" });
  assert.equal(later.next!.startsAt.toISOString(), "2026-11-20T00:00:00.000Z");
  for (const [extra, why] of [
    [{ AGON_SEASON_NEXT_ID: "9003" }, /AGON_SEASON_NEXT_ENDS_AT/],
    [{ AGON_SEASON_NEXT_ID: "three", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" }, /positive integer/],
    [{ AGON_SEASON_NEXT_ID: "9002", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" }, /must differ/],
    [{ AGON_SEASON_NEXT_ID: "9003", AGON_SEASON_NEXT_ENDS_AT: "2026-11-01T00:00:00Z" }, /must be after/],
    [{ AGON_SEASON_NEXT_ID: "9003", AGON_SEASON_NEXT_STARTS_AT: "2026-11-01T00:00:00Z", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" }, /cannot start before/],
    [{ AGON_SEASON_NEXT_ID: "9003", AGON_SEASON_NEXT_STARTS_AT: "soon", AGON_SEASON_NEXT_ENDS_AT: "2026-12-17T00:00:00Z" }, /AGON_SEASON_NEXT_STARTS_AT/],
  ] as const) {
    const out = settings(extra);
    assert.equal(out.next, null, JSON.stringify(extra));
    assert.match(out.nextProblems.join("; "), why);
    assert.equal(out.seasonId, 9002n, "the running season is untouched");
  }
});

const market = (n: number): PolymarketMarket => ({ conditionId: cid(n), question: `q${n}`, slug: `q${n}`, endAt: new Date("2026-11-20T12:00:00Z"), yesPriceBps: 4000, liquidity: 20_000, closed: false, resolution: "pending", tags: ["crypto"] });
function world(startIso: string) {
  const store = new MemorySeasonStore();
  const clock = { now: new Date(startIso) };
  const logs: string[] = [];
  const base: Omit<SeasonWorkerDeps, "seasonId"> = {
    store, domain,
    polymarket: { listCandidates: async () => [market(1), market(2)], getMarkets: async () => [] },
    committer: { commit: async () => ({ txHash: cid(999), blockTime: new Date(clock.now.getTime() + 5_000), circleTxId: "c-1" }) },
    verifyForecast: createForecastVerifier(domain),
    now: () => clock.now,
    house: [{ spec: DEFAULT_HOUSE_AGENTS[0]!, walletId: "w-atlas", address: accounts[0]!.address }, { spec: DEFAULT_HOUSE_AGENTS[4]!, walletId: "w-mirror", address: accounts[1]!.address }],
    callModel: async () => ({ text: '{"probability":0.31,"reasons":["a","b","c"]}' }),
    signTypedData: async (walletId, json) => {
      const doc = JSON.parse(json);
      return (walletId === "w-atlas" ? accounts[0]! : accounts[1]!).signTypedData({
        domain: doc.domain, types: { Forecast: doc.types.Forecast }, primaryType: "Forecast",
        message: { ...doc.message, seasonId: BigInt(doc.message.seasonId), round: BigInt(doc.message.round) },
      });
    },
    newSalt: () => cid(7),
    log: (m) => logs.push(m),
  };
  return { store, clock, logs, base };
}

// Owner decision 2026-11-11: the forecast track rolls over on 19 November with no gap.
test("at the instant one season ends the next opens its first round, with the house agents entered and no restart", { timeout: 10_000 }, async () => {
  const { store, clock, logs, base } = world("2026-11-18T23:50:00Z");
  const controller = new AbortController();
  const guard = setTimeout(() => controller.abort(), 8_000);
  const switches: string[] = [];
  let ticks = 0;
  const loop = seasonScheduleLoop({ ...base, log: (m) => { logs.push(m); if (m.includes("tick")) { ticks += 1; if (clock.now < s3.startsAt) clock.now = new Date("2026-11-19T00:00:30Z"); else controller.abort(); } } }, {
    seasons: [s2, s3], intervalMs: 1, signal: controller.signal, onSwitch: (to, from) => switches.push(`${from?.seasonId ?? "none"}->${to.seasonId}`),
  });
  await loop;
  clearTimeout(guard);
  assert.deepEqual(switches, ["none->9002", "9002->9003"]);
  assert.ok(logs.some((m) => m === "season 9002 ended; season 9003 takes over"));
  // Season 2's last round (111: 27 days and 18 hours in) and Season 3's round 0 both exist.
  assert.ok(await store.getRound(9002n, 111n), "the old season's last round was opened before the handover");
  const first = await store.getRound(9003n, 0n);
  assert.ok(first, "the new season's first round is open");
  assert.equal(first!.openedAt.toISOString(), "2026-11-19T00:00:00.000Z", "it opens at the instant the old season ended");
  assert.equal((await store.listEntries(9003n)).filter((e) => e.house).length, 2, "house agents are entered in the new season");
  assert.equal((await store.listRoundForecasts(9003n, 0n)).length, 4, "and have forecast its first round");
  assert.ok(ticks >= 2);
});

test("with no next season set, the season simply ends and nothing new opens", { timeout: 10_000 }, async () => {
  const { store, clock, logs, base } = world("2026-11-19T00:10:00Z");
  const controller = new AbortController();
  let rounds = 0;
  const loop = seasonScheduleLoop({ ...base, now: () => { rounds += 1; if (rounds > 40) controller.abort(); return clock.now; } }, { seasons: [s2], intervalMs: 1, signal: controller.signal });
  await loop;
  assert.equal((await store.listRounds(9002n, 10)).length, 0);
  assert.equal(logs.some((m) => m.includes("takes over")), false);
});

const raw = (results: number): ScoringRaw => ({ entries: [], rounds: [], markets: [], forecasts: [], results: Array.from({ length: results }, (_, i) => ({ marketId: cid(i) })) as unknown as ScoringRaw["results"] });

test("the Arena part of the Agon score uses the season before until the new season has its first result", async () => {
  const asked: bigint[] = [];
  const store = (byId: Record<string, number>) => ({ scoringRaw: async (id: bigint) => { asked.push(id); return raw(byId[id.toString()] ?? 0); } });
  const during = at("2026-11-20T00:00:00Z");
  assert.equal((await scoringRawWithCarry(store({ "9002": 40, "9003": 0 }), [s2, s3], during)).results.length, 40, "Season 3 has nothing settled yet: Season 2's record carries");
  assert.equal((await scoringRawWithCarry(store({ "9002": 40, "9003": 3 }), [s2, s3], during)).results.length, 3, "from its first result, Season 3 is used");
  asked.length = 0;
  assert.equal((await scoringRawWithCarry(store({ "9002": 40 }), [s2, s3], at("2026-11-10T00:00:00Z"))).results.length, 40);
  assert.deepEqual(asked, [9002n], "before the handover only the running season is read");
  assert.equal((await scoringRawWithCarry(store({}), [s2], during)).results.length, 0, "with no season before, an empty record stays empty");
});

test("GET /current names the running season and the one that follows, so a page needs no rebuild", async () => {
  const store = new MemorySeasonStore();
  const clock = { now: at("2026-11-18T12:00:00Z") };
  await store.ensureSeason(s2);
  await store.ensureSeason(s3);
  const rounds = { store, polymarket: { listCandidates: async () => [], getMarkets: async () => [] }, committer: { commit: async () => ({ txHash: cid(1), blockTime: clock.now, circleTxId: "c" }) }, verifyForecast: createForecastVerifier(domain), now: () => clock.now };
  const app = createSeasonRoutes({ store, rounds, network: agonNetwork("arc-testnet"), verifyEntry: async () => ({ ok: false as const, code: "invalid" }) as never, seasons: () => [s2, s3] });
  const before = (await (await app.request("http://x/current")).json()) as Record<string, unknown>;
  assert.deepEqual(before, {
    seasonId: "9002", startsAt: "2026-10-22T00:00:00.000Z", endsAt: "2026-11-19T00:00:00.000Z", currentRound: "110", previousSeasonId: null,
    next: { seasonId: "9003", startsAt: "2026-11-19T00:00:00.000Z", endsAt: "2026-12-17T00:00:00.000Z" },
  });
  clock.now = at("2026-11-19T00:00:01Z");
  const after = (await (await app.request("http://x/current")).json()) as Record<string, unknown>;
  assert.deepEqual([after.seasonId, after.currentRound, after.previousSeasonId, after.next], ["9003", "0", "9002", null]);
  // A season's own page still answers by its number, and a server with no schedule has no "current".
  assert.equal(((await (await app.request("http://x/9002")).json()) as { seasonId: string }).seasonId, "9002");
  const bare = createSeasonRoutes({ store, rounds, network: agonNetwork("arc-testnet"), verifyEntry: async () => ({ ok: false as const, code: "invalid" }) as never });
  assert.equal((await bare.request("http://x/current")).status, 404);
});
