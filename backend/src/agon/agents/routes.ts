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
import { randomBytes } from "node:crypto";

import { MAX_WATCH_MARKETS, alertsBetween, parseMarketRefs, stateFromGamma, type WatchState } from "./resolution-watch.ts";
import { rulesCheck, rulesCheckPrompt } from "./rules-check.ts";
import type { WatchStore } from "./watch-store.ts";
import { scoutReport, scoutRulesPrompt } from "./scout.ts";

export type SpecialistKey = "pitch" | "scout" | "rules" | "watch";
export const SPECIALISTS: Record<SpecialistKey, { name: string; price: bigint; model: string; description: string }> = {
  pitch: { name: "Pitch", price: 150_000n, model: "global.anthropic.claude-haiku-5-5", description: "Pitch football forecast" },
  scout: { name: "Scout", price: 100_000n, model: "global.anthropic.claude-haiku-5-5", description: "Scout Polymarket market check" },
  rules: { name: "Rules Check", price: 250_000n, model: "global.anthropic.claude-sonnet-5-5", description: "Rules Check: Polymarket resolution rules" },
  // The model only answers the listing certification task; watching is code.
  watch: { name: "Resolution Watch", price: 250_000n, model: "global.anthropic.claude-haiku-5-5", description: "Resolution Watch: settlement alerts for up to 10 Polymarket markets" },
};
const CAPABILITY: Record<SpecialistKey, string> = { pitch: "analysis", scout: "analysis", rules: "verification", watch: "verification" };
const WATCH_DAYS = 60;
const RULES_MAX_TOKENS = 1_500;
export type SpecialistSeller = { payTo: Address; settle: ExactSettler };

const body = z.object({ market: z.string().trim().min(3).max(400) });
const watchBody = z.object({ markets: z.string().trim().min(3).max(4_000) });
const watchRefs = (raw: unknown): string[] | null => { const b = watchBody.safeParse(raw); return b.success ? parseMarketRefs(b.data.markets) : null; };

const marketView = (m: MarketSnapshot) => ({ question: m.question, url: m.url, slug: m.slug, closesAt: m.endAt.toISOString(), crowdBps: m.yesBps });

/// Specialist agents Agon runs and sells per call over x402: Pitch forecasts
/// football markets, Scout checks whether a Polymarket market is worth trading,
/// Rules Check reads a market's resolution rules for traps and dispute risk,
/// Resolution Watch alerts on settlement of up to 10 markets until they settle.
/// The market is looked up before any money moves; a market the agent cannot
/// serve is refused with nothing charged.
export function createSpecialistRoutes(deps: {
  network: AgonNetwork;
  sellers: Partial<Record<SpecialistKey, SpecialistSeller>>;
  store: PaymentsStore;
  lookup: MarketLookup;
  callModel: ModelCaller;
  /** Resolution Watch: where watches are kept and how a payer maps to an Agon account. */
  watch?: { store: Pick<WatchStore, "createWatch" | "getWatch">; ownerOf: (payer: Address) => Promise<string | null>; statusBase: string; newId?: () => string };
  now?: () => Date;
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  const now = deps.now ?? (() => new Date());
  const markets = new WeakMap<Request, MarketSnapshot>();
  const watched = new WeakMap<Request, MarketSnapshot[]>();
  const sellerFor = (key: string) => (Object.hasOwn(SPECIALISTS, key) && deps.sellers[key as SpecialistKey] && (key !== "watch" || deps.watch) ? { key: key as SpecialistKey, seller: deps.sellers[key as SpecialistKey]! } : null);
  const gates = new Map<string, ReturnType<typeof createCertificationGate>>();
  const gateFor = (key: string) => gates.get(key) ?? gates.set(key, createCertificationGate()).get(key)!;

  // A watch's status is public by its unguessable id; the owner is never shown.
  app.get("/watch/:id", async (c) => {
    const found = deps.watch ? await deps.watch.store.getWatch(c.req.param("id")) : null;
    if (!found) return c.json({ error: "not_found" }, 404);
    const { watch, markets: ms, alerts } = found;
    return c.json({
      watchId: watch.watchId, status: watch.status, endsAt: watch.endsAt.toISOString(),
      markets: ms.map((m) => ({ question: m.question, url: m.url, status: m.state.status, outcome: m.state.outcome, yesBps: m.state.yesBps, updatedAt: m.updatedAt.toISOString() })),
      alerts: alerts.map((a) => ({ kind: a.kind, title: a.title, body: a.body, at: a.createdAt.toISOString() })),
    });
  });

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
      // Resolution Watch answers the settlement-alerts test with the same code its worker runs.
      ...(found.key === "watch" ? { settlementAlerts: async (t: { question: string; readings: Record<string, unknown>[] }) => {
        const states = t.readings.map(stateFromGamma);
        return states.flatMap((s, i) => (i === 0 ? [] : alertsBetween(t.question, states[i - 1]!, s).map((a) => ({ step: i, kind: a.kind }))));
      } } : {}),
    });
    if (check === "preflight") return next();
    if (check) return check;
    if (found.key === "watch") {
      if (!watchRefs(raw)) return c.json({ error: "invalid_request", message: `Send {"markets": "<up to ${MAX_WATCH_MARKETS} Polymarket links, slugs or condition ids, one per line>"}.` }, 400);
    } else if (!body.safeParse(raw).success) return c.json({ error: "invalid_request", message: "Send {\"market\": \"<polymarket link, slug or condition id>\"}." }, 400);
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
          if (key === "watch") {
            const refs = watchRefs(await ctx.req.raw.clone().json().catch(() => null));
            if (!refs) return "invalid_request";
            const found: MarketSnapshot[] = [];
            for (const ref of refs) {
              const r = await deps.lookup(ref);
              if (!r.ok) return r.code;
              if (r.market.closed) return "market_closed";
              found.push(r.market);
            }
            watched.set(ctx.req.raw, found);
            return null;
          }
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
      if (key === "watch") {
        const w = deps.watch!;
        const list = watched.get(c.req.raw)!;
        const payer = c.get("x402").payer;
        const watchId = w.newId?.() ?? randomBytes(16).toString("hex");
        const endsAt = new Date(now().getTime() + WATCH_DAYS * 86_400_000);
        // The first reading is the baseline: an already proposed market raises "settlement started" on the next tick.
        const baseline = (m: MarketSnapshot): WatchState => ({ status: "open", outcome: null, yesBps: m.yesBps, rules: m.description });
        await w.store.createWatch({ watchId, ownerAddress: await w.ownerOf(payer).catch(() => null), payer, network: deps.network.id, endsAt },
          list.map((m) => ({ conditionId: m.conditionId, question: m.question, url: m.url, state: baseline(m) })), now());
        return c.json({
          agent: spec.name, watchId, statusUrl: `${w.statusBase}/${watchId}`, endsAt: endsAt.toISOString(),
          markets: list.map((m) => ({ question: m.question, url: m.url, status: "open" })),
        });
      }
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
