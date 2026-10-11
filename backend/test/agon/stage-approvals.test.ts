import assert from "node:assert/strict";
import test from "node:test";
import { Hono, type MiddlewareHandler } from "hono";
import type { Address } from "viem";

import { createApprovalRoutes } from "../../src/agon/stage/approval-routes.ts";
import { authorizeApprover, describeApproval, type ApprovalGateDeps } from "../../src/agon/stage/approvals.ts";
import { hashChatUser, operatorOwnerRef, telegramOwnerRef } from "../../src/agon/stage/settings.ts";
import { MemoryChannelStore } from "./channel-memory-store.ts";
import { QUESTION, stageWorld } from "./stage-test-world.ts";

const PEPPER = "p".repeat(40);
const ALICE = `0x${"1".repeat(40)}` as Address;
const MALLORY = `0x${"6".repeat(40)}` as Address;
const TG_ID = "424242";
const TG_HASH = hashChatUser(PEPPER, "telegram", TG_ID);

const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
  const address = c.req.header("x-test-address");
  if (!address) return c.json({ error: "unauthorized" }, 401);
  c.set("address", address.toLowerCase());
  await next();
};

function setup(price = 600_000n) {
  const world = stageWorld({ price });
  const channels = new MemoryChannelStore();
  const gate: ApprovalGateDeps = { payments: world.store, channels, chatIdPepper: PEPPER, network: world.network, now: () => new Date() };
  const app = new Hono();
  app.route("/agon", createApprovalRoutes({ gate, hire: world.hire, requireAuth }));
  const post = (token: string, as?: Address) => app.request(`/agon/approvals/${token}`, { method: "POST", headers: as ? { "x-test-address": as } : {} });
  return { ...world, channels, gate, app, post };
}

async function overLimitToken(s: ReturnType<typeof setup>, ownerRef: string): Promise<{ token: string; jobId: string }> {
  const quote = await s.services.ask(ownerRef, { question: QUESTION });
  assert.ok(quote.ok && quote.step === "approval_link", JSON.stringify(quote, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  return { token: new URL(quote.approvalUrl).searchParams.get("t")!, jobId: quote.jobId };
}

test("the approval page can read what it approves without using it", async () => {
  const s = setup();
  const { token, jobId } = await overLimitToken(s, operatorOwnerRef(ALICE));
  const res = await s.app.request(`/agon/approvals/${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const { approval } = (await res.json()) as { approval: { action: string; title: string; jobId: string; rows: { label: string; value: string }[]; network: string; testnet: boolean; owner: string } };
  assert.deepEqual([approval.action, approval.title, approval.jobId, approval.network, approval.testnet, approval.owner], ["over_limit_hire", "Approve a hire", jobId, "Arc Testnet", true, "web"]);
  assert.deepEqual(approval.rows, [
    { label: "Service", value: "Agon Lead Agent" },
    { label: "Price", value: "0.60 USDC" },
    { label: "Question", value: QUESTION },
    { label: "Network", value: "Arc Testnet" },
  ]);
  assert.equal((await describeApproval(s.gate, token)).ok, true, "still unused");
  assert.equal((await s.app.request("/agon/approvals/nope-nope-nope-nope-nope")).status, 404);
});

test("the owner approves an over-limit hire once; a second use is refused", async () => {
  const s = setup();
  const { token, jobId } = await overLimitToken(s, operatorOwnerRef(ALICE));
  const first = await s.post(token, ALICE);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { action: "over_limit_hire", ok: true, jobId });
  assert.equal(s.settler.calls.length, 1);
  const again = await s.post(token, ALICE);
  assert.equal(again.status, 410);
  assert.deepEqual(await again.json(), { error: "used" });
});

test("a different signed-in account is refused and the link is not used up", async () => {
  const s = setup();
  const { token } = await overLimitToken(s, operatorOwnerRef(ALICE));
  const wrong = await s.post(token, MALLORY);
  assert.equal(wrong.status, 403);
  assert.deepEqual(await wrong.json(), { error: "wrong_account" });
  assert.equal(s.settler.calls.length, 0);
  assert.equal((await s.post(token, ALICE)).status, 200);
});

test("approving needs a browser sign-in", async () => {
  const s = setup();
  const { token } = await overLimitToken(s, operatorOwnerRef(ALICE));
  assert.equal((await s.post(token)).status, 401);
});

test("a Telegram user whose website account has the same Telegram linked approves at once", async () => {
  const s = setup();
  await s.channels.ensureAccount("telegram", TG_HASH, new Date());
  s.channels.telegramIds.set(ALICE, TG_ID);
  const { token } = await overLimitToken(s, telegramOwnerRef(TG_HASH));
  assert.equal((await s.post(token, ALICE)).status, 200);
});

test("an unlinked Telegram user is linked by the first approval and later approvals must match it", async () => {
  const s = setup();
  await s.channels.ensureAccount("telegram", TG_HASH, new Date());
  const first = await overLimitToken(s, telegramOwnerRef(TG_HASH));
  assert.equal((await s.post(first.token, ALICE)).status, 200);
  assert.equal((await s.channels.getAccount("telegram", TG_HASH))!.operatorAddress, ALICE);
  const second = await overLimitToken(s, telegramOwnerRef(TG_HASH));
  const refused = await s.post(second.token, MALLORY);
  assert.equal(refused.status, 403);
  assert.deepEqual(await authorizeApprover(s.gate, `budget:${telegramOwnerRef(TG_HASH)}`, ALICE), { ok: true });
});

test("Telegram approvals are refused when the chat pepper is not configured", async () => {
  const s = setup();
  s.gate.chatIdPepper = null;
  assert.deepEqual(await authorizeApprover(s.gate, `budget:${telegramOwnerRef(TG_HASH)}`, ALICE), { ok: false, code: "chat_not_configured" });
  assert.deepEqual(await authorizeApprover(s.gate, "budget:wa:abc", ALICE), { ok: false, code: "unknown_owner" });
});

test("withdraw and unfreeze approvals run their wallet actions", async () => {
  const s = setup(300_000n);
  const owner = operatorOwnerRef(ALICE);
  await s.services.wallet(owner);
  const withdraw = await s.services.requestWithdraw(owner, `0x${"7".repeat(40)}` as Address, 1_000_000n);
  assert.ok(withdraw.ok);
  const wToken = new URL(withdraw.approvalUrl).searchParams.get("t")!;
  const view = (await (await s.app.request(`/agon/approvals/${wToken}`)).json()) as { approval: { rows: { label: string; value: string }[] } };
  assert.deepEqual(view.approval.rows.slice(0, 2), [{ label: "Amount", value: "1.00 USDC" }, { label: "To", value: `0x${"7".repeat(40)}` }]);
  const done = await s.post(wToken, ALICE);
  assert.deepEqual(await done.json(), { action: "withdraw", ok: true, transferId: "t-1" });

  await s.services.freeze(owner);
  const unfreeze = await s.services.requestUnfreeze(owner);
  const uToken = new URL(unfreeze!.approvalUrl).searchParams.get("t")!;
  assert.deepEqual(await (await s.post(uToken, ALICE)).json(), { action: "unfreeze", ok: true });
  assert.equal((await s.services.wallet(owner)).frozen, false);
});

test("an account whose website has a different Telegram linked cannot claim a chat wallet", async () => {
  const s = setup();
  await s.channels.ensureAccount("telegram", TG_HASH, new Date());
  s.channels.telegramIds.set(MALLORY, "999999");
  const { token } = await overLimitToken(s, telegramOwnerRef(TG_HASH));
  const refused = await s.post(token, MALLORY);
  assert.equal(refused.status, 403);
  assert.equal((await s.channels.getAccount("telegram", TG_HASH))!.operatorAddress, null, "nothing was linked");
  assert.equal((await s.post(token, ALICE)).status, 200, "the link still works for an unlinked account");
});
