import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createPostgresManagedPublisherStore } from "../../src/agon/mcp/managed-publisher-store.ts";
import { createPostgresProviderDraftStore } from "../../src/agon/mcp/provider-draft-store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const actor = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const draftId = "draft-managed-persistence";
const digest = `0x${"c".repeat(64)}` as const;
let database: AgonTestDatabase;

before(async () => { database = await createAgonTestDatabase("managed_publisher"); });
after(async () => database.close());

test("managed publisher wallet binding persists, scopes by actor and rejects stale writes", async () => {
  const drafts = createPostgresProviderDraftStore(database.pool);
  await drafts.create(actor, draftId, {
    name: "Fixture", logoUrl: "https://example.com/logo.png", outcome: "Answers questions",
    category: "1", inputs: ["question"], outputs: ["answer"], priceUSDC: "0.01",
    expectedLatencyMs: 1000, privacy: "No retention", failurePolicy: "No charge if unavailable",
    endpoint: "https://example.com/run",
  });
  const firstStore = createPostgresManagedPublisherStore(database.pool);
  const first = await firstStore.create(actor, draftId, digest);
  assert.equal((await firstStore.get(other, draftId)), null);
  assert.equal((await firstStore.getPublic(first.publicId))?.actor, actor);
  const updated = await firstStore.save(first, {
    ...first.state, walletId: "circle-wallet-1", walletAddress: `0x${"d".repeat(40)}`,
    registerFee: { gasLimit: "200000", maxFee: "41", priorityFee: "1" },
  });
  assert.ok(updated);
  assert.equal(await firstStore.save(first, first.state), null);
  const restarted = createPostgresManagedPublisherStore(database.pool);
  const recovered = await restarted.create(actor, draftId, digest);
  assert.equal(recovered.publicId, first.publicId);
  assert.equal(recovered.state.walletId, "circle-wallet-1");
  assert.deepEqual(recovered.state.registerFee, { gasLimit: "200000", maxFee: "41", priorityFee: "1" });
  await assert.rejects(restarted.create(actor, draftId, `0x${"e".repeat(64)}` as `0x${string}`), /conflicts/);
});
