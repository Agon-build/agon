import { Hono } from "hono";

import { agonNetwork } from "../network.ts";
import { buildRoundTree, proofFor } from "../playground/seasons/forecast.ts";
import { arenaLeaderboard } from "./leaderboard.ts";
import { answerLeaf, taskHash } from "./leaves.ts";
import type { ArenaRaw, ArenaRound, ArenaSeason, TrackDef } from "./types.ts";

/// Public Arena pages for every track. A round's questions, true answers and the
/// agents' answers leave the server only once the round is committed on Arc, so
/// nothing here can help an agent answer a round that is still open.

export type ArenaTrackSource = { def: Pick<TrackDef, "id" | "label" | "categoryId">; season: ArenaSeason | null; raw(): Promise<ArenaRaw | null> };

const ROUND = /^\d{1,6}$/;
const EXCERPT_SHOWN = 500;

const seasonView = (s: ArenaSeason) => ({ seasonId: s.seasonId.toString(), network: s.network, explorer: agonNetwork(s.network).explorer, commitsAddress: s.commitsAddress, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), roundHours: s.roundHours });
const roundView = (r: ArenaRound) => ({
  round: Number(r.round), state: r.state, openedAt: r.opensAt.toISOString(),
  ...(r.state === "committed" ? { root: r.root, count: r.count, tx: r.tx, committedAt: r.blockTime?.toISOString() ?? null } : {}),
});

export function createArenaRoutes(deps: { tracks: ArenaTrackSource[] }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    c.header("access-control-allow-origin", "*");
    if (c.res.status === 200) c.header("cache-control", "public, max-age=60");
  });
  const find = (id: string) => deps.tracks.find((t) => t.def.id === id) ?? null;
  const head = (t: ArenaTrackSource) => ({ id: t.def.id, label: t.def.label, categoryId: t.def.categoryId, open: t.season !== null, season: t.season ? seasonView(t.season) : null });

  app.get("/tracks", (c) => c.json({ tracks: deps.tracks.map(head) }));

  app.get("/tracks/:track", async (c) => {
    const track = find(c.req.param("track"));
    if (!track) return c.json({ error: "track_not_found" }, 404);
    const raw = await track.raw();
    if (!raw) return c.json({ ...head(track), ranked: false, rows: [], rounds: [] });
    const board = arenaLeaderboard(raw);
    return c.json({ ...head(track), ranked: board.ranked, rows: board.rows, rounds: [...raw.rounds].reverse().slice(0, 10).map(roundView) });
  });

  app.get("/tracks/:track/rounds", async (c) => {
    const track = find(c.req.param("track"));
    if (!track) return c.json({ error: "track_not_found" }, 404);
    const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? 20) || 20, 60));
    const raw = await track.raw();
    return c.json({ rounds: raw ? [...raw.rounds].reverse().slice(0, limit).map(roundView) : [] });
  });

  app.get("/tracks/:track/rounds/:round", async (c) => {
    const track = find(c.req.param("track"));
    if (!track) return c.json({ error: "track_not_found" }, 404);
    if (!ROUND.test(c.req.param("round"))) return c.json({ error: "invalid_round" }, 400);
    const n = BigInt(c.req.param("round"));
    const raw = await track.raw();
    const round = raw?.rounds.find((r) => r.round === n);
    if (!raw || !round) return c.json({ error: "round_not_found" }, 404);
    const entrants = raw.entrants.filter((e) => e.round === n).map((e) => ({ agentId: e.agentId, listingReference: e.listingReference, name: e.name, firstParty: e.firstParty, status: e.status }));
    // Until Arc holds the round, only who is in it is shown.
    if (round.state !== "committed") return c.json({ ...roundView(round), entrants });

    const tasks = raw.tasks.filter((t) => t.round === n);
    const hashes = new Map(tasks.map((t) => [t.taskId, taskHash(t)]));
    const answers = raw.answers.filter((a) => a.round === n);
    const leaves = answers.map((a) => answerLeaf(a, hashes.get(a.taskId)!));
    const tree = leaves.length > 0 ? buildRoundTree(leaves) : null;
    return c.json({
      ...roundView(round), entrants,
      tasks: tasks.map((t) => ({ taskId: t.taskId, family: t.family, question: t.question, valueType: t.valueType, truth: t.truth, void: t.void, hash: hashes.get(t.taskId) })),
      answers: answers.map((a, i) => ({
        taskId: a.taskId, agentId: a.agentId, outcome: a.outcome, score: a.score, durationMs: a.durationMs, answerHash: a.answerHash,
        excerpt: a.excerpt === null ? null : a.excerpt.slice(0, EXCERPT_SHOWN),
        leaf: leaves[i], proof: tree ? proofFor(tree.leaves, leaves[i]!) : [],
      })),
    });
  });

  return app;
}
