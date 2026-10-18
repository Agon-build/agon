import { fromJsonSchema, type AuthInfo, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { formatUsdc } from "../payments/bargain.ts";
import { askJson, rankedJson, routeQuoteJson } from "../stage/app-routes.ts";
import type { Router } from "../routing/router.ts";
import type { CustodyTerms } from "../stage/custody-terms.ts";
import { parseUsdc } from "../stage/money.ts";
import { createRateLimiter } from "../stage/rate-limit.ts";
import type { StageServices } from "../stage/services.ts";
import { operatorOwnerRef } from "../stage/settings.ts";
import { failure, requireActor, result } from "./tool-results.ts";

export type StageMcpDeps = {
  services: StageServices;
  season: { request(path: string, init?: RequestInit): Response | Promise<Response> } | null;
  seasonId: string;
  off: () => boolean;
  /** Agent wallet terms the account owner accepts once in the browser. */
  terms: Pick<CustodyTerms, "isAccepted">;
  /** The aggregator; when set, find_service routes a need and hire_service takes a routeId. */
  router?: Router;
  /** Per-actor quote limit; true while under it. */
  limit?: (actor: string) => boolean;
};

const LEAD_OUTCOME = "A probability for a Polymarket question, with three reasons, next to the market's own price. The lead agent buys live data and hires one of Agon's Season 1 forecasters after haggling.";

const findSchema = fromJsonSchema<{ need?: string }>({
  type: "object",
  properties: { need: { type: "string", maxLength: 600, description: "What the user needs done, in plain words. Agon picks the best rated, fair-priced agent for it." } },
  additionalProperties: false,
});
const hireSchema = fromJsonSchema<{ ref?: string; question?: string; maxPrice?: string; routeId?: string; reference?: string; input?: Record<string, unknown> }>({
  type: "object",
  properties: {
    routeId: { type: "string", maxLength: 64, description: "The routeId from find_service." },
    reference: { type: "string", maxLength: 600, description: "The reference of the pick or an alternative from find_service." },
    input: { type: "object", description: "Only when hire_service asked a question: the input values to send, as one object." },
    ref: { type: "string", description: "For a forecast: agent:lead." },
    question: { type: "string", minLength: 8, maxLength: 300, description: "For a forecast with ref agent:lead: the question in plain language." },
    maxPrice: { type: "string", description: "For a forecast: most the user will pay in USDC, for example 0.50." },
  },
  additionalProperties: false,
});
const confirmSchema = fromJsonSchema<{ jobId: string; code: string }>({
  type: "object",
  properties: { jobId: { type: "string", minLength: 36, maxLength: 36 }, code: { type: "string", pattern: "^\\d{4}$" } },
  required: ["jobId", "code"],
  additionalProperties: false,
});
const jobSchema = fromJsonSchema<{ jobId: string }>({ type: "object", properties: { jobId: { type: "string", minLength: 1, maxLength: 64 } }, required: ["jobId"], additionalProperties: false });
const boardSchema = fromJsonSchema<{ limit?: number }>({ type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 50 } }, additionalProperties: false });
const entrySchema = fromJsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    agentAddress: { type: "string" }, erc8004AgentId: { type: "string" }, displayName: { type: "string" }, forecastEndpoint: { type: "string" },
    ownerSignature: { type: "string" }, agentSignature: { type: "string" },
  },
  required: ["agentAddress", "erc8004AgentId", "displayName", "ownerSignature", "agentSignature"],
  additionalProperties: false,
});
const forecastsSchema = fromJsonSchema<{ forecasts: unknown[] }>({
  type: "object",
  properties: { forecasts: { type: "array", minItems: 1, maxItems: 50, items: { type: "object" } } },
  required: ["forecasts"],
  additionalProperties: false,
});

const hireInput = z.object({ ref: z.literal("agent:lead"), question: z.string().min(8).max(300), maxPrice: z.string().max(32).optional() });
const routedInput = z.object({ routeId: z.string().min(1).max(64), reference: z.string().min(1).max(600), input: z.record(z.unknown()).optional() });
const confirmInput = z.object({ jobId: z.string().uuid(), code: z.string().regex(/^\d{4}$/) });

async function forward(season: StageMcpDeps["season"], path: string, body: unknown) {
  if (!season) return failure("season_unavailable", "Season 1 is not running on this server.");
  const res = await season.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return result({ status: res.status, body: await res.json().catch(() => null) });
}

const sharedQuoteLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });

export function registerStageTools(server: McpServer, authInfo: () => AuthInfo | undefined, deps: StageMcpDeps): void {
  const quoteLimit = deps.limit ?? ((actor: string) => sharedQuoteLimit(actor));
  server.registerTool("find_service", {
    title: "Find an agent service to hire",
    description: "List agent services that can be hired and paid per use from this MCP connection, with the live price.",
    inputSchema: findSchema,
  }, async (args) => {
    const need = typeof (args as { need?: unknown }).need === "string" ? (args as { need: string }).need.trim() : "";
    if (deps.router && need.length >= 8) {
      const who = requireActor(authInfo(), "agon:read");
      if (typeof who !== "string") return who;
      if (!quoteLimit(who)) return failure("rate_limited", "Too many requests. Wait a minute.");
      const routed = await deps.router.route(operatorOwnerRef(who), need, { quoteLead: false });
      if (routed.kind === "pick") {
        return result({
          routeId: routed.routeId, pick: rankedJson(routed.pick), alternatives: routed.alternatives.map(rankedJson), sources: routed.sources,
          howToHire: "Show the user the pick, its price, fee and total. To hire, call hire_service with routeId and reference (the pick or an alternative).",
        });
      }
      if (routed.kind === "none") return result({ services: [], sources: routed.sources, message: "Nothing on Agon or Circle fits this request. Try describing it differently." });
    }

    const [price, rows] = await Promise.all([deps.services.leadPrice().catch(() => null), deps.services.leaderboard(5).catch(() => null)]);
    return result({
      services: [{
        ref: "agent:lead", name: "Agon Lead Agent", builtBy: "Agon", category: "Prediction", outcome: LEAD_OUTCOME,
        price: price === null ? null : `${formatUsdc(price)} USDC`,
        priceAtomic: price === null ? null : price.toString(),
        network: deps.services.network.label, testnet: deps.services.network.id === "arc-testnet",
        howToHire: "Call hire_service with ref agent:lead and the question.",
      }],
      forecasters: (rows ?? []).map((r) => ({ name: r.displayName, house: r.house, ranked: r.ranked, rank: r.rank, rating: r.rating, beatsMarketBy: r.meanSkill, forecasts: r.forecastsResolved })),
    });
  });

  server.registerTool("hire_service", {
    title: "Get terms to hire an agent service",
    description: "Returns the exact price and a confirmation code (under your limit) or a browser approval link (over it). Nothing is paid until confirm_hire or the approval.",
    inputSchema: hireSchema,
  }, async (args) => {
    const who = requireActor(authInfo(), "agon:read");
    if (typeof who !== "string") return who;
    if (deps.off()) return failure("channel_off", "Hiring through MCP is paused right now.");
    if (!quoteLimit(who)) return failure("rate_limited", "Too many quotes. Wait a minute.");
    const routed = routedInput.safeParse(args);
    if (routed.success) {
      if (!deps.router) return failure("routing_off", "Routing is not available on this server.");
      if (!(await deps.terms.isAccepted(operatorOwnerRef(who)))) {
        return failure("terms_required", `The account owner must accept Agon's agent wallet terms once in the browser at ${deps.services.siteUrl} (Hire page) before an agent can hire.`);
      }
      const quoted = routeQuoteJson(await deps.router.quote(operatorOwnerRef(who), routed.data.routeId, routed.data.reference, routed.data.input));
      if (!quoted.ok) return result(quoted);
      return result({ ...quoted, nextStep: quoted.step === "confirm_code" ? "Show the user the total. When they agree, call confirm_hire with jobId and code (needs the wallet:execute capability)." : "This is over the user's per-hire limit. Ask the user to open approvalUrl in a browser signed in to Agon." });
    }
    const input = hireInput.safeParse(args);
    if (!input.success) return failure("invalid_input", "ref must be agent:lead and question must be 8 to 300 characters.");
    const maxPrice = input.data.maxPrice === undefined ? undefined : parseUsdc(input.data.maxPrice);
    if (maxPrice === null) return failure("invalid_input", "maxPrice must be a USDC amount such as 0.50.");
    // The first quote creates the agent wallet; only the person can accept its terms, in the browser.
    if (!(await deps.terms.isAccepted(operatorOwnerRef(who)))) {
      return failure("terms_required", `The account owner must accept Agon's agent wallet terms once in the browser at ${deps.services.siteUrl} (Hire page) before an agent can hire.`);
    }
    const asked = askJson(await deps.services.ask(operatorOwnerRef(who), { question: input.data.question, ...(maxPrice !== undefined ? { maxPrice } : {}) }));
    if (!asked.ok) return result(asked);
    const nextStep = asked.step === "confirm_code"
      ? "Show the user the price. When they agree, call confirm_hire with jobId and code (needs the wallet:execute capability)."
      : "This is over the user's per-hire limit. Ask the user to open approvalUrl in a browser signed in to Agon.";
    return result({ ...asked, nextStep });
  });

  server.registerTool("confirm_hire", {
    title: "Pay for a quoted hire",
    description: "Pays the quoted price from the user's Agon budget wallet within their limits and returns the result with a receipt link.",
    inputSchema: confirmSchema,
  }, async (args) => {
    const who = requireActor(authInfo(), "wallet:execute");
    if (typeof who !== "string") return who;
    if (deps.off()) return failure("channel_off", "Hiring through MCP is paused right now.");
    const input = confirmInput.safeParse(args);
    if (!input.success) return failure("invalid_input", "jobId must be the quote's job id and code its 4 digits.");
    const out = deps.router ? await deps.router.confirm(operatorOwnerRef(who), input.data.code) : await deps.services.confirm(operatorOwnerRef(who), input.data.code);
    if (!out.ok) return result({ ok: false, code: out.code, ...(out.jobId ? { jobId: out.jobId } : {}) });
    const live = await deps.services.live(out.jobId);
    return result({ ok: true, jobId: out.jobId, amount: formatUsdc(out.amount), txHash: out.txHash, receiptUrl: deps.services.receiptUrl(out.jobId), answer: live?.answer ?? null, result: out.result ?? null });
  });

  server.registerTool("get_job_status", {
    title: "Watch a hire",
    description: "Live progress, payments with Arc links, and the answer for a job.",
    inputSchema: jobSchema,
  }, async ({ jobId }) => {
    const live = await deps.services.live(jobId);
    return live ? result(live) : failure("job_not_found", "No job with that id.");
  });

  server.registerTool("get_leaderboard", {
    title: "Season 1 leaderboard",
    description: "Season 1 forecasters ranked by how much they beat the market once their forecasts resolve. The dry run on Arc Testnet is not scoring yet.",
    inputSchema: boardSchema,
  }, async ({ limit }) => {
    const rows = await deps.services.leaderboard(Math.max(1, Math.min(limit ?? 10, 50)));
    return rows ? result({ rows }) : failure("season_unavailable", "Season 1 is not running on this server.");
  });

  server.registerTool("enter_season", {
    title: "Enter Season 1",
    description: "Enter an ERC-8004 agent in Season 1. Needs the identity owner's signature and the forecast signer's signature over the entry message.",
    inputSchema: entrySchema,
  }, async (args) => forward(deps.season, `/${deps.seasonId}/entries`, args));

  server.registerTool("submit_forecasts", {
    title: "Submit signed forecasts",
    description: "Submit up to 50 signed Season 1 forecasts for the open round.",
    inputSchema: forecastsSchema,
  }, async (args) => forward(deps.season, `/${deps.seasonId}/forecasts`, args));
}
