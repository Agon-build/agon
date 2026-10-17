import assert from "node:assert/strict";
import test from "node:test";

import { CHAT_TERMS_VERSION, handleChatMessage, type ConversationDeps } from "../../src/agon/channels/chat/conversation.ts";
import { keywordIntent, parseCodeIntent } from "../../src/agon/channels/chat/intents.ts";
import type { ChatReply } from "../../src/agon/channels/chat/types.ts";
import { hashChatUser, telegramOwnerRef } from "../../src/agon/stage/settings.ts";
import { MemoryChannelStore } from "./channel-memory-store.ts";
import { QUESTION, stageWorld } from "./stage-test-world.ts";

const PEPPER = "p".repeat(40);
const USER = "4242";

function setup(opts: { off?: boolean; acceptTerms?: boolean; limit?: (key: string) => boolean; router?: ConversationDeps["router"]; outside?: ConversationDeps["outside"] } = {}) {
  const world = stageWorld();
  const channels = new MemoryChannelStore();
  const sent: { id: number; reply: ChatReply }[] = [];
  const edits: { id: number; reply: ChatReply }[] = [];
  let next = 100;
  const deps: ConversationDeps = {
    services: world.services, channels, channel: "telegram", ownerRefOf: telegramOwnerRef, pepper: PEPPER,
    classify: async (t) => parseCodeIntent(t) ?? keywordIntent(t),
    reply: {
      send: async (reply) => { next += 1; sent.push({ id: next, reply }); return next; },
      edit: async (id, reply) => { edits.push({ id, reply }); return true; },
    },
    off: () => opts.off ?? false, now: () => new Date(), pollMs: 1, sleep: () => new Promise((r) => setImmediate(r)),
    ...(opts.limit ? { limit: opts.limit } : {}),
    ...(opts.router ? { router: opts.router } : {}),
    ...(opts.outside ? { outside: opts.outside } : {}),
  };
  const say = (text: string, kind: "text" | "tap" | "start" | "other" = "text") => handleChatMessage(deps, { userId: USER, kind, text });
  return { ...world, channels, deps, sent, edits, say, last: () => sent.at(-1)!.reply };
}

async function accepted(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.say("hi");
  await s.say("terms:accept", "tap");
  return s;
}

test("first contact shows the chat terms with an agree button and does nothing else", async () => {
  const s = setup();
  await s.say("Will BTC close above $120k on Friday?");
  assert.equal(s.sent.length, 1);
  assert.match(s.last().text, /withdraw your balance at any time/);
  assert.match(s.last().text, /Agon holds a small USDC balance for you/);
  assert.deepEqual(s.last().buttons, [[{ label: "I agree", data: "terms:accept" }]]);
  assert.equal(s.store.jobs.size, 0);
  assert.equal(s.store.wallets.size, 0);
});

test("agreeing creates the wallet and shows its address; ids are stored only hashed", async () => {
  const s = await accepted();
  assert.match(s.last().text, /Your Agon wallet: 0x[0-9a-f]{40}/);
  assert.match(s.last().text, /5\.00 USDC on Arc Testnet/);
  assert.match(s.last().text, /\nCommands: \/balance \/deposit \/history \/leaderboard \/limits \/freeze \/withdraw \/help\n/);
  const hash = hashChatUser(PEPPER, "telegram", USER);
  assert.equal((await s.channels.getAccount("telegram", hash))!.termsVersion, CHAT_TERMS_VERSION);
  assert.ok([...s.channels.accounts.keys()].every((k) => !k.includes(USER)));
  assert.ok([...s.store.wallets.keys()].every((k) => k.startsWith(`tg:${hash}|`)));
});

test("on testnet every way to add funds points at Circle's faucet and never claims it ran", async () => {
  const s = await accepted();
  const faucet = [{ label: "Get test USDC", url: "https://faucet.circle.com" }];
  assert.match(s.last().text, /Get test USDC at https:\/\/faucet\.circle\.com \(choose Arc Testnet\)\./);
  assert.doesNotMatch(s.last().text, /is added to new wallets/);
  assert.deepEqual(s.last().buttons, [faucet]);
  await s.say("deposit");
  assert.match(s.last().text, /faucet\.circle\.com/);
  assert.deepEqual(s.last().buttons, [faucet]);
  s.state.balance = 0n;
  await s.say(QUESTION);
  assert.match(s.last().text, /You need 0\.30 USDC[\s\S]*faucet\.circle\.com/);
  assert.deepEqual(s.last().buttons, [faucet]);
});

test("a question gets the lead agent's price, a YES code and a pay button", async () => {
  const s = await accepted();
  await s.say(`${QUESTION} Spend up to 0.50`);
  const quote = s.last();
  assert.match(quote.text, /^Agon Lead Agent will forecast this for 0\.30 USDC \(Arc Testnet, test USDC\)\./);
  assert.match(quote.text, /Question: What's the real chance BTC closes above \$120k on Friday\?/);
  const code = /Reply YES (\d{4}) to pay\. Expires in 5 min\./.exec(quote.text)![1]!;
  assert.deepEqual(quote.buttons, [[{ label: "Pay 0.30 USDC", data: `yes:${code}` }, { label: "Cancel", data: "cancel" }]]);
});

test("only a YES code can pay", async () => {
  const s = await accepted();
  await s.say(QUESTION);
  const code = /Reply YES (\d{4})/.exec(s.last().text)![1]!;
  await s.say("yes pay it");
  assert.equal(s.settler.calls.length, 0);
  await s.say(`YES ${code === "0000" ? "1111" : "0000"}`);
  assert.equal(s.settler.calls.length, 0);
  assert.match(s.last().text, /did not match/);
  await s.say(`yes:${code}`, "tap");
  assert.equal(s.settler.calls.length, 1);
});

test("paying shows progress in one message, then the forecast with the receipt link", async () => {
  const s = await accepted();
  await s.say(QUESTION);
  const code = /Reply YES (\d{4})/.exec(s.last().text)![1]!;
  const before = s.sent.length;
  await s.say(`YES ${code}`);
  const progress = s.sent[before]!;
  assert.match(progress.reply.text, /^(Paying 0\.30 USDC on Arc Testnet|Paid\. Working on it)/);
  assert.ok(s.edits.every((e) => e.id === progress.id), "progress edits one message");
  const finalProgress = s.edits.at(-1)?.reply.text ?? progress.reply.text;
  assert.match(finalProgress, /- Bought market search from AGON testnet stand-in: 0\.0085 USDC/);
  assert.match(finalProgress, /- Hired Atlas \(house\)/);
  const answer = s.last();
  assert.match(answer.text, /^Forecast: 34% chance\. Polymarket says 41%\./);
  assert.match(answer.text, /Why:\n1\. Spot is 6% below the line\n2\. Three days left\n3\. Funding is flat/);
  assert.match(answer.text, /Receipt for 1 payment: https:\/\/agon\.surf\/r\/[0-9a-f-]{36}/);
  assert.equal(answer.buttons![0]![0]!.label, "Open receipt");
});

test("an empty wallet gets the deposit address and the amount needed", async () => {
  const s = await accepted();
  s.state.balance = 0n;
  await s.say(QUESTION);
  assert.match(s.last().text, /You need 0\.30 USDC in your Agon wallet first\.\nSend USDC on Arc Testnet to:\n0x[0-9a-f]{40}/);
});

test("over the per-hire limit the reply is a browser approval button", async () => {
  const s = await accepted();
  s.state.price = 600_000n;
  await s.say(QUESTION);
  assert.match(s.last().text, /over your per-hire limit of 0\.50/);
  assert.equal(s.last().buttons![0]![0]!.label, "Approve in browser");
  assert.match(s.last().buttons![0]![0]!.url!, /^https:\/\/agon\.surf\/approve\?t=/);
});

test("wallet commands answer in plain words", async () => {
  const s = await accepted();
  await s.say("balance");
  assert.match(s.last().text, /Balance: 5\.00 USDC on Arc Testnet\. Left today: 2\.00 of 2\.00\. Up to 0\.50 per hire\./);
  await s.say("deposit");
  assert.match(s.last().text, /Send USDC on Arc Testnet to:\n0x[0-9a-f]{40}/);
  await s.say("limits 0.20 per hire");
  assert.match(s.last().text, /Up to 0\.20 per hire/);
  await s.say("limits 9 per hire");
  assert.match(s.last().text, /can only be lowered/);
  await s.say("leaderboard");
  assert.match(s.last().text, /1\. Atlas \(house\): beat the market by 0\.031 over 214 forecasts/);
  await s.say("freeze");
  assert.match(s.last().text, /Frozen\./);
  await s.say("unfreeze");
  assert.equal(s.last().buttons![0]![0]!.label, "Unfreeze in browser");
  await s.say(`withdraw 1 to 0x${"7".repeat(40)}`);
  assert.equal(s.last().buttons![0]![0]!.label, "Approve in browser");
  await s.say("withdraw");
  assert.match(s.last().text, /withdraw 1\.50 to 0x/);
  await s.say("history");
  assert.match(s.last().text, /No asks yet|Your recent asks/);
  await s.say("what is the meaning of life");
  assert.match(s.last().text, /I can forecast market questions/);
});

test("the chat off switch answers with the web link and nothing else runs", async () => {
  const s = setup({ off: true });
  await s.say(QUESTION);
  assert.match(s.last().text, /paused right now\. You can still ask at https:\/\/agon\.surf\/ask/);
  assert.equal(s.store.jobs.size, 0);
});

test("cancel retires the quote so a later Pay tap cannot pay", async () => {
  const s = await accepted();
  await s.say(QUESTION);
  const code = /Reply YES (\d{4})/.exec(s.last().text)![1]!;
  await s.say("cancel", "tap");
  assert.match(s.last().text, /Cancelled\. Nothing was paid\./);
  await s.say(`yes:${code}`, "tap");
  assert.equal(s.settler.calls.length, 0);
  assert.match(s.last().text, /That quote is closed/);
});

test("a chat user sending too fast is told to wait and nothing else runs", async () => {
  const s = setup({ limit: () => false });
  await s.say(QUESTION);
  assert.match(s.last().text, /quickly\. Wait a minute/);
  assert.equal(s.store.jobs.size, 0);
  assert.equal(s.channels.accounts.size, 0, "a limited message does not even create the account");
});

const CHAT_PICK = {
  source: "circle" as const, reference: "circle:https://analyst.example/ratings", name: "Analyst ratings", provider: "LoneStarOracle", category: "FINANCIAL_ANALYSIS", description: "Analyst ratings",
  url: "https://analyst.example/ratings", method: "GET" as const, inputSchema: null, price: 10_000n, payTo: null, network: "arc" as const, rating: { tier: "unrated" as const, score: null },
  latencyMs: null, tags: [], fee: 150n, total: 10_150n, reason: "Not rated by Agon, from LoneStarOracle on Circle",
};
function chatRouter(calls: string[]) {
  return {
    route: async (_o: string, text: string) => { calls.push(`route:${text}`); return { kind: "pick" as const, routeId: "r1", intent: { kind: "market_data" as const, query: text, values: {} }, pick: CHAT_PICK, alternatives: [], sources: [] }; },
    quote: async () => ({ ok: true as const, step: "confirm_code" as const, jobId: "j1", amount: 10_000n, fee: 150n, total: 10_150n, providerLabel: "Analyst ratings", network: "Arc", testnet: false, expiresAt: new Date(Date.now() + 60_000), code: "4242", input: { symbol: "AAPL" }, source: "circle" as const, reason: CHAT_PICK.reason }),
    confirm: async (_o: string, code: string) => { calls.push(`confirm:${code}`); return { ok: true as const, jobId: "j1", amount: 10_000n, txHash: null, result: { symbol: "AAPL", signal: "BULLISH" } }; },
  } as unknown as NonNullable<ConversationDeps["router"]>;
}

test("a research question in chat gets a pick with price, fee, total, network and a code", async () => {
  const calls: string[] = [];
  const s = await accepted({ router: chatRouter(calls) });
  await s.say("Give me analyst ratings for AAPL");
  const text = s.last().text;
  assert.match(text, /Analyst ratings/);
  assert.match(text, /0\.01 USDC and Agon's 0\.00015 fee, 0\.01015 USDC in total/);
  assert.match(text, /real USDC on Arc mainnet/i);
  assert.match(text, /Not rated by Agon/);
  assert.match(text, /YES 4242/);
  await s.say("yes:4242", "tap");
  assert.ok(calls.includes("confirm:4242"));
  assert.match(s.last().text, /BULLISH/);
});

test("wallet commands use the test wallet unless the message says mainnet", async () => {
  const outside = { ...((await accepted()).services), wallet: async () => ({ networkId: "arc", network: "Arc", testnet: false, explorer: "https://explorer.arc.io", address: `0x${"9".repeat(40)}`, balance: 2_000_000n, perHireCap: 250_000n, dailyCap: 1_000_000n, spentToday: 0n, leftToday: 1_000_000n, frozen: false }) } as unknown as NonNullable<ConversationDeps["outside"]>;
  const s = await accepted({ outside });
  await s.say("balance");
  assert.match(s.last().text, /on Arc Testnet/);
  await s.say("/balance mainnet");
  assert.match(s.last().text, /2\.00 USDC on Arc\./);
});

test("minor: a frozen mainnet wallet is told to unfreeze mainnet", async () => {
  const router = { ...chatRouter([]), quote: async () => ({ ok: false as const, code: "frozen" }) } as unknown as NonNullable<ConversationDeps["router"]>;
  const s = await accepted({ router });
  await s.say("Give me analyst ratings for AAPL");
  assert.match(s.last().text, /unfreeze mainnet/);
});

test("minor: a forecast found by the router is quoted once, with its fee and total", async () => {
  const ask = { ok: true as const, step: "confirm_code" as const, jobId: "jl", amount: 300_000n, fee: 4_500n, total: 304_500n, providerLabel: "Agon Lead Agent", network: "Arc Testnet", testnet: true, expiresAt: new Date(Date.now() + 60_000), code: "7777" };
  const router = { ...chatRouter([]), route: async () => ({ kind: "lead" as const, ask }) } as unknown as NonNullable<ConversationDeps["router"]>;
  const s = await accepted({ router });
  const jobs = s.store.jobs.size;
  await s.say("Give me analyst ratings for AAPL");
  assert.match(s.last().text, /YES 7777/);
  assert.match(s.last().text, /0\.3045 USDC/);
  assert.equal(s.store.jobs.size, jobs, "no second quote");
});

test("minor: when Circle cannot be reached, a request with no fit says so", async () => {
  const router = { ...chatRouter([]), route: async () => ({ kind: "none" as const, sources: [{ id: "agon", status: "ok" }, { id: "circle", status: "unavailable" }] }) } as unknown as NonNullable<ConversationDeps["router"]>;
  const s = await accepted({ router });
  await s.say("Give me analyst ratings for AAPL");
  assert.match(s.last().text, /Circle's marketplace could not be reached/);
});

test("minor: the chat terms give both wallets' limits, and mainnet limits answer with mainnet numbers", async () => {
  const first = setup();
  await first.say("hi");
  assert.match(first.last().text, /0\.25 per hire and 1\.00 per day on Arc mainnet/);
  const base = (await accepted()).services;
  const outside = { ...base, network: { ...base.network, id: "arc", label: "Arc" }, lowerLimits: async () => ({ ok: false, code: "above_default" }) } as unknown as NonNullable<ConversationDeps["outside"]>;
  const s = await accepted({ outside });
  await s.say("/limits 5 per hire mainnet");
  assert.match(s.last().text, /up to 0\.25 per hire and 1\.00 per day/);
});
