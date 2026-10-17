import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { createMcpTokenVerifier, type AccessTokenStore } from "../../src/agon/access-tokens.ts";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";
import { authorizeMcpRequest } from "../../src/agon/mcp-oauth/edge.ts";
import { createOAuthRoutes } from "../../src/agon/mcp-oauth/routes.ts";
import { PostgresOAuthStore } from "../../src/agon/mcp-oauth/store.ts";
import type { CustodyTerms } from "../../src/agon/stage/custody-terms.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const ORIGIN = "https://api.agon.surf";
const RESOURCE = `${ORIGIN}/agon/mcp`;
const META = `${ORIGIN}/.well-known/oauth-protected-resource/agon/mcp`;
const ALICE = `0x${"a".repeat(40)}`;

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("mcp_oauth_e2e"); });
after(async () => db.close());

/// The same wiring as production: OAuth routes at the root, the MCP edge in front of the native handler.
function server() {
  const store = new PostgresOAuthStore(db.pool);
  const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
    if (c.req.header("cookie") !== "session=alice") return c.json({ error: "unauthorized" }, 401);
    c.set("address", ALICE);
    await next();
  };
  const terms: CustodyTerms = { isAccepted: async () => true, accept: async () => true };
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
    async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
  });
  const native = createAgonNativeMcpHandler(access);
  const verify = createMcpTokenVerifier({} as AccessTokenStore, async () => null, () => new Date(), async (token) => {
    const claims = await store.verifyAccess(token, RESOURCE, new Date());
    return claims ? { address: claims.address, client: "agon-mcp", scopes: claims.scopes } : null;
  });
  const app = new Hono();
  app.route("/", createOAuthRoutes({ store, issuer: ORIGIN, resource: RESOURCE, appUrl: "https://agon.surf", requireAuth, terms, resolveClient: (id) => store.getClient(id) }));
  app.all("/agon/mcp", async (c) => {
    const auth = await authorizeMcpRequest(c.req.raw, { verify, resourceMetadataUrl: META });
    return auth.ok ? native.fetch(c.req.raw, { authInfo: auth.authInfo }) : auth.response;
  });
  return app;
}

const mcp = (method: string, params: Record<string, unknown> = {}, token?: string) => new Request(RESOURCE, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});
const path = (url: string) => { const u = new URL(url); return `${u.pathname}${u.search}`; };
const param = (header: string, name: string) => new RegExp(`${name}="([^"]+)"`).exec(header)?.[1] ?? "";

test("a client with no Agon-specific code connects, calls a tool, refreshes and is cut off by Disconnect", async () => {
  const app = server();

  // 1. Unauthenticated call: the server says where to sign in.
  const first = await app.request(mcp("tools/list"));
  assert.equal(first.status, 401);
  const challenge = first.headers.get("www-authenticate")!;
  const prm = (await (await app.request(path(param(challenge, "resource_metadata")))).json()) as { resource: string; authorization_servers: string[] };
  assert.equal(prm.resource, RESOURCE);
  const as = (await (await app.request(`/.well-known/oauth-authorization-server`)).json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string; registration_endpoint: string };
  assert.equal(as.issuer, prm.authorization_servers[0]);

  // 2. Register (DCR), then authorize with PKCE and the resource.
  const redirect = "http://127.0.0.1:47011/callback";
  const reg = (await (await app.request(path(as.registration_endpoint), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Test Client", redirect_uris: [redirect] }) })).json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challengeS256 = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(as.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: challengeS256, code_challenge_method: "S256", state: "st", resource: RESOURCE, scope: param(challenge, "scope") })) authorize.searchParams.set(k, v);
  const toConnect = await app.request(path(authorize.toString()));
  assert.equal(toConnect.status, 302);
  const requestId = new URL(toConnect.headers.get("location")!).searchParams.get("request")!;

  // 3. The person confirms on the Connect page (browser session).
  const decision = (await (await app.request(`/oauth/requests/${requestId}/decision`, { method: "POST", headers: { "content-type": "application/json", cookie: "session=alice" }, body: JSON.stringify({ approve: true, level: "listing" }) })).json()) as { redirectTo: string };
  const callback = new URL(decision.redirectTo);
  assert.equal(callback.searchParams.get("state"), "st");
  assert.equal(callback.searchParams.get("iss"), ORIGIN);

  // 4. Exchange the code and use the token.
  const form = (body: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const tokens = (await (await app.request(path(as.token_endpoint), form({ grant_type: "authorization_code", code: callback.searchParams.get("code")!, client_id: reg.client_id, redirect_uri: redirect, code_verifier: verifier, resource: RESOURCE }))).json()) as { access_token: string; refresh_token: string };
  const listed = await app.request(mcp("tools/list", {}, tokens.access_token));
  assert.equal(listed.status, 200);
  assert.match(await listed.text(), /search_services/);
  const searched = await app.request(mcp("tools/call", { name: "search_services", arguments: {} }, tokens.access_token));
  assert.equal(searched.status, 200);

  // 5. Spending is beyond Listing: the server asks for a step up.
  const stepUp = await app.request(mcp("tools/call", { name: "authorize_hire", arguments: {} }, tokens.access_token));
  assert.equal(stepUp.status, 403);
  assert.equal(param(stepUp.headers.get("www-authenticate")!, "scope"), "wallet:execute");

  // 6. Refresh, then Disconnect in Account cuts the agent off at once.
  const refreshed = (await (await app.request(path(as.token_endpoint), form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id, resource: RESOURCE }))).json()) as { access_token: string };
  assert.equal((await app.request(mcp("tools/list", {}, refreshed.access_token))).status, 200);
  const { connections } = (await (await app.request("/agon/app/connections", { headers: { cookie: "session=alice" } })).json()) as { connections: { id: string }[] };
  assert.equal((await app.request(`/agon/app/connections/${connections[0]!.id}/disconnect`, { method: "POST", headers: { cookie: "session=alice" } })).status, 200);
  const after = await app.request(mcp("tools/list", {}, refreshed.access_token));
  assert.equal(after.status, 401);
  assert.match(after.headers.get("www-authenticate")!, /invalid_token/);
});
