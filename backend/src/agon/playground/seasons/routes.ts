import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { verifyMessage, type Address, type Hex } from "viem";

import { clientAddress } from "../../../http/client-address.ts";
import { explorerAddressUrl, explorerTxUrl, type AgonNetwork } from "../../network.ts";
import { allProofs, buildRoundTree, slateLeaf } from "./forecast.ts";
import { acceptForecast, entryRoundAt, roundIndexAt, type RoundDeps } from "./rounds.ts";
import { SEASON_CATEGORIES, parseCategory } from "./categories.ts";
import {
  computeLeaderboard, computeRatings, MIN_RANKED_CATEGORY_FORECASTS, MIN_RANKED_FORECASTS, type AgentRatings, type LeaderboardRow, type RatingCell,
} from "./scoring.ts";
import type { SeasonStore } from "./types.ts";

export type EntryFields = {
  seasonId: bigint;
  erc8004AgentId: bigint;
  agentAddress: Address;
  displayName: string;
  forecastEndpoint: string | null;
};

/// The exact text both the ERC-8004 owner and the forecast signer sign. Every
/// field that appears on the board or routes money is inside it.
export function entryMessage(f: EntryFields): string {
  return [
    `AGON Season ${f.seasonId} entry`,
    `Agent id: ${f.erc8004AgentId}`,
    `Forecast signer: ${f.agentAddress.toLowerCase()}`,
    `Name: ${f.displayName}`,
    `Endpoint: ${f.forecastEndpoint ?? "none"}`,
  ].join("\n");
}

export type EntryVerifier = (input: EntryFields & { message: string; ownerSignature: Hex; agentSignature: Hex }) => Promise<boolean>;

type EntryClient = {
  readContract(args: { address: Address; abi: readonly unknown[]; functionName: "ownerOf"; args: [bigint] }): Promise<unknown>;
  verifyMessage(args: { address: Address; message: string; signature: Hex }): Promise<boolean>;
};

const OWNER_OF_ABI = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
] as const;

/// Both signatures are required: the ERC-8004 owner (which may be a smart
/// account, checked on chain) and the forecast signer itself (an EOA, checked
/// locally). Without the second, anyone owning some agent id could enter or
/// rename an address they do not control.
export function createErc8004EntryVerifier(client: EntryClient, identityRegistry: Address): EntryVerifier {
  return async (input) => {
    try {
      const agentOk = await verifyMessage({ address: input.agentAddress, message: input.message, signature: input.agentSignature });
      if (!agentOk) return false;
      const owner = (await client.readContract({ address: identityRegistry, abi: OWNER_OF_ABI, functionName: "ownerOf", args: [input.erc8004AgentId] })) as Address;
      return await client.verifyMessage({ address: owner, message: input.message, signature: input.ownerSignature });
    } catch {
      return false;
    }
  };
}

const idParam = z.string().regex(/^\d{1,18}$/).transform((v) => BigInt(v));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Address);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v.toLowerCase() as Hex);
const eoaSignature = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

const entryBody = z.object({
  agentAddress: address,
  erc8004AgentId: z.string().regex(/^\d{1,78}$/).transform((v) => BigInt(v)),
  displayName: z
    .string()
    .trim()
    .min(1)
    .max(48)
    .refine((v) => !/house/i.test(v), "display name cannot claim the house label"),
  forecastEndpoint: z.string().url().startsWith("https://").max(512).optional(),
  // The owner may be a smart account, so its signature can be longer than 65 bytes; it is still bounded.
  ownerSignature: z.string().regex(/^0x[0-9a-fA-F]{130,4000}$/),
  agentSignature: eoaSignature,
});

const forecastItem = z.object({
  round: z.string().regex(/^\d{1,18}$/).transform((v) => BigInt(v)),
  marketId: bytes32,
  agentAddress: address,
  probabilityBps: z.number(),
  salt: z.string().max(66),
  signature: eoaSignature,
});

const round4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);

type BoardCache = { at: number; rows: LeaderboardRow[]; lastCommitAt: Date | null };
type ProofCache = { forecasts: Map<Hex, Hex[]>; slateLeaf: Hex; slateProof: Hex[] };

export function createSeasonRoutes(deps: {
  store: SeasonStore;
  rounds: RoundDeps;
  network: AgonNetwork;
  verifyEntry: EntryVerifier;
  leaderboardCacheMs?: number;
  postLimitPerMinute?: number;
  maxBodyBytes?: number;
}): Hono {
  const app = new Hono();
  const boards = new Map<string, BoardCache>();
  const ratings = new Map<string, { at: number; agents: AgentRatings[] }>();
  const proofs = new Map<string, ProofCache>();
  const cacheMs = deps.leaderboardCacheMs ?? 60_000;
  const postLimit = deps.postLimitPerMinute ?? 20;
  const windows = new Map<string, { start: number; count: number }>();

  function allowPost(key: string): boolean {
    const now = Date.now();
    if (windows.size > 10_000) {
      for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
    }
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= postLimit;
  }

  app.use("/:seasonId/*", async (c, next) => {
    if (!idParam.safeParse(c.req.param("seasonId")).success) return c.json({ error: "invalid_season_id" }, 400);
    await next();
  });

  // Public writes: bounded body, then a per-address rate limit before any work.
  app.on("POST", "/:seasonId/*", bodyLimit({ maxSize: deps.maxBodyBytes ?? 64 * 1024, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.on("POST", "/:seasonId/*", async (c, next) => {
    const who = clientAddress((name) => c.req.header(name));
    if (!allowPost(who)) return c.json({ error: "rate_limited" }, 429);
    await next();
  });

  async function seasonFor(raw: string) {
    const parsed = idParam.safeParse(raw);
    if (!parsed.success) return null;
    return deps.store.getSeason(parsed.data);
  }

  app.get("/:seasonId", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    return c.json({
      seasonId: season.seasonId.toString(),
      network: deps.network.label,
      commitsAddress: season.commitsAddress,
      commitsUrl: explorerAddressUrl(deps.network, season.commitsAddress),
      startsAt: season.startsAt.toISOString(),
      endsAt: season.endsAt.toISOString(),
      roundHours: season.roundHours,
      currentRound: roundIndexAt(season, deps.rounds.now())?.toString() ?? null,
    });
  });

  app.get("/:seasonId/leaderboard", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const asked = c.req.query("category");
    const category = asked === undefined || asked === "" || asked === "overall" ? null : parseCategory(asked);
    if (asked !== undefined && asked !== "" && asked !== "overall" && !category) return c.json({ error: "invalid_category" }, 400);
    const key = `${season.seasonId}:${category ?? "overall"}`;
    let board = boards.get(key);
    if (!board || Date.now() - board.at >= cacheMs) {
      const raw = await deps.store.scoringRaw(season.seasonId);
      const lastCommit = raw.rounds.reduce<Date | null>((max, r) => (r.commitBlockTime && (!max || r.commitBlockTime > max) ? r.commitBlockTime : max), null);
      board = { at: Date.now(), rows: computeLeaderboard(raw, category ? { category } : {}), lastCommitAt: lastCommit };
      boards.set(key, board);
    }
    return c.json({
      seasonId: season.seasonId.toString(),
      category: category ?? "overall",
      minRanked: category ? MIN_RANKED_CATEGORY_FORECASTS : MIN_RANKED_FORECASTS,
      network: deps.network.label,
      commitsAddress: season.commitsAddress,
      updatedAt: new Date(board.at).toISOString(),
      lastCommitAt: board.lastCommitAt?.toISOString() ?? null,
      // Outside entries appear once they have a scored forecast.
      rows: board.rows
        .filter((r) => r.house || r.forecastsResolved > 0)
        .map((r) => ({ ...r, meanSkill: round4(r.meanSkill), meanBrier: round4(r.meanBrier), rating: round4(r.rating) })),
    });
  });

  app.get("/:seasonId/ratings", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const key = season.seasonId.toString();
    let cached = ratings.get(key);
    if (!cached || Date.now() - cached.at >= cacheMs) {
      cached = { at: Date.now(), agents: computeRatings(await deps.store.scoringRaw(season.seasonId)) };
      ratings.set(key, cached);
    }
    const show = (x: RatingCell) => ({ ...x, rating: round4(x.rating), meanSkill: round4(x.meanSkill) });
    return c.json({
      seasonId: key,
      updatedAt: new Date(cached.at).toISOString(),
      categories: SEASON_CATEGORIES,
      minRanked: { overall: MIN_RANKED_FORECASTS, category: MIN_RANKED_CATEGORY_FORECASTS },
      agents: cached.agents
        .filter((a) => a.house || a.overall.forecastsResolved > 0)
        .map((a) => ({
          agentAddress: a.agentAddress,
          displayName: a.displayName,
          house: a.house,
          overall: show(a.overall),
          categories: Object.fromEntries(SEASON_CATEGORIES.map((cat) => [cat, show(a.categories[cat])])),
        })),
    });
  });

  app.get("/:seasonId/entries", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const entries = await deps.store.listEntries(season.seasonId);
    return c.json({
      entries: entries.map((e) => ({
        agentAddress: e.agentAddress,
        erc8004AgentId: e.erc8004AgentId?.toString() ?? null,
        displayName: e.displayName,
        house: e.house,
        forecastEndpoint: e.forecastEndpoint,
        enteredRound: e.enteredRound.toString(),
      })),
    });
  });

  app.get("/:seasonId/rounds", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "20") || 20, 1), 1000);
    const rounds = await deps.store.listRounds(season.seasonId, limit);
    return c.json({
      rounds: rounds.map((r) => ({ round: r.round.toString(), state: r.state, openedAt: r.openedAt.toISOString(), commitTx: r.commitTx })),
    });
  });

  app.get("/:seasonId/rounds/:round", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const parsedRound = idParam.safeParse(c.req.param("round"));
    if (!parsedRound.success) return c.json({ error: "invalid_round" }, 400);
    const round = await deps.store.getRound(season.seasonId, parsedRound.data);
    if (!round) return c.json({ error: "round_not_found" }, 404);
    const markets = await deps.store.listRoundMarkets(season.seasonId, round.round);
    // Forecasts, salts and signatures stay private until the round's root is
    // on chain, so no agent can copy another's forecast during intake.
    const committed = round.state === "committed";
    const forecasts = committed ? await deps.store.listRoundForecasts(season.seasonId, round.round) : [];
    let cached: ProofCache | undefined;
    if (committed && forecasts.length > 0) {
      const key = `${season.seasonId}:${round.round}`;
      cached = proofs.get(key);
      if (!cached) {
        const slate = slateLeaf(season.seasonId, round.round, markets);
        const tree = buildRoundTree([...forecasts.map((f) => f.leaf), slate]);
        const all = allProofs(tree.leaves);
        cached = { forecasts: all, slateLeaf: slate, slateProof: all.get(slate) ?? [] };
        proofs.set(key, cached);
      }
    }
    return c.json({
      round: round.round.toString(),
      state: round.state,
      openedAt: round.openedAt.toISOString(),
      intakeClosesAt: round.intakeClosesAt.toISOString(),
      markets: markets.map((m) => ({ marketId: m.marketId, question: m.question, slug: m.slug, endAt: m.endAt.toISOString(), baselineBps: m.baselineBps, category: m.category })),
      commit: committed
        ? {
            root: round.commitRoot,
            count: round.commitCount,
            tx: round.commitTx,
            txUrl: explorerTxUrl(deps.network, round.commitTx!),
            blockTime: round.commitBlockTime!.toISOString(),
          }
        : null,
      slate: cached ? { leaf: cached.slateLeaf, proof: cached.slateProof } : null,
      forecasts: forecasts.map((f) => ({
        agentAddress: f.agentAddress,
        marketId: f.marketId,
        probabilityBps: f.probabilityBps,
        salt: f.salt,
        signature: f.signature,
        leaf: f.leaf,
        proof: cached?.forecasts.get(f.leaf) ?? [],
      })),
    });
  });

  app.post("/:seasonId/entries", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const parsed = entryBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_entry", detail: parsed.error.issues.map((i) => i.message) }, 400);
    const body = parsed.data;
    const fields: EntryFields = {
      seasonId: season.seasonId,
      erc8004AgentId: body.erc8004AgentId,
      agentAddress: body.agentAddress,
      displayName: body.displayName,
      forecastEndpoint: body.forecastEndpoint ?? null,
    };
    const verified = await deps.verifyEntry({
      ...fields,
      message: entryMessage(fields),
      ownerSignature: body.ownerSignature as Hex,
      agentSignature: body.agentSignature as Hex,
    });
    if (!verified) return c.json({ error: "signature_invalid" }, 403);

    const existing = await deps.store.getEntry(season.seasonId, body.agentAddress);
    if (existing) {
      if (existing.house) return c.json({ error: "house_agent" }, 409);
      const same =
        existing.erc8004AgentId === fields.erc8004AgentId &&
        existing.displayName === fields.displayName &&
        existing.forecastEndpoint === fields.forecastEndpoint;
      return same
        ? c.json({ entered: true, enteredRound: existing.enteredRound.toString() }, 200)
        : c.json({ error: "already_entered" }, 409);
    }
    const holder = await deps.store.getEntryByAgentId(season.seasonId, fields.erc8004AgentId);
    if (holder) return c.json({ error: "agent_id_taken" }, 409);
    const enteredRound = entryRoundAt(season, deps.rounds.now());
    if (enteredRound === null) return c.json({ error: "season_not_open" }, 409);
    await deps.store.upsertEntry({ ...fields, house: false, enteredRound });
    return c.json({ entered: true, enteredRound: enteredRound.toString() }, 201);
  });

  app.post("/:seasonId/forecasts", async (c) => {
    const season = await seasonFor(c.req.param("seasonId"));
    if (!season) return c.json({ error: "season_not_found" }, 404);
    const parsed = z.object({ forecasts: z.array(forecastItem).min(1).max(50) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_forecasts" }, 400);
    const results = [];
    for (const f of parsed.data.forecasts) {
      results.push(
        await acceptForecast(deps.rounds, {
          seasonId: season.seasonId,
          round: f.round,
          marketId: f.marketId,
          agentAddress: f.agentAddress,
          probabilityBps: f.probabilityBps,
          salt: f.salt as Hex,
          signature: f.signature as Hex,
        }),
      );
    }
    return c.json({ results });
  });

  return app;
}
