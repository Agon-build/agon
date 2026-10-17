import assert from "node:assert/strict";
import test from "node:test";

import { parseRegistration, resolveClient } from "../../src/agon/mcp-oauth/clients.ts";
import type { OAuthClient } from "../../src/agon/mcp-oauth/store.ts";

const URL_ID = "https://claude.ai/oauth/claude-code-client-metadata";

function fakeStore() {
  const clients = new Map<string, OAuthClient>();
  return {
    clients,
    getClient: async (id: string) => clients.get(id) ?? null,
    registerClient: async (input: { clientName: string; redirectUris: string[]; logoUri?: string | null; source: "dcr" | "cimd"; clientId?: string }) => {
      const c: OAuthClient = { clientId: input.clientId ?? "agon_dcr_x", clientName: input.clientName, redirectUris: input.redirectUris, logoUri: input.logoUri ?? null, source: input.source, fetchedAt: new Date() };
      clients.set(c.clientId, c);
      return c;
    },
  };
}
const publicOk = async (u: string) => new URL(u);
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

test("dcr metadata with loopback and cursor redirects is accepted; http non-loopback is refused", () => {
  const ok = parseRegistration({ client_name: "Cursor", redirect_uris: ["http://127.0.0.1:1234/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"] });
  assert.deepEqual(ok, { ok: true, value: { clientName: "Cursor", redirectUris: ["http://127.0.0.1:1234/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"], logoUri: null } });
  assert.deepEqual(parseRegistration({ redirect_uris: ["http://example.com/cb"] }), { ok: false, error: "invalid_redirect_uri" });
  assert.deepEqual(parseRegistration({ redirect_uris: [] }), { ok: false, error: "invalid_redirect_uri" });
  assert.deepEqual(parseRegistration("nope"), { ok: false, error: "invalid_client_metadata" });
  const unnamed = parseRegistration({ redirect_uris: ["http://localhost/cb"] });
  assert.ok(unnamed.ok && unnamed.value.clientName === "MCP client");
});

test("cimd document is fetched, checked and stored", async () => {
  const store = fakeStore();
  const fetch = (async () => json({ client_id: URL_ID, client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] })) as typeof globalThis.fetch;
  const client = await resolveClient(URL_ID, { store, fetch, assertPublic: publicOk, now: () => new Date() });
  assert.equal(client?.clientName, "Claude Code");
  assert.equal(client?.source, "cimd");
  assert.equal(store.clients.get(URL_ID)?.clientId, URL_ID);
});

test("cimd refuses a private address, a redirect, a slow answer and an oversized body", async () => {
  const store = fakeStore();
  const deps = (fetch: typeof globalThis.fetch, assertPublic = publicOk) => ({ store, fetch, assertPublic, now: () => new Date() });
  const never = (() => new Promise<Response>(() => {})) as typeof globalThis.fetch;
  assert.equal(await resolveClient("https://10.0.0.1/c", deps(never, async () => { throw new Error("blocked"); })), null);
  assert.equal(await resolveClient(URL_ID, deps((async () => new Response(null, { status: 302, headers: { location: "https://x.example" } })) as typeof globalThis.fetch)), null);
  const started = Date.now();
  assert.equal(await resolveClient(URL_ID, deps(never)), null);
  assert.ok(Date.now() - started < 3_500, "slow documents time out");
  const big = { client_id: URL_ID, client_name: "x".repeat(40_000), redirect_uris: ["http://127.0.0.1/cb"] };
  assert.equal(await resolveClient(URL_ID, deps((async () => json(big)) as typeof globalThis.fetch)), null);
});

test("cimd document whose client_id differs from its URL is refused; unknown plain ids are null", async () => {
  const store = fakeStore();
  const fetch = (async () => json({ client_id: "https://other.example/c", client_name: "X", redirect_uris: ["http://127.0.0.1/cb"] })) as typeof globalThis.fetch;
  assert.equal(await resolveClient(URL_ID, { store, fetch, assertPublic: publicOk, now: () => new Date() }), null);
  assert.equal(await resolveClient("agon_dcr_missing", { store, fetch, assertPublic: publicOk, now: () => new Date() }), null);
});

test("a failed metadata document is not fetched again for a few minutes", async () => {
  const store = fakeStore();
  let calls = 0;
  const fetch = (async () => { calls += 1; return new Response("nope", { status: 404 }); }) as typeof globalThis.fetch;
  const id = "https://broken.example/client.json";
  assert.equal(await resolveClient(id, { store, fetch, assertPublic: publicOk, now: () => new Date("2026-10-17T12:00:00Z") }), null);
  assert.equal(await resolveClient(id, { store, fetch, assertPublic: publicOk, now: () => new Date("2026-10-17T12:01:00Z") }), null);
  assert.equal(calls, 1);
  await resolveClient(id, { store, fetch, assertPublic: publicOk, now: () => new Date("2026-10-17T12:06:00Z") });
  assert.equal(calls, 2);
});
