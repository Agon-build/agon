import assert from "node:assert/strict";
import test from "node:test";

import {
  AGON_DEFAULT_NETWORK_KEY,
  AGON_NETWORKS,
  getAgonBalanceTarget,
  getAgonNetworkKey,
  getPublicAgonNetworkKey,
  loginHref,
  networkHref,
} from "./network.ts";

test("Arc Testnet is the public Agon context", () => {
  assert.equal(AGON_DEFAULT_NETWORK_KEY, "arc-testnet");
  assert.equal(AGON_NETWORKS[AGON_DEFAULT_NETWORK_KEY].chainId, 5042002);
  assert.equal(AGON_NETWORKS[AGON_DEFAULT_NETWORK_KEY].brand, "ARC");
});

test("sign-in keeps the selected network in both login and return URLs", () => {
  assert.equal(loginHref("arc-testnet", "/account"), "/login?returnTo=%2Faccount%3Fnetwork%3Darc-testnet&network=arc-testnet");
  assert.equal(loginHref("arc-testnet", "https://hostile.example"), "/login?returnTo=%2F%3Fnetwork%3Darc-testnet&network=arc-testnet");
  assert.equal(loginHref("arc-testnet", "//hostile.example/x"), "/login?returnTo=%2F%3Fnetwork%3Darc-testnet&network=arc-testnet");
  assert.equal(loginHref("arc-testnet", "/\\hostile"), "/login?returnTo=%2F%3Fnetwork%3Darc-testnet&network=arc-testnet");
});

test("Arc is the only network context; parked BNB keys are gone and old links reopen on Arc", () => {
  assert.deepEqual(Object.keys(AGON_NETWORKS), ["arc-testnet"]);
  assert.equal(AGON_NETWORKS["arc-testnet"].explorerUrl, "https://explorer.testnet.arc.io");
  assert.equal(AGON_NETWORKS["arc-testnet"].apiUrl !== null, true);
  assert.equal(getAgonBalanceTarget("arc-testnet")?.chainId, 5042002);
  assert.equal(getAgonNetworkKey("bnb-mainnet"), "arc-testnet");
  assert.equal(getAgonNetworkKey("not-a-network"), "arc-testnet");
  assert.equal(getPublicAgonNetworkKey("bnb-testnet"), "arc-testnet");
});

test("network links preserve the route and replace only the network context", () => {
  assert.equal(networkHref("/market", "arc-testnet", "?category=trading&network=other"), "/market?category=trading&network=arc-testnet");
});
