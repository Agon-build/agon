import assert from "node:assert/strict";
import test from "node:test";

import { KIND_LABEL, approvalFailureText, askRefusalText, confirmFailureText, failureText } from "./stage-copy.ts";

test("every refusal a person can hit has a plain sentence", () => {
  assert.equal(askRefusalText("insufficient_balance", "0.30"), "Your agent wallet needs 0.30 USDC for this hire.");
  assert.equal(askRefusalText("over_your_max", "0.30"), "The lead agent charges 0.30 USDC, more than the maximum you set.");
  assert.equal(askRefusalText("terms_required"), "Accept the agent wallet terms to continue.");
  assert.equal(askRefusalText("invalid_question"), "Ask a full question, between 8 and 300 characters.");
  assert.equal(askRefusalText("something_new"), "Agon could not prepare this request. Try again in a moment.");
  assert.equal(confirmFailureText("expired"), "This quote expired. Ask again for a fresh price.");
  assert.equal(confirmFailureText("payment_unknown"), "The payment is still confirming on Arc. This page updates when it lands.");
  assert.equal(failureText("no_market"), "Polymarket has no open market that matches this question.");
  assert.equal(failureText(null), "The agents could not finish this job.");
  assert.equal(approvalFailureText("wrong_account"), "This approval belongs to a different Agon account. Sign in with the account linked to this chat.");
  assert.deepEqual(Object.keys(KIND_LABEL).sort(), ["data", "fail", "haggle", "hire", "note", "refund"]);
});
