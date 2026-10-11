import assert from "node:assert/strict";
import test from "node:test";

import { agonNetwork, explorerAddressUrl, explorerTxUrl } from "../../src/agon/network.ts";

test("arc-testnet carries the verified testnet values", () => {
  const n = agonNetwork("arc-testnet");
  assert.equal(n.chainId, 5_042_002);
  assert.equal(n.caip2, "eip155:5042002");
  assert.equal(n.circleChain, "ARC-TESTNET");
  assert.equal(n.label, "Arc Testnet");
  assert.deepEqual(n.rpcHttp, ["https://rpc.testnet.arc.io"]);
  assert.equal(n.usdc, "0x3600000000000000000000000000000000000000");
  assert.equal(n.identityRegistry, "0x8004A818BFB912233c491871b3d84c89A494BD9e");
});

test("arc carries the verified mainnet values", () => {
  const n = agonNetwork("arc");
  assert.equal(n.chainId, 5042);
  assert.equal(n.caip2, "eip155:5042");
  assert.equal(n.circleChain, "ARC");
  assert.equal(n.label, "Arc");
  assert.deepEqual(n.rpcHttp, ["https://rpc.mainnet.arc.io"]);
  assert.equal(n.identityRegistry, "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432");
});

test("an RPC override replaces the default list and must be non-empty https", () => {
  assert.deepEqual(agonNetwork("arc", ["https://a.example", "https://b.example"]).rpcHttp, ["https://a.example", "https://b.example"]);
  assert.throws(() => agonNetwork("arc", ["http://insecure.example"]), /https/);
  assert.deepEqual(agonNetwork("arc", []).rpcHttp, ["https://rpc.mainnet.arc.io"]);
});

test("unknown network ids are refused", () => {
  assert.throws(() => agonNetwork("base"), /unknown AGON network/);
  assert.throws(() => agonNetwork("ARC"), /unknown AGON network/);
});

test("explorer links use the network's explorer", () => {
  const hash = `0x${"ab".repeat(32)}`;
  assert.equal(explorerTxUrl(agonNetwork("arc"), hash), `https://explorer.arc.io/tx/${hash}`);
  assert.equal(
    explorerAddressUrl(agonNetwork("arc-testnet"), "0x3600000000000000000000000000000000000000"),
    "https://explorer.testnet.arc.io/address/0x3600000000000000000000000000000000000000",
  );
});
