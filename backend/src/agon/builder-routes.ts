import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { AccessTokenStore } from "./access-tokens.ts";
import type { ProviderDraftInput } from "./mcp/contract.ts";
import type { ManagedPublisher } from "./mcp/managed-publisher.ts";

const createToken = z.object({
  name: z.string().trim().min(1).max(80),
  level: z.enum(["read", "listing", "hiring", "full"]),
  days: z.union([z.literal(30), z.literal(90)]),
}).strict();
const approveBody = z.object({ termsDigest: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();

/// The network fee a builder sends to the publishing wallet (covers identity registration and publication).
export const LISTING_FEE_USDC = "0.50";

type AdapterResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };
export type BuilderListingDeps = {
  access: {
    startListing(actor: string, input: unknown): Promise<AdapterResult<{ draftId: string }>>;
    checkListing(actor: string, input: unknown): Promise<AdapterResult<unknown>>;
  };
  drafts: {
    list(actor: string, limit: number): Promise<{ draftId: string; draft: ProviderDraftInput; state: string }[]>;
    get(actor: string, draftId: string): Promise<{ draftId: string; draft: ProviderDraftInput; state: string } | null>;
  };
  publisher?: Pick<ManagedPublisher, "setup" | "approve" | "status" | "advance">;
};

/// Publisher messages that are safe and useful to show a builder as they are.
const SAFE_PUBLISHER_MESSAGE = /^(?:Run the listing checks|Create a listing draft|The exact draft digest|Provision the publisher|Publisher state changed)/;

/// Signed-in builder routes (browser session only): Agent access tokens, and
/// the web listing flow over the same draft store, checker and publisher as MCP.
export function createBuilderRoutes(deps: {
  tokens: AccessTokenStore;
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
  now?: () => Date;
  listing?: BuilderListingDeps;
  /// Server log for failures the page only sees as a safe message.
  log?: (message: string) => void;
}): Hono {
  const app = new Hono<{ Variables: { address: string } }>();
  const now = deps.now ?? (() => new Date());
  app.use("*", deps.requireAuth);

  app.get("/tokens", async (c) => {
    const at = now();
    const tokens = (await deps.tokens.list(c.get("address"))).map((r) => ({
      id: r.id, name: r.name, level: r.level, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null, active: !r.revokedAt && r.expiresAt > at,
    }));
    return c.json({ tokens });
  });

  app.post("/tokens", async (c) => {
    const parsed = createToken.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_request" }, 400);
    const out = await deps.tokens.create({ owner: c.get("address"), ...parsed.data, now: now() });
    if (!out.ok) return c.json({ error: out.code }, 409);
    const r = out.record;
    return c.json({ token: out.token, record: { id: r.id, name: r.name, level: r.level, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() } }, 201);
  });

  app.post("/tokens/:id/revoke", async (c) =>
    (await deps.tokens.revoke(c.get("address"), c.req.param("id"), now())) ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404));

  const listing = deps.listing;
  if (listing) {
    const publisherCall = async (c: Context<{ Variables: { address: string } }>, run: (p: NonNullable<BuilderListingDeps["publisher"]>) => Promise<unknown>) => {
      if (!listing.publisher) return c.json({ error: "publishing_unavailable", message: "Publishing is not available on this network right now." }, 503);
      try {
        return c.json(await run(listing.publisher) as Record<string, unknown>);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const action = c.req.path.split("/").pop();
        (deps.log ?? ((m: string) => console.warn(m)))(`[agon-listing] ${action} failed for draft ${c.req.param("id")}: ${detail.slice(0, 500)}`);
        const message = error instanceof Error && SAFE_PUBLISHER_MESSAGE.test(error.message) ? error.message : "Publishing could not continue. Check the status and try again.";
        return c.json({ error: "publishing_failed", message }, 400);
      }
    };
    const statusOf = async (actor: string, draftId: string) => {
      if (!listing.publisher) return null;
      try { return await listing.publisher.status(actor, draftId); } catch { return null; }
    };

    app.post("/drafts", async (c) => {
      const out = await listing.access.startListing(c.get("address"), await c.req.json().catch(() => null));
      return out.ok ? c.json({ draftId: out.value.draftId }, 201) : c.json({ error: out.code, message: out.message }, 400);
    });

    app.get("/drafts", async (c) => {
      const actor = c.get("address");
      const rows = await listing.drafts.list(actor, 50);
      const drafts = await Promise.all(rows.map(async (d) => ({
        draftId: d.draftId, name: d.draft.name, endpoint: d.draft.endpoint, priceUSDC: d.draft.priceUSDC, state: d.state,
        publishing: await statusOf(actor, d.draftId),
      })));
      return c.json({ drafts });
    });

    app.get("/drafts/:id", async (c) => {
      const actor = c.get("address");
      const d = await listing.drafts.get(actor, c.req.param("id"));
      if (!d) return c.json({ error: "not_found" }, 404);
      return c.json({ draftId: d.draftId, draft: d.draft, state: d.state, publishing: await statusOf(actor, d.draftId), feeUSDC: LISTING_FEE_USDC });
    });

    app.post("/drafts/:id/check", async (c) => {
      const out = await listing.access.checkListing(c.get("address"), { draftId: c.req.param("id") });
      if (out.ok) return c.json(out.value as Record<string, unknown>);
      return c.json({ error: out.code, message: out.message }, out.code === "rate_limited" ? 429 : 400);
    });

    app.post("/drafts/:id/setup", (c) => publisherCall(c, async (p) => ({ ...(await p.setup(c.get("address"), c.req.param("id"))), feeUSDC: LISTING_FEE_USDC })));
    app.post("/drafts/:id/advance", (c) => publisherCall(c, async (p) => ({ ...(await p.advance(c.get("address"), c.req.param("id"))), feeUSDC: LISTING_FEE_USDC })));
    app.post("/drafts/:id/approve", async (c) => {
      const parsed = approveBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "invalid_request", message: "Send the terms digest shown for this listing." }, 400);
      return publisherCall(c, (p) => p.approve(c.get("address"), c.req.param("id"), parsed.data.termsDigest, "approve"));
    });
  }

  return app as unknown as Hono;
}
