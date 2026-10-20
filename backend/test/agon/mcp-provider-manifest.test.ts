import test from "node:test";
import assert from "node:assert/strict";
import { compileProviderManifest } from "../../src/agon/mcp/provider-manifest.ts";
import { parseInputLine } from "../../src/agon/mcp/listing-inputs.ts";

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

test("named inputs publish real field names with descriptions, and optional ones are not required", () => {
  const body = compileProviderManifest({ ...draft, inputs: ["market: a Polymarket link, slug or condition id", "url: https://example.com/a:b", "notes: up to 5 short notes (optional)", "records"] }, { agentId: "42" }).body;
  assert.deepEqual(body.invocation.requestSchema, {
    type: "object",
    properties: {
      market: { type: "string", description: "a Polymarket link, slug or condition id" },
      url: { type: "string", description: "https://example.com/a:b" },
      notes: { type: "string", description: "up to 5 short notes" },
      records: { type: "string", description: "records" },
    },
    required: ["market", "url", "records"],
  });
});

test("parseInputLine names the field or says how to write it", () => {
  assert.deepEqual(parseInputLine("market: a Polymarket link"), { name: "market", description: "a Polymarket link", optional: false });
  assert.deepEqual(parseInputLine("crowdBps: Yes price in basis points (optional)"), { name: "crowdBps", description: "Yes price in basis points", optional: true });
  assert.deepEqual(parseInputLine("question"), { name: "question", description: "question", optional: false });
  assert.match((parseInputLine("a polymarket question") as { error: string }).error, /name: what it is/);
  assert.match((parseInputLine("9lives: bad") as { error: string }).error, /name: what it is/);
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
