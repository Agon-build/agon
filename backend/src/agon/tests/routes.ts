import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { TestResultsStore } from "./results-store.ts";
import { publicDetail, publicView, type RunRefusal, type TestService } from "./service.ts";

export const REFUSALS: Record<RunRefusal, { status: 404 | 409 | 422 | 429 | 503; message: string }> = {
  not_found: { status: 404, message: "That listing was not found." },
  not_listed: { status: 409, message: "Only listed agents can be tested." },
  no_test_for_category: { status: 422, message: "There is no public test for this category yet." },
  user_limit: { status: 429, message: "You have run 5 tests in the last hour. Try again later." },
  agent_limit: { status: 429, message: "This agent has had 20 public tests today. Try again tomorrow." },
  in_progress: { status: 429, message: "A test is already running for you or this agent. Try again in a moment." },
  unavailable: { status: 503, message: "Tests are unavailable right now. Try again in a few minutes." },
};

const runSchema = z.object({ listingReference: z.string().min(1).max(200) });
const AGENT_ID = /^\d{1,78}$/;

/// Public Playground tests: anyone reads, signed-in people run.
export function createTestRoutes(deps: { service: TestService; store: TestResultsStore; requireRun: MiddlewareHandler }) {
  const app = new Hono<{ Variables: { address: string } }>();

  app.post("/", deps.requireRun, async (c) => {
    const parsed = runSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "validation_failed", message: "Send the listing reference to test." }, 400);
    const out = await deps.service.runPublic(c.get("address"), parsed.data.listingReference);
    if (!out.ok) {
      const refusal = REFUSALS[out.code];
      return c.json({ error: out.code, message: refusal.message }, refusal.status);
    }
    return c.json(out.result, 201);
  });

  app.get("/", async (c) => {
    const agentId = c.req.query("agentId");
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? 20) || 20));
    if (agentId && !AGENT_ID.test(agentId)) return c.json({ error: "validation_failed", message: "Agent id must be a number." }, 400);
    const rows = agentId ? await deps.store.listByAgent(agentId, limit) : await deps.store.listRecent(limit);
    c.header("cache-control", "public, max-age=15");
    return c.json({ items: rows.map(publicView) });
  });

  app.get("/remaining/:agentId", async (c) => {
    const agentId = c.req.param("agentId");
    if (!AGENT_ID.test(agentId)) return c.json({ error: "validation_failed", message: "Agent id must be a number." }, 400);
    const perAgentDay = deps.service.limits.perAgentDay;
    return c.json({ agentId, remainingToday: await deps.store.remainingToday(agentId, new Date(), perAgentDay), perAgentDay });
  });

  app.get("/:id", async (c) => {
    const row = await deps.store.get(c.req.param("id"));
    if (!row) return c.json({ error: "not_found", message: "That test was not found." }, 404);
    return c.json(publicDetail(row));
  });

  return app;
}
