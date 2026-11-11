import { createPublicClient, fallback, http, type Hex } from "viem";

import { pool } from "../../../db/pool.js";
import { callModel } from "../../../runners/llm/client.js";
import { executeContractCall, findTransactionByRefId, getTxState, signTypedDataJson } from "../../../chain/circleDev.ts";
import type { AgonNetwork } from "../../network.ts";
import { createCircleRootCommitter } from "./committer.ts";
import { createEvidenceSearch } from "./evidence.ts";
import { createForecastVerifier, forecastDomain, newSalt } from "./forecast.ts";
import { createGammaClient } from "./polymarket.ts";
import type { RoundDeps } from "./rounds.ts";
import { resolveSeasonSettings } from "./settings.ts";
import { PostgresSeasonStore } from "./store.ts";
import type { Season } from "./types.ts";
import { activeSeason, scoringRawWithCarry } from "./schedule.ts";
import type { ScoringRaw } from "./types.ts";
import { seasonScheduleLoop, type SeasonWorkerDeps } from "./worker.ts";

export type SeasonRuntime = {
  store: PostgresSeasonStore; rounds: RoundDeps; network: AgonNetwork;
  /** The season running now. It changes by itself when the next season starts. */
  season: Season;
  /** Every season this deployment knows, in order: the one it started with and the one that follows. */
  seasons: Season[];
  /** What the Arena part of the Agon score is read from: the running season, or the one before it until the first result. */
  scoringRaw(): Promise<ScoringRaw>;
};

/// Production wiring for Season 1. Never throws: a disabled, incomplete or
/// malformed season config logs why and returns null, so the auth service
/// always starts.
export function startSeasonRuntime(env: Record<string, string | undefined> = process.env): SeasonRuntime | null {
  try {
    const resolved = resolveSeasonSettings(env);
    if (!resolved.enabled) return null;
    if (!resolved.ok) {
      console.error(`[season] disabled: ${resolved.problems.join("; ")}`);
      return null;
    }
    const s = resolved.settings;
    const network = s.network;
    const client = createPublicClient({ transport: fallback(network.rpcHttp.map((url) => http(url))) });
    const store = new PostgresSeasonStore(pool);
    const domain = forecastDomain(network.chainId, s.commitsAddress);
    const season: Season = { seasonId: s.seasonId, network: network.id, commitsAddress: s.commitsAddress, startsAt: s.startsAt, endsAt: s.endsAt, roundHours: 6 };
    const log = (message: string) => console.log(`[season] ${message}`);

    const rounds: RoundDeps = {
      store,
      polymarket: createGammaClient(),
      committer: createCircleRootCommitter({
        walletId: s.committerWalletId,
        commitsAddress: s.commitsAddress,
        network: network.id,
        execute: (input) => executeContractCall(input),
        findByRefId: (refId) => findTransactionByRefId(refId, s.committerWalletId),
        getTxState,
        getReceipt: async (txHash: Hex) => {
          const receipt = await client.getTransactionReceipt({ hash: txHash });
          const block = await client.getBlock({ blockNumber: receipt.blockNumber });
          return { success: receipt.status === "success", blockTime: new Date(Number(block.timestamp) * 1000) };
        },
      }),
      // Season 1 accepts EOA forecast signers only: a contract wallet's
      // isValidSignature can change after the commit and break the public check.
      verifyForecast: createForecastVerifier(domain),
      now: () => new Date(),
      log,
    };
    const seasons: Season[] = [season, ...(s.next ? [{ ...season, seasonId: s.next.seasonId, startsAt: s.next.startsAt, endsAt: s.next.endsAt }] : [])];
    if (s.nextProblems.length > 0) console.error(`[season] the next season is not set: ${s.nextProblems.join("; ")}`);
    const worker: Omit<SeasonWorkerDeps, "seasonId"> = {
      ...rounds,
      domain,
      house: s.house,
      houseAgentIds: s.houseAgentIds,
      callModel: async (p) => ({ text: (await callModel(p)).text }),
      ...(env.EXA_API_KEY?.trim() ? { searchEvidence: createEvidenceSearch({ apiKey: env.EXA_API_KEY.trim(), log }) } : {}),
      signTypedData: signTypedDataJson,
      newSalt,
      commitsOff: () => env.AGON_SEASON_COMMITS_OFF === "true",
    };
    void seasonScheduleLoop(worker, { seasons, intervalMs: s.tickMs }).catch((error) =>
      console.error(`[season] loop stopped: ${(error as Error).message}`),
    );
    const now = activeSeason(seasons, new Date());
    log(`running season ${now.seasonId} on ${network.label} with ${s.house.length} house agents${s.next ? `; season ${s.next.seasonId} follows at ${s.next.startsAt.toISOString()}` : ""}`);
    return {
      store, rounds, network, seasons,
      get season() { return activeSeason(seasons, new Date()); },
      scoringRaw: () => scoringRawWithCarry(store, seasons, new Date()),
    };
  } catch (error) {
    console.error(`[season] disabled: ${(error as Error).message}`);
    return null;
  }
}
