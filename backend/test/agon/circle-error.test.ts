import assert from "node:assert/strict";
import test from "node:test";

import { circleErrorText } from "../../src/chain/circle-error.ts";

test("Circle's own code and message are kept when a request is rejected", () => {
  const err = Object.assign(new Error("Request failed with status code 400"), { response: { status: 400, data: { code: 156020, message: "Invalid fee configuration." } } });
  assert.equal(circleErrorText(err), "Circle rejected the request (HTTP 400, code 156020): Invalid fee configuration.");
});

test("errors without a Circle body keep their own message, and nothing secret is echoed", () => {
  assert.equal(circleErrorText(new Error("socket hang up")), "socket hang up");
  assert.equal(circleErrorText("x"), "x");
  const withConfig = Object.assign(new Error("Request failed with status code 401"), { response: { status: 401, data: {} }, config: { headers: { Authorization: "Bearer SECRET" } } });
  assert.equal(circleErrorText(withConfig), "Circle rejected the request (HTTP 401)");
  assert.doesNotMatch(circleErrorText(withConfig), /SECRET/);
});
