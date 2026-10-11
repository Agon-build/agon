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

function setup(opts: { off?: boolean; acceptTerms?: boolean; limit?: (key: string) => boolean } = {}) {
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
  };
  const say = (text: string, kind: "text" | "tap" | "start" | "other" = "text") => handleChatMessage(deps, { userId: USER, kind, text });
  return { ...world, channels, deps, sent, edits, say, last: () => sent.at(-1)!.reply };
}

async function accepted() {
  const s = setup();
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
  const hash = hashChatUser(PEPPER, "telegram", USER);
  assert.equal((await s.channels.getAccount("telegram", hash))!.termsVersion, CHAT_TERMS_VERSION);
  assert.ok([...s.channels.accounts.keys()].every((k) => !k.includes(USER)));
  assert.ok([...s.store.wallets.keys()].every((k) => k.startsWith(`tg:${hash}|`)));
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
