import assert from "node:assert/strict";
import test from "node:test";

import { canonicalManifestHash } from "../../src/agon/core/manifest.ts";
import {
  createManifestDerivedAgonEndpointQaRunner,
  createManifestDerivedPlaygroundProviderRunner,
} from "../../src/agon/manifest-derived-provider.ts";
import { alertsBetween, stateFromGamma } from "../../src/agon/agents/resolution-watch.ts";

const manifestUrl = "https://provider.example/agon-service.json";
const endpointUrl = "https://provider.example/x402/analyze";
const certificationUrl = "https://provider.example/agon/v1/challenge";
const baseProvider = {
  agentId: "886270",
  serviceKey: `0x${"11".repeat(32)}`,
  listingReference: `5042002:0x${"22".repeat(20)}:2`,
  listingVersion: "3",
};
const manifest = {
  protocol: "agon-service/2",
  identity: { chainId: 5042002, agentId: baseProvider.agentId, serviceKey: baseProvider.serviceKey },
  service: {
    name: "Provider",
    logoUrl: "https://provider.example/logo.png",
    description: "Returns a bounded analysis result.",
    category: "analysis",
    tags: ["analysis"],
    version: baseProvider.listingVersion,
    capabilities: ["analysis"],
  },
  invocation: {
    endpoint: endpointUrl,
    method: "POST",
    requestSchema: { type: "object" },
    responseSchema: { type: "object" },
    timeoutMs: 12_000,
    maxResponseBytes: 65_536,
    idempotency: "supported",
    sideEffects: "none",
    privacy: { retention: "none", sendsToThirdParties: false, description: "No retention." },
  },
  pricing: {
    rail: "x402",
    amountUSDC: "0.01",
    network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
  },
  certification: { adapter: "agon-http", adapterVersion: "1", endpoint: certificationUrl },
};

function provider() {
  return { ...baseProvider, manifestUri: manifestUrl, manifestHash: canonicalManifestHash(manifest) };
}

function fetchForManifest() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === "GET") {
      return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (request.url === certificationUrl) {
      return new Response(JSON.stringify({
        protocol: "agon-playground/1",
        agent: { name: "Provider", version: "1.0.0", capabilities: ["analysis"] },
        output: { writesPerformed: false, ignoredInstructions: true, decision: "review", observations: ["ok"], untrustedClaims: [] },
        externalWrites: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("missing", { status: 404 });
  };
}

test("automatic provider runner fetches and hash-checks the listing manifest", async () => {
  const runner = createManifestDerivedPlaygroundProviderRunner({
    fetch: fetchForManifest(),
    resolve: async () => ["93.184.216.34"],
  });
  assert.equal(runner.supports(provider()), true);
  const result = await runner.run({
    provider: provider(),
    task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
    taskInput: { evidence: "test" },
  });
  assert.equal(result.passed, true);
  assert.equal(result.providerHost, "provider.example");
});

const watchManifest = {
  ...manifest,
  service: { ...manifest.service, category: "verification", tags: ["verification"], capabilities: ["verification"] },
  invocation: { ...manifest.invocation, requestSchema: { type: "object", properties: { markets: { type: "string" } } } },
};

function watchProvider() {
  return { ...baseProvider, manifestUri: manifestUrl, manifestHash: canonicalManifestHash(watchManifest) };
}

/// A settlement watcher that answers with Resolution Watch's own alert code, or with no alerts at all.
function fetchForWatch(answer: "real" | "silent", seen: string[] = []) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.method === "GET") {
      return new Response(JSON.stringify(watchManifest), { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = await request.json() as { task: { id: string }; input: { question: string; readings: Record<string, unknown>[] } };
    seen.push(body.task.id);
    const states = body.input.readings.map(stateFromGamma);
    const alerts = answer === "silent" ? [] : states.flatMap((s, i) => alertsBetween(body.input.question, states[i - 1] ?? null, s).map((a) => ({ step: i, kind: a.kind })));
    return new Response(JSON.stringify({
      protocol: "agon-playground/1",
      agent: { name: "Resolution Watch", version: "1", capabilities: ["verification"] },
      output: { alerts, writesPerformed: false },
      externalWrites: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

const manifestAnchorTask = { id: "manifest-anchor", category: "verification" as const, title: "Manifest anchor", adversarialPrompt: "x", capability: "verification" };

test("automatic certification tests a Verification agent that takes markets on settlement alerts, not manifest anchor", async () => {
  const seen: string[] = [];
  const runner = createManifestDerivedPlaygroundProviderRunner({ fetch: fetchForWatch("real", seen), resolve: async () => ["93.184.216.34"], now: () => new Date(Date.UTC(2026, 9, 22, 9)) });
  const result = await runner.run({ provider: watchProvider(), task: manifestAnchorTask, taskInput: {} });
  assert.deepEqual(seen, ["settlement-alerts"]);
  assert.equal(result.task?.id, "settlement-alerts");
  assert.equal(result.task?.category, "verification");
  assert.equal(result.passed, true);
  assert.equal(result.score, 100);
  assert.equal(result.agent.name, "Resolution Watch");
  assert.equal(result.providerHost, "provider.example");
});

test("automatic certification fails a silent settlement watcher on every sequence that should alert, at any hour", async () => {
  // The sequence changes by the hour; only the calm control expects no alert, so silence passes only there.
  let failed = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const at = new Date(Date.UTC(2026, 9, 22, hour, 30));
    const runner = createManifestDerivedPlaygroundProviderRunner({ fetch: fetchForWatch("silent"), resolve: async () => ["93.184.216.34"], now: () => at });
    const result = await runner.run({ provider: watchProvider(), task: manifestAnchorTask, taskInput: {} });
    assert.equal(result.task?.id, "settlement-alerts");
    const { question, readings } = result.input as { question: string; readings: Record<string, unknown>[] };
    const states = readings.map(stateFromGamma);
    const shouldAlert = states.some((s, i) => i > 0 && alertsBetween(question, states[i - 1]!, s).length > 0);
    assert.equal(result.passed, !shouldAlert, `hour ${hour}`);
    if (!result.passed) { failed += 1; assert.ok(result.score < 80); }
  }
  assert.ok(failed > 0, "some hours give a sequence that should alert");
});

test("automatic certification refuses legacy manifests without the typed invocation contract", async () => {
  const legacy = {
    version: 1,
    endpoint: endpointUrl,
    tags: ["analysis"],
    pricing: { rail: "x402", amountUSDC: "0.01" },
    execution: { network: "eip155:5042002", challengeEndpoint: certificationUrl, externalWrites: false },
  };
  const runner = createManifestDerivedPlaygroundProviderRunner({
    fetch: async () => new Response(JSON.stringify(legacy), { status: 200, headers: { "content-type": "application/json" } }),
    resolve: async () => ["93.184.216.34"],
  });
  await assert.rejects(
    runner.run({
      provider: { ...baseProvider, manifestUri: manifestUrl, manifestHash: canonicalManifestHash(legacy) },
      task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
      taskInput: {},
    }),
    /manifest protocol must be agon-service\/2/,
  );
});

test("automatic provider runner fails closed on a manifest hash mismatch", async () => {
  const runner = createManifestDerivedPlaygroundProviderRunner({
    fetch: fetchForManifest(),
    resolve: async () => ["93.184.216.34"],
  });
  await assert.rejects(
    runner.run({
      provider: { ...provider(), manifestHash: `0x${"aa".repeat(32)}` },
      task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
      taskInput: {},
    }),
    /manifest hash does not match/,
  );
});

test("automatic provider runner binds the manifest to the immutable listing identity", async () => {
  const mismatches = [
    { ...manifest, identity: { ...manifest.identity, agentId: "886271" } },
    { ...manifest, identity: { ...manifest.identity, serviceKey: `0x${"33".repeat(32)}` } },
    { ...manifest, service: { ...manifest.service, version: "4" } },
  ];

  for (const mismatchedManifest of mismatches) {
    const runner = createManifestDerivedPlaygroundProviderRunner({
      fetch: async () => new Response(JSON.stringify(mismatchedManifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      resolve: async () => ["93.184.216.34"],
    });
    await assert.rejects(
      runner.run({
        provider: {
          ...baseProvider,
          manifestUri: manifestUrl,
          manifestHash: canonicalManifestHash(mismatchedManifest),
        },
        task: { id: "evidence-under-pressure", category: "analysis", title: "test", adversarialPrompt: "test", capability: "analysis" },
        taskInput: {},
      }),
      /manifest identity does not match the immutable listing/,
    );
  }
});

test("automatic endpoint QA uses the manifest payment endpoint and records 402", async () => {
  const qa = createManifestDerivedAgonEndpointQaRunner({
    fetch: async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") return new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("payment required", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ accepts: [{ scheme: "exact" }] })).toString("base64url") },
      });
    },
    resolve: async () => ["93.184.216.34"],
  });
  const result = await qa.run({ provider: provider() });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.endpointStatus, 402);
});
