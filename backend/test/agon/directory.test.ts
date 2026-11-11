import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";

import { agonPayee, createDirectory, createDirectoryRoutes, proofFromScores } from "../../src/agon/directory.ts";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { PUBLIC_MCP_TOOLS, createAgonNativeMcpHandler, createAgonPublicMcpHandler } from "../../src/agon/mcp/native-server.ts";
import { agonNetwork } from "../../src/agon/network.ts";
import type { AgonListingLite } from "../../src/agon/routing/agon-source.ts";
import type { Proof, ProofPart } from "../../src/agon/routing/catalog.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const SCOUT_PAY = `0x${"c2".repeat(20)}` as Address;
const part = (status: ProofPart["status"], value: number | null = null, count = 0): ProofPart => ({ value, count, status });
const PROOF: Proof = { score: 82, playground: part("rated", 90, 6), arena: part("coming_next"), paid: part("not_enough", null, 1) };
const lite = (over: Partial<AgonListingLite>): AgonListingLite => ({
  reference: "5042002:0x11:5", agentId: "5", name: "Scout", description: "Checks whether a Polymarket market is worth trading at your size.", category: "3",
  endpoint: "https://api.agon.surf/agon/agents/specialists/scout", priceAtomic: 100_000n, latencyMs: 15_000, status: "Listed", verified: true, suspended: false,
  inputSchema: { type: "object", properties: { market: { type: "string" }, size: { type: "string" } }, required: ["market"] }, ...over,
});

function setup(rows: AgonListingLite[] = [lite({}), lite({ reference: "r:9", agentId: "9", name: "Other", endpoint: "https://other.example/run", verified: false, category: "42" }), lite({ reference: "r:7", agentId: "7", name: "Paused", status: "Paused" }), lite({ reference: "r:8", agentId: "8", name: "Suspended", suspended: true })]) {
  const state = { reads: 0, fail: false, t: NOW.getTime() };
  const directory = createDirectory({
    listListings: async () => { state.reads += 1; if (state.fail) throw new Error("listings unavailable"); return rows; },
    proofFor: async (agentId) => (agentId === "5" ? PROOF : null),
    payToFor: (endpoint) => agonPayee(endpoint, { lead: null, house: {}, specialists: { scout: SCOUT_PAY } }),
    network: agonNetwork("arc-testnet"), siteUrl: "https://agon.surf", apiUrl: "https://api.agon.surf", now: () => new Date(state.t),
  });
  return { directory, state };
}

test("the directory lists every listed agent with what a caller needs to call and pay it", async () => {
  const { directory } = setup();
  const d = await directory();
  assert.deepEqual(d.agents.map((a) => a.name), ["Scout", "Other"], "paused and suspended agents are left out; the proven one comes first");
  const scout = d.agents[0]!;
  assert.deepEqual(scout, {
    reference: "5042002:0x11:5", agentId: "5", name: "Scout", job: "Checks whether a Polymarket market is worth trading at your size.",
    category: { id: "3", name: "Analysis" },
    inputs: { type: "object", properties: { market: { type: "string" }, size: { type: "string" } }, required: ["market"] },
    price: { usdc: "0.10", atomic: "100000" },
    call: { method: "POST", url: "https://api.agon.surf/agon/agents/specialists/scout", payment: "x402 exact, USDC" },
    payTo: SCOUT_PAY, status: "Listed", verification: "Verified",
    proof: { score: 82, playground: PROOF.playground, arena: PROOF.arena, paid: PROOF.paid },
    links: { page: "https://agon.surf/agents/5", scores: "https://api.agon.surf/agon/scores/5", tests: "https://api.agon.surf/agon/tests?agentId=5" },
  });
  const other = d.agents[1]!;
  assert.deepEqual([other.payTo, other.verification, other.proof, other.category], [null, "Not verified yet", null, { id: "42", name: null }], "an agent Agon does not run names its payee in its own 402");
  assert.deepEqual([d.network.caip2, d.network.testnet, d.readAt], ["eip155:5042002", true, NOW.toISOString()]);
  assert.deepEqual(d.mcp, { public: "https://api.agon.surf/agon/mcp/public", signedIn: "https://api.agon.surf/agon/mcp" });
  assert.doesNotThrow(() => JSON.stringify(d), "no value that cannot be sent as JSON");
});

test("the directory is read at most once a minute, and a failed read is tried again", async () => {
  const { directory, state } = setup();
  await directory();
  await directory();
  assert.equal(state.reads, 1);
  state.t += 61_000;
  state.fail = true;
  await assert.rejects(directory());
  state.fail = false;
  assert.equal((await directory()).agents.length, 2);
  assert.equal(state.reads, 3);
});

test("Agon knows the payee only of the agents it runs itself", () => {
  const sellers = { lead: `0x${"a1".repeat(20)}` as Address, house: { atlas: `0x${"b2".repeat(20)}` as Address }, specialists: { scout: SCOUT_PAY } };
  assert.equal(agonPayee("https://api.agon.surf/agon/agents/lead/forecast", sellers), sellers.lead);
  assert.equal(agonPayee("https://api.agon.surf/agon/agents/house/atlas", sellers), sellers.house.atlas);
  assert.equal(agonPayee("https://api.agon.surf/agon/agents/specialists/scout", sellers), SCOUT_PAY);
  assert.equal(agonPayee("https://api.agon.surf/agon/agents/specialists/rules", sellers), null);
  assert.equal(agonPayee("https://other.example/run", sellers), null);
  assert.equal(agonPayee("not a url", sellers), null);
  assert.equal(proofFromScores({ windows: { all: { score: 82, parts: PROOF } } })!.score, 82);
  assert.equal(proofFromScores({ windows: { all: null } }), null);
  assert.equal(proofFromScores(null), null);
});

test("GET /agon/directory needs no sign-in, gives one agent by reference, and is limited per caller", async () => {
  const { directory, state } = setup();
  let allowed = 3;
  const app = createDirectoryRoutes({ directory, limit: () => (allowed -= 1) >= 0 });
  const all = await app.request("http://api.test/");
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("access-control-allow-origin"), "*");
  assert.equal(((await all.json()) as { agents: unknown[] }).agents.length, 2);
  const one = await app.request("http://api.test/?reference=9");
  assert.deepEqual(((await one.json()) as { agents: { name: string }[] }).agents.map((a) => a.name), ["Other"]);
  assert.equal((await app.request("http://api.test/?reference=nope")).status, 404);
  assert.equal((await app.request("http://api.test/")).status, 429);
  allowed = 5;
  state.t += 61_000;
  state.fail = true;
  assert.equal((await app.request("http://api.test/")).status, 503);
});

const listing = {
  id: "5042002:0x1111111111111111111111111111111111111111:3", chainId: "5042002", serviceRegistry: "0x1111111111111111111111111111111111111111", listingId: "3", agentId: "42",
  serviceKey: `0x${"a".repeat(64)}`, category: "3", version: "1",
  manifest: { hash: `0x${"b".repeat(64)}`, uri: "https://provider.example/manifest.json", body: { service: { name: "CRM helper", description: "Enrich a bounded CRM list", logoUrl: "https://provider.example/logo.png", tags: ["crm"] }, invocation: { endpoint: "https://provider.example/run", requestSchema: { type: "object" }, timeoutMs: 1000 }, pricing: { amountUSDC: "0.22" } } },
  providerSnapshot: `0x${"c".repeat(64)}`, status: "Listed", verification: { status: "Verified", scope: { agentId: "42", listingId: "3", version: "1", category: "3" } },
  risk: { unverified: false, warning: null, quarantineReason: null },
  endpointQa: { status: "passed", checkedAt: new Date().toISOString(), endpointStatus: 200, evidenceHash: `0x${"d".repeat(64)}`, reason: "ok", attempts: 1, passedAttempts: 1, successRate: 100, endpointUrl: "https://provider.example/run" },
  payment: { rail: "X402", directX402: true, escrowEligible: false }, provenance: { sourceBlockNumber: "1", sourceTxHash: `0x${"e".repeat(64)}`, sourceLogIndex: 1 },
} as const;
const access = createMcpAccessAdapter({
  async listListings() { return { ok: true as const, value: { items: [listing], nextCursor: null } }; },
  async getListing() { return { ok: true as const, value: listing }; },
  async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
} as never);
const rpc = (body: unknown) => new Request("https://api.agon.surf/agon/mcp/public", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
/// The server answers as JSON or as one server-sent event carrying the JSON in its data line.
const rpcBody = async (res: Response): Promise<unknown> => {
  const text = await res.text();
  const data = text.split(/\r?\n/).find((line) => line.startsWith("data:"));
  return JSON.parse(data ? data.slice(5) : text);
};
const toolNames = async (res: Response) => ((await rpcBody(res)) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name).sort();

// Phase 4 (2026-11-11): an agent with no Agon account can find a service and read its proof.
test("the public MCP endpoint serves only read tools, with no sign-in", async () => {
  const { directory } = setup();
  const handler = createAgonPublicMcpHandler(access, {
    ratings: { scores: { request: () => Response.json({ agentId: "42", windows: {} }) }, tests: { request: () => Response.json({ items: [] }) } },
    directory, leaderboard: async () => [{ rank: 1 }],
  });
  const init = await handler.fetch(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "outside-agent", version: "1" } } }));
  assert.equal(init.status, 200);
  const names = await toolNames(await handler.fetch(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })));
  assert.deepEqual(names, [...PUBLIC_MCP_TOOLS].sort());
  const call = async (name: string, args: Record<string, unknown> = {}) => (await handler.fetch(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }))).text();
  assert.match(await call("search_services", { query: "crm" }), /CRM helper/);
  assert.match(await call("get_directory"), /specialists\/scout/);
  assert.match(await call("get_agent_scores", { agentId: "42" }), /windows/);
  assert.match(await call("get_leaderboard", { limit: 5 }), /rank/);
  // Nothing that spends, lists or reads an account exists here, with or without a token.
  for (const name of ["hire_service", "confirm_hire", "authorize_hire", "preview_hire", "find_service", "start_listing", "run_agent_test", "enter_season"]) {
    const out = await call(name);
    assert.ok(/"error"\s*:|"isError"\s*:\s*true/.test(out) && !/CRM helper|specialists\/scout/.test(out), `${name}: ${out.slice(0, 200)}`);
  }
});

test("the public tools are a subset of the signed-in server's, and a bare public endpoint serves discovery alone", async () => {
  const bare = await toolNames(await createAgonPublicMcpHandler(access).fetch(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })));
  assert.deepEqual(bare, ["get_service", "search_services"]);
  const signedIn = await toolNames(await createAgonNativeMcpHandler(access).fetch(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })));
  assert.ok(bare.every((n) => signedIn.includes(n)));
  assert.ok(signedIn.includes("preview_hire"), "the signed-in server still has its own tools");
});
