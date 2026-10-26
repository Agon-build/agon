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

test("a wrapped Circle client rejects with Circle's reason only: no request, headers or key", async () => {
  const { withCleanErrors } = await import("../../src/chain/circle-error.ts");
  const raw = {
    createWallets: async () => { throw Object.assign(new Error("Request failed with status code 400"), { response: { status: 400, data: { code: 156006, message: "TEST_API key cannot be used with blockchain mainnets." } }, config: { headers: { Authorization: "Bearer TEST_API_KEY:SECRET" } } }); },
    ok: async () => "fine",
  };
  const client = withCleanErrors(raw);
  assert.equal(await client.ok(), "fine");
  await assert.rejects(client.createWallets(), (e: Error) => {
    assert.equal(e.message, "Circle rejected the request (HTTP 400, code 156006): TEST_API key cannot be used with blockchain mainnets.");
    assert.doesNotMatch(JSON.stringify(e, Object.getOwnPropertyNames(e)), /SECRET/);
    return true;
  });
});

test("Arc mainnet calls use the live Circle keys and Arc Testnet the test keys", async () => {
  const { circleKeysFor } = await import("../../src/chain/circle-error.ts");
  const circle = { apiKey: "TEST_API_KEY:t", entitySecret: "ts", walletSetId: "tw", live: { apiKey: "LIVE_API_KEY:l", entitySecret: "ls", walletSetId: "lw" } };
  assert.deepEqual(circleKeysFor("ARC", circle), { apiKey: "LIVE_API_KEY:l", entitySecret: "ls", walletSetId: "lw" });
  assert.deepEqual(circleKeysFor("ARC-TESTNET", circle), { apiKey: "TEST_API_KEY:t", entitySecret: "ts", walletSetId: "tw" });
});
