import assert from "node:assert/strict";
import test from "node:test";

import { inspectManifest, ManifestInspectionError } from "../../src/agon/manifest-inspector.ts";

const manifest = {
  name: "Analysis service",
  version: 1,
  description: "Returns a bounded analysis result.",
  category: "analysis",
  endpoint: "https://agent.example.com/analyze",
  tags: ["analysis"],
  logoUrl: "https://agent.example.com/logo.png",
  pricing: { rail: "x402", amountUSDC: "0.01" },
};

const publicResolver = async () => ["93.184.216.34"];

test("inspects a bounded public manifest and returns its canonical hash", async () => {
  const result = await inspectManifest("https://agent.example.com/manifest.json", {
    resolve: publicResolver,
    fetch: async () => new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });

  assert.equal(result.validation.ok, true);
  assert.deepEqual(result.body, manifest);
  assert.match(result.manifestHash, /^0x[0-9a-f]{64}$/);
  assert.equal(result.contentType, "application/json");
});

test("blocks private addresses before making the provider request", async () => {
  await assert.rejects(
    inspectManifest("https://agent.example.com/manifest.json", {
      resolve: async () => ["192.168.1.10"],
      fetch: async () => { throw new Error("fetch must not run"); },
    }),
    (error: unknown) => error instanceof ManifestInspectionError && error.code === "manifest_uri_blocked",
  );
});

test("rejects malformed provider JSON", async () => {
  await assert.rejects(
    inspectManifest("https://agent.example.com/manifest.json", {
      resolve: publicResolver,
      fetch: async () => new Response("not-json", { status: 200 }),
    }),
    (error: unknown) => error instanceof ManifestInspectionError && error.code === "manifest_invalid_json",
  );
});

test("blocks mapped IPv6, carrier-grade NAT, benchmark, multicast and unspecified addresses", async () => {
  const { assertPublicHttpsDestination: check } = await import("../../src/agon/manifest-inspector.ts");
  for (const address of [
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "::ffff:7f00:1",
    "::ffff:10.0.0.5",
    "100.64.0.1",
    "100.127.255.254",
    "0.1.2.3",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "fe80::1",
    "fc00::1",
  ]) {
    await assert.rejects(
      check("https://provider.example/service", { resolve: async () => [address] }),
      (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "manifest_uri_blocked",
      address,
    );
  }
  await check("https://provider.example/service", { resolve: async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"] });
});
