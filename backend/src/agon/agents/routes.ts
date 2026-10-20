import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../network.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "../payments/exact-seller.ts";
import { LISTING_BODY_LIMIT_BYTES, answerListingCheck, createCertificationGate } from "../payments/listing-protocols.ts";
import type { PaymentsStore } from "../payments/types.ts";
import { FORECAST_MAX_TOKENS, parseProbability, type ModelCaller } from "../playground/seasons/house-agents.ts";
import type { MarketLookup, MarketSnapshot } from "./market-lookup.ts";
import { isFootballMarket, pitchPrompt } from "./pitch.ts";
import { rulesCheck, rulesCheckPrompt } from "./rules-check.ts";
import { scoutReport, scoutRulesPrompt } from "./scout.ts";

export type SpecialistKey = "pitch" | "scout" | "rules";
export const SPECIALISTS: Record<SpecialistKey, { name: string; price: bigint; model: string; description: string }> = {
  pitch: { name: "Pitch", price: 150_000n, model: "global.anthropic.claude-haiku-5-5", description: "Pitch football forecast" },
  scout: { name: "Scout", price: 100_000n, model: "global.anthropic.claude-haiku-5-5", description: "Scout Polymarket market check" },
  rules: { name: "Rules Check", price: 250_000n, model: "global.anthropic.claude-sonnet-5-5", description: "Rules Check: Polymarket resolution rules" },
};
const CAPABILITY: Record<SpecialistKey, string> = { pitch: "analysis", scout: "analysis", rules: "verification" };
const RULES_MAX_TOKENS = 1_500;
export type SpecialistSeller = { payTo: Address; settle: ExactSettler };

const body = z.object({ market: z.string().trim().min(3).max(400) });

const marketView = (m: MarketSnapshot) => ({ question: m.question, url: m.url, slug: m.slug, closesAt: m.endAt.toISOString(), crowdBps: m.yesBps });

/// Specialist agents Agon runs and sells per call over x402: Pitch forecasts
/// football markets, Scout checks whether a Polymarket market is worth trading,
/// Rules Check reads a market's resolution rules for traps and dispute risk.
/// The market is looked up before any money moves; a market the agent cannot
/// serve is refused with nothing charged.
export function createSpecialistRoutes(deps: {
  network: AgonNetwork;
  sellers: Partial<Record<SpecialistKey, SpecialistSeller>>;
  store: PaymentsStore;
  lookup: MarketLookup;
  callModel: ModelCaller;
  now?: () => Date;
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  const now = deps.now ?? (() => new Date());
  const markets = new WeakMap<Request, MarketSnapshot>();
  const sellerFor = (key: string) => (Object.hasOwn(SPECIALISTS, key) && deps.sellers[key as SpecialistKey] ? { key: key as SpecialistKey, seller: deps.sellers[key as SpecialistKey]! } : null);
  const gates = new Map<string, ReturnType<typeof createCertificationGate>>();
  const gateFor = (key: string) => gates.get(key) ?? gates.set(key, createCertificationGate()).get(key)!;

  app.use("/:key", bodyLimit({ maxSize: LISTING_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/:key", async (c, next) => {
    const found = sellerFor(c.req.param("key"));
    if (!found) return c.json({ error: "not_for_sale" }, 404);
    const spec = SPECIALISTS[found.key];
    const raw = await c.req.raw.clone().json().catch(() => null);
    const check = await answerListingCheck(c, raw, {
      agent: { name: spec.name, capabilities: [CAPABILITY[found.key]] },
      model: spec.model,
      callModel: async (p) => deps.callModel({ model: p.model, systemPrompt: p.system, userPrompt: p.prompt, maxTokens: p.maxTokens, temperature: 0.2 }),
      gate: gateFor(found.key),
      // Rules Check answers the Playground's market-rules test with the same reading it sells.
      ...(found.key === "rules" ? { marketRules: async (t: { question: string; rules: string }) => {
        const reply = await deps.callModel({ model: spec.model, ...rulesCheckPrompt(t.question, t.rules), maxTokens: RULES_MAX_TOKENS, temperature: 0 });
        const { decides, traps, risk } = rulesCheck({ question: t.question, rules: t.rules, umaStatuses: [] }, reply.text);
        return { decides, traps, risk };
      } } : {}),
    });
    if (check === "preflight") return next();
    if (check) return check;
    if (!body.safeParse(raw).success) return c.json({ error: "invalid_request", message: "Send {\"market\": \"<polymarket link, slug or condition id>\"}." }, 400);
    return next();
  });

  app.post(
    "/:key",
    async (c, next) => {
      const { key, seller } = sellerFor(c.req.param("key"))!;
      return exactPayment({
        network: deps.network,
        payTo: seller.payTo,
        price: async () => SPECIALISTS[key].price,
        settle: seller.settle,
        claimNonce: (n, payer, nonce: Hex) => deps.store.claimSellerNonce(n, payer, nonce),
        description: SPECIALISTS[key].description,
        // Nothing settles until the market is found and fits this agent.
        beforeSettle: async (_payment, ctx) => {
          const parsed = body.safeParse(await ctx.req.raw.clone().json().catch(() => null));
          if (!parsed.success) return "invalid_request";
          const found = await deps.lookup(parsed.data.market);
          if (!found.ok) return found.code;
          if (found.market.closed) return "market_closed";
          if (key === "pitch" && !isFootballMarket(found.market)) return "not_a_football_market";
          markets.set(ctx.req.raw, found.market);
          return null;
        },
        now,
      })(c, next);
    },
    async (c) => {
      const key = c.req.param("key") as SpecialistKey;
      const spec = SPECIALISTS[key];
      const m = markets.get(c.req.raw)!;
      if (key === "pitch") {
        const reply = await deps.callModel({ model: spec.model, ...pitchPrompt(m, now()), maxTokens: FORECAST_MAX_TOKENS, temperature: 0.2 });
        const parsed = parseProbability(reply.text);
        if (!parsed) return c.json({ error: "model_unparseable" }, 502);
        return c.json({
          agent: spec.name, market: marketView(m), probabilityBps: parsed.probabilityBps, crowdBps: m.yesBps,
          edgePts: (parsed.probabilityBps - m.yesBps) / 100, reasons: parsed.reasons.slice(0, 3), model: spec.model,
        });
      }
      if (key === "rules") {
        // The model reads the rules; code keeps only quotes found in them and decides the risk. No price is sent or returned.
        const reply = await deps.callModel({ model: spec.model, ...rulesCheckPrompt(m.question, m.description), maxTokens: RULES_MAX_TOKENS, temperature: 0 }).catch(() => null);
        if (!reply) return c.json({ error: "model_unavailable" }, 502);
        const { crowdBps: _price, ...market } = marketView(m);
        return c.json({ agent: spec.name, market, ...rulesCheck({ question: m.question, rules: m.description, umaStatuses: m.umaStatuses }, reply.text), model: spec.model });
      }
      const report = scoutReport(m, now());
      // The model only summarises the rules; the verdict never depends on it.
      const note = await deps.callModel({ model: spec.model, ...scoutRulesPrompt(m), maxTokens: 200, temperature: 0 })
        .then((r) => r.text.trim().split("\n")[0]!.slice(0, 240))
        .catch(() => "");
      return c.json({ agent: spec.name, market: marketView(m), ...report, rulesNote: note || "Read the market's rules on Polymarket before trading." });
    },
  );
  return app as unknown as Hono;
}
