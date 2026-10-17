import { Hono, type Context, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { ACCESS_LEVEL_SCOPES } from "../access-tokens.ts";
import { clientAddress } from "../../http/client-address.ts";
import type { CustodyTerms } from "../stage/custody-terms.ts";
import { createRateLimiter } from "../stage/rate-limit.ts";
import { operatorOwnerRef } from "../stage/settings.ts";
import { parseRegistration } from "./clients.ts";
import { redirectAllowed, smallestLevelFor, type ConnectLevel } from "./rules.ts";
import type { OAuthClient, PostgresOAuthStore } from "./store.ts";

const decisionBody = z.object({
  approve: z.boolean(),
  level: z.enum(["read", "listing", "hiring", "full"]),
  acceptTerms: z.boolean().optional(),
  termsVersion: z.string().max(64).optional(),
});

const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const SPENDING: ConnectLevel[] = ["hiring", "full"];

function redirectHost(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return "this computer";
    return u.protocol === "https:" ? u.host : u.protocol.slice(0, -1);
  } catch {
    return "an unknown app";
  }
}

function withParams(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

const INVALID_LINK_PAGE = `<!doctype html><meta charset="utf-8"><title>Agon</title><body style="font-family:system-ui;background:#141110;color:#f3ede6;padding:48px"><h1>This sign-in link is not valid</h1><p>Start the connection again from your agent.</p></body>`;

/// Agon as the OAuth authorization server for its own MCP endpoint
/// (MCP authorization, revision 2026-07-28). The person approves on the
/// agon.surf Connect page with their browser session.
export function createOAuthRoutes(deps: {
  store: PostgresOAuthStore;
  issuer: string;
  resource: string;
  appUrl: string;
  requireAuth: MiddlewareHandler<{ Variables: { address: string } }>;
  terms: CustodyTerms;
  resolveClient: (clientId: string) => Promise<OAuthClient | null>;
  limit?: (key: string) => boolean;
  now?: () => Date;
}): Hono {
  const app = new Hono<{ Variables: { address: string } }>();
  const now = deps.now ?? (() => new Date());
  const limit = deps.limit ?? createRateLimiter({ limit: 20, windowMs: 3_600_000 });
  const authorizeLimit = deps.limit ?? createRateLimiter({ limit: 60, windowMs: 3_600_000 });
  const allScopes = [...ACCESS_LEVEL_SCOPES.full];
  const open = (c: Context) => { c.header("Access-Control-Allow-Origin", "*"); c.header("Cache-Control", "no-store"); };
  const oauthError = (c: Context, error: string, description: string, status: 400 | 401 | 429 = 400) => { open(c); return c.json({ error, error_description: description }, status); };

  for (const path of ["/.well-known/oauth-protected-resource/agon/mcp", "/.well-known/oauth-protected-resource"]) {
    app.get(path, (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      return c.json({ resource: deps.resource, authorization_servers: [deps.issuer], scopes_supported: ["agon:read"], bearer_methods_supported: ["header"], resource_name: "Agon" });
    });
  }

  app.get("/.well-known/oauth-authorization-server", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({
      issuer: deps.issuer,
      authorization_endpoint: `${deps.issuer}/oauth/authorize`,
      token_endpoint: `${deps.issuer}/oauth/token`,
      registration_endpoint: `${deps.issuer}/oauth/register`,
      revocation_endpoint: `${deps.issuer}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: allScopes,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  for (const path of ["/oauth/register", "/oauth/token", "/oauth/revoke"]) {
    app.options(path, (c) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "POST");
      c.header("Access-Control-Allow-Headers", "content-type");
      return c.body(null, 204);
    });
  }

  app.post("/oauth/register", async (c) => {
    if (!limit(`register:${clientAddress((n) => c.req.header(n))}`)) return oauthError(c, "slow_down", "Too many registrations. Try again later.", 429);
    const parsed = parseRegistration(await c.req.json().catch(() => null));
    if (!parsed.ok) return oauthError(c, parsed.error, "Redirect URIs must be loopback http, https or an app scheme.");
    const client = await deps.store.registerClient({ ...parsed.value, source: "dcr" });
    open(c);
    return c.json({
      client_id: client.clientId, client_id_issued_at: Math.floor(now().getTime() / 1000), client_name: client.clientName, redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none",
    }, 201);
  });

  app.get("/oauth/authorize", async (c) => {
    const q = (name: string) => c.req.query(name) ?? null;
    const clientId = q("client_id");
    const redirectUri = q("redirect_uri");
    if (!authorizeLimit(`authorize:${clientAddress((n) => c.req.header(n))}`)) return c.html(INVALID_LINK_PAGE.replace("This sign-in link is not valid", "Too many sign-in attempts"), 429);
    const client = clientId ? await deps.resolveClient(clientId) : null;
    // Never redirect to a place the client did not register.
    if (!client || !redirectUri || !redirectAllowed(client.redirectUris, redirectUri)) return c.html(INVALID_LINK_PAGE, 400);
    const state = q("state");
    const back = (error: string) => c.redirect(withParams(redirectUri, { error, state, iss: deps.issuer }), 302);
    if (q("response_type") !== "code") return back("unsupported_response_type");
    const challenge = q("code_challenge");
    if (q("code_challenge_method") !== "S256" || !challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back("invalid_request");
    const resource = q("resource") ?? deps.resource;
    if (resource.replace(/\/$/, "").toLowerCase() !== deps.resource.toLowerCase()) return back("invalid_target");
    const requestedScopes = (q("scope") ?? "").split(" ").filter(Boolean).slice(0, 20);
    const req = await deps.store.createRequest({ clientId: client.clientId, redirectUri, codeChallenge: challenge, state, requestedScopes, resource: deps.resource, now: now() });
    return c.redirect(`${deps.appUrl}/connect?request=${req.id}`, 302);
  });

  app.use("/oauth/requests/*", deps.requireAuth);
  app.use("/agon/app/connections", deps.requireAuth);
  app.use("/agon/app/connections/*", deps.requireAuth);

  app.get("/oauth/requests/:id", async (c) => {
    const req = await deps.store.getRequest(c.req.param("id"), now()).catch(() => null);
    if (!req) return c.json({ error: "request_expired" }, 404);
    const client = await deps.store.getClient(req.clientId);
    // A metadata-document app is identified by its own https host; a self-registered app only by what it says.
    const verified = client?.source === "cimd";
    const host = redirectHost(req.redirectUri);
    const level = !verified && host !== "this computer" ? "read" : smallestLevelFor(req.requestedScopes);
    return c.json({
      clientName: client?.clientName ?? "MCP client", logoUri: verified ? client?.logoUri ?? null : null, verified,
      clientHost: verified ? new URL(req.clientId).host : null, redirectHost: host,
      level, termsAccepted: await deps.terms.isAccepted(operatorOwnerRef(c.get("address"))),
      expiresAt: req.expiresAt.toISOString(),
    });
  });

  app.post("/oauth/requests/:id/decision", async (c) => {
    const body = decisionBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid_body" }, 400);
    const id = c.req.param("id");
    const at = now();
    const pending = await deps.store.getRequest(id, at).catch(() => null);
    if (!pending) return c.json({ error: "request_expired" }, 404);
    if (!body.data.approve) {
      const denied = await deps.store.deny(id, at);
      if (!denied) return c.json({ error: "request_expired" }, 404);
      return c.json({ redirectTo: withParams(denied.redirectUri, { error: "access_denied", state: denied.state, iss: deps.issuer }) });
    }
    const address = c.get("address");
    if (SPENDING.includes(body.data.level) && !(await deps.terms.isAccepted(operatorOwnerRef(address)))) {
      const accepted = body.data.acceptTerms === true && body.data.termsVersion
        ? await deps.terms.accept(operatorOwnerRef(address), body.data.termsVersion, at)
        : false;
      if (!accepted) return c.json({ error: "terms_required" }, 409);
    }
    const decided = await deps.store.decide(id, { address, level: body.data.level, now: at });
    if (!decided) return c.json({ error: "request_expired" }, 404);
    return c.json({ redirectTo: withParams(decided.redirectUri, { code: decided.code, state: decided.state, iss: deps.issuer }) });
  });

  app.post("/oauth/token", async (c) => {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const field = (name: string) => (typeof form[name] === "string" ? (form[name] as string) : "");
    const resource = field("resource") || deps.resource;
    const grant = field("grant_type");
    const at = now();
    if (grant === "authorization_code") {
      const out = await deps.store.redeemCode({ code: field("code"), clientId: field("client_id"), redirectUri: field("redirect_uri"), codeVerifier: field("code_verifier"), resource, now: at });
      if ("error" in out) return oauthError(c, "invalid_grant", "The code is invalid, expired or already used.");
      open(c);
      return c.json({ access_token: out.accessToken, token_type: "Bearer", expires_in: out.expiresIn, refresh_token: out.refreshToken, scope: out.scope });
    }
    if (grant === "refresh_token") {
      const out = await deps.store.refresh({ refreshToken: field("refresh_token"), clientId: field("client_id"), resource, now: at });
      if ("error" in out) return oauthError(c, "invalid_grant", "Sign in to Agon again.");
      open(c);
      return c.json({ access_token: out.accessToken, token_type: "Bearer", expires_in: out.expiresIn, refresh_token: out.refreshToken, scope: out.scope });
    }
    return oauthError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });

  app.post("/oauth/revoke", async (c) => {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    if (typeof form.token === "string" && form.token) await deps.store.revokeToken(form.token, now());
    open(c);
    return c.body(null, 200);
  });

  app.get("/agon/app/connections", async (c) => {
    const rows = await deps.store.listConnections(c.get("address"));
    return c.json({ connections: rows.map((r) => ({ id: r.id, clientName: r.clientName, level: r.level, createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null })) });
  });

  app.post("/agon/app/connections/:id/disconnect", async (c) => {
    const ok = await deps.store.disconnect(c.get("address"), c.req.param("id"), now());
    return ok ? c.json({ disconnected: true }) : c.json({ error: "not_found" }, 404);
  });

  return app as unknown as Hono;
}
