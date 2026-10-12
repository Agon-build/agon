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
  assert.equal(
    loginHref("bnb-testnet", "/market/2177?network=bnb-mainnet#hire-agent"),
    "/login?returnTo=%2Fmarket%2F2177%3Fnetwork%3Dbnb-testnet%23hire-agent&network=bnb-testnet",
  );
  assert.equal(
    loginHref("bnb-mainnet", "https://hostile.example"),
    "/login?returnTo=%2F%3Fnetwork%3Dbnb-mainnet&network=bnb-mainnet",
  );
  assert.equal(loginHref("arc-testnet", "/account"), "/login?returnTo=%2Faccount%3Fnetwork%3Darc-testnet&network=arc-testnet");
  assert.equal(loginHref("arc-testnet", "//hostile.example/x"), "/login?returnTo=%2F%3Fnetwork%3Darc-testnet&network=arc-testnet");
  assert.equal(loginHref("arc-testnet", "/\\hostile"), "/login?returnTo=%2F%3Fnetwork%3Darc-testnet&network=arc-testnet");
});

test("the supported network registry keeps all three chain identities distinct", () => {
  assert.equal(AGON_NETWORKS["bnb-mainnet"].chainId, 56);
  assert.equal(AGON_NETWORKS["bnb-testnet"].chainId, 97);
  assert.equal(AGON_NETWORKS["arc-testnet"].chainId, 5042002);
  assert.equal(AGON_NETWORKS["bnb-mainnet"].explorerUrl, "https://bscscan.com");
  assert.equal(AGON_NETWORKS["bnb-testnet"].explorerUrl, "https://testnet.bscscan.com");
  assert.equal(AGON_NETWORKS["arc-testnet"].explorerUrl, "https://testnet.arcscan.app");
});

test("unconfigured BNB contexts cannot inherit the Arc catalog adapter", () => {
  assert.equal(AGON_NETWORKS["bnb-mainnet"].apiUrl, null);
  assert.equal(AGON_NETWORKS["bnb-testnet"].apiUrl, null);
  assert.equal(AGON_NETWORKS["bnb-mainnet"].readiness, "adapter_pending");
  assert.equal(AGON_NETWORKS["bnb-testnet"].readiness, "adapter_pending");
  assert.equal(AGON_NETWORKS["arc-testnet"].apiUrl !== null, true);
});

test("balance targets never fall back from BNB to Arc", () => {
  assert.equal(getAgonBalanceTarget("bnb-mainnet"), null);
  assert.equal(getAgonBalanceTarget("bnb-testnet"), null);
  assert.equal(getAgonBalanceTarget("arc-testnet")?.chainId, 5042002);
});

test("network links preserve the route and replace only the network context", () => {
  assert.equal(
    networkHref("/market", "bnb-testnet", "?category=trading&network=arc-testnet"),
    "/market?category=trading&network=bnb-testnet",
  );
  assert.equal(getAgonNetworkKey("not-a-network"), "arc-testnet");
  assert.equal(getPublicAgonNetworkKey("bnb-mainnet"), "arc-testnet");
  assert.equal(getPublicAgonNetworkKey("bnb-testnet"), "arc-testnet");
});
