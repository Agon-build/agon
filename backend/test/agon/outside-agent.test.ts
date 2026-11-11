import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import { utcDay, type BudgetClaim, type BudgetLedger } from "../../src/agon/access-tokens.ts";
import { createDirectoryRoutes, type Directory } from "../../src/agon/directory.ts";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createAgonNativeMcpHandler, createAgonPublicMcpHandler } from "../../src/agon/mcp/native-server.ts";
import type { StageMcpDeps } from "../../src/agon/mcp/stage-tools.ts";
import { rpcAnswer, runOutsideAgent } from "../../src/agon/outside-agent.ts";
import { stageWorld } from "./stage-test-world.ts";

const ALICE = `0x${"1".repeat(40)}`;
const TOKEN = "agon_pat_test-budget-token";
const access = createMcpAccessAdapter({
  async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
  async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
  async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
});
const DIRECTORY = { name: "Agon", agents: [{ name: "Agon Lead Agent" }, { name: "Scout" }] } as unknown as Directory;

/// A whole Agon in one process: the public directory, the public MCP endpoint and the signed-in
/// MCP endpoint, which knows one budget token (0.50 a hire, 1.00 a day; the Lead costs 0.30).
function agon(budget: Partial<BudgetClaim> = {}) {
  const world = stageWorld();
  const rows: { jobId: string; day: string; amount: bigint }[] = [];
  const ledger: BudgetLedger = {
    async reserve(i) {
      const spent = rows.filter((r) => r.day === utcDay(i.now)).reduce((s, r) => s + r.amount, 0n);
      if (rows.some((r) => r.jobId === i.jobId)) return "duplicate";
      if (spent + i.amount > i.dailyCap) return "over_daily";
      rows.push({ jobId: i.jobId, day: utcDay(i.now), amount: i.amount });
      return "reserved";
    },
    async release(_t, jobId) { const at = rows.findIndex((r) => r.jobId === jobId); if (at >= 0) rows.splice(at, 1); },
    async spentToday(_t, now) { return rows.filter((r) => r.day === utcDay(now)).reduce((s, r) => s + r.amount, 0n); },
    async usable() { return true; },
  };
  const stage: StageMcpDeps = { services: world.services, season: null, seasonId: "1", off: () => false, limit: () => true, budgets: ledger, terms: { isAccepted: async () => true } };
  const signedIn = createAgonNativeMcpHandler(access, undefined, stage);
  const publicMcp = createAgonPublicMcpHandler(access, { directory: async () => DIRECTORY });
  const claim: BudgetClaim = { tokenId: "00000000-0000-4000-8000-00000000b0b0", perHireCap: 500_000n, dailyCap: 1_000_000n, categories: null, allowOutside: false, ...budget };
  const app = new Hono();
  app.route("/agon/directory", createDirectoryRoutes({ directory: async () => DIRECTORY, limit: () => true }));
  app.all("/agon/mcp/public", (c) => publicMcp.fetch(c.req.raw));
  app.all("/agon/mcp", (c) => {
    const bearer = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
    if (bearer !== TOKEN) return c.json({ error: "invalid_token" }, 401);
    return signedIn.fetch(c.req.raw, { authInfo: { token: bearer, clientId: "agon-cli", scopes: ["agon:read", "budget:spend"], extra: { address: ALICE, client: "agon-cli", budget: claim } } });
  });
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => app.request(String(url), init)) as typeof fetch;
  return { ...world, fetchImpl, rows };
}

// The proof the architecture asks for (phase 4): an outside agent finds Agon with no account,
// completes three hires on a budget token, and is refused the fourth over the daily cap.
test("the outside agent discovers Agon, pays three hires from a budget token and is refused the fourth", async () => {
  const { fetchImpl, settler, rows } = agon();
  const lines: string[] = [];
  const report = await runOutsideAgent({ api: "http://api.test/", token: TOKEN, hires: 4, fetchImpl, log: (l) => lines.push(l) });
  assert.equal(report.passed, true, `${report.reason}\n${lines.join("\n")}`);
  assert.deepEqual(report.discovery, { directoryAgents: 2, publicTools: ["get_directory", "get_service", "search_services"], directoryOverMcp: true });
  assert.deepEqual(report.hires.map((h) => [h.ok, h.code, h.total, h.hasAnswer]), [[true, null, "0.30", true], [true, null, "0.30", true], [true, null, "0.30", true], [false, "over_token_daily", "0.30", false]]);
  assert.equal(settler.calls.length, 3, "three payments, no more");
  assert.equal(rows.length, 3);
  assert.equal(lines.join("\n").includes(TOKEN), false, "the token is never logged");
  assert.match(lines.at(-1)!, /^PASS/);
});

test("the outside agent fails loudly when the budget does not hold, the token is wrong, or discovery is down", async () => {
  // A cap that allows all four: the run must fail, because the fourth hire was paid.
  const loose = agon({ dailyCap: 5_000_000n });
  const paidAll = await runOutsideAgent({ api: "http://api.test", token: TOKEN, hires: 4, fetchImpl: loose.fetchImpl });
  assert.deepEqual([paidAll.passed, paidAll.reason], [false, "hire 4 was paid; the token's daily cap should have refused it"]);
  // A cap that stops the first hire.
  const tight = agon({ perHireCap: 100_000n, dailyCap: 100_000n });
  const none = await runOutsideAgent({ api: "http://api.test", token: TOKEN, hires: 4, fetchImpl: tight.fetchImpl });
  assert.deepEqual([none.passed, none.reason], [false, "hire 1 was not paid and answered (over_token_per_hire)"]);
  assert.equal(tight.settler.calls.length, 0);
  const wrongToken = await runOutsideAgent({ api: "http://api.test", token: "agon_pat_wrong", hires: 2, fetchImpl: agon().fetchImpl });
  assert.deepEqual([wrongToken.passed, wrongToken.reason], [false, "the token was refused at the door (HTTP 401)"]);
  const down = await runOutsideAgent({ api: "http://api.test", fetchImpl: (async () => new Response("nope", { status: 503 })) as typeof fetch });
  assert.deepEqual([down.passed, down.reason], [false, "the public directory did not answer"]);
  // With no token, discovery alone is checked.
  const discovery = await runOutsideAgent({ api: "http://api.test", fetchImpl: agon().fetchImpl });
  assert.deepEqual([discovery.passed, discovery.reason, discovery.hires.length], [true, "discovery only", 0]);
});

test("an MCP answer is read as plain JSON or as one server-sent event", () => {
  assert.deepEqual(rpcAnswer('{"result":{"tools":[]}}'), { result: { tools: [] } });
  assert.deepEqual(rpcAnswer('event: message\ndata: {"result":{"isError":true}}\n\n'), { result: { isError: true } });
  assert.equal(rpcAnswer("<html>"), null);
});
