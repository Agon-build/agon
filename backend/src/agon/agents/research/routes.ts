import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Address, Hex } from "viem";
import { z } from "zod";

import type { ChainReader, MarketReader } from "../../arena/tracks/research/index.ts";
import type { AgonNetwork } from "../../network.ts";
import { exactPayment, type ExactSettler, type X402Paid } from "../../payments/exact-seller.ts";
import { LISTING_BODY_LIMIT_BYTES, answerListingCheck, createCertificationGate, type CertifyModelCaller } from "../../payments/listing-protocols.ts";
import type { PaymentsStore } from "../../payments/types.ts";
import { readChain, readMarket, type Found, type Lookup, type ReadQuestion } from "./lookup.ts";

/// Research agents Agon runs and sells per call over x402. Each takes one input, `question`,
/// and answers one fact it reads itself. They differ in where they look:
/// Ledger reads the Arc chain, Archive reads public market records, Compass reads both and
/// reads the chain twice before it answers. A question outside an agent's reach is refused
/// before payment, with nothing charged.

export const RESEARCH_KEYS = ["ledger", "archive", "compass"] as const;
export type ResearchKey = (typeof RESEARCH_KEYS)[number];
export const RESEARCH_AGENTS: Record<ResearchKey, { name: string; price: bigint; description: string; chain: boolean; markets: boolean; twice: boolean }> = {
  ledger: { name: "Ledger", price: 50_000n, description: "Ledger: one fact from the Arc chain", chain: true, markets: false, twice: false },
  archive: { name: "Archive", price: 50_000n, description: "Archive: one fact from a public market record", chain: false, markets: true, twice: false },
  compass: { name: "Compass", price: 50_000n, description: "Compass: one fact from the Arc chain or a market record, read twice", chain: true, markets: true, twice: true },
};
/// The model only reads a question the words did not settle, and answers a certification task that is not Research's own.
export const RESEARCH_MODEL = "global.anthropic.claude-haiku-5-5";
export type ResearchSeller = { payTo: Address; settle: ExactSettler };

const body = z.object({ question: z.string().trim().min(8).max(600) });

const REFUSALS: Readonly<Record<string, string>> = {
  unsupported_question: "This agent cannot answer that question.",
  not_found: "That block or market was not found.",
  source_unavailable: "The source did not answer. Try again in a minute.",
  source_disagrees: "Two readings of the source did not agree, so no answer is sold.",
};

const handle = z.object({ walletId: z.string().min(1), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });
/// The research agents' seller wallets from AGON_RESEARCH_WALLETS, a JSON map of ledger, archive
/// and compass to wallet handles. A wrong value sells nothing and says why; it never stops payments.
export function researchWalletsFrom(env: Record<string, string | undefined>): { wallets: Partial<Record<ResearchKey, { walletId: string; address: Address }>>; problem: string | null } {
  const raw = env.AGON_RESEARCH_WALLETS?.trim();
  if (!raw) return { wallets: {}, problem: null };
  try {
    const parsed = z.record(handle).parse(JSON.parse(raw));
    const wallets: Partial<Record<ResearchKey, { walletId: string; address: Address }>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!(RESEARCH_KEYS as readonly string[]).includes(key)) throw new Error(key);
      wallets[key as ResearchKey] = { walletId: value.walletId, address: value.address.toLowerCase() as Address };
    }
    return { wallets, problem: null };
  } catch {
    return { wallets: {}, problem: "AGON_RESEARCH_WALLETS must map ledger, archive or compass to wallet handles" };
  }
}

export function createResearchRoutes(deps: {
  network: AgonNetwork;
  sellers: Partial<Record<ResearchKey, ResearchSeller>>;
  store: Pick<PaymentsStore, "claimSellerNonce">;
  readQuestion: ReadQuestion;
  chain: ChainReader;
  markets: MarketReader;
  /** Answers a certification task that is not the Research one. */
  callModel: CertifyModelCaller;
  now?: () => Date;
}): Hono {
  const app = new Hono<{ Variables: { x402: X402Paid } }>();
  const now = deps.now ?? (() => new Date());
  const answers = new WeakMap<Request, Record<string, unknown>>();
  const sellerFor = (key: string) => ((RESEARCH_KEYS as readonly string[]).includes(key) && deps.sellers[key as ResearchKey] ? { key: key as ResearchKey, seller: deps.sellers[key as ResearchKey]! } : null);
  const gates = new Map<string, ReturnType<typeof createCertificationGate>>();
  const gateFor = (key: string) => gates.get(key) ?? gates.set(key, createCertificationGate()).get(key)!;

  /// The answer to a request, or why this agent does not sell one.
  const solve = async (key: ResearchKey, raw: unknown): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; code: string }> => {
    const parsed = body.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "invalid_request" };
    const agent = RESEARCH_AGENTS[key];
    const lookup: Lookup | null = await deps.readQuestion(parsed.data.question).catch(() => null);
    if (!lookup) return { ok: false, code: "unsupported_question" };
    let found: Found;
    if ("block" in lookup) {
      if (!agent.chain) return { ok: false, code: "unsupported_question" };
      found = await readChain(deps.chain, lookup, agent.twice);
    } else {
      if (!agent.markets) return { ok: false, code: "unsupported_question" };
      found = await readMarket(deps.markets, lookup);
    }
    if (!found.ok) return found;
    return { ok: true, body: { agent: agent.name, answer: found.answer, value: found.value, source: found.source, readAt: now().toISOString() } };
  };
  /// Research's own certification task: Arc's chain id and a fresh block, read from the chain.
  const liveFact = async () => ({ chainId: deps.network.chainId, blockNumber: Number(await deps.chain.latest()), source: `${deps.network.label} RPC, read by this agent` });

  app.use("/:key", bodyLimit({ maxSize: LISTING_BODY_LIMIT_BYTES, onError: (c) => c.json({ error: "body_too_large" }, 413) }));
  app.use("/:key", async (c, next) => {
    const found = sellerFor(c.req.param("key"));
    if (!found) return c.json({ error: "not_for_sale" }, 404);
    const raw = await c.req.raw.clone().json().catch(() => null);
    const check = await answerListingCheck(c, raw, { agent: { name: RESEARCH_AGENTS[found.key].name, capabilities: ["research"] }, model: RESEARCH_MODEL, callModel: deps.callModel, gate: gateFor(found.key), liveFact });
    if (check === "preflight") return next();
    if (check) return check;
    if (!body.safeParse(raw).success) return c.json({ error: "invalid_request", message: "Send {\"question\": \"<one question, 8 to 600 characters>\"}." }, 400);
    // The question is checked before payment is asked for, so a buyer never signs for a refusal.
    if (!c.req.header("payment-signature") && !c.req.header("x-payment")) {
      const tried = await solve(found.key, raw);
      if (!tried.ok) return c.json({ error: tried.code, message: REFUSALS[tried.code] ?? REFUSALS.unsupported_question }, tried.code === "source_unavailable" ? 503 : 422);
    }
    return next();
  });

  app.post(
    "/:key",
    async (c, next) => {
      const { key, seller } = sellerFor(c.req.param("key"))!;
      return exactPayment({
        network: deps.network,
        payTo: seller.payTo,
        price: async () => RESEARCH_AGENTS[key].price,
        settle: seller.settle,
        claimNonce: (n, payer, nonce: Hex) => deps.store.claimSellerNonce(n, payer, nonce),
        description: RESEARCH_AGENTS[key].description,
        // The answer is made before the payment settles: a refusal leaves the buyer's money where it was.
        prepare: async (_payment, ctx) => {
          const answer = await solve(key, await ctx.req.raw.clone().json().catch(() => null));
          if (!answer.ok) return answer.code;
          answers.set(ctx.req.raw, answer.body);
          return null;
        },
        now,
      })(c, next);
    },
    (c) => c.json(answers.get(c.req.raw)!),
  );
  return app as unknown as Hono;
}
