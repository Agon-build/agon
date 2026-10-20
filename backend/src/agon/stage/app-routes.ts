import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Address } from "viem";

import { formatUsdc } from "../payments/bargain.ts";
import { parseUsdc } from "./money.ts";
import { CUSTODY_TERMS, CUSTODY_TERMS_VERSION, type CustodyTerms } from "./custody-terms.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { AskResult, StageServices, WalletView } from "./services.ts";
import { operatorOwnerRef } from "./settings.ts";
import type { Ranked } from "../routing/rank.ts";
import type { RouteQuote, Router } from "../routing/router.ts";

const askBody = z.object({ question: z.string().max(2000), maxPrice: z.string().max(32).optional() });
const confirmBody = z.object({ code: z.string().max(16) });
const termsBody = z.object({ version: z.string().max(64) });
const routeBody = z.object({ request: z.string().trim().min(8).max(600) });
const routeDirectBody = z.object({ reference: z.string().trim().min(1).max(600), request: z.string().trim().min(3).max(600) });
const routeQuoteBody = z.object({ routeId: z.string().max(64), reference: z.string().max(600), input: z.record(z.unknown()).optional() });
const limitsBody = z.object({ perHire: z.string().max(32).optional(), daily: z.string().max(32).optional() });
const withdrawBody = z.object({ to: z.string().regex(/^0x[0-9a-fA-F]{40}$/), amount: z.string().max(32) });

const money = (atomic: bigint | null) => (atomic === null ? null : formatUsdc(atomic));

export function walletJson(w: WalletView) {
  return {
    networkId: w.networkId, network: w.network, testnet: w.testnet, explorer: w.explorer, address: w.address,
    balance: money(w.balance), balanceAtomic: w.balance === null ? null : w.balance.toString(),
    perHire: formatUsdc(w.perHireCap), daily: formatUsdc(w.dailyCap), spentToday: formatUsdc(w.spentToday), leftToday: formatUsdc(w.leftToday), frozen: w.frozen,
  };
}

export function rankedJson(r: Ranked) {
  return {
    source: r.source, reference: r.reference, name: r.name, provider: r.provider, category: r.category, description: r.description,
    method: r.method, network: r.network, rating: r.rating, reason: r.reason,
    price: formatUsdc(r.price), fee: formatUsdc(r.fee), total: formatUsdc(r.total),
  };
}

export function routeQuoteJson(q: RouteQuote) {
  if (!q.ok) {
    const out: Record<string, unknown> = { ok: false, code: q.code };
    if ("question" in q) Object.assign(out, { question: q.question, missing: q.missing });
    if ("depositAddress" in q) Object.assign(out, { amount: formatUsdc(q.amount), depositAddress: q.depositAddress, network: q.network });
    // Raw seller and network errors stay in the server log, never in the reply.
    return out;
  }
  return {
    ok: true, step: q.step, jobId: q.jobId, amount: formatUsdc(q.amount), fee: formatUsdc(q.fee), total: formatUsdc(q.total), providerLabel: q.providerLabel,
    network: q.network, testnet: q.testnet, expiresAt: q.expiresAt.toISOString(), input: q.input, source: q.source, reason: q.reason,
    ...(q.code ? { code: q.code } : {}), ...(q.approvalUrl ? { approvalUrl: q.approvalUrl } : {}),
  };
}

export function askJson(a: AskResult) {
  if (!a.ok) {
    return {
      ok: false as const, code: a.code,
      ...(a.detail ? { detail: a.detail } : {}), ...(a.amount !== undefined ? { amount: formatUsdc(a.amount) } : {}), ...(a.depositAddress ? { depositAddress: a.depositAddress } : {}),
    };
  }
  const base = { ok: true as const, jobId: a.jobId, amount: formatUsdc(a.amount), amountAtomic: a.amount.toString(), fee: formatUsdc(a.fee), total: formatUsdc(a.total), providerLabel: a.providerLabel, network: a.network, testnet: a.testnet, expiresAt: a.expiresAt.toISOString() };
  return a.step === "confirm_code" ? { ...base, step: a.step, code: a.code } : { ...base, step: a.step, approvalUrl: a.approvalUrl };
}

async function readJson(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  return c.req.json().catch(() => null);
}

export function createAppRoutes(deps: {
  services: StageServices;
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
  off: () => boolean;
  askLimit?: (key: string) => boolean;
  terms: CustodyTerms;
  /** The aggregator; when set, confirm goes through it so each job confirms on its own network. */
  router?: Router;
  /** The Arc mainnet wallet services for outside routes (?network=arc). */
  outside?: StageServices;
}): Hono {
  const app = new Hono<{ Variables: { address: string } }>();
  const askLimit = deps.askLimit ?? createRateLimiter({ limit: 10, windowMs: 60_000 });
  const owner = (c: { get(key: "address"): string }) => operatorOwnerRef(c.get("address"));

  app.get("/config", async (c) => {
    const price = await deps.services.leadPrice().catch(() => null);
    return c.json({ network: deps.services.network.label, testnet: deps.services.network.id === "arc-testnet", leadPrice: money(price), leadPriceAtomic: price === null ? null : price.toString(), siteUrl: deps.services.siteUrl });
  });

  app.get("/live/:jobId", async (c) => {
    c.header("Cache-Control", "no-store");
    const live = await deps.services.live(c.req.param("jobId"));
    return live ? c.json(live) : c.json({ error: "job_not_found" }, 404);
  });

  app.use("/wallet", deps.requireAuth);
  app.use("/wallet/*", deps.requireAuth);
  app.use("/ask", deps.requireAuth);
  app.use("/hires/*", deps.requireAuth);
  app.use("/history", deps.requireAuth);
  app.use("/terms", deps.requireAuth);
  app.use("/route", deps.requireAuth);
  app.use("/route/*", deps.requireAuth);
  const servicesFor = (c: { req: { query(name: string): string | undefined } }) => (c.req.query("network") === "arc" ? deps.outside ?? null : deps.services);

  app.get("/terms", async (c) => c.json({ version: CUSTODY_TERMS_VERSION, lines: CUSTODY_TERMS, accepted: await deps.terms.isAccepted(owner(c)) }));

  app.post("/terms", async (c) => {
    const body = termsBody.safeParse(await readJson(c));
    if (!body.success || !(await deps.terms.accept(owner(c), body.data.version, new Date()))) return c.json({ error: "invalid_terms_version" }, 400);
    return c.json({ accepted: true });
  });

  app.get("/wallet", async (c) => {
    // Reading never creates a wallet; the first ask does.
    const services = servicesFor(c);
    if (!services) return c.json({ error: "outside_off" }, 404);
    const wallet = await services.findWallet(owner(c));
    return wallet ? c.json(walletJson(wallet)) : c.json({ error: "no_wallet" }, 404);
  });

  app.post("/ask", async (c) => {
    if (deps.off()) return c.json({ error: "web_off" }, 503);
    const body = askBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const maxPrice = body.data.maxPrice === undefined ? undefined : parseUsdc(body.data.maxPrice);
    if (maxPrice === null) return c.json({ error: "invalid_body" }, 400);
    if (!askLimit(c.get("address"))) return c.json({ error: "rate_limited" }, 429);
    // The first ask creates the agent wallet, so the terms come first.
    if (!(await deps.terms.isAccepted(owner(c)))) return c.json({ ok: false, code: "terms_required" });
    return c.json(askJson(await deps.services.ask(owner(c), { question: body.data.question, ...(maxPrice !== undefined ? { maxPrice } : {}) })));
  });

  app.post("/route", async (c) => {
    if (deps.off() || !deps.router) return c.json({ error: "web_off" }, 503);
    const body = routeBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    if (!askLimit(c.get("address"))) return c.json({ error: "rate_limited" }, 429);
    if (!(await deps.terms.isAccepted(owner(c)))) return c.json({ ok: false, code: "terms_required" });
    const out = await deps.router.route(owner(c), body.data.request);
    if (out.kind === "lead") return c.json(out.ask ? { kind: "lead", ...askJson(out.ask) } : { kind: "lead" });
    if (out.kind === "none") return c.json({ kind: "none", sources: out.sources });
    return c.json({ kind: "pick", routeId: out.routeId, pick: rankedJson(out.pick), alternatives: out.alternatives.map(rankedJson), sources: out.sources });
  });

  // A person picked this agent on its page: no reading, no ranking, no routing fee.
  app.post("/route/direct", async (c) => {
    if (deps.off() || !deps.router) return c.json({ error: "web_off" }, 503);
    const body = routeDirectBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    if (!askLimit(c.get("address"))) return c.json({ error: "rate_limited" }, 429);
    if (!(await deps.terms.isAccepted(owner(c)))) return c.json({ ok: false, code: "terms_required" });
    const out = await deps.router.direct(owner(c), body.data.reference, body.data.request);
    if (out.kind === "not_hireable") return c.json({ ok: false, code: "not_hireable" });
    if (out.kind === "lead") return c.json(out.ask ? { kind: "lead", ...askJson(out.ask) } : { kind: "lead" });
    return c.json({ kind: "pick", routeId: out.routeId, pick: rankedJson(out.pick), alternatives: [], sources: out.sources });
  });

  app.post("/route/quote", async (c) => {
    if (deps.off() || !deps.router) return c.json({ error: "web_off" }, 503);
    const body = routeQuoteBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    if (!askLimit(c.get("address"))) return c.json({ error: "rate_limited" }, 429);
    if (!(await deps.terms.isAccepted(owner(c)))) return c.json({ ok: false, code: "terms_required" });
    return c.json(routeQuoteJson(await deps.router.quote(owner(c), body.data.routeId, body.data.reference, body.data.input)));
  });

  app.post("/hires/:jobId/confirm", async (c) => {
    if (deps.off()) return c.json({ error: "web_off" }, 503);
    const body = confirmBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const out = deps.router ? await deps.router.confirm(owner(c), body.data.code.trim()) : await deps.services.confirm(owner(c), body.data.code.trim());
    return c.json(
      out.ok
        ? { ok: true, jobId: out.jobId, amount: formatUsdc(out.amount), txHash: out.txHash, result: out.result ?? null }
        : { ok: false, code: out.code, ...(out.jobId ? { jobId: out.jobId } : {}), ...(out.detail ? { detail: out.detail } : {}) },
    );
  });

  // Paged: one extra row tells whether an older page exists.
  app.get("/history", async (c) => {
    const page = Number(c.req.query("page") ?? 1);
    const limit = Number(c.req.query("limit") ?? 10);
    if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return c.json({ error: "validation_failed", message: "page must be 1 or more and limit between 1 and 50" }, 400);
    }
    const rows = await deps.services.history(owner(c), limit + 1, (page - 1) * limit);
    return c.json({ items: rows.slice(0, limit), page, hasMore: rows.length > limit });
  });

  app.post("/wallet/limits", async (c) => {
    const body = limitsBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const perHireCap = body.data.perHire === undefined ? undefined : parseUsdc(body.data.perHire);
    const dailyCap = body.data.daily === undefined ? undefined : parseUsdc(body.data.daily);
    if (perHireCap === null || dailyCap === null) return c.json({ error: "invalid_body" }, 400);
    const services = servicesFor(c);
    if (!services) return c.json({ error: "outside_off" }, 404);
    return c.json(await services.lowerLimits(owner(c), { ...(perHireCap !== undefined ? { perHireCap } : {}), ...(dailyCap !== undefined ? { dailyCap } : {}) }));
  });

  app.post("/wallet/freeze", async (c) => {
    const services = servicesFor(c);
    return services ? c.json({ frozen: await services.freeze(owner(c)) }) : c.json({ error: "outside_off" }, 404);
  });

  app.post("/wallet/unfreeze", async (c) => {
    const services = servicesFor(c);
    if (!services) return c.json({ error: "outside_off" }, 404);
    const link = await services.requestUnfreeze(owner(c));
    return link ? c.json({ approvalUrl: link.approvalUrl, expiresAt: link.expiresAt.toISOString() }) : c.json({ error: "no_wallet" }, 404);
  });

  app.post("/wallet/withdraw", async (c) => {
    const body = withdrawBody.safeParse(await readJson(c));
    const amount = body.success ? parseUsdc(body.data.amount) : null;
    if (!body.success || amount === null) return c.json({ error: "invalid_body" }, 400);
    const services = servicesFor(c);
    if (!services) return c.json({ error: "outside_off" }, 404);
    const out = await services.requestWithdraw(owner(c), body.data.to.toLowerCase() as Address, amount);
    return c.json(out.ok ? { ok: true, approvalUrl: out.approvalUrl, expiresAt: out.expiresAt.toISOString() } : out);
  });

  return app as unknown as Hono;
}
