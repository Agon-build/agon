import type { Address, Hex } from "viem";
import type { AgonNetworkId } from "../../network.ts";
import type { MarketCategory } from "./categories.ts";

export type Season = {
  seasonId: bigint;
  network: AgonNetworkId;
  commitsAddress: Address;
  startsAt: Date;
  endsAt: Date;
  roundHours: number;
};

export type SeasonEntry = {
  seasonId: bigint;
  agentAddress: Address;
  erc8004AgentId: bigint | null;
  displayName: string;
  house: boolean;
  forecastEndpoint: string | null;
  enteredRound: bigint;
};

export type RoundState = "open" | "committing" | "committed" | "skipped";

export type SeasonRound = {
  seasonId: bigint;
  round: bigint;
  openedAt: Date;
  intakeClosesAt: Date;
  state: RoundState;
  commitRoot: Hex | null;
  commitCount: number | null;
  commitTx: Hex | null;
  commitBlockTime: Date | null;
};

export type RoundMarket = {
  seasonId: bigint;
  round: bigint;
  marketId: Hex;
  question: string;
  slug: string;
  endAt: Date;
  baselineBps: number;
  /** Derived from Gamma event tags at round open; not part of the committed slate leaf. */
  category: MarketCategory;
};

export type StoredForecast = {
  seasonId: bigint;
  round: bigint;
  marketId: Hex;
  agentAddress: Address;
  probabilityBps: number;
  salt: Hex;
  signature: Hex;
  leaf: Hex;
};

export type MarketResult = {
  marketId: Hex;
  status: "pending" | "resolved" | "void";
  outcome: 0 | 1 | null;
  checkedAt: Date;
  /** When the market first read as final; set once, never changed. Null while pending or unknown. */
  resolvedAt?: Date | null;
};

export type InsertForecastResult = "inserted" | "duplicate" | "changed" | "round_closed";

export type ScoringRaw = {
  entries: SeasonEntry[];
  rounds: SeasonRound[];
  markets: RoundMarket[];
  forecasts: StoredForecast[];
  results: MarketResult[];
};

export type CommitRecord = { root: Hex; count: number; tx: Hex; blockTime: Date; circleTxId: string };

export interface SeasonStore {
  ensureSeason(season: Season): Promise<Season>;
  getSeason(seasonId: bigint): Promise<Season | null>;
  upsertEntry(entry: SeasonEntry): Promise<void>;
  /// Sets (or clears, with null) an entry's ERC-8004 id.
  setEntryAgentId(seasonId: bigint, agent: Address, agentId: bigint | null): Promise<void>;
  getEntry(seasonId: bigint, agent: Address): Promise<SeasonEntry | null>;
  getEntryByAgentId(seasonId: bigint, erc8004AgentId: bigint): Promise<SeasonEntry | null>;
  listEntries(seasonId: bigint): Promise<SeasonEntry[]>;
  /** Creates the round and its slate in one transaction. False when the round already exists. */
  openRound(
    round: { seasonId: bigint; round: bigint; openedAt: Date; intakeClosesAt: Date },
    markets: RoundMarket[],
  ): Promise<boolean>;
  getRound(seasonId: bigint, round: bigint): Promise<SeasonRound | null>;
  listRounds(seasonId: bigint, limit: number): Promise<SeasonRound[]>;
  listRoundMarkets(seasonId: bigint, round: bigint): Promise<RoundMarket[]>;
  /** Every market id that has appeared on any slate of this season. */
  listSeasonMarketIds(seasonId: bigint): Promise<Hex[]>;
  /**
   * Inserts only while the round is open and now is before intake close,
   * checked atomically with the round row so a commit in progress never
   * misses a forecast it did not include (round_closed otherwise).
   */
  insertForecast(forecast: StoredForecast, now: Date): Promise<InsertForecastResult>;
  listRoundForecasts(seasonId: bigint, round: bigint): Promise<StoredForecast[]>;
  /** Rounds in state open or committing whose intake has closed. */
  roundsDueForCommit(now: Date): Promise<SeasonRound[]>;
  setRoundState(seasonId: bigint, round: bigint, state: RoundState): Promise<void>;
  recordCommit(seasonId: bigint, round: bigint, commit: CommitRecord): Promise<void>;
  /** Distinct slate markets whose end time has passed and whose result is missing or pending. */
  marketsAwaitingResult(now: Date): Promise<Hex[]>;
  saveResults(results: MarketResult[]): Promise<void>;
  scoringRaw(seasonId: bigint): Promise<ScoringRaw>;
}
