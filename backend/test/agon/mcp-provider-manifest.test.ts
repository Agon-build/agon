import test from "node:test";
import assert from "node:assert/strict";
import { compileProviderManifest } from "../../src/agon/mcp/provider-manifest.ts";

const draft = {
  name: "CRM helper",
  logoUrl: "https://provider.example/logo.png",
  outcome: "Enrich a bounded CRM list",
  category: "crm",
  inputs: ["records"],
  outputs: ["enriched records"],
  priceUSDC: "0.04",
  expectedLatencyMs: 90_000,
  privacy: "Deletes input after delivery",
  failurePolicy: "Retry delivery without another charge when safe",
  endpoint: "https://provider.example/execute",
} as const;

test("provider drafts compile into a valid canonical Arc manifest", () => {
  const compiled = compileProviderManifest(draft, { agentId: "42" });
  assert.equal(compiled.body.protocol, "agon-service/2");
  assert.equal(compiled.body.identity.agentId, "42");
  assert.equal(compiled.body.service.logoUrl, "https://provider.example/logo.png");
  assert.match(compiled.manifestHash, /^0x[0-9a-f]{64}$/);
  assert.match(compiled.serviceKey, /^0x[0-9a-f]{64}$/);
  assert.equal(compiled.body.pricing.amountUSDC, "0.04");
});

test("the same provider draft and identity produce stable keys and hashes", () => {
  const first = compileProviderManifest(draft, { agentId: "42" });
  const second = compileProviderManifest(draft, { agentId: "42" });
  assert.equal(first.serviceKey, second.serviceKey);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.draftDigest, second.draftDigest);
});

test("a numeric registry category becomes a readable search tag", () => {
  assert.deepEqual(compileProviderManifest({ ...draft, category: "3" }, { agentId: "42" }).body.service.tags, ["analysis"]);
  assert.deepEqual(compileProviderManifest(draft, { agentId: "42" }).body.service.tags, ["crm"]);
});
