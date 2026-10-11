import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORY_LABELS, CATEGORY_QUERY_TAGS, SEASON_CATEGORIES, categoryFor, parseCategory,
} from "../../src/agon/playground/seasons/categories.ts";

test("six categories in rule order, each with a label and a query tag", () => {
  assert.deepEqual([...SEASON_CATEGORIES], ["sports", "crypto", "economics", "politics", "world", "culture"]);
  assert.deepEqual(Object.keys(CATEGORY_LABELS).sort(), [...SEASON_CATEGORIES, "other"].sort());
  assert.deepEqual(CATEGORY_QUERY_TAGS, { sports: "sports", crypto: "crypto", economics: "economy", politics: "politics", world: "geopolitics", culture: "pop-culture" });
});

test("tags seen on live Gamma events map to their category", () => {
  assert.equal(categoryFor(["sports", "games", "soccer", "ucl"]), "sports");
  assert.equal(categoryFor(["esports", "league-of-legends"]), "sports");
  assert.equal(categoryFor(["crypto", "crypto-prices", "bitcoin"]), "crypto");
  assert.equal(categoryFor(["economy"]), "economics");
  assert.equal(categoryFor(["elections", "global-elections", "canada"]), "politics");
  assert.equal(categoryFor(["geopolitics"]), "world");
  assert.equal(categoryFor(["pop-culture", "tweets-markets"]), "culture");
  assert.equal(categoryFor(["Sports", "EPL"]), "sports", "tags compare case-insensitively");
});

test("the first matching rule wins when a market carries tags of two categories", () => {
  assert.equal(categoryFor(["crypto", "sports"]), "sports");
  assert.equal(categoryFor(["finance", "crypto"]), "crypto");
  assert.equal(categoryFor(["politics", "economy"]), "economics");
  assert.equal(categoryFor(["geopolitics", "elections"]), "politics");
});

test("unmapped or missing tags are Other", () => {
  assert.equal(categoryFor([]), "other");
  assert.equal(categoryFor(["finance"]), "other");
  assert.equal(categoryFor(["recurring", "weekly", "hide-from-new"]), "other");
});

test("parseCategory accepts only the six category names", () => {
  assert.equal(parseCategory("politics"), "politics");
  assert.equal(parseCategory("Politics"), "politics");
  assert.equal(parseCategory("other"), null);
  assert.equal(parseCategory("overall"), null);
  assert.equal(parseCategory(""), null);
  assert.equal(parseCategory(undefined), null);
});
