import type { Address, Hex } from "viem";

import type {
  CommitRecord,
  InsertForecastResult,
  MarketResult,
  RoundMarket,
  RoundState,
  ScoringRaw,
  Season,
  SeasonEntry,
  SeasonRound,
  SeasonStore,
  StoredForecast,
} from "../../src/agon/playground/seasons/types.ts";

/// Behaviour-compatible stand-in for PostgresSeasonStore, for unit tests of
/// rounds, worker and routes. Keep it in step with season-store.test.ts.
export class MemorySeasonStore implements SeasonStore {
  seasons = new Map<string, Season>();
  entries = new Map<string, SeasonEntry>();
  rounds = new Map<string, SeasonRound>();
  markets = new Map<string, RoundMarket[]>();
  forecasts = new Map<string, StoredForecast>();
  results = new Map<string, MarketResult>();

  private rk(seasonId: bigint, round: bigint): string {
    return `${seasonId}:${round}`;
  }

  async ensureSeason(season: Season): Promise<Season> {
    const k = season.seasonId.toString();
    if (!this.seasons.has(k)) this.seasons.set(k, season);
    return this.seasons.get(k)!;
  }

  async getSeason(seasonId: bigint): Promise<Season | null> {
    return this.seasons.get(seasonId.toString()) ?? null;
  }

  async upsertEntry(e: SeasonEntry): Promise<void> {
    const k = `${e.seasonId}:${e.agentAddress.toLowerCase()}`;
    const prev = this.entries.get(k);
    this.entries.set(k, {
      ...e,
      agentAddress: e.agentAddress.toLowerCase() as Address,
      erc8004AgentId: e.erc8004AgentId ?? prev?.erc8004AgentId ?? null,
      house: prev?.house ?? e.house,
      enteredRound: prev?.enteredRound ?? e.enteredRound,
    });
  }

  async getEntry(seasonId: bigint, agent: Address): Promise<SeasonEntry | null> {
    return this.entries.get(`${seasonId}:${agent.toLowerCase()}`) ?? null;
  }

  async getEntryByAgentId(seasonId: bigint, erc8004AgentId: bigint): Promise<SeasonEntry | null> {
    return [...this.entries.values()].find((e) => e.seasonId === seasonId && e.erc8004AgentId === erc8004AgentId) ?? null;
  }

  async listEntries(seasonId: bigint): Promise<SeasonEntry[]> {
    return [...this.entries.values()].filter((e) => e.seasonId === seasonId);
  }

  async openRound(round: { seasonId: bigint; round: bigint; openedAt: Date; intakeClosesAt: Date }, markets: RoundMarket[]): Promise<boolean> {
    const k = this.rk(round.seasonId, round.round);
    if (this.rounds.has(k)) return false;
    this.rounds.set(k, { ...round, state: "open", commitRoot: null, commitCount: null, commitTx: null, commitBlockTime: null });
    this.markets.set(k, markets.map((m) => ({ ...m, marketId: m.marketId.toLowerCase() as Hex })));
    return true;
  }

  async getRound(seasonId: bigint, round: bigint): Promise<SeasonRound | null> {
    return this.rounds.get(this.rk(seasonId, round)) ?? null;
  }

  async listRounds(seasonId: bigint, limit: number): Promise<SeasonRound[]> {
    return [...this.rounds.values()]
      .filter((r) => r.seasonId === seasonId)
      .sort((a, b) => Number(b.round - a.round))
      .slice(0, limit);
  }

  async listRoundMarkets(seasonId: bigint, round: bigint): Promise<RoundMarket[]> {
    return this.markets.get(this.rk(seasonId, round)) ?? [];
  }

  async insertForecast(f: StoredForecast, now: Date): Promise<InsertForecastResult> {
    const round = this.rounds.get(this.rk(f.seasonId, f.round));
    if (!round || round.state !== "open" || now.getTime() >= round.intakeClosesAt.getTime()) return "round_closed";
    const k = `${f.seasonId}:${f.round}:${f.marketId.toLowerCase()}:${f.agentAddress.toLowerCase()}`;
    const prev = this.forecasts.get(k);
    if (!prev) {
      this.forecasts.set(k, {
        ...f,
        agentAddress: f.agentAddress.toLowerCase() as Address,
        marketId: f.marketId.toLowerCase() as Hex,
        leaf: f.leaf.toLowerCase() as Hex,
      });
      return "inserted";
    }
    return prev.leaf === f.leaf.toLowerCase() ? "duplicate" : "changed";
  }

  async listSeasonMarketIds(seasonId: bigint): Promise<Hex[]> {
    const ids = new Set<Hex>();
    for (const r of this.rounds.values()) {
      if (r.seasonId !== seasonId) continue;
      for (const mk of this.markets.get(this.rk(seasonId, r.round)) ?? []) ids.add(mk.marketId);
    }
    return [...ids];
  }

  async listRoundForecasts(seasonId: bigint, round: bigint): Promise<StoredForecast[]> {
    return [...this.forecasts.values()]
      .filter((f) => f.seasonId === seasonId && f.round === round)
      .sort((a, b) => (a.leaf < b.leaf ? -1 : 1));
  }

  async roundsDueForCommit(now: Date): Promise<SeasonRound[]> {
    return [...this.rounds.values()].filter((r) => (r.state === "open" || r.state === "committing") && r.intakeClosesAt <= now);
  }

  async setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void> {
    const row = this.rounds.get(this.rk(seasonId, round));
    if (row && row.state !== "committed") row.state = state;
  }

  async recordCommit(seasonId: bigint, round: bigint, c: CommitRecord): Promise<void> {
    const row = this.rounds.get(this.rk(seasonId, round))!;
    Object.assign(row, { state: "committed", commitRoot: c.root, commitCount: c.count, commitTx: c.tx, commitBlockTime: c.blockTime });
  }

  async marketsAwaitingResult(now: Date): Promise<Hex[]> {
    const ids = new Set<Hex>();
    for (const list of this.markets.values()) {
      for (const m of list) {
        const res = this.results.get(m.marketId);
        if (m.endAt <= now && (!res || res.status === "pending")) ids.add(m.marketId);
      }
    }
    return [...ids].sort();
  }

  async saveResults(results: MarketResult[]): Promise<void> {
    for (const r of results) {
      const id = r.marketId.toLowerCase();
      const prev = this.results.get(id);
      if (!prev || prev.status === "pending") this.results.set(id, { ...r, marketId: id as Hex });
    }
  }

  async scoringRaw(seasonId: bigint): Promise<ScoringRaw> {
    const rounds = [...this.rounds.values()].filter((r) => r.seasonId === seasonId);
    const markets = rounds.flatMap((r) => this.markets.get(this.rk(seasonId, r.round)) ?? []);
    return {
      entries: await this.listEntries(seasonId),
      rounds,
      markets,
      forecasts: [...this.forecasts.values()].filter((f) => f.seasonId === seasonId),
      results: [...this.results.values()],
    };
  }
}
