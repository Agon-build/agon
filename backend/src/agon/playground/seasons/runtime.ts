import { createPublicClient, fallback, http, type Hex } from "viem";

import { pool } from "../../../db/pool.js";
import { callModel } from "../../../runners/llm/client.js";
import { executeContractCall, findTransactionByRefId, getTxState, signTypedDataJson } from "../../../chain/circleDev.ts";
import type { AgonNetwork } from "../../network.ts";
import { createCircleRootCommitter } from "./committer.ts";
import { createForecastVerifier, forecastDomain, newSalt } from "./forecast.ts";
import { createGammaClient } from "./polymarket.ts";
import type { RoundDeps } from "./rounds.ts";
import { resolveSeasonSettings } from "./settings.ts";
import { PostgresSeasonStore } from "./store.ts";
import type { Season } from "./types.ts";
import { seasonWorkerLoop, type SeasonWorkerDeps } from "./worker.ts";

export type SeasonRuntime = { store: PostgresSeasonStore; rounds: RoundDeps; network: AgonNetwork; season: Season };

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
    const worker: SeasonWorkerDeps = {
      ...rounds,
      seasonId: s.seasonId,
      domain,
      house: s.house,
      callModel: async (p) => ({ text: (await callModel(p)).text }),
      signTypedData: signTypedDataJson,
      newSalt,
      commitsOff: () => env.AGON_SEASON_COMMITS_OFF === "true",
    };
    void seasonWorkerLoop(worker, { season, intervalMs: s.tickMs }).catch((error) =>
      console.error(`[season] loop stopped: ${(error as Error).message}`),
    );
    log(`running season ${s.seasonId} on ${network.label} with ${s.house.length} house agents`);
    return { store, rounds, network, season };
  } catch (error) {
    console.error(`[season] disabled: ${(error as Error).message}`);
    return null;
  }
}
