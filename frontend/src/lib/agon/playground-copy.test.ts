import assert from "node:assert/strict";
import test from "node:test";

import { liveProviderMessage } from "./playground-copy.ts";

const listing = { id: "5042002:0xf017290a267a3ceb693544882464a188d9e4a516:1", version: "1", category: "3" };
const scope = `${listing.id}@1`;

test("another category says nothing is connected when no current listing matches a provider scope", () => {
  const message = liveProviderMessage({ category: "research", analysisCategoryId: "3", providerScopes: ["5042002:0x2144c156b0a4581da2d046c2e41ac41c6c3938cb:2@3"], listings: [listing] });
  assert.equal(message, "No listed service is connected to the Sandbox yet. This selection runs AGON's public sample.");
});

test("another category points to Analysis only when a current listing is connected", () => {
  const message = liveProviderMessage({ category: "research", analysisCategoryId: "3", providerScopes: [scope], listings: [listing] });
  assert.equal(message, "Live listed services can be tested in Analysis. This selection runs AGON's public sample.");
});

test("analysis with a connected current listing needs no warning", () => {
  assert.equal(liveProviderMessage({ category: "analysis", analysisCategoryId: "3", providerScopes: [scope], listings: [listing] }), null);
});

test("analysis without a connected listing says so", () => {
  assert.equal(liveProviderMessage({ category: "analysis", analysisCategoryId: "3", providerScopes: [], listings: [listing] }), "No listed service is connected to the Sandbox yet.");
  assert.equal(liveProviderMessage({ category: "analysis", analysisCategoryId: "3", providerScopes: ["other@1"], listings: [listing] }), "No live service is available in this category yet.");
});
