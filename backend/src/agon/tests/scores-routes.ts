import { Hono } from "hono";

import { WINDOWS, type Window } from "./scores.ts";
import type { ScoreRow, ScoreSnapshotStore } from "./snapshots.ts";

const SORTS = ["score", "playground", "arena", "paid"] as const;
type Sort = (typeof SORTS)[number];
const AGENT_ID = /^\d{1,78}$/;
const CATEGORY = /^\d{1,3}$/;

const view = (r: ScoreRow) => ({
  agentId: r.agentId, listingReference: r.listingReference, categoryId: r.categoryId, firstParty: r.firstParty, rank: r.rank,
  score: r.score, previousScore: r.previousScore, change: r.change, parts: r.parts, counts: r.counts,
});

function sortRows(rows: ScoreRow[], sort: Sort): ScoreRow[] {
  if (sort === "score") return rows;
  const value = (r: ScoreRow) => r.parts[sort].value;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return (a.rank ?? Infinity) - (b.rank ?? Infinity);
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va || (a.rank ?? Infinity) - (b.rank ?? Infinity);
  });
}

/// Public Agon scores, read from snapshots. Boards are per category only.
export function createScoresRoutes(deps: { store: ScoreSnapshotStore; remainingTests?: (agentId: string) => Promise<number>; now?: () => Date }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    await next();
    if (c.res.status === 200) c.header("cache-control", "public, max-age=60");
  });

  app.get("/", async (c) => {
    const agents = c.req.query("agents");
    if (agents !== undefined) {
      const ids = agents.split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.length || ids.length > 100 || !ids.every((id) => AGENT_ID.test(id))) {
        return c.json({ error: "validation_failed", message: "List up to 100 agent ids, separated by commas." }, 400);
      }
      return c.json({ items: (await deps.store.forAgents(ids, "all")).map(view) });
    }
    const category = c.req.query("category");
    if (!category) return c.json({ error: "category_required", message: "Choose a category. Boards are per category." }, 400);
    if (!CATEGORY.test(category)) return c.json({ error: "validation_failed", message: "Category must be a number." }, 400);
    const window = (c.req.query("window") ?? "all") as Window;
    if (!WINDOWS.includes(window)) return c.json({ error: "validation_failed", message: "Window must be all, 30d, 7d or 24h." }, 400);
    const sort = (c.req.query("sort") ?? "score") as Sort;
    if (!SORTS.includes(sort)) return c.json({ error: "validation_failed", message: "Sort by score, playground, arena or paid." }, 400);
    const rows = await deps.store.board(category, window);
    return c.json({ category, window, sort, computedAt: rows[0]?.computedAt ?? null, rows: sortRows(rows, sort).map(view) });
  });

  app.get("/:agentId", async (c) => {
    const agentId = c.req.param("agentId");
    if (!AGENT_ID.test(agentId)) return c.json({ error: "validation_failed", message: "Agent id must be a number." }, 400);
    const rows = await deps.store.forAgent(agentId);
    if (!rows.length) return c.json({ error: "not_found", message: "This agent has no score yet." }, 404);
    const category = rows[0]!.categoryId;
    const windows = Object.fromEntries(WINDOWS.map((w) => {
      const row = rows.find((r) => r.categoryId === category && r.window === w);
      return [w, row ? view(row) : null];
    }));
    const now = (deps.now ?? (() => new Date()))();
    return c.json({
      agentId,
      category,
      windows,
      history: await deps.store.history(agentId, category, 30, now),
      remainingTests: deps.remainingTests ? await deps.remainingTests(agentId) : null,
    });
  });

  return app;
}
