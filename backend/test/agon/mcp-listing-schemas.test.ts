import assert from "node:assert/strict";
import test from "node:test";

import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { compileListingInput, confirmListingInput, confirmPauseInput, pauseListingInput, providerDraftInput, publishListingInput } from "../../src/agon/mcp/contract.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";

type Schema = { type?: string; properties?: Record<string, { type?: string; description?: string; items?: { type?: string }; pattern?: string; enum?: unknown[] }>; required?: string[]; additionalProperties?: boolean };

async function toolSchemas(): Promise<Map<string, { description: string; inputSchema: Schema }>> {
  const access = createMcpAccessAdapter({
    async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
    async getListing() { return { ok: false as const, error: { code: "not_found", message: "x" } }; },
    async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "x" } }; },
  });
  const res = await createAgonNativeMcpHandler(access).fetch(new Request("https://api.agon.surf/agon/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  }));
  const raw = await res.text();
  const json = raw.startsWith("event:") ? raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : raw;
  const tools = (JSON.parse(json) as { result: { tools: { name: string; description: string; inputSchema: Schema }[] } }).result.tools;
  return new Map(tools.map((t) => [t.name, t]));
}

test("start_listing tells any agent every field, its type and what to put in it", async () => {
  const start = (await toolSchemas()).get("start_listing")!;
  const s = start.inputSchema;
  assert.deepEqual([...(s.required ?? [])].sort(), Object.keys(providerDraftInput.shape).sort());
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties!.inputs!.type, "array");
  assert.equal(s.properties!.inputs!.items!.type, "string");
  assert.equal(s.properties!.outputs!.type, "array");
  assert.equal(s.properties!.expectedLatencyMs!.type, "integer");
  assert.equal(s.properties!.priceUSDC!.type, "string");
  assert.match(s.properties!.priceUSDC!.pattern!, /\d/);
  assert.deepEqual(s.properties!.category!.enum, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  for (const [name, p] of Object.entries(s.properties!)) assert.ok((p.description ?? "").length > 15, `${name} is described`);
  assert.match(start.description, /Analysis/);
  assert.match(start.description, /ask the user only/i);
  assert.match(start.description, /402/);
});

test("every listing tool publishes the exact shape its server check expects", async () => {
  const tools = await toolSchemas();
  const expect: [string, { shape: Record<string, unknown> }][] = [
    ["compile_listing", compileListingInput], ["prepare_listing_publication", publishListingInput], ["prepare_listing_version", publishListingInput],
    ["pause_listing", pauseListingInput], ["confirm_listing", confirmListingInput], ["confirm_pause", confirmPauseInput],
  ];
  for (const [name, zod] of expect) {
    const s = tools.get(name)!.inputSchema;
    assert.deepEqual(Object.keys(s.properties ?? {}).sort(), Object.keys(zod.shape).sort(), name);
    assert.equal(s.additionalProperties, false, name);
  }
  assert.deepEqual(tools.get("check_listing")!.inputSchema.required, ["draftId"]);
});

test("a valid example from the published shape passes the server's strict check", () => {
  const example = {
    name: "Kestrel", logoUrl: "https://agon.surf/agents/kestrel.svg", outcome: "Forecast for one Polymarket market.", category: "3",
    inputs: ["a polymarket market or question"], outputs: ["probability", "reasons"], priceUSDC: "0.22", expectedLatencyMs: 30000,
    privacy: "Inputs are stored with the job receipt.", failurePolicy: "No charge if no forecast is produced.", endpoint: "https://api.agon.surf/agon/agents/house/kestrel/forecast",
  };
  assert.ok(providerDraftInput.safeParse(example).success);
});
