import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork } from "../../network.ts";
import { sellerRespond } from "../../payments/bargain.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "../../payments/exact-seller.ts";
import type { PaymentsStore } from "../../payments/types.ts";
import { LISTING_BODY_LIMIT_BYTES, answerListingCheck, createCertificationGate } from "../../payments/listing-protocols.ts";
import { FORECAST_MAX_TOKENS, forecastPrompt, parseProbability, type HouseAgentSpec, type ModelCaller } from "./house-agents.ts";

export type HouseSeller = { spec: HouseAgentSpec; payTo: Address; settle: ExactSettler };

const QUOTE_TTL_MS = 5 * 60_000;
const atomic = z.string().regex(/^\d{1,18}$/).transform((v) => BigInt(v));
const quoteBody = z.object({
  buyer: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((v) => v.toLowerCase() as Address),
  offer: atomic,
  round: z.number().int().min(1).max(3),
  lastCounter: atomic.optional(),
});
const forecastBody = z.object({
  marketId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  question: z.string().min(5).max(300),
  endDate: z.string().datetime({ offset: true }),
  crowdBps: z.number().int().min(0).max(10_000).optional(),
  notes: z.array(z.string().max(200)).max(5).optional(),
});

/// House forecasters as real sellers: they haggle down to a floor over HTTP,
/// then sell one forecast per x402 payment, at the agreed quote or the list
/// price. The market-copy benchmark is never for sale.
export function createHouseSellerRoutes(deps: {
  network: AgonNetwork;
  sellers: Record<string, HouseSeller>;
  store: PaymentsStore;
  ask: bigint;
  floor: bigint;
  callModel: ModelCaller;
  now?: () => Date;
  newQuoteId?: () => string;
  maxRounds?: number;
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  const now = deps.now ?? (() => new Date());
  const seller = (key: string) => {
    const s = deps.sellers[key];
    return s && s.spec.kind === "model" ? s : null;
  };

  app.post("/:key/quote", async (c) => {
    const s = seller(c.req.param("key"));
    if (!s) return c.json({ error: "not_for_sale" }, 404);
    const parsed = quoteBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_quote_request" }, 400);
    const { buyer, offer, round, lastCounter } = parsed.data;
    const decision = sellerRespond({ ask: deps.ask, floor: deps.floor, offer, round, maxRounds: deps.maxRounds ?? 3, lastCounter: lastCounter ?? null });
    if (decision.kind === "counter") return c.json({ kind: "counter", amount: decision.amount.toString() });
    if (decision.kind === "walk") return c.json({ kind: "walk" });
    const quoteId = (deps.newQuoteId ?? randomUUID)();
    const expiresAt = new Date(now().getTime() + QUOTE_TTL_MS);
    await deps.store.insertQuote({ quoteId, sellerKey: c.req.param("key"), buyer, amount: decision.amount, expiresAt, usedAt: null, transcript: [{ offer: offer.toString(), round }] });
    return c.json({ kind: "accept", amount: decision.amount.toString(), quoteId, expiresAt: expiresAt.toISOString() });
  });

  // One budget per house agent, so a busy one never blocks the others.
  const gates = new Map<string, ReturnType<typeof createCertificationGate>>();
  const gateFor = (key: string) => gates.get(key) ?? gates.set(key, createCertificationGate()).get(key)!;
  app.use("/:key/forecast", bodyLimit({ maxSize: LISTING_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/:key/forecast", async (c, next) => {
    const s = seller(c.req.param("key"));
    if (!s) return c.json({ error: "not_for_sale" }, 404);
    const raw = await c.req.raw.clone().json().catch(() => null);
    const check = await answerListingCheck(c, raw, {
      agent: { name: s.spec.displayName.replace(/\s*\(house[^)]*\)$/, ""), capabilities: ["analysis"] },
      model: s.spec.model!,
      callModel: async (p) => deps.callModel({ model: p.model, systemPrompt: p.system, userPrompt: p.prompt, maxTokens: p.maxTokens, temperature: 0.2 }),
      gate: gateFor(c.req.param("key")),
    });
    if (check === "preflight") return next();
    if (check) return check;
    const body = forecastBody.safeParse(raw);
    if (!body.success) return c.json({ error: "invalid_forecast_request" }, 400);
    return next();
  });

  app.post(
    "/:key/forecast",
    async (c, next) => {
      const s = seller(c.req.param("key"))!;
      const quoteId = c.req.header("x-agon-quote");
      const quote = quoteId ? await deps.store.getQuote(quoteId) : null;
      const quoted = quote && !quote.usedAt && quote.expiresAt > now() && quote.sellerKey === c.req.param("key") ? quote : null;
      return exactPayment({
        network: deps.network,
        payTo: s.payTo,
        price: async () => quoted?.amount ?? deps.ask,
        settle: s.settle,
        claimNonce: (n, payer, nonce: Hex) => deps.store.claimSellerNonce(n, payer, nonce),
        description: `${s.spec.displayName} forecast`,
        beforeSettle: async (payment) => (quoted && !(await deps.store.useQuote(quoted.quoteId, payment.payer, now())) ? "quote_invalid" : null),
        now,
      })(c, next);
    },
    async (c) => {
      const s = seller(c.req.param("key"))!;
      const body = forecastBody.parse(await c.req.json());
      const market = {
        seasonId: 0n, round: 0n, marketId: body.marketId as Hex, question: body.question, slug: "",
        endAt: new Date(body.endDate), baselineBps: body.crowdBps ?? 5_000, category: "other" as const,
      };
      const reply = await deps.callModel({ model: s.spec.model!, ...forecastPrompt(s.spec, market, now(), body.notes ?? []), maxTokens: FORECAST_MAX_TOKENS, temperature: 0.2 });
      const parsed = parseProbability(reply.text);
      if (!parsed) return c.json({ error: "model_unparseable" }, 502);
      return c.json({ probabilityBps: parsed.probabilityBps, reasons: parsed.reasons, model: s.spec.model, agent: s.spec.displayName });
    },
  );
  // Mounted as a plain sub-app; the x402 variable stays internal to these routes.
  return app as unknown as Hono;
}
