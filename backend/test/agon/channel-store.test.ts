import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Address } from "viem";

import { PostgresChannelStore } from "../../src/agon/channels/store.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

let db: AgonTestDatabase;
let store: PostgresChannelStore;
const now = new Date("2026-10-27T12:00:00Z");
const H = "a".repeat(64);
const OP = `0x${"1".repeat(40)}` as Address;
const OTHER = `0x${"2".repeat(40)}` as Address;

before(async () => {
  db = await createAgonTestDatabase("channels");
  store = new PostgresChannelStore(db.pool);
});
after(async () => db.close());

test("an update id is claimed once per channel", async () => {
  assert.equal(await store.claimUpdate("telegram", "1001", now), true);
  assert.equal(await store.claimUpdate("telegram", "1001", now), false);
  assert.equal(await store.claimUpdate("whatsapp", "1001", now), true);
});

test("accounts are created once, accept terms and record activity", async () => {
  const first = await store.ensureAccount("telegram", H, now);
  assert.deepEqual([first.operatorAddress, first.termsVersion], [null, null]);
  const again = await store.ensureAccount("telegram", H, new Date(now.getTime() + 1000));
  assert.equal(again.createdAt.getTime(), first.createdAt.getTime());
  const accepted = await store.acceptTerms("telegram", H, "chat-2026-10-11", now);
  assert.equal(accepted!.termsVersion, "chat-2026-10-11");
  await store.touch("telegram", H, now);
  assert.equal((await store.getAccount("telegram", H))!.lastInboundAt!.getTime(), now.getTime());
  assert.equal(await store.getAccount("telegram", "b".repeat(64)), null);
  assert.equal(await store.acceptTerms("telegram", "b".repeat(64), "v", now), null);
});

test("a website account links once; a second account is refused", async () => {
  assert.equal(await store.linkOperator("telegram", H, OP), "linked");
  assert.equal(await store.linkOperator("telegram", H, OP), "already_same");
  assert.equal(await store.linkOperator("telegram", H, OTHER), "other_operator");
  assert.equal(await store.linkOperator("telegram", "c".repeat(64), OP), "no_account");
  assert.equal((await store.getAccount("telegram", H))!.operatorAddress, OP);
});

test("the Telegram id an operator linked on the website can be read", async () => {
  await db.pool.query("insert into operators (address, telegram_id) values ($1, $2) on conflict (address) do update set telegram_id = excluded.telegram_id", [OP, "777"]);
  assert.equal(await store.operatorTelegramId(OP), "777");
  assert.equal(await store.operatorTelegramId(OTHER), null);
});
