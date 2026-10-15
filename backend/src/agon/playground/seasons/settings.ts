import { z } from "zod";
import type { Address } from "viem";

import { agonNetwork, type AgonNetwork } from "../../network.ts";
import { houseAgentIdsFrom, parseFirstPartyAgents } from "../../first-party.ts";
import { DEFAULT_HOUSE_AGENTS, houseAgentsFromEnv } from "./house-agents.ts";
import type { HouseRunner } from "./worker.ts";

export type SeasonSettings = {
  seasonId: bigint;
  network: AgonNetwork;
  commitsAddress: Address;
  committerWalletId: string;
  startsAt: Date;
  endsAt: Date;
  tickMs: number;
  house: HouseRunner[];
  /// House key to its listing's ERC-8004 id, from AGON_FIRST_PARTY_AGENTS.
  /// Null when that value is unset or invalid: stored ids are then left alone.
  houseAgentIds: Record<string, bigint> | null;
};

export type SeasonSettingsResult =
  | { enabled: false }
  | { enabled: true; ok: true; settings: SeasonSettings }
  | { enabled: true; ok: false; problems: string[] };

const houseWallets = z.record(z.object({ walletId: z.string().min(1), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }));
const instant = z.string().datetime({ offset: true });

/// Reads Season settings from the environment without ever throwing. The
/// season keys live outside the main config schema so a typo here can only
/// disable the season, never stop the auth service or other processes.
export function resolveSeasonSettings(env: Record<string, string | undefined>): SeasonSettingsResult {
  if (env.AGON_SEASON_ENABLED !== "true") return { enabled: false };
  const problems: string[] = [];

  const seasonIdRaw = env.AGON_SEASON_ID ?? "1";
  const seasonId = /^[1-9]\d{0,17}$/.test(seasonIdRaw) ? BigInt(seasonIdRaw) : null;
  if (seasonId === null) problems.push("AGON_SEASON_ID must be a positive integer");

  let network: AgonNetwork | null = null;
  const rpc = (env.AGON_SEASON_RPC_HTTP ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  try {
    network = agonNetwork(env.AGON_SEASON_NETWORK ?? "arc-testnet");
  } catch {
    problems.push("AGON_SEASON_NETWORK must be arc-testnet or arc");
  }
  if (network && rpc.length > 0) {
    try {
      network = agonNetwork(network.id, rpc);
    } catch {
      problems.push("AGON_SEASON_RPC_HTTP must be comma-separated https URLs");
    }
  }

  const commits = env.AGON_SEASON_COMMITS_ADDRESS ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(commits)) problems.push("AGON_SEASON_COMMITS_ADDRESS must be a contract address");
  const committerWalletId = env.AGON_SEASON_COMMITTER_WALLET_ID ?? "";
  if (!committerWalletId) problems.push("AGON_SEASON_COMMITTER_WALLET_ID is required");

  const startsOk = instant.safeParse(env.AGON_SEASON_STARTS_AT ?? "").success;
  const endsOk = instant.safeParse(env.AGON_SEASON_ENDS_AT ?? "").success;
  if (!startsOk) problems.push("AGON_SEASON_STARTS_AT must be an ISO date-time");
  if (!endsOk) problems.push("AGON_SEASON_ENDS_AT must be an ISO date-time");
  const startsAt = new Date(env.AGON_SEASON_STARTS_AT ?? "");
  const endsAt = new Date(env.AGON_SEASON_ENDS_AT ?? "");
  if (startsOk && endsOk && endsAt <= startsAt) problems.push("AGON_SEASON_ENDS_AT must be after AGON_SEASON_STARTS_AT");

  const tickMs = Number(env.AGON_SEASON_TICK_MS ?? "60000");
  if (!Number.isInteger(tickMs) || tickMs < 10_000) problems.push("AGON_SEASON_TICK_MS must be an integer of at least 10000");

  let house: HouseRunner[] = [];
  try {
    const wallets = houseWallets.parse(JSON.parse(env.AGON_SEASON_HOUSE_WALLETS ?? "{}"));
    try {
      house = houseAgentsFromEnv(env.AGON_SEASON_HOUSE_MODELS)
        .filter((spec) => wallets[spec.key])
        .map((spec) => ({ spec, walletId: wallets[spec.key]!.walletId, address: wallets[spec.key]!.address.toLowerCase() as Address }));
    } catch {
      problems.push("AGON_SEASON_HOUSE_MODELS must be a JSON object of key to model id");
    }
  } catch {
    problems.push('AGON_SEASON_HOUSE_WALLETS must be JSON like {"atlas":{"walletId":"...","address":"0x..."}}');
  }

  // A badge setting never stops the Season: an invalid value only leaves ids as stored.
  const firstParty = env.AGON_FIRST_PARTY_AGENTS?.trim() ? parseFirstPartyAgents(env.AGON_FIRST_PARTY_AGENTS) : null;
  const houseAgentIds = firstParty?.ok ? houseAgentIdsFrom(firstParty.agents, DEFAULT_HOUSE_AGENTS.map((a) => a.key)) : null;

  if (problems.length > 0 || seasonId === null || network === null) return { enabled: true, ok: false, problems };
  return {
    enabled: true,
    ok: true,
    settings: {
      seasonId,
      network,
      commitsAddress: commits.toLowerCase() as Address,
      committerWalletId,
      startsAt,
      endsAt,
      tickMs,
      house,
      houseAgentIds,
    },
  };
}
