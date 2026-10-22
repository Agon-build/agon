import assert from "node:assert/strict";
import test from "node:test";

import { KIND_LABEL, approvalFailureText, askRefusalText, confirmFailureText, failureText, hireHeading, showConfirmError } from "./stage-copy.ts";

test("every refusal a person can hit has a plain sentence", () => {
  assert.equal(askRefusalText("insufficient_balance", "0.30"), "Your agent wallet needs 0.30 USDC for this hire.");
  assert.equal(askRefusalText("over_your_max", "0.3045"), "This costs 0.3045 USDC in total, more than the maximum you set.");
  assert.equal(askRefusalText("terms_required"), "Accept the agent wallet terms to continue.");
  assert.equal(askRefusalText("invalid_question"), "Ask a full question, between 8 and 300 characters.");
  assert.equal(askRefusalText("something_new"), "Agon could not prepare this request. Try again in a moment.");
  assert.equal(confirmFailureText("expired"), "This quote expired. Ask again for a fresh price.");
  assert.equal(confirmFailureText("payment_unknown"), "The payment is still confirming on Arc. This page updates when it lands.");
  assert.equal(failureText("no_market"), "Polymarket has no open market that matches this question.");
  assert.equal(failureText("market_started"), "The market for this already started, so it can no longer be forecast.");
  assert.equal(failureText(null), "The agents could not finish this job.");
  assert.equal(approvalFailureText("wrong_account"), "This approval belongs to a different Agon account. Sign in with the account linked to this chat.");
  assert.deepEqual(Object.keys(KIND_LABEL).sort(), ["data", "fail", "haggle", "hire", "note", "refund"]);
});

test("a market agent's refusal reads as its reason, at quote time and on the job page", () => {
  for (const code of ["market_not_found", "market_closed", "not_yes_no", "not_a_football_market", "market_unavailable"]) {
    assert.notEqual(askRefusalText(code), askRefusalText("something_unknown"), code);
    assert.notEqual(failureText(code), failureText("something_unknown"), code);
  }
  assert.match(failureText("market_closed"), /closed/);
  assert.match(failureText("market_closed"), /Nothing was charged/);
});

test("a hire's input shown as a list under the agent's name, a question as the heading", () => {
  assert.deepEqual(hireHeading("a-slug\nb-slug\n\n c-slug ", "Resolution Watch"), { title: "Hire Resolution Watch", lines: ["a-slug", "b-slug", "c-slug"] });
  assert.deepEqual(hireHeading("https://polymarket.com/event/x/y-z-2026", null), { title: "Hire this agent", lines: ["https://polymarket.com/event/x/y-z-2026"] });
  assert.deepEqual(hireHeading("Will BTC close above 120k on Friday?", "Lead"), { title: "Will BTC close above 120k on Friday?", lines: null });
  assert.deepEqual(hireHeading(null, null), { title: null, lines: null });
});

test("'still confirming' gives way once the job has a final outcome", () => {
  assert.equal(showConfirmError("payment_unknown", "paying"), true);
  assert.equal(showConfirmError("payment_unknown", "failed"), false);
  assert.equal(showConfirmError("payment_unknown", "answered"), false);
  assert.equal(showConfirmError("payment_unknown", "refunded"), false);
  assert.equal(showConfirmError("market_closed", "failed"), true, "a refusal stays: it is the reason");
  assert.equal(showConfirmError(null, "paying"), false);
});
