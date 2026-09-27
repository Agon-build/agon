import assert from "node:assert/strict";
import test from "node:test";

import { marketEmptyState } from "./market-empty.ts";

test("an empty catalog with no filters says nothing is published and offers listing", () => {
  const state = marketEmptyState({ loadedCount: 0, hasFilters: false });
  assert.equal(state.title, "NO SERVICES LISTED YET");
  assert.equal(state.offerClearFilters, false);
  assert.equal(state.primaryHref, "/market/new");
});

test("a filtered search with no match keeps the clear-filters action", () => {
  const state = marketEmptyState({ loadedCount: 4, hasFilters: true });
  assert.equal(state.title, "NO SERVICES FOUND");
  assert.equal(state.offerClearFilters, true);
});

test("a category filter on an empty catalog still offers to clear it", () => {
  assert.equal(marketEmptyState({ loadedCount: 0, hasFilters: true }).offerClearFilters, true);
});
