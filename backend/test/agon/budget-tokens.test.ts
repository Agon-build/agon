import assert from "node:assert/strict";
import test from "node:test";
import type { MiddlewareHandler } from "hono";

import { BUDGET_DEFAULT_DAILY, BUDGET_DEFAULT_PER_HIRE, budgetProblem, utcDay, type AccessTokenRecord, type AccessTokenStore, type BudgetClaim, type BudgetLedger, type TokenBudget } from "../../src/agon/access-tokens.ts";
import { createBuilderRoutes } from "../../src/agon/builder-routes.ts";
import { createMcpAccessAdapter } from "../../src/agon/mcp/adapter.ts";
import { createOwnerQueue, mayHaveCharged, reserveBudget } from "../../src/agon/mcp/budget-hire.ts";
import { createAgonNativeMcpHandler } from "../../src/agon/mcp/native-server.ts";
import type { StageMcpDeps } from "../../src/agon/mcp/stage-tools.ts";
import { QUESTION, stageWorld } from "./stage-test-world.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const ALICE = `0x${"1".repeat(40)}`;
const TOKEN = "00000000-0000-4000-8000-00000000b0b0";
const budget = (over: Partial<BudgetClaim> = {}): BudgetClaim => ({ tokenId: TOKEN, perHireCap: 500_000n, dailyCap: 1_000_000n, categories: null, allowOutside: false, ...over });

/// The ledger as the database keeps it: one row per token and job, summed per UTC day.
function memoryLedger() {
  const rows: { tokenId: string; jobId: string; day: string; amount: bigint }[] = [];
  const ledgerState = { usable: true };
  const ledger: BudgetLedger = {
    async reserve(i) {
      if (rows.some((r) => r.tokenId === i.tokenId && r.jobId === i.jobId)) return "duplicate";
      const day = utcDay(i.now);
      const spent = rows.filter((r) => r.tokenId === i.tokenId && r.day === day).reduce((s, r) => s + r.amount, 0n);
      if (spent + i.amount > i.dailyCap) return "over_daily";
      rows.push({ tokenId: i.tokenId, jobId: i.jobId, day, amount: i.amount });
      return "reserved";
    },
    async release(tokenId, jobId) { const at = rows.findIndex((r) => r.tokenId === tokenId && r.jobId === jobId); if (at >= 0) rows.splice(at, 1); },
    async spentToday(tokenId, now) { return rows.filter((r) => r.tokenId === tokenId && r.day === utcDay(now)).reduce((s, r) => s + r.amount, 0n); },
    async usable() { return ledgerState.usable; },
  };
  return { ledger, rows, ledgerState };
}

test("a budget must have sane caps, inside Agon's own ceiling, and known categories", () => {
  const ok: TokenBudget = { perHireCap: BUDGET_DEFAULT_PER_HIRE, dailyCap: BUDGET_DEFAULT_DAILY, categories: null, allowOutside: false };
  assert.deepEqual([BUDGET_DEFAULT_PER_HIRE, BUDGET_DEFAULT_DAILY], [500_000n, 5_000_000n], "0.50 USDC a hire and 5 USDC a day (owner decision 2026-11-11)");
  assert.equal(budgetProblem(ok), null);
  assert.equal(budgetProblem({ ...ok, categories: ["prediction", "research"] }), null);
  assert.equal(budgetProblem({ ...ok, perHireCap: 0n }), "invalid_caps");
  assert.equal(budgetProblem({ ...ok, dailyCap: 400_000n }), "invalid_caps", "a day's cap below one hire's");
  assert.equal(budgetProblem({ ...ok, perHireCap: 5_000_001n, dailyCap: 6_000_000n }), "caps_too_high");
  assert.equal(budgetProblem({ ...ok, dailyCap: 50_000_001n }), "caps_too_high");
  assert.equal(budgetProblem({ ...ok, categories: [] }), "invalid_categories");
  assert.equal(budgetProblem({ ...ok, categories: ["gambling"] }), "invalid_categories");
});

test("a quote is held to the token's rules, then reserved against today's cap", async () => {
  const { ledger, rows, ledgerState } = memoryLedger();
  const quote = (jobId: string, total = 300_000n, over: Partial<{ source: "agon" | "circle"; categories: string[] }> = {}) => ({ jobId, total, source: "agon" as const, categories: ["prediction"], ...over });
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j1"), NOW), { ok: true });
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j2"), NOW), { ok: true });
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j3"), NOW), { ok: true });
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j4"), NOW), { ok: false, code: "over_token_daily" }, "the fourth would pass 1.00 USDC");
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j1", 1n), NOW), { ok: false, code: "over_token_daily" }, "the same quote is never paid twice");
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j5", 500_001n), NOW), { ok: false, code: "over_token_per_hire" });
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j6", 0n), NOW), { ok: false, code: "over_token_per_hire" }, "a quote of nothing is not a hire");
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j7", 10_000n, { source: "circle" }), NOW), { ok: false, code: "outside_not_allowed" });
  assert.deepEqual(await reserveBudget(ledger, budget({ categories: ["research"] }), quote("j8", 10_000n), NOW), { ok: false, code: "category_not_allowed" });
  assert.deepEqual(await reserveBudget(ledger, budget({ categories: ["research"] }), quote("j9", 10_000n, { categories: [] }), NOW), { ok: false, code: "category_not_allowed" }, "a service in no category passes no category rule");
  assert.equal(rows.length, 3, "a refused quote reserves nothing");
  // The next UTC day starts a new cap; a revoked or expired token spends nothing at all.
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j10"), new Date("2026-11-12T00:00:01Z")), { ok: true });
  ledgerState.usable = false;
  assert.deepEqual(await reserveBudget(ledger, budget(), quote("j11", 1n), new Date("2026-11-12T00:00:02Z")), { ok: false, code: "token_not_usable" });
  // Allowed outside, in an allowed category.
  ledgerState.usable = true;
  assert.deepEqual(await reserveBudget(ledger, budget({ allowOutside: true, categories: ["market_data"] }), quote("j12", 10_000n, { source: "circle", categories: ["market_data", "prediction"] }), new Date("2026-11-12T00:00:03Z")), { ok: true });
});

test("only failures after which money may have moved keep counting against the budget", () => {
  for (const code of ["delivery_failed", "delivery_unknown", "payment_unknown", "already_processed"]) assert.equal(mayHaveCharged(code), true, code);
  for (const code of ["frozen", "payments_off", "over_daily", "over_per_payment", "market_closed", "signing_refused", "network_error", "invalid_code"]) assert.equal(mayHaveCharged(code), false, code);
});

test("budget hires for one account run one at a time, and a failure does not block the next", async () => {
  const queue = createOwnerQueue();
  const order: string[] = [];
  const slow = queue("a", async () => { order.push("a1 start"); await new Promise((r) => setTimeout(r, 20)); order.push("a1 end"); return 1; });
  const failing = queue("a", async () => { order.push("a2"); throw new Error("boom"); });
  const after = queue("a", async () => { order.push("a3"); return 3; });
  const other = queue("b", async () => { order.push("b1"); return "b"; });
  assert.equal(await other, "b");
  assert.equal(await slow, 1);
  await assert.rejects(failing, /boom/);
  assert.equal(await after, 3);
  assert.deepEqual(order.filter((x) => x.startsWith("a")), ["a1 start", "a1 end", "a2", "a3"]);
  assert.ok(order.indexOf("b1") < order.indexOf("a1 end"), "another account does not wait");
});

const access = createMcpAccessAdapter({
  async listListings() { return { ok: true as const, value: { items: [], nextCursor: null } }; },
  async getListing() { return { ok: false as const, error: { code: "not_found", message: "not found" } }; },
  async prepareX402Call() { return { ok: false as const, error: { code: "disabled", message: "disabled" } }; },
});
const rpc = (id: number, name: string, args: Record<string, unknown>) => new Request("https://api.agon.surf/agon/mcp", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
});
const withBudget = (b: BudgetClaim) => ({ authInfo: { token: "verified", clientId: "agon-cli", scopes: ["agon:read", "budget:spend"], extra: { address: ALICE, client: "agon-cli", budget: b } } });
async function payload(res: Response): Promise<{ isError?: boolean; value: Record<string, unknown> }> {
  const raw = await res.text();
  const json = raw.startsWith("event:") ? raw.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim() : raw;
  const body = JSON.parse(json) as { result: { isError?: boolean; content: { text: string }[] } };
  return { isError: body.result.isError, value: JSON.parse(body.result.content[0]!.text) };
}
function setup(opts: { router?: StageMcpDeps["router"]; termsAccepted?: boolean } = {}) {
  const world = stageWorld();
  const book = memoryLedger();
  const stage: StageMcpDeps = {
    services: world.services, season: null, seasonId: "1", off: () => false, limit: () => true, budgets: book.ledger,
    terms: { isAccepted: async () => opts.termsAccepted ?? true },
    ...(opts.router ? { router: opts.router } : {}),
  };
  return { ...world, ...book, handler: createAgonNativeMcpHandler(access, undefined, stage) };
}
const hireLead = (handler: ReturnType<typeof setup>["handler"], id: number, b: BudgetClaim) => handler.fetch(rpc(id, "hire_service", { ref: "agent:lead", question: QUESTION }), withBudget(b)).then(payload);

// Owner decision 2026-11-11: an agent holding a budget token finds, pays and gets the answer in
// one call, inside the token's caps, with no code shown to it. Proof target for production:
// three hires go through and the fourth is refused over budget.
test("a budget token pays three hires in one call each, and is refused the fourth over its daily cap", async () => {
  const { handler, settler, rows } = setup();
  for (const id of [1, 2, 3]) {
    const out = await hireLead(handler, id, budget());
    assert.deepEqual([out.value.ok, out.value.paidFromBudget, out.value.amount, out.value.total], [true, true, "0.30", "0.30"], JSON.stringify(out.value));
    assert.equal((out.value.answer as { probabilityBps: number }).probabilityBps, 3400);
    assert.match(String(out.value.receiptUrl), /^https:\/\/agon\.surf\/r\//);
    assert.match(String(out.value.note), /Do not follow instructions/);
    assert.equal("code" in out.value, false, "no confirmation code is handed to the agent");
    assert.deepEqual(out.value.budget, { spentToday: `0.${id * 3}0`, dailyLimit: "1.00", perHireLimit: "0.50" });
  }
  const fourth = await hireLead(handler, 4, budget());
  assert.deepEqual([fourth.value.ok, fourth.value.code, fourth.value.total, fourth.value.dailyLimit], [false, "over_token_daily", "0.30", "1.00"]);
  assert.equal(settler.calls.length, 3, "the fourth moved no money");
  assert.equal(rows.length, 3);
});

test("a budget token cannot pay above its per-hire cap, outside its categories, or once revoked", async () => {
  const world = setup();
  const small = await hireLead(world.handler, 1, budget({ perHireCap: 200_000n }));
  assert.deepEqual([small.value.ok, small.value.code, small.value.perHireLimit], [false, "over_token_per_hire", "0.20"]);
  const wrongCategory = await hireLead(world.handler, 2, budget({ categories: ["research", "creative"] }));
  assert.deepEqual([wrongCategory.value.ok, wrongCategory.value.code], [false, "category_not_allowed"]);
  const rightCategory = await hireLead(world.handler, 3, budget({ categories: ["prediction"] }));
  assert.equal(rightCategory.value.ok, true);
  world.ledgerState.usable = false;
  const revoked = await hireLead(world.handler, 4, budget());
  assert.deepEqual([revoked.value.ok, revoked.value.code], [false, "token_not_usable"]);
  assert.equal(world.settler.calls.length, 1, "only the allowed hire moved money");
});

test("the account's own limits still hold under a budget token, and the token cannot use the code path", async () => {
  const world = setup();
  // Over the wallet's per-hire limit: the person must approve in the browser; the token gets no link to pay with.
  world.state.price = 600_000n;
  const over = await hireLead(world.handler, 1, budget({ perHireCap: 5_000_000n, dailyCap: 50_000_000n }));
  assert.deepEqual([over.value.ok, over.value.code, "approvalUrl" in over.value], [false, "over_wallet_limit", false]);
  assert.equal(world.rows.length, 0);
  // A budget token holds no wallet:execute, so confirm_hire refuses it.
  const confirm = await payload(await world.handler.fetch(rpc(2, "confirm_hire", { jobId: "00000000-0000-4000-8000-000000000001", code: "1234" }), withBudget(budget())));
  assert.equal((confirm.value.error as { code: string }).code, "scope_required");
  // The owner must still have accepted the wallet terms in the browser.
  const noTerms = setup({ termsAccepted: false });
  const refused = await hireLead(noTerms.handler, 3, budget());
  assert.equal((refused.value.error as { code: string }).code, "terms_required");
  assert.equal(world.settler.calls.length + noTerms.settler.calls.length, 0);
});

test("a token with no budget keeps the two-step code flow unchanged", async () => {
  const { handler, settler, rows } = setup();
  const quote = await payload(await handler.fetch(rpc(1, "hire_service", { ref: "agent:lead", question: QUESTION }), { authInfo: { token: "verified", clientId: "agon-cli", scopes: ["agon:read"], extra: { address: ALICE, client: "agon-cli" } } }));
  assert.deepEqual([quote.value.ok, quote.value.step, typeof quote.value.code], [true, "confirm_code", "string"]);
  assert.equal(settler.calls.length, 0);
  assert.equal(rows.length, 0);
});

function fakeRouter(confirmOutcome: () => Record<string, unknown>, quoteOver: Record<string, unknown> = {}) {
  let n = 0;
  return {
    route: async () => ({ kind: "none" as const, sources: [] }),
    quote: async () => ({ ok: true as const, step: "confirm_code" as const, jobId: `00000000-0000-4000-8000-00000000000${(n += 1)}`, amount: 10_000n, fee: 150n, total: 10_150n, providerLabel: "Analyst ratings", network: "Arc", testnet: false, expiresAt: new Date(Date.now() + 60_000), code: "4242", input: {}, source: "circle" as const, reason: "r", categories: ["market_data"], ...quoteOver }),
    confirm: async () => confirmOutcome(),
  } as unknown as NonNullable<StageMcpDeps["router"]>;
}
const hireRouted = (handler: ReturnType<typeof setup>["handler"], id: number, b: BudgetClaim) => handler.fetch(rpc(id, "hire_service", { routeId: "r1", reference: "circle:x" }), withBudget(b)).then(payload);

test("a routed outside service is paid from a budget only when the token allows outside services", async () => {
  let outcome: Record<string, unknown> = { ok: true, jobId: "00000000-0000-4000-8000-000000000001", amount: 10_000n, txHash: null, result: { price: 1 } };
  const world = setup({ router: fakeRouter(() => outcome) });
  const kept = await hireRouted(world.handler, 1, budget());
  assert.deepEqual([kept.value.ok, kept.value.code], [false, "outside_not_allowed"]);
  const paid = await hireRouted(world.handler, 2, budget({ allowOutside: true }));
  assert.deepEqual([paid.value.ok, paid.value.paidFromBudget, paid.value.total, paid.value.result], [true, true, "0.01015", { price: 1 }]);
  assert.equal(await world.ledger.spentToday(TOKEN, new Date()), 10_150n);
  // A failure with no charge gives the money back to the budget; one that may have charged does not.
  outcome = { ok: false, code: "frozen", jobId: "00000000-0000-4000-8000-000000000003" };
  const frozen = await hireRouted(world.handler, 3, budget({ allowOutside: true }));
  assert.deepEqual([frozen.value.ok, frozen.value.code, frozen.value.charged], [false, "frozen", "no"]);
  assert.equal(await world.ledger.spentToday(TOKEN, new Date()), 10_150n);
  outcome = { ok: false, code: "delivery_failed", jobId: "00000000-0000-4000-8000-000000000004" };
  const failed = await hireRouted(world.handler, 4, budget({ allowOutside: true }));
  assert.deepEqual([failed.value.ok, failed.value.code, failed.value.charged], [false, "delivery_failed", "possibly"]);
  assert.equal(await world.ledger.spentToday(TOKEN, new Date()), 20_300n, "a paid hire that was not delivered still counts");
});

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const signedIn: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => { c.set("address", OWNER); await next(); };
function fakeTokens(): AccessTokenStore & { made: Parameters<AccessTokenStore["create"]>[0][] } {
  const records: AccessTokenRecord[] = [];
  const made: Parameters<AccessTokenStore["create"]>[0][] = [];
  return {
    made,
    async create(input) {
      made.push(input);
      if (input.level === "budget" && !input.budget) return { ok: false, code: "budget_required" };
      if (input.level !== "budget" && input.budget) return { ok: false, code: "budget_not_allowed" };
      const problem = input.budget ? budgetProblem(input.budget) : null;
      if (problem) return { ok: false, code: problem };
      const record: AccessTokenRecord = { id: TOKEN, owner: input.owner, name: input.name, level: input.level, createdAt: input.now, expiresAt: new Date(input.now.getTime() + input.days * 86_400_000), lastUsedAt: null, revokedAt: null, budget: input.budget ?? null };
      records.push(record);
      return { ok: true, token: "agon_pat_secret", record };
    },
    async list() { return records; },
    async revoke() { return true; },
    async verify() { return { ok: false, reason: "unknown" }; },
  };
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("the account owner creates a budget token with caps in USDC, and sees what it spent today", async () => {
  const tokens = fakeTokens();
  const app = createBuilderRoutes({ tokens, budgets: { spentToday: async () => 300_000n }, requireAuth: signedIn, now: () => NOW });
  const made = await app.request("http://x/tokens", post({ name: "Research agent", level: "budget", days: 7, budget: { perHire: "0.50", daily: "5", categories: ["prediction"], allowOutside: false } }));
  assert.equal(made.status, 201);
  const body = (await made.json()) as { token: string; record: { budget: unknown; expiresAt: string } };
  assert.deepEqual(body.record.budget, { perHire: "0.50", daily: "5.00", categories: ["prediction"], allowOutside: false });
  assert.equal(body.record.expiresAt, "2026-11-18T12:00:00.000Z");
  assert.deepEqual(tokens.made[0]!.budget, { perHireCap: 500_000n, dailyCap: 5_000_000n, categories: ["prediction"], allowOutside: false });
  const listed = (await (await app.request("http://x/tokens")).json()) as { tokens: Record<string, unknown>[] };
  assert.deepEqual([listed.tokens[0]!.level, listed.tokens[0]!.spentToday, listed.tokens[0]!.budget], ["budget", "0.30", { perHire: "0.50", daily: "5.00", categories: ["prediction"], allowOutside: false }]);
  assert.equal(JSON.stringify(listed).includes("agon_pat_secret"), false);
  // Refused: a budget level without a budget, a budget on another level, caps above the ceiling, bad amounts and categories.
  const status = async (b: unknown) => { const res = await app.request("http://x/tokens", post(b)); return [res.status, ((await res.json()) as { error: string }).error]; };
  assert.deepEqual(await status({ name: "x", level: "budget", days: 30 }), [400, "budget_required"]);
  assert.deepEqual(await status({ name: "x", level: "hiring", days: 30, budget: { perHire: "0.50", daily: "5" } }), [400, "budget_not_allowed"]);
  assert.deepEqual(await status({ name: "x", level: "budget", days: 30, budget: { perHire: "6", daily: "10" } }), [400, "caps_too_high"]);
  assert.deepEqual(await status({ name: "x", level: "budget", days: 30, budget: { perHire: "1", daily: "0.50" } }), [400, "invalid_caps"]);
  assert.deepEqual(await status({ name: "x", level: "budget", days: 30, budget: { perHire: "lots", daily: "5" } }), [400, "invalid_caps"]);
  assert.deepEqual(await status({ name: "x", level: "budget", days: 30, budget: { perHire: "0.50", daily: "5", categories: ["gambling"] } }), [400, "invalid_request"]);
  assert.deepEqual(await status({ name: "x", level: "budget", days: 365, budget: { perHire: "0.50", daily: "5" } }), [400, "invalid_request"]);
  // A token with no budget lists with none.
  await app.request("http://x/tokens", post({ name: "reader", level: "read", days: 30 }));
  const again = (await (await app.request("http://x/tokens")).json()) as { tokens: Record<string, unknown>[] };
  assert.deepEqual([again.tokens[1]!.budget, "spentToday" in again.tokens[1]!], [null, false]);
});
