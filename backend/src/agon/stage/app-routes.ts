import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Address } from "viem";

import { formatUsdc } from "../payments/bargain.ts";
import { parseUsdc } from "./money.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { AskResult, StageServices, WalletView } from "./services.ts";
import { operatorOwnerRef } from "./settings.ts";

const askBody = z.object({ question: z.string().max(2000), maxPrice: z.string().max(32).optional() });
const confirmBody = z.object({ code: z.string().max(16) });
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

export function askJson(a: AskResult) {
  if (!a.ok) {
    return {
      ok: false as const, code: a.code,
      ...(a.detail ? { detail: a.detail } : {}), ...(a.amount !== undefined ? { amount: formatUsdc(a.amount) } : {}), ...(a.depositAddress ? { depositAddress: a.depositAddress } : {}),
    };
  }
  const base = { ok: true as const, jobId: a.jobId, amount: formatUsdc(a.amount), amountAtomic: a.amount.toString(), providerLabel: a.providerLabel, network: a.network, testnet: a.testnet, expiresAt: a.expiresAt.toISOString() };
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

  app.get("/wallet", async (c) => {
    // Reading never creates a wallet; the first ask does.
    const wallet = await deps.services.findWallet(owner(c));
    return wallet ? c.json(walletJson(wallet)) : c.json({ error: "no_wallet" }, 404);
  });

  app.post("/ask", async (c) => {
    if (deps.off()) return c.json({ error: "web_off" }, 503);
    const body = askBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const maxPrice = body.data.maxPrice === undefined ? undefined : parseUsdc(body.data.maxPrice);
    if (maxPrice === null) return c.json({ error: "invalid_body" }, 400);
    if (!askLimit(c.get("address"))) return c.json({ error: "rate_limited" }, 429);
    return c.json(askJson(await deps.services.ask(owner(c), { question: body.data.question, ...(maxPrice !== undefined ? { maxPrice } : {}) })));
  });

  app.post("/hires/:jobId/confirm", async (c) => {
    if (deps.off()) return c.json({ error: "web_off" }, 503);
    const body = confirmBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const out = await deps.services.confirm(owner(c), body.data.code.trim());
    return c.json(
      out.ok
        ? { ok: true, jobId: out.jobId, amount: formatUsdc(out.amount), txHash: out.txHash }
        : { ok: false, code: out.code, ...(out.jobId ? { jobId: out.jobId } : {}), ...(out.detail ? { detail: out.detail } : {}) },
    );
  });

  app.get("/history", async (c) => c.json({ items: await deps.services.history(owner(c), 20) }));

  app.post("/wallet/limits", async (c) => {
    const body = limitsBody.safeParse(await readJson(c));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const perHireCap = body.data.perHire === undefined ? undefined : parseUsdc(body.data.perHire);
    const dailyCap = body.data.daily === undefined ? undefined : parseUsdc(body.data.daily);
    if (perHireCap === null || dailyCap === null) return c.json({ error: "invalid_body" }, 400);
    return c.json(await deps.services.lowerLimits(owner(c), { ...(perHireCap !== undefined ? { perHireCap } : {}), ...(dailyCap !== undefined ? { dailyCap } : {}) }));
  });

  app.post("/wallet/freeze", async (c) => c.json({ frozen: await deps.services.freeze(owner(c)) }));

  app.post("/wallet/unfreeze", async (c) => {
    const link = await deps.services.requestUnfreeze(owner(c));
    return link ? c.json({ approvalUrl: link.approvalUrl, expiresAt: link.expiresAt.toISOString() }) : c.json({ error: "no_wallet" }, 404);
  });

  app.post("/wallet/withdraw", async (c) => {
    const body = withdrawBody.safeParse(await readJson(c));
    const amount = body.success ? parseUsdc(body.data.amount) : null;
    if (!body.success || amount === null) return c.json({ error: "invalid_body" }, 400);
    const out = await deps.services.requestWithdraw(owner(c), body.data.to.toLowerCase() as Address, amount);
    return c.json(out.ok ? { ok: true, approvalUrl: out.approvalUrl, expiresAt: out.expiresAt.toISOString() } : out);
  });

  return app as unknown as Hono;
}
