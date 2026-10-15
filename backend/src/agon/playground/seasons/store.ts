import type pg from "pg";
import type { Address, Hex } from "viem";

import type { MarketCategory } from "./categories.ts";

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
} from "./types.ts";

const lower = <T extends string>(value: T) => value.toLowerCase() as T;

type SeasonRow = { season_id: string; network: Season["network"]; commits_address: Address; starts_at: Date; ends_at: Date; round_hours: number };
type EntryRow = { season_id: string; agent_address: Address; erc8004_agent_id: string | null; display_name: string; house: boolean; forecast_endpoint: string | null; entered_round: string };
type RoundRow = { season_id: string; round: string; opened_at: Date; intake_closes_at: Date; state: RoundState; commit_root: Hex | null; commit_count: number | null; commit_tx: Hex | null; commit_block_time: Date | null };
type MarketRow = { season_id: string; round: string; market_id: Hex; question: string; slug: string; end_at: Date; baseline_bps: number; category: string | null };
type ForecastRow = { season_id: string; round: string; market_id: Hex; agent_address: Address; probability_bps: number; salt: Hex; signature: Hex; leaf: Hex };
type ResultRow = { market_id: Hex; status: MarketResult["status"]; outcome: number | null; checked_at: Date };

const toSeason = (r: SeasonRow): Season => ({
  seasonId: BigInt(r.season_id), network: r.network, commitsAddress: r.commits_address, startsAt: r.starts_at, endsAt: r.ends_at, roundHours: r.round_hours,
});
const toEntry = (r: EntryRow): SeasonEntry => ({
  seasonId: BigInt(r.season_id),
  agentAddress: r.agent_address,
  erc8004AgentId: r.erc8004_agent_id === null ? null : BigInt(r.erc8004_agent_id),
  displayName: r.display_name,
  house: r.house,
  forecastEndpoint: r.forecast_endpoint,
  enteredRound: BigInt(r.entered_round),
});
const toRound = (r: RoundRow): SeasonRound => ({
  seasonId: BigInt(r.season_id),
  round: BigInt(r.round),
  openedAt: r.opened_at,
  intakeClosesAt: r.intake_closes_at,
  state: r.state,
  commitRoot: r.commit_root,
  commitCount: r.commit_count,
  commitTx: r.commit_tx,
  commitBlockTime: r.commit_block_time,
});
const toMarket = (r: MarketRow): RoundMarket => ({
  seasonId: BigInt(r.season_id), round: BigInt(r.round), marketId: r.market_id, question: r.question, slug: r.slug, endAt: r.end_at, baselineBps: r.baseline_bps,
  category: (r.category ?? "other") as MarketCategory,
});
const toForecast = (r: ForecastRow): StoredForecast => ({
  seasonId: BigInt(r.season_id),
  round: BigInt(r.round),
  marketId: r.market_id,
  agentAddress: r.agent_address,
  probabilityBps: r.probability_bps,
  salt: r.salt,
  signature: r.signature,
  leaf: r.leaf,
});
const toResult = (r: ResultRow): MarketResult => ({
  marketId: r.market_id, status: r.status, outcome: r.outcome === 0 || r.outcome === 1 ? r.outcome : null, checkedAt: r.checked_at,
});

export class PostgresSeasonStore implements SeasonStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async ensureSeason(season: Season): Promise<Season> {
    await this.pool.query(
      `insert into agon_seasons (season_id, network, commits_address, starts_at, ends_at, round_hours)
       values ($1, $2, $3, $4, $5, $6) on conflict (season_id) do nothing`,
      [season.seasonId.toString(), season.network, lower(season.commitsAddress), season.startsAt, season.endsAt, season.roundHours],
    );
    return (await this.getSeason(season.seasonId))!;
  }

  async getSeason(seasonId: bigint): Promise<Season | null> {
    const { rows } = await this.pool.query<SeasonRow>("select * from agon_seasons where season_id = $1", [seasonId.toString()]);
    return rows[0] ? toSeason(rows[0]) : null;
  }

  async upsertEntry(e: SeasonEntry): Promise<void> {
    await this.pool.query(
      `insert into agon_season_entries (season_id, agent_address, erc8004_agent_id, display_name, house, forecast_endpoint, entered_round)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (season_id, agent_address) do update
         set erc8004_agent_id = coalesce(excluded.erc8004_agent_id, agon_season_entries.erc8004_agent_id), display_name = excluded.display_name,
             forecast_endpoint = excluded.forecast_endpoint`,
      [e.seasonId.toString(), lower(e.agentAddress), e.erc8004AgentId?.toString() ?? null, e.displayName, e.house, e.forecastEndpoint, e.enteredRound.toString()],
    );
  }

  async getEntry(seasonId: bigint, agent: Address): Promise<SeasonEntry | null> {
    const { rows } = await this.pool.query<EntryRow>(
      "select * from agon_season_entries where season_id = $1 and agent_address = $2",
      [seasonId.toString(), lower(agent)],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async getEntryByAgentId(seasonId: bigint, erc8004AgentId: bigint): Promise<SeasonEntry | null> {
    const { rows } = await this.pool.query<EntryRow>(
      "select * from agon_season_entries where season_id = $1 and erc8004_agent_id = $2 limit 1",
      [seasonId.toString(), erc8004AgentId.toString()],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async listEntries(seasonId: bigint): Promise<SeasonEntry[]> {
    const { rows } = await this.pool.query<EntryRow>(
      "select * from agon_season_entries where season_id = $1 order by created_at, agent_address",
      [seasonId.toString()],
    );
    return rows.map(toEntry);
  }

  async openRound(round: { seasonId: bigint; round: bigint; openedAt: Date; intakeClosesAt: Date }, markets: RoundMarket[]): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into agon_season_rounds (season_id, round, opened_at, intake_closes_at)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [round.seasonId.toString(), round.round.toString(), round.openedAt, round.intakeClosesAt],
      );
      if (inserted.rowCount === 0) {
        await client.query("rollback");
        return false;
      }
      for (const m of markets) {
        await client.query(
          `insert into agon_season_round_markets (season_id, round, market_id, question, slug, end_at, baseline_bps, category)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [m.seasonId.toString(), m.round.toString(), lower(m.marketId), m.question, m.slug, m.endAt, m.baselineBps, m.category ?? "other"],
        );
      }
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getRound(seasonId: bigint, round: bigint): Promise<SeasonRound | null> {
    const { rows } = await this.pool.query<RoundRow>(
      "select * from agon_season_rounds where season_id = $1 and round = $2",
      [seasonId.toString(), round.toString()],
    );
    return rows[0] ? toRound(rows[0]) : null;
  }

  async listRounds(seasonId: bigint, limit: number): Promise<SeasonRound[]> {
    const { rows } = await this.pool.query<RoundRow>(
      "select * from agon_season_rounds where season_id = $1 order by round desc limit $2",
      [seasonId.toString(), limit],
    );
    return rows.map(toRound);
  }

  async listRoundMarkets(seasonId: bigint, round: bigint): Promise<RoundMarket[]> {
    const { rows } = await this.pool.query<MarketRow>(
      "select * from agon_season_round_markets where season_id = $1 and round = $2 order by end_at, market_id",
      [seasonId.toString(), round.toString()],
    );
    return rows.map(toMarket);
  }

  /// Holds a share lock on the round row for the whole insert. The commit path
  /// moves the round to committing with an UPDATE, which waits for this lock,
  /// so it lists forecasts only after every in-flight insert has finished.
  async insertForecast(f: StoredForecast, now: Date): Promise<InsertForecastResult> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const round = await client.query<{ state: string; intake_closes_at: Date }>(
        "select state, intake_closes_at from agon_season_rounds where season_id = $1 and round = $2 for share",
        [f.seasonId.toString(), f.round.toString()],
      );
      const r = round.rows[0];
      if (!r || r.state !== "open" || now.getTime() >= r.intake_closes_at.getTime()) {
        await client.query("rollback");
        return "round_closed";
      }
      const inserted = await client.query(
        `insert into agon_season_forecasts (season_id, round, market_id, agent_address, probability_bps, salt, signature, leaf)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
        [f.seasonId.toString(), f.round.toString(), lower(f.marketId), lower(f.agentAddress), f.probabilityBps, lower(f.salt), lower(f.signature), lower(f.leaf)],
      );
      let result: InsertForecastResult = "inserted";
      if (inserted.rowCount !== 1) {
        const { rows } = await client.query<{ leaf: Hex }>(
          "select leaf from agon_season_forecasts where season_id = $1 and round = $2 and market_id = $3 and agent_address = $4",
          [f.seasonId.toString(), f.round.toString(), lower(f.marketId), lower(f.agentAddress)],
        );
        result = rows[0]?.leaf === lower(f.leaf) ? "duplicate" : "changed";
      }
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listSeasonMarketIds(seasonId: bigint): Promise<Hex[]> {
    const { rows } = await this.pool.query<{ market_id: Hex }>(
      "select distinct market_id from agon_season_round_markets where season_id = $1",
      [seasonId.toString()],
    );
    return rows.map((r) => r.market_id);
  }

  async listRoundForecasts(seasonId: bigint, round: bigint): Promise<StoredForecast[]> {
    const { rows } = await this.pool.query<ForecastRow>(
      "select * from agon_season_forecasts where season_id = $1 and round = $2 order by leaf",
      [seasonId.toString(), round.toString()],
    );
    return rows.map(toForecast);
  }

  async roundsDueForCommit(now: Date): Promise<SeasonRound[]> {
    const { rows } = await this.pool.query<RoundRow>(
      "select * from agon_season_rounds where state in ('open', 'committing') and intake_closes_at <= $1 order by season_id, round",
      [now],
    );
    return rows.map(toRound);
  }

  async setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void> {
    await this.pool.query(
      "update agon_season_rounds set state = $3 where season_id = $1 and round = $2 and state <> 'committed'",
      [seasonId.toString(), round.toString(), state],
    );
  }

  async recordCommit(seasonId: bigint, round: bigint, c: CommitRecord): Promise<void> {
    await this.pool.query(
      `update agon_season_rounds
          set state = 'committed', commit_root = $3, commit_count = $4, commit_tx = $5, commit_block_time = $6, circle_tx_id = $7
        where season_id = $1 and round = $2`,
      [seasonId.toString(), round.toString(), lower(c.root), c.count, lower(c.tx), c.blockTime, c.circleTxId],
    );
  }

  async marketsAwaitingResult(now: Date): Promise<Hex[]> {
    const { rows } = await this.pool.query<{ market_id: Hex }>(
      `select distinct m.market_id
         from agon_season_round_markets m
         left join agon_season_market_results r on r.market_id = m.market_id
        where m.end_at <= $1 and (r.market_id is null or r.status = 'pending')
        order by m.market_id`,
      [now],
    );
    return rows.map((r) => r.market_id);
  }

  /// Only pending rows update, so a final result stays fixed even if a later
  /// Gamma read returns something different.
  async saveResults(results: MarketResult[]): Promise<void> {
    for (const r of results) {
      await this.pool.query(
        `insert into agon_season_market_results (market_id, status, outcome, checked_at)
         values ($1, $2, $3, $4)
         on conflict (market_id) do update set status = excluded.status, outcome = excluded.outcome, checked_at = excluded.checked_at
         where agon_season_market_results.status = 'pending'`,
        [lower(r.marketId), r.status, r.outcome, r.checkedAt],
      );
    }
  }

  async scoringRaw(seasonId: bigint): Promise<ScoringRaw> {
    const id = seasonId.toString();
    const [entries, rounds, markets, forecasts, results] = await Promise.all([
      this.pool.query<EntryRow>("select * from agon_season_entries where season_id = $1", [id]),
      this.pool.query<RoundRow>("select * from agon_season_rounds where season_id = $1", [id]),
      this.pool.query<MarketRow>("select * from agon_season_round_markets where season_id = $1", [id]),
      this.pool.query<ForecastRow>("select * from agon_season_forecasts where season_id = $1", [id]),
      this.pool.query<ResultRow>(
        "select r.* from agon_season_market_results r where r.market_id in (select market_id from agon_season_round_markets where season_id = $1)",
        [id],
      ),
    ]);
    return {
      entries: entries.rows.map(toEntry),
      rounds: rounds.rows.map(toRound),
      markets: markets.rows.map(toMarket),
      forecasts: forecasts.rows.map(toForecast),
      results: results.rows.map(toResult),
    };
  }
}
