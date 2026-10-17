import assert from "node:assert/strict";
import test from "node:test";

import { ACCESS_LEVEL_SCOPES } from "../../src/agon/access-tokens.ts";
import { hashSecret, isAllowedRedirectUri, newSecret, redirectAllowed, scopesForLevel, smallestLevelFor, verifyPkceS256 } from "../../src/agon/mcp-oauth/rules.ts";

test("pkce: RFC 7636 appendix B pair verifies; a changed verifier and a 42-char verifier fail", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(verifyPkceS256(verifier, challenge), true);
  assert.equal(verifyPkceS256(`${verifier.slice(0, -1)}A`, challenge), false);
  assert.equal(verifyPkceS256(verifier.slice(0, 42), challenge), false);
});

test("loopback redirect matches on any port but not on another path or host", () => {
  const reg = ["http://127.0.0.1:33418/callback", "https://app.example/cb"];
  assert.equal(redirectAllowed(reg, "http://127.0.0.1:51000/callback"), true);
  assert.equal(redirectAllowed(reg, "http://127.0.0.1:51000/other"), false);
  assert.equal(redirectAllowed(reg, "http://evil.example:33418/callback"), false);
  assert.equal(redirectAllowed(reg, "https://app.example/cb"), true);
  assert.equal(redirectAllowed(reg, "https://app.example:8443/cb"), false);
  assert.equal(redirectAllowed(["http://localhost/cb"], "http://localhost:9999/cb"), true);
});

test("redirect uri shapes", () => {
  assert.equal(isAllowedRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback"), true);
  assert.equal(isAllowedRedirectUri("http://127.0.0.1:1234/callback"), true);
  assert.equal(isAllowedRedirectUri("http://[::1]:1234/callback"), true);
  assert.equal(isAllowedRedirectUri("https://app.example/cb"), true);
  assert.equal(isAllowedRedirectUri("http://example.com/cb"), false);
  assert.equal(isAllowedRedirectUri("javascript:alert(1)"), false);
  assert.equal(isAllowedRedirectUri("data:text/html,x"), false);
  assert.equal(isAllowedRedirectUri("file:///etc/passwd"), false);
  assert.equal(isAllowedRedirectUri("https://a.example/cb#x"), false);
});

test("levels map to the existing scope sets and the smallest level covers the request", () => {
  assert.deepEqual(scopesForLevel("full"), [...ACCESS_LEVEL_SCOPES.full]);
  assert.deepEqual(scopesForLevel("read"), [...ACCESS_LEVEL_SCOPES.read]);
  assert.equal(smallestLevelFor(["agon:read", "wallet:execute"]), "hiring");
  assert.equal(smallestLevelFor(["listing:write", "wallet:execute"]), "full");
  assert.equal(smallestLevelFor(["listing:prepare", "nonsense"]), "listing");
  assert.equal(smallestLevelFor([]), "read");
});

test("secrets are prefixed random values and hash to hex", () => {
  const a = newSecret("agon_oat_");
  assert.match(a, /^agon_oat_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newSecret("agon_oat_"), a);
  assert.match(hashSecret(a), /^[0-9a-f]{64}$/);
});
