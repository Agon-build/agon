import assert from "node:assert/strict";
import test from "node:test";

import { parseRegistration, resolveClient, type DocumentFetcher } from "../../src/agon/mcp-oauth/clients.ts";
import type { OAuthClient } from "../../src/agon/mcp-oauth/store.ts";

const URL_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const PUBLIC_IP = "160.79.104.10";

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
const doc = (body: unknown, status = 200): DocumentFetcher => async () => ({ status, body: JSON.stringify(body) });
const resolvePublic = async () => [PUBLIC_IP];
const deps = (get: DocumentFetcher, resolve: (host: string) => Promise<string[]> = resolvePublic, store = fakeStore()) => ({ store, resolve, get, now: () => new Date() });

test("dcr metadata with loopback and cursor redirects is accepted; http non-loopback is refused", () => {
  const ok = parseRegistration({ client_name: "Cursor", redirect_uris: ["http://127.0.0.1:1234/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"] });
  assert.deepEqual(ok, { ok: true, value: { clientName: "Cursor", redirectUris: ["http://127.0.0.1:1234/callback", "cursor://anysphere.cursor-retrieval/oauth/callback"], logoUri: null } });
  assert.deepEqual(parseRegistration({ redirect_uris: ["http://example.com/cb"] }), { ok: false, error: "invalid_redirect_uri" });
  assert.deepEqual(parseRegistration({ redirect_uris: [] }), { ok: false, error: "invalid_redirect_uri" });
  assert.deepEqual(parseRegistration("nope"), { ok: false, error: "invalid_client_metadata" });
  const unnamed = parseRegistration({ redirect_uris: ["http://localhost/cb"] });
  assert.ok(unnamed.ok && unnamed.value.clientName === "MCP client");
});

test("cimd document is fetched from the address that was checked, and stored", async () => {
  const seen: string[] = [];
  const get: DocumentFetcher = async (url, address) => { seen.push(`${url.host} ${address}`); return { status: 200, body: JSON.stringify({ client_id: URL_ID, client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }) }; };
  const d = deps(get);
  const client = await resolveClient(URL_ID, d);
  assert.equal(client?.clientName, "Claude Code");
  assert.equal(client?.source, "cimd");
  assert.deepEqual(seen, [`claude.ai ${PUBLIC_IP}`], "the fetch is pinned to the vetted address, so a second DNS answer cannot redirect it");
});

test("cimd refuses a private address, a redirect, a slow lookup, a slow answer and an oversized body", async () => {
  let called = false;
  const never = <T>() => new Promise<T>(() => {});
  assert.equal(await resolveClient("https://internal.example/c1", deps(async () => { called = true; return { status: 200, body: "{}" }; }, async () => ["10.0.0.1"])), null);
  assert.equal(called, false, "a private address is never contacted");
  assert.equal(await resolveClient("https://internal.example/c2", deps(doc({}), async () => [PUBLIC_IP, "127.0.0.1"])), null, "any private answer refuses the host");
  assert.equal(await resolveClient("https://moved.example/c", deps(doc({ client_id: "x" }, 302))), null);
  let started = Date.now();
  assert.equal(await resolveClient("https://slowdns.example/c", deps(doc({}), () => never())), null);
  assert.ok(Date.now() - started < 3_500, "a slow DNS lookup is inside the 3 s budget");
  started = Date.now();
  assert.equal(await resolveClient("https://slow.example/c", deps(() => never())), null);
  assert.ok(Date.now() - started < 3_500, "a slow answer times out");
  assert.equal(await resolveClient("https://big.example/c", deps(async () => ({ status: 200, body: null }))), null, "the fetcher reports an oversized body as null");
  const huge = { client_id: "https://huge.example/c", client_name: "x".repeat(40_000), redirect_uris: ["http://127.0.0.1/cb"] };
  assert.equal(await resolveClient("https://huge.example/c", deps(doc(huge))), null);
});

test("cimd document whose client_id differs from its URL is refused; unknown plain ids are null", async () => {
  assert.equal(await resolveClient("https://mismatch.example/c", deps(doc({ client_id: "https://other.example/c", client_name: "X", redirect_uris: ["http://127.0.0.1/cb"] }))), null);
  assert.equal(await resolveClient("agon_dcr_missing", deps(doc({}))), null);
});

test("a failed metadata document is not fetched again for a few minutes", async () => {
  const store = fakeStore();
  let calls = 0;
  const get: DocumentFetcher = async () => { calls += 1; return { status: 404, body: "nope" }; };
  const id = "https://broken.example/client.json";
  const at = (t: string) => ({ store, resolve: resolvePublic, get, now: () => new Date(t) });
  assert.equal(await resolveClient(id, at("2026-10-17T12:00:00Z")), null);
  assert.equal(await resolveClient(id, at("2026-10-17T12:01:00Z")), null);
  assert.equal(calls, 1);
  await resolveClient(id, at("2026-10-17T12:06:00Z"));
  assert.equal(calls, 2);
});
