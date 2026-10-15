import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createMemoryProviderDraftStore, createPostgresProviderDraftStore, type ProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("draft_list"); });
after(async () => db.close());

const draft = (name: string) => ({ name, logoUrl: "https://example.com/l.png", outcome: "o", category: "3", inputs: ["i"], outputs: ["o"], priceUSDC: "0.10", expectedLatencyMs: 1000, privacy: "p", failurePolicy: "f", endpoint: "https://example.com/run" });
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

async function listsNewestFirst(store: ProviderDraftStore) {
  await store.create(A, "draft-1", draft("first"));
  await new Promise((r) => setTimeout(r, 15));
  await store.create(A, "draft-2", draft("second"));
  await store.create(B, "draft-3", draft("other"));
  assert.deepEqual((await store.list(A, 10)).map((d) => d.draftId), ["draft-2", "draft-1"]);
  assert.deepEqual((await store.list(A, 1)).map((d) => d.draftId), ["draft-2"]);
  assert.equal((await store.list(A.replace("0x", "0X").toLowerCase(), 10)).length, 2);
  assert.deepEqual((await store.list(B, 10)).map((d) => d.draftId), ["draft-3"]);
}

test("a builder's drafts list newest first and never show another builder's drafts (memory)", async () => {
  await listsNewestFirst(createMemoryProviderDraftStore());
});

test("a builder's drafts list newest first and never show another builder's drafts (Postgres)", async () => {
  await listsNewestFirst(createPostgresProviderDraftStore(db.pool));
});
