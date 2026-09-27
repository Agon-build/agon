import assert from "node:assert/strict";
import test from "node:test";

import { authorizeWalletExecute, createWalletExecutePolicy } from "../../src/auth/wallet-execute-policy.ts";

const USDC = "0x3600000000000000000000000000000000000000";
const IDENTITY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REGISTRY = "0xf017290A267A3CEb693544882464a188D9e4a516";
const ARENA = "0x05B81dF2F1615BBDEbd837991BAB199F65eCCB83";
const PRIZE_ESCROW = "0x9A81C86aA4E548EC322889cdE7E489fBEb0a215F";
const AGENT_REGISTRY = "0x99306f3f4C1608915f07eDE24F5e6515F6eeE281";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";

const policy = createWalletExecutePolicy({
  usdc: USDC,
  identityRegistry: IDENTITY,
  intentBound: [REGISTRY, ARENA],
  usdcSpenders: [PRIZE_ESCROW, AGENT_REGISTRY],
  legacy: [PRIZE_ESCROW, AGENT_REGISTRY],
});

function check(client: string | null, contractAddress: string, abiFunctionSignature: string, abiParameters: unknown[] = []) {
  return authorizeWalletExecute(policy, { client, contractAddress, abiFunctionSignature, abiParameters });
}

test("a browser session can send its own USDC, but never pull or pre-authorize others", () => {
  assert.equal(check(null, USDC, "transfer(address,uint256)", [ATTACKER, "1000000"]).ok, true);
  assert.equal(check(null, USDC, "transferFrom(address,address,uint256)", [ATTACKER, ATTACKER, "1"]).ok, false);
  assert.equal(check(null, USDC, "increaseAllowance(address,uint256)", [PRIZE_ESCROW, "1"]).ok, false);
  assert.equal(check(null, USDC, "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)", []).ok, false);
});

test("a CLI or agent token cannot send USDC at all", () => {
  const result = check("agon-cli", USDC, "transfer(address,uint256)", [ATTACKER, "1000000"]);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 403);
});

test("USDC approve is allowed only to a known spender contract", () => {
  assert.equal(check(null, USDC, "approve(address,uint256)", [PRIZE_ESCROW, "5000000"]).ok, true);
  assert.equal(check(null, USDC, "approve( address , uint256 )", [PRIZE_ESCROW.toLowerCase(), "1"]).ok, true);
  assert.equal(check(null, USDC, "approve(address,uint256)", [ATTACKER, "5000000"]).ok, false);
});

test("identity registry allows registration only, never transfers", () => {
  assert.equal(check(null, IDENTITY, "register(string)", ["https://example.com/agent.json"]).ok, true);
  assert.equal(check(null, IDENTITY, "transferFrom(address,address,uint256)", [ATTACKER, ATTACKER, "1"]).ok, false);
  assert.equal(check(null, IDENTITY, "setApprovalForAll(address,bool)", [ATTACKER, true]).ok, false);
});

test("legacy contracts refuse asset-moving functions but keep their game actions", () => {
  assert.equal(check(null, AGENT_REGISTRY, "transferFrom(address,address,uint256)", [ATTACKER, ATTACKER, "7"]).ok, false);
  assert.equal(check(null, AGENT_REGISTRY, "safeTransferFrom(address,address,uint256)", [ATTACKER, ATTACKER, "7"]).ok, false);
  assert.equal(check(null, PRIZE_ESCROW, "claimPrize(uint256,uint256,uint256,bytes32[])", []).ok, true);
});

test("CLI and agent tokens may sign only intent-bound AGON calls", () => {
  assert.equal(check("agon-cli", REGISTRY, "publish(uint256,bytes32,bytes32,string,uint256,uint8)").ok, true);
  assert.equal(check("agon-cli", ARENA, "requestEvaluation(bytes32,uint256,bytes32,bytes32,bytes32,uint64)").ok, true);
  const approve = check("agon-cli", USDC, "approve(address,uint256)", [PRIZE_ESCROW, "1"]);
  assert.equal(approve.ok, false);
  assert.equal(approve.ok === false && approve.status, 403);
  assert.equal(check("agon-cli", IDENTITY, "register(string)", ["https://example.com/a.json"]).ok, false);
});

test("contracts outside the allowlist are refused", () => {
  const result = check(null, ATTACKER, "anything()");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
});
