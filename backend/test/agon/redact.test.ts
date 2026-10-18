import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitive } from "../../src/agon/redact.ts";

// Shaped like a real viem error that reached a notification on 2026-10-17; the key here is made up.
const LEAKED = [
  "marketplace_state_write_failed:marketplace verification submission is unknown: RPC Request failed.",
  "URL: https://rpc.testnet.arc-node.example.com/v1/swrm_00000000fakekey0000000000000000",
  'Request body: {"method":"eth_sendRawTransaction","params":["0x02f8ef834cef527d0185059682f00182ac0494f01' + "ab".repeat(120) + '"]}',
  "Request Arguments: from: 0x294B30bf8051896097F4fcA081C21Baa569CE2bF to: 0xf017290a267a3ceb693544882464a188d9e4a516 data: 0x646c8ab1" + "0".repeat(200),
  "Contract Call: address: 0xf017290a267a3ceb693544882464a188d9e4a516 function: setVerificationForVersion(uint256 id, uint256 expectedVersion, bytes32 expectedManifestHash, uint8 verification)",
  "Version: viem@2.21.0",
].join("\n");

test("a raw RPC error keeps its short reason and loses the URL path, request body, arguments and calldata", () => {
  const out = redactSensitive(LEAKED);
  assert.match(out, /^marketplace_state_write_failed/);
  assert.doesNotMatch(out, /swrm_|fakekey|\/v1\//, "no URL path or key");
  assert.doesNotMatch(out, /Request body|Request Arguments|Contract Call|eth_sendRawTransaction|viem@/);
  assert.doesNotMatch(out, /0x[0-9a-fA-F]{70,}/, "no long calldata");
  assert.ok(out.length < 200, out);
});

test("ordinary alert text, addresses and transaction hashes are left alone", () => {
  const ok = "Refund of 0.30 USDC to 0x294b30bf8051896097f4fca081c21baa569ce2bf for job 11111111-1111-4111-8111-111111111111 did not go through.";
  assert.equal(redactSensitive(ok), ok);
  const hash = `Settled in 0x${"ab".repeat(32)}.`;
  assert.equal(redactSensitive(hash), hash);
});

test("tokens and keys are removed wherever they appear", () => {
  for (const secret of ["agon_oat_abcdefghijklmnop1234", "agon_ort_abcdefghijklmnop1234", "Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc", "https://api.example.com/rpc?apikey=SECRET123"]) {
    const out = redactSensitive(`failed with ${secret} here`);
    assert.doesNotMatch(out, /abcdefghijklmnop1234|eyJhbGci|SECRET123/, out);
  }
});

test("the notification bell cleans stored rows on the way out", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../src/auth/index.ts", import.meta.url), "utf8");
  const route = src.slice(src.indexOf('app.get("/notifications"'), src.indexOf('app.get("/notifications"') + 2500);
  assert.match(route, /title: redactSensitive\(r\.title\)/);
  assert.match(route, /redactSensitive\(r\.body\)/);
});
