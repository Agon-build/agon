import { Hono } from "hono";
import { z } from "zod";
import type { Address, Hex } from "viem";

import type { AgonNetwork, AgonNetworkId } from "../network.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "./exact-seller.ts";

/// Testnet stand-in for the Circle marketplace services the lead agent buys
/// from on Arc mainnet (BlockRun's DefiLlama price and prediction-market
/// search). Same prices, same x402 exact payment, real public data, testnet
/// USDC. Mounted only when payments run on arc-testnet.
export const STANDIN_PRICE_ATOMIC = 2_000n;
export const STANDIN_SEARCH_ATOMIC = 8_500n;

const COINS = /^[a-z0-9:,\-]{1,200}$/;

function strings(value: unknown): string[] | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

const gammaMarket = z.object({
  conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  question: z.string(),
  slug: z.string().default(""),
  endDate: z.string().default(""),
  outcomes: z.unknown(),
  outcomePrices: z.unknown(),
  liquidityNum: z.coerce.number().optional(),
  closed: z.boolean().optional(),
});

export function createStandinRoutes(deps: {
  network: AgonNetwork;
  payTo: Address;
  settle: ExactSettler;
  claimNonce: (n: AgonNetworkId, payer: Address, nonce: Hex) => Promise<boolean>;
  fetchImpl?: typeof fetch;
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  const upstream = deps.fetchImpl ?? fetch;
  const pay = (amount: bigint, description: string) =>
    exactPayment({ network: deps.network, payTo: deps.payTo, price: async () => amount, settle: deps.settle, claimNonce: deps.claimNonce, description });

  app.use("/price/:coins", async (c, next) => (COINS.test(c.req.param("coins")) ? next() : c.json({ error: "invalid_coins" }, 400)));
  app.get("/price/:coins", pay(STANDIN_PRICE_ATOMIC, "Token price lookup (DefiLlama)"), async (c) => {
    const res = await upstream(`https://coins.llama.fi/prices/current/${c.req.param("coins")}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return c.json({ error: "upstream_unavailable" }, 502);
    return c.json(await res.json());
  });

  app.use("/markets", async (c, next) => {
    const q = (c.req.query("q") ?? "").trim();
    return q.length >= 2 && q.length <= 200 ? next() : c.json({ error: "invalid_query" }, 400);
  });
  app.get("/markets", pay(STANDIN_SEARCH_ATOMIC, "Prediction market search (Polymarket)"), async (c) => {
    // events_status=active: without it Polymarket ranks long-closed events first.
    const params = new URLSearchParams({ q: (c.req.query("q") ?? "").trim(), limit_per_type: "10", events_status: "active" });
    const res = await upstream(`https://gamma-api.polymarket.com/public-search?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return c.json({ error: "upstream_unavailable" }, 502);
    const body = (await res.json()) as { events?: { markets?: unknown[] }[] };
    const markets = [];
    for (const event of body.events ?? []) {
      for (const raw of event.markets ?? []) {
        const m = gammaMarket.safeParse(raw);
        if (!m.success || m.data.closed === true) continue;
        const outcomes = strings(m.data.outcomes);
        const prices = strings(m.data.outcomePrices)?.map(Number);
        if (!outcomes || outcomes[0] !== "Yes" || outcomes[1] !== "No" || !prices || !Number.isFinite(prices[0])) continue;
        markets.push({
          conditionId: m.data.conditionId.toLowerCase(), question: m.data.question, slug: m.data.slug, endDate: m.data.endDate,
          yesPriceBps: Math.round(prices[0]! * 10_000), liquidity: m.data.liquidityNum ?? 0,
        });
      }
    }
    return c.json({ markets });
  });
  // Mounted as a plain sub-app; the x402 variable stays internal to these routes.
  return app as unknown as Hono;
}
