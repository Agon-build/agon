import assert from "node:assert/strict";
import test from "node:test";

import { createProviderFetch, publicOnlyLookup } from "../../src/agon/payments/provider-fetch.ts";

// Audit B9 (2026-11-09): the provider host was checked at quote time and resolved
// again when Agon paid, so a rebinding DNS record could point the paid call elsewhere.

function lookupWith(addresses: string[]) {
  const lookup = publicOnlyLookup(async () => addresses);
  return (all: boolean) => new Promise<{ error: Error | null; result: unknown }>((resolve) => {
    lookup("provider.example", { all }, (error: Error | null, address?: unknown, family?: number) => resolve({ error, result: all ? address : { address, family } }));
  });
}

test("the connection lookup refuses a host that resolves to a private address", async () => {
  const out = await lookupWith(["93.184.216.34", "127.0.0.1"])(false);
  assert.ok(out.error);
  assert.match(out.error!.message, /private or reserved/);
});

test("the connection lookup refuses a rebinding answer even after a public one", async () => {
  let call = 0;
  const lookup = publicOnlyLookup(async () => (call++ === 0 ? ["93.184.216.34"] : ["10.0.0.5"]));
  const first = await new Promise<Error | null>((resolve) => lookup("provider.example", {}, (error: Error | null) => resolve(error)));
  const second = await new Promise<Error | null>((resolve) => lookup("provider.example", {}, (error: Error | null) => resolve(error)));
  assert.equal(first, null);
  assert.ok(second);
});

test("the connection lookup hands back the vetted public address", async () => {
  assert.deepEqual(await lookupWith(["93.184.216.34"])(false), { error: null, result: { address: "93.184.216.34", family: 4 } });
  assert.deepEqual(await lookupWith(["2606:2800:220:1::1"])(true), { error: null, result: [{ address: "2606:2800:220:1::1", family: 6 }] });
});

test("an https provider call to a private address fails before any request is sent", async () => {
  const providerFetch = createProviderFetch({ resolve: async () => ["127.0.0.1"] });
  await assert.rejects(providerFetch("https://provider.example/agent", { method: "POST", body: "{}" }), /private or reserved/);
});

test("plain http calls (Agon's own internal services) go to the normal fetch", async () => {
  const seen: string[] = [];
  const providerFetch = createProviderFetch({ resolve: async () => ["127.0.0.1"], fallback: (async (url: string | URL | Request) => { seen.push(String(url)); return new Response("ok"); }) as typeof fetch });
  const res = await providerFetch("http://auth:8090/x402/lead", { method: "POST" });
  assert.equal(await res.text(), "ok");
  assert.deepEqual(seen, ["http://auth:8090/x402/lead"]);
});

test("a compressed provider body is made plain again; an unknown encoding is refused", async () => {
  const { gzipSync, brotliCompressSync } = await import("node:zlib");
  const { decodeBody } = await import("../../src/agon/payments/provider-fetch.ts");
  const plain = Buffer.from(JSON.stringify({ answer: 42 }));
  assert.deepEqual(decodeBody(plain, null), plain);
  assert.deepEqual(decodeBody(gzipSync(plain), "gzip"), plain);
  assert.deepEqual(decodeBody(brotliCompressSync(plain), "br"), plain);
  assert.throws(() => decodeBody(plain, "zstd"), /unsupported content-encoding/);
});
