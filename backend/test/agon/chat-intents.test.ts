import assert from "node:assert/strict";
import test from "node:test";

import { classifyIntent, keywordIntent, parseCodeIntent } from "../../src/agon/channels/chat/intents.ts";

const model = (text: string) => async () => ({ text });

test("codes, cancel and commands are parsed by code", () => {
  assert.deepEqual(parseCodeIntent("YES 4821"), { kind: "confirm", code: "4821" });
  assert.deepEqual(parseCodeIntent(" yes 4821 "), { kind: "confirm", code: "4821" });
  assert.deepEqual(parseCodeIntent("yes:4821"), { kind: "confirm", code: "4821" });
  assert.equal(parseCodeIntent("yes 482"), null);
  assert.equal(parseCodeIntent("yes pay it"), null);
  assert.deepEqual(parseCodeIntent("cancel"), { kind: "cancel" });
  assert.deepEqual(parseCodeIntent("/balance"), { kind: "balance" });
  assert.deepEqual(parseCodeIntent("/balance@agon_surf_bot"), { kind: "balance" });
  assert.deepEqual(parseCodeIntent("deposit"), { kind: "deposit" });
  assert.deepEqual(parseCodeIntent("limits"), { kind: "limits", perHire: null, daily: null });
  assert.deepEqual(parseCodeIntent("limits 0.20 per hire 1 per day"), { kind: "limits", perHire: 200_000n, daily: 1_000_000n });
  assert.deepEqual(parseCodeIntent(`withdraw 1.5 to 0x${"7".repeat(40)}`), { kind: "withdraw", to: `0x${"7".repeat(40)}`, amount: 1_500_000n });
  assert.deepEqual(parseCodeIntent("withdraw"), { kind: "withdraw", to: null, amount: null });
  assert.deepEqual(parseCodeIntent("/help"), { kind: "help" });
  assert.equal(parseCodeIntent("What's the chance BTC closes above $120k?"), null);
});

test("the keyword fallback reads forecast questions and a stated budget", () => {
  assert.deepEqual(keywordIntent("What's the real chance BTC closes above $120k on Friday? Spend up to 0.50"), {
    kind: "forecast", question: "What's the real chance BTC closes above $120k on Friday?", maxPrice: 500_000n,
  });
  assert.deepEqual(keywordIntent("Will ETH be above 5000 this week"), { kind: "forecast", question: "Will ETH be above 5000 this week", maxPrice: null });
  assert.deepEqual(keywordIntent("hello there"), { kind: "unknown" });
});

test("the model routes free text; its fields are validated by code", async () => {
  const forecast = await classifyIntent("how likely is btc over 120k by friday, max 50 cents", {
    model: "m", callModel: model('{"intent":"forecast","question":"How likely is BTC over $120k by Friday?","maxPrice":"0.50"}'),
  });
  assert.deepEqual(forecast, { kind: "forecast", question: "How likely is BTC over $120k by Friday?", maxPrice: 500_000n });
  assert.deepEqual(await classifyIntent("whats in my wallet", { model: "m", callModel: model('```json\n{"intent":"balance"}\n```') }), { kind: "balance" });
  assert.deepEqual(await classifyIntent("send 2 to 0x123", { model: "m", callModel: model('{"intent":"withdraw","amount":"2","to":"0x123"}') }), { kind: "withdraw", to: null, amount: 2_000_000n });
});

test("only a YES code can pay: the model can never produce a confirmation", async () => {
  let calls = 0;
  const confirmy = async () => { calls += 1; return { text: '{"intent":"confirm","code":"4821"}' }; };
  assert.deepEqual(await classifyIntent("yes pay it", { model: "m", callModel: confirmy }), { kind: "unknown" });
  assert.deepEqual(await classifyIntent("YES 4821", { model: "m", callModel: confirmy }), { kind: "confirm", code: "4821" });
  assert.equal(calls, 1, "a code never goes to the model");
});

test("a model outage or nonsense falls back to keywords", async () => {
  const down = async () => { throw new Error("provider down"); };
  assert.equal((await classifyIntent("Will BTC close above $120k on Friday?", { model: "m", callModel: down })).kind, "forecast");
  assert.deepEqual(await classifyIntent("hmm", { model: "m", callModel: model("no json here") }), { kind: "unknown" });
});

test("an address or amount the user never typed is dropped", async () => {
  const typedTo = `0x${"7".repeat(40)}`;
  const otherTo = `0x${"6".repeat(40)}`;
  const hallucinated = await classifyIntent("please withdraw everything", { model: "m", callModel: model(`{"intent":"withdraw","amount":"5","to":"${otherTo}"}`) });
  assert.deepEqual(hallucinated, { kind: "withdraw", to: null, amount: null });
  const typed = await classifyIntent(`send two dollars, actually 2.5, to ${typedTo} please`, { model: "m", callModel: model(`{"intent":"withdraw","amount":"2.5","to":"${typedTo}"}`) });
  assert.deepEqual(typed, { kind: "withdraw", to: typedTo, amount: 2_500_000n });
  const limits = await classifyIntent("make my hires cheaper", { model: "m", callModel: model('{"intent":"limits","perHire":"0.10"}') });
  assert.deepEqual(limits, { kind: "limits", perHire: null, daily: null });
});
