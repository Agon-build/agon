import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AGON_CONTRACTS } from "../arc.ts";
import { AGON_SERVICE_REGISTRY } from "./abi.ts";

// The backend serves whichever registry and Arena the deployment receipt marks
// active (V2 when present). The web app must sign against the same pair.
const receipt = JSON.parse(readFileSync(new URL("../../../../contracts/deployments/agon-arc-testnet.json", import.meta.url), "utf8")) as {
  contracts: Record<string, string | undefined>;
};
const activeRegistry = receipt.contracts.AgonServiceRegistryV2 ?? receipt.contracts.AgonServiceRegistry!;
const activeArena = receipt.contracts.AgonArenaV2 ?? receipt.contracts.AgonArena!;

test("frontend service registry matches the active deployment", () => {
  assert.equal(AGON_CONTRACTS.ServiceRegistry.toLowerCase(), activeRegistry.toLowerCase());
  assert.equal(AGON_SERVICE_REGISTRY.toLowerCase(), activeRegistry.toLowerCase());
});

test("frontend Arena matches the active deployment", () => {
  assert.equal(AGON_CONTRACTS.Arena.toLowerCase(), activeArena.toLowerCase());
});

test("frontend profile registry, escrow, and prize vault match the receipt", () => {
  assert.equal(AGON_CONTRACTS.ProfileRegistry.toLowerCase(), receipt.contracts.AgonProfileRegistry!.toLowerCase());
  assert.equal(AGON_CONTRACTS.JobEscrow.toLowerCase(), receipt.contracts.AgonJobEscrow!.toLowerCase());
  assert.equal(AGON_CONTRACTS.PrizeVault.toLowerCase(), receipt.contracts.AgonPrizeVault!.toLowerCase());
});
