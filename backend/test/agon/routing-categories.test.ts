import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogEntry } from "../../src/agon/routing/catalog.ts";
import { categoryForKind, circleFits, HIRE_CATEGORIES } from "../../src/agon/routing/categories.ts";

const circle = (category: string, name: string, description = ""): CatalogEntry => ({
  source: "circle", reference: `circle:${name}`, name, provider: "P", category, description, url: "https://x.example/a", method: "GET",
  inputSchema: null, price: 1000n, payTo: null, network: "arc", rating: { tier: "unrated", score: null }, latencyMs: null, tags: [],
});

test("Hire has seven categories, in order, with plain labels", () => {
  assert.deepEqual(HIRE_CATEGORIES.map((c) => [c.id, c.label]), [
    ["prediction", "Prediction markets"],
    ["research", "Research and web search"],
    ["market_data", "Market and crypto data"],
    ["social", "News and social"],
    ["creative", "Images and creative"],
    ["developer", "Developer tools and infrastructure"],
    ["business", "Business and office tools"],
  ]);
});

test("each kind of request belongs to one category, and an unclear one goes to research", () => {
  assert.equal(categoryForKind("forecast"), "prediction");
  assert.equal(categoryForKind("analysis"), "prediction");
  assert.equal(categoryForKind("business"), "business");
  assert.equal(categoryForKind("content"), "creative");
  assert.equal(categoryForKind("other"), "research");
});

test("an outside service fits a category by Circle's live category, and by words where the category is shared", () => {
  assert.equal(circleFits("prediction", circle("FINANCIAL_ANALYSIS", "ETH price")), false);
  assert.equal(circleFits("prediction", circle("FINANCIAL_ANALYSIS", "Polymarket odds")), true);
  assert.equal(circleFits("market_data", circle("FINANCIAL_ANALYSIS", "ETH price")), true);
  assert.equal(circleFits("business", circle("COMMUNICATION", "Send SMS")), true);
  assert.equal(circleFits("business", circle("DATA_ENRICHMENT", "Company lookup")), true);
  assert.equal(circleFits("research", circle("MAPS_WEATHER", "Weather now")), true);
  assert.equal(circleFits("creative", circle("INFERENCE", "Chat model")), false);
  assert.equal(circleFits("creative", circle("INFERENCE", "Image generation")), true);
  assert.equal(circleFits("social", circle("WEB_SEARCH_RESEARCH", "Search")), false);
});

test("Prediction markets holds Agon's market agents, Verification ones included (Resolution Watch, Rules Check)", () => {
  assert.deepEqual(HIRE_CATEGORIES.find((c) => c.id === "prediction")!.agonCategories, ["3", "4", "8"]);
});
