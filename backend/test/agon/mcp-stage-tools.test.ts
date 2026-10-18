import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";
import type { StageMcpDeps } from "../../src/agon/mcp/stage-tools.ts";
import { QUESTION, stageWorld } from "./stage-test-world.ts";

const ALICE = `0x${"1".repeat(40)}`;
const access = createMcpAccessAdapter({
  async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
  async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
  async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
});

function rpc(id: number, name: string, args: Record<string, unknown>) {
  return new Request("https://api.agon.surf/agon/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
  });
}
const auth = (scopes: string[]) => ({ authInfo: { token: "verified", clientId: "agon-cli", scopes, extra: { address: ALICE, client: "agon-cli" } } });
async function payload(res: Response): Promise<{ isError?: boolean; value: Record<string, unknown> }> {
  // The streamable HTTP transport may answer as one server-sent event ("event: message\ndata: {...}").
  const raw = await res.text();
  const json = raw.startsWith("event:") ? raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim() : raw;
  const body = JSON.parse(json) as { result: { isError?: boolean; content: { text: string }[] } };
  return { isError: body.result.isError, value: JSON.parse(body.result.content[0]!.text) };
}

function setup(off = false, limit?: (key: string) => boolean, termsAccepted = true, router?: StageMcpDeps["router"]) {
  const world = stageWorld();
  const seasonCalls: { path: string; body: unknown }[] = [];
  const season = new Hono();
  season.post("/1/entries", async (c) => {
    seasonCalls.push({ path: "/1/entries", body: await c.req.json() });
    return c.json({ entered: true, enteredRound: "4" }, 201);
  });
  season.post("/1/forecasts", async (c) => {
    seasonCalls.push({ path: "/1/forecasts", body: await c.req.json() });
    return c.json({ results: [{ ok: true, duplicate: false }] });
  });
  const terms = { isAccepted: async () => termsAccepted, accept: async () => true };
  const stage: StageMcpDeps = { services: world.services, season: { request: (p, i) => season.request(p, i) }, seasonId: "1", off: () => off, terms, ...(limit ? { limit } : {}), ...(router ? { router } : {}) };
  return { ...world, handler: createAgonNativeMcpHandler(access, undefined, stage), seasonCalls };
}

test("the stage tools are listed only when the stage is configured", async () => {
  const list = new Request("https://api.agon.surf/agon/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const withStage = await (await setup().handler.fetch(list.clone())).text();
  for (const name of ["find_service", "hire_service", "confirm_hire", "get_job_status", "get_leaderboard", "enter_season", "submit_forecasts"]) assert.match(withStage, new RegExp(`"${name}"`));
  assert.match(withStage, /"get_hire_status"/, "the existing tool is untouched");
  const without = await (await createAgonNativeMcpHandler(access).fetch(list.clone())).text();
  assert.doesNotMatch(without, /"hire_service"/);
});

test("find_service shows the lead agent with its live price and the top forecasters", async () => {
  const { handler } = setup();
  const { value } = await payload(await handler.fetch(rpc(1, "find_service", { need: "forecast" })));
  const services = value.services as Record<string, unknown>[];
  assert.deepEqual([services[0]!.ref, services[0]!.name, services[0]!.price, services[0]!.network, services[0]!.builtBy], ["agent:lead", "Agon Lead Agent", "0.30 USDC", "Arc Testnet", "Agon"]);
  const forecasters = value.forecasters as Record<string, unknown>[];
  assert.deepEqual([forecasters[0]!.name, forecasters[0]!.rank, forecasters[0]!.beatsMarketBy, forecasters[0]!.forecasts], ["Atlas (house)", 1, 0.0312, 214]);
});

test("hire_service needs a signed-in token; confirm_hire needs wallet:execute and pays once", async () => {
  const { handler, settler } = setup();
  const anonymous = await payload(await handler.fetch(rpc(1, "hire_service", { ref: "agent:lead", question: QUESTION })));
  assert.equal(anonymous.isError, true);
  assert.equal((anonymous.value.error as { code: string }).code, "authentication_required");

  const quote = await payload(await handler.fetch(rpc(2, "hire_service", { ref: "agent:lead", question: QUESTION, maxPrice: "0.50" }), auth(["agon:read"])));
  assert.deepEqual([quote.value.ok, quote.value.step, quote.value.amount], [true, "confirm_code", "0.30"]);
  assert.match(String(quote.value.nextStep), /confirm_hire/);

  const readOnly = await payload(await handler.fetch(rpc(3, "confirm_hire", { jobId: quote.value.jobId, code: quote.value.code }), auth(["agon:read"])));
  assert.equal((readOnly.value.error as { code: string }).code, "scope_required");
  assert.equal(settler.calls.length, 0);

  const paid = await payload(await handler.fetch(rpc(4, "confirm_hire", { jobId: quote.value.jobId, code: quote.value.code }), auth(["wallet:execute"])));
  assert.equal(paid.value.ok, true);
  assert.equal((paid.value.answer as { probabilityBps: number }).probabilityBps, 3400);
  assert.match(String(paid.value.receiptUrl), /^https:\/\/agon\.surf\/r\//);
  const again = await payload(await handler.fetch(rpc(5, "confirm_hire", { jobId: quote.value.jobId, code: quote.value.code }), auth(["wallet:execute"])));
  assert.equal(again.value.ok, false);
  assert.equal(settler.calls.length, 1);
});

test("over the per-hire limit hire_service returns a browser approval link", async () => {
  const world = setup();
  world.state.price = 600_000n;
  const quote = await payload(await world.handler.fetch(rpc(1, "hire_service", { ref: "agent:lead", question: QUESTION }), auth(["agon:read"])));
  assert.equal(quote.value.step, "approval_link");
  assert.match(String(quote.value.approvalUrl), /^https:\/\/agon\.surf\/approve\?t=/);
  assert.match(String(quote.value.nextStep), /browser/);
});

test("unknown services, bad input and the off switch are refused", async () => {
  const { handler } = setup();
  assert.equal((await payload(await handler.fetch(rpc(1, "hire_service", { ref: "agent:other", question: QUESTION }), auth(["agon:read"])))).isError, true);
  assert.equal((await payload(await handler.fetch(rpc(2, "hire_service", { ref: "agent:lead", question: QUESTION, maxPrice: "lots" }), auth(["agon:read"])))).isError, true);
  const off = setup(true);
  const refused = await payload(await off.handler.fetch(rpc(3, "hire_service", { ref: "agent:lead", question: QUESTION }), auth(["agon:read"])));
  assert.equal((refused.value.error as { code: string }).code, "channel_off");
});

test("job status and the leaderboard are public", async () => {
  const { handler, services } = setup();
  const quote = await services.ask(`op:${ALICE}`, { question: QUESTION });
  assert.ok(quote.ok);
  const status = await payload(await handler.fetch(rpc(1, "get_job_status", { jobId: quote.jobId })));
  assert.equal(status.value.phase, "quoted");
  const missing = await payload(await handler.fetch(rpc(2, "get_job_status", { jobId: "00000000-0000-4000-8000-000000000000" })));
  assert.equal((missing.value.error as { code: string }).code, "job_not_found");
  const board = await payload(await handler.fetch(rpc(3, "get_leaderboard", { limit: 5 })));
  assert.equal((board.value.rows as { displayName: string }[])[0]!.displayName, "Atlas (house)");
});

test("season entry and forecasts are forwarded to the Season routes unchanged", async () => {
  const { handler, seasonCalls } = setup();
  const entry = { agentAddress: ALICE, erc8004AgentId: "42", displayName: "Northwind", ownerSignature: `0x${"1".repeat(130)}`, agentSignature: `0x${"2".repeat(130)}` };
  const entered = await payload(await handler.fetch(rpc(1, "enter_season", entry)));
  assert.deepEqual(entered.value, { status: 201, body: { entered: true, enteredRound: "4" } });
  const forecasts = { forecasts: [{ round: "4", marketId: `0x${"ab".repeat(32)}`, agentAddress: ALICE, probabilityBps: 3400, salt: `0x${"cd".repeat(32)}`, signature: `0x${"3".repeat(130)}` }] };
  const submitted = await payload(await handler.fetch(rpc(2, "submit_forecasts", forecasts)));
  assert.equal(submitted.value.status, 200);
  assert.deepEqual(seasonCalls.map((c) => c.path), ["/1/entries", "/1/forecasts"]);
  assert.deepEqual(seasonCalls[0]!.body, entry);
});

test("hire_service is rate limited per actor", async () => {
  const { handler, store } = setup(false, () => false);
  const refused = await payload(await handler.fetch(rpc(1, "hire_service", { ref: "agent:lead", question: QUESTION }), auth(["agon:read"])));
  assert.equal((refused.value.error as { code: string }).code, "rate_limited");
  assert.equal(store.jobs.size, 0);
});

test("an agent cannot hire until the account owner accepts the wallet terms in the browser", async () => {
  const { handler, services } = setup(false, undefined, false);
  const out = await payload(await handler.fetch(rpc(1, "hire_service", { ref: "agent:lead", question: QUESTION }), auth(["agon:read"])));
  assert.equal(out.isError, true);
  const error = (out.value as { error: { code: string; message: string } }).error;
  assert.equal(error.code, "terms_required");
  assert.match(error.message, /browser/);
  assert.equal(await services.findWallet(`op:${ALICE}`), null, "no agent wallet was created");
});

const ROUTED = {
  source: "circle" as const, reference: "circle:https://analyst.example/ratings", name: "Analyst ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS", description: "Analyst ratings",
  url: "https://analyst.example/ratings", method: "GET" as const, inputSchema: null, price: 10_000n, payTo: null, network: "arc" as const, rating: { tier: "unrated" as const, score: null },
  latencyMs: null, tags: [], fee: 150n, total: 10_150n, reason: "Not rated by Agon, from LoneStarOracle on Circle",
};
function mcpRouter(calls: string[]) {
  return {
    route: async (_o: string, need: string, opts?: { quoteLead?: boolean }) => { calls.push(`route:${need}:${opts?.quoteLead}`); return { kind: "pick" as const, routeId: "r1", intent: { kind: "market_data" as const, query: need, values: {} }, pick: ROUTED, alternatives: [], sources: [{ id: "agon", status: "ok" as const }] }; },
    quote: async (_o: string, routeId: string, reference: string) => { calls.push(`quote:${routeId}:${reference}`); return { ok: true as const, step: "confirm_code" as const, jobId: "00000000-0000-4000-8000-000000000001", amount: 10_000n, fee: 150n, total: 10_150n, providerLabel: "Analyst ratings", network: "Arc", testnet: false, expiresAt: new Date(Date.now() + 60_000), code: "4242", input: { symbol: "AAPL" }, source: "circle" as const, reason: ROUTED.reason }; },
    confirm: async (_o: string, code: string) => { calls.push(`confirm:${code}`); return { ok: true as const, jobId: "00000000-0000-4000-8000-000000000001", amount: 10_000n, txHash: null, result: { price: 1 } }; },
  } as unknown as NonNullable<StageMcpDeps["router"]>;
}

test("find_service with a need returns Agon's pick and how to hire it, without quoting", async () => {
  const calls: string[] = [];
  const { handler } = setup(false, undefined, true, mcpRouter(calls));
  const { value } = await payload(await handler.fetch(rpc(1, "find_service", { need: "analyst ratings for AAPL" }), auth(["agon:read"])));
  assert.equal((value.pick as { reference: string; total: string }).reference, ROUTED.reference);
  assert.equal((value.pick as { total: string }).total, "0.01015");
  assert.equal(value.routeId, "r1");
  assert.match(String(value.howToHire), /hire_service with routeId and reference/);
  assert.deepEqual(calls, ["route:analyst ratings for AAPL:false"]);
});

test("hire_service quotes a routed pick and confirm_hire confirms through the router", async () => {
  const calls: string[] = [];
  const { handler } = setup(false, undefined, true, mcpRouter(calls));
  const q = await payload(await handler.fetch(rpc(1, "hire_service", { routeId: "r1", reference: ROUTED.reference }), auth(["agon:read"])));
  assert.deepEqual([q.value.ok, q.value.total, q.value.code], [true, "0.01015", "4242"]);
  const c = await payload(await handler.fetch(rpc(2, "confirm_hire", { jobId: "00000000-0000-4000-8000-000000000001", code: "4242" }), auth(["wallet:execute"])));
  assert.equal(c.value.ok, true);
  assert.deepEqual(calls, [`quote:r1:${ROUTED.reference}`, "confirm:4242"]);
});

test("final I5 and C2: find_service with a need is rate limited, and confirm_hire returns the routed answer", async () => {
  const calls: string[] = [];
  const limited = setup(false, () => false, true, mcpRouter(calls));
  const refused = await payload(await limited.handler.fetch(rpc(1, "find_service", { need: "analyst ratings for AAPL" }), auth(["agon:read"])));
  assert.equal((refused.value.error as { code: string }).code, "rate_limited");
  assert.deepEqual(calls, []);
  const { handler } = setup(false, undefined, true, mcpRouter(calls));
  const done = await payload(await handler.fetch(rpc(2, "confirm_hire", { jobId: "00000000-0000-4000-8000-000000000001", code: "4242" }), auth(["agon:read", "wallet:execute"])));
  assert.deepEqual(done.value.result, { price: 1 });
});

test("tool descriptions claim only what is live (agon-build capabilities.md, 2026-10-18)", async () => {
  const list = new Request("https://api.agon.surf/agon/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const raw = await (await setup().handler.fetch(list)).text();
  const body = JSON.parse(raw.slice(raw.indexOf("{"))) as { result: { tools: { name: string; description: string; inputSchema: unknown }[] } };
  const stage = body.result.tools.filter((t) => ["find_service", "hire_service", "confirm_hire", "get_job_status", "get_leaderboard", "enter_season", "submit_forecasts"].includes(t.name));
  for (const t of stage) {
    const text = `${t.description} ${JSON.stringify(t.inputSchema)}`;
    assert.doesNotMatch(text, /Circle/, `${t.name} presents Circle services as working`);
    assert.doesNotMatch(text, /forecaster ratings/, `${t.name} presents Arena ratings as existing`);
  }
  assert.match(stage.find((t) => t.name === "get_leaderboard")!.description, /not scoring yet/);
});

test("the Lead agent is not described as hiring a best-rated forecaster while no forecaster is rated", async () => {
  const { handler } = setup();
  const { value } = await payload(await handler.fetch(rpc(1, "find_service", {})));
  assert.doesNotMatch(JSON.stringify(value), /best-rated/i);
});
