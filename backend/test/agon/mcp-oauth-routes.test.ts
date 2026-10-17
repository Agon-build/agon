import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { ACCESS_LEVEL_SCOPES } from "../../src/agon/access-tokens.ts";
import { createOAuthRoutes } from "../../src/agon/mcp-oauth/routes.ts";
import { PostgresOAuthStore } from "../../src/agon/mcp-oauth/store.ts";
import { CUSTODY_TERMS_VERSION, type CustodyTerms } from "../../src/agon/stage/custody-terms.ts";
import { operatorOwnerRef } from "../../src/agon/stage/settings.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const ISSUER = "https://api.agon.surf";
const RESOURCE = "https://api.agon.surf/agon/mcp";
const APP = "https://agon.surf";
const ALICE = `0x${"1".repeat(40)}`;
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "http://127.0.0.1:33418/callback";

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("mcp_oauth_routes"); });
after(async () => db.close());

const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  const address = c.req.header("x-test-address");
  if (!address) return c.json({ error: "unauthorized" }, 401);
  c.set("address", address.toLowerCase());
  await next();
};

function setup(opts: { limit?: (key: string) => boolean } = {}) {
  const store = new PostgresOAuthStore(db.pool);
  const accepted = new Set<string>();
  const terms: CustodyTerms = {
    isAccepted: async (ref) => accepted.has(ref),
    accept: async (ref, version) => { if (version !== CUSTODY_TERMS_VERSION) return false; accepted.add(ref); return true; },
  };
  const app = new Hono();
  app.route("/", createOAuthRoutes({ store, issuer: ISSUER, resource: RESOURCE, appUrl: APP, requireAuth, terms, resolveClient: (id) => store.getClient(id), ...(opts.limit ? { limit: opts.limit } : {}) }));
  const form = (body: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const asAlice = (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), "x-test-address": ALICE, "content-type": "application/json" } });
  return { app, store, terms, accepted, form, asAlice };
}

async function register(app: Hono, redirect = REDIRECT) {
  const res = await app.request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [redirect] }) });
  assert.equal(res.status, 201);
  return (await res.json()) as { client_id: string; token_endpoint_auth_method: string; redirect_uris: string[] };
}

function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:51000/callback", code_challenge: CHALLENGE, code_challenge_method: "S256", state: "xyz", resource: RESOURCE, ...extra });
  return `/oauth/authorize?${q.toString()}`;
}

test("metadata documents name the resource, issuer, S256 and iss support", async () => {
  const { app } = setup();
  for (const path of ["/.well-known/oauth-protected-resource/agon/mcp", "/.well-known/oauth-protected-resource"]) {
    const prm = (await (await app.request(path)).json()) as Record<string, unknown>;
    assert.equal(prm.resource, RESOURCE);
    assert.deepEqual(prm.authorization_servers, [ISSUER]);
    assert.deepEqual(prm.scopes_supported, ["agon:read"]);
  }
  const as = (await (await app.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
  assert.equal(as.issuer, ISSUER);
  assert.equal(as.authorization_endpoint, `${ISSUER}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${ISSUER}/oauth/token`);
  assert.equal(as.registration_endpoint, `${ISSUER}/oauth/register`);
  assert.equal(as.revocation_endpoint, `${ISSUER}/oauth/revoke`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.equal(as.authorization_response_iss_parameter_supported, true);
});

test("full flow: register, authorize, read request, approve with listing, token, refresh", async () => {
  const { app, form, asAlice } = setup();
  const client = await register(app);
  assert.equal(client.token_endpoint_auth_method, "none");
  const auth = await app.request(authorizeUrl(client.client_id));
  assert.equal(auth.status, 302);
  const location = auth.headers.get("location")!;
  assert.ok(location.startsWith(`${APP}/connect?request=`), location);
  const id = new URL(location).searchParams.get("request")!;
  const view = (await (await app.request(`/oauth/requests/${id}`, asAlice())).json()) as { clientName: string; redirectHost: string; level: string; termsAccepted: boolean };
  assert.deepEqual([view.clientName, view.redirectHost, view.level, view.termsAccepted], ["Claude Code", "this computer", "read", false]);
  const decision = await app.request(`/oauth/requests/${id}/decision`, asAlice({ method: "POST", body: JSON.stringify({ approve: true, level: "listing" }) }));
  assert.equal(decision.status, 200);
  const redirectTo = new URL(((await decision.json()) as { redirectTo: string }).redirectTo);
  assert.equal(`${redirectTo.origin}${redirectTo.pathname}`, "http://127.0.0.1:51000/callback");
  assert.equal(redirectTo.searchParams.get("state"), "xyz");
  assert.equal(redirectTo.searchParams.get("iss"), ISSUER);
  const code = redirectTo.searchParams.get("code")!;
  const tokenRes = await app.request("/oauth/token", form({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://127.0.0.1:51000/callback", code_verifier: VERIFIER, resource: RESOURCE }));
  assert.equal(tokenRes.status, 200);
  assert.equal(tokenRes.headers.get("cache-control"), "no-store");
  const tokens = (await tokenRes.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number; scope: string };
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.expires_in, 3600);
  assert.equal(tokens.scope, ACCESS_LEVEL_SCOPES.listing.join(" "));
  const refreshed = await app.request("/oauth/token", form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: client.client_id, resource: RESOURCE }));
  assert.equal(refreshed.status, 200);
  assert.notEqual(((await refreshed.json()) as { refresh_token: string }).refresh_token, tokens.refresh_token);
  const list = (await (await app.request("/agon/app/connections", asAlice())).json()) as { connections: { id: string; clientName: string; level: string }[] };
  assert.equal(list.connections[0]!.clientName, "Claude Code");
  assert.equal(list.connections[0]!.level, "listing");
  assert.equal((await app.request(`/agon/app/connections/${list.connections[0]!.id}/disconnect`, asAlice({ method: "POST" }))).status, 200);
  assert.equal(((await (await app.request("/agon/app/connections", asAlice())).json()) as { connections: unknown[] }).connections.length, 0);
});

test("an unregistered redirect uri or unknown client gets a 400 page, not a redirect", async () => {
  const { app } = setup();
  const client = await register(app);
  const bad = await app.request(authorizeUrl(client.client_id, { redirect_uri: "http://127.0.0.1:51000/elsewhere" }));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("location"), null);
  assert.equal((await app.request(authorizeUrl("agon_dcr_unknown"))).status, 400);
});

test("a known client with a bad request is sent back with an error, state and iss", async () => {
  const { app } = setup();
  const client = await register(app);
  for (const extra of [{ code_challenge_method: "plain" }, { resource: "https://evil.example/mcp" }, { response_type: "token" }]) {
    const res = await app.request(authorizeUrl(client.client_id, extra));
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location")!);
    assert.ok(loc.searchParams.get("error"));
    assert.equal(loc.searchParams.get("state"), "xyz");
    assert.equal(loc.searchParams.get("iss"), ISSUER);
  }
});

test("cancel returns access_denied with state and iss", async () => {
  const { app, asAlice } = setup();
  const client = await register(app);
  const id = new URL((await app.request(authorizeUrl(client.client_id))).headers.get("location")!).searchParams.get("request")!;
  const out = (await (await app.request(`/oauth/requests/${id}/decision`, asAlice({ method: "POST", body: JSON.stringify({ approve: false, level: "read" }) }))).json()) as { redirectTo: string };
  const loc = new URL(out.redirectTo);
  assert.equal(loc.searchParams.get("error"), "access_denied");
  assert.equal(loc.searchParams.get("state"), "xyz");
  assert.equal(loc.searchParams.get("iss"), ISSUER);
});

test("hire without accepted terms needs acceptTerms; accepting stores the terms", async () => {
  const { app, asAlice, terms } = setup();
  const client = await register(app);
  const id = new URL((await app.request(authorizeUrl(client.client_id))).headers.get("location")!).searchParams.get("request")!;
  const refused = await app.request(`/oauth/requests/${id}/decision`, asAlice({ method: "POST", body: JSON.stringify({ approve: true, level: "hiring" }) }));
  assert.equal(refused.status, 409);
  assert.deepEqual(await refused.json(), { error: "terms_required" });
  const ok = await app.request(`/oauth/requests/${id}/decision`, asAlice({ method: "POST", body: JSON.stringify({ approve: true, level: "hiring", acceptTerms: true, termsVersion: CUSTODY_TERMS_VERSION }) }));
  assert.equal(ok.status, 200);
  assert.equal(await terms.isAccepted(operatorOwnerRef(ALICE)), true);
});

test("decision and request reads need a browser session", async () => {
  const { app } = setup();
  const client = await register(app);
  const id = new URL((await app.request(authorizeUrl(client.client_id))).headers.get("location")!).searchParams.get("request")!;
  assert.equal((await app.request(`/oauth/requests/${id}`)).status, 401);
  assert.equal((await app.request(`/oauth/requests/${id}/decision`, { method: "POST", body: "{}" })).status, 401);
  assert.equal((await app.request("/agon/app/connections")).status, 401);
});

test("token endpoint refuses a reused code with invalid_grant", async () => {
  const { app, form, asAlice } = setup();
  const client = await register(app);
  const id = new URL((await app.request(authorizeUrl(client.client_id))).headers.get("location")!).searchParams.get("request")!;
  const out = (await (await app.request(`/oauth/requests/${id}/decision`, asAlice({ method: "POST", body: JSON.stringify({ approve: true, level: "read" }) }))).json()) as { redirectTo: string };
  const code = new URL(out.redirectTo).searchParams.get("code")!;
  const body = { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: "http://127.0.0.1:51000/callback", code_verifier: VERIFIER, resource: RESOURCE };
  assert.equal((await app.request("/oauth/token", form(body))).status, 200);
  const again = await app.request("/oauth/token", form(body));
  assert.equal(again.status, 400);
  assert.equal(((await again.json()) as { error: string }).error, "invalid_grant");
  const bad = await app.request("/oauth/token", form({ grant_type: "password" }));
  assert.equal(((await bad.json()) as { error: string }).error, "unsupported_grant_type");
});

test("a self-registered app is labelled unverified; an https-redirect one cannot preselect spending", async () => {
  const { app, asAlice, store } = setup();
  const reg = await (await app.request("/oauth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["https://evil.example/cb"] }) })).json() as { client_id: string };
  const loc = (await app.request(authorizeUrl(reg.client_id, { redirect_uri: "https://evil.example/cb", scope: "agon:read wallet:execute" }))).headers.get("location")!;
  const view = (await (await app.request(`/oauth/requests/${new URL(loc).searchParams.get("request")}`, asAlice())).json()) as { verified: boolean; clientHost: string | null; redirectHost: string; level: string };
  assert.deepEqual([view.verified, view.clientHost, view.redirectHost, view.level], [false, null, "evil.example", "read"]);
  const cimd = await store.registerClient({ clientName: "Claude Code", redirectUris: [REDIRECT], source: "cimd", clientId: "https://claude.ai/oauth/claude-code-client-metadata" });
  const loc2 = (await app.request(authorizeUrl(cimd.clientId, { scope: "agon:read wallet:execute" }))).headers.get("location")!;
  const view2 = (await (await app.request(`/oauth/requests/${new URL(loc2).searchParams.get("request")}`, asAlice())).json()) as { verified: boolean; clientHost: string | null; level: string };
  assert.deepEqual([view2.verified, view2.clientHost, view2.level], [true, "claude.ai", "hiring"]);
});

test("authorize is rate limited per network address", async () => {
  const { app } = setup({ limit: (key) => !key.startsWith("authorize:") });
  const client = await register(app);
  const res = await app.request(authorizeUrl(client.client_id));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("location"), null);
});

test("the approve endpoint only takes JSON", async () => {
  const { app } = setup();
  const client = await register(app);
  const id = new URL((await app.request(authorizeUrl(client.client_id))).headers.get("location")!).searchParams.get("request")!;
  const res = await app.request(`/oauth/requests/${id}/decision`, { method: "POST", headers: { "x-test-address": ALICE, "content-type": "text/plain" }, body: JSON.stringify({ approve: true, level: "full" }) });
  assert.equal(res.status, 415);
});
