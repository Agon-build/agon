import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { CHECKER_HEADER, createCheckerPass } from "../../src/agon/checker-pass.ts";
import { createCertificationGate } from "../../src/agon/payments/listing-protocols.ts";

const SECRET = "s".repeat(64);

test("the pass goes only to Agon's own origin, never to an outside provider, and refuses redirects there", async () => {
  const pass = createCheckerPass(["https://api.agon.surf/"], SECRET);
  const seen: { url: string; header: string | null; redirect: RequestRedirect | undefined }[] = [];
  const wrapped = pass.wrap((async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), header: new Headers(init?.headers).get(CHECKER_HEADER), redirect: init?.redirect });
    return new Response("{}");
  }) as typeof fetch);
  await wrapped("https://api.agon.surf/agon/agents/house/atlas/forecast", { method: "POST", headers: { "content-type": "application/json" } });
  await wrapped("https://provider.example/forecast", { method: "POST" });
  await wrapped("https://api.agon.surf.evil.example/x");
  await wrapped("http://api.agon.surf/x");
  assert.deepEqual(seen.map((s) => s.header), [SECRET, null, null, null]);
  assert.equal(seen[0]!.redirect, "error");
  assert.ok(pass.accepts(SECRET));
  assert.ok(!pass.accepts("x".repeat(64)) && !pass.accepts(undefined) && !pass.accepts("short"));
});

test("Agon's checker through the proxy is never rate limited; an outside caller still is", async () => {
  const pass = createCheckerPass(["https://api.agon.surf"], SECRET);
  const gate = createCertificationGate({ perCaller: 2, trusts: (v) => pass.accepts(v) });
  const app = new Hono();
  app.post("/", (c) => c.json({ ok: gate(c) }));
  const call = async (headers: Record<string, string>) => ((await (await app.request("/", { method: "POST", headers })).json()) as { ok: boolean }).ok;
  const proxied = { "x-forwarded-for": "203.0.113.9" };
  const checker = [];
  for (let i = 0; i < 8; i++) checker.push(await call({ ...proxied, [CHECKER_HEADER]: SECRET }));
  assert.ok(checker.every(Boolean), "the sixth and later checks in an hour still pass");
  assert.deepEqual([await call(proxied), await call(proxied), await call(proxied)], [true, true, false]);
  assert.equal(await call({ ...proxied, [CHECKER_HEADER]: "x".repeat(64) }), false, "a wrong pass is an outside caller");
});
