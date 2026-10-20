import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  PostgresAgonOperationsAlertRepository,
  deliverAgonOperationsAlertOnce,
  type AgonAlertDelivery,
  type AgonOperationsAlertDeliveryRepository,
} from "../../src/agon/operations-alerts.ts";
import { alertAgonArenaOperator } from "../../src/agon/execution/arena-review-alerts.ts";
import { alertAgonCertificationOperator } from "../../src/agon/execution/certification-alerts.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

const OPERATOR = `0x${"ab".repeat(20)}`;
const SUBSCRIBER = `0x${"bc".repeat(20)}`;
let database: AgonTestDatabase;
let repository: PostgresAgonOperationsAlertRepository;

before(async () => {
  database = await createAgonTestDatabase("operationsalerts");
  repository = new PostgresAgonOperationsAlertRepository(database.pool);
  await database.pool.query("insert into operators (address, telegram_id) values ($1, $2)", [OPERATOR, "123456"]);
});

after(async () => database.close());

test("deduplicates repeated certification failures and keeps one shared notification and delivery", async () => {
  const input = {
    operator: OPERATOR,
    listingReference: `5042002:0x${"11".repeat(20)}:2`,
    listingVersion: "3",
    status: "warning" as const,
    reasons: ["endpoint_qa_failed"],
    consecutiveFailures: 1,
  };
  await alertAgonCertificationOperator(input, repository);
  await alertAgonCertificationOperator({ ...input, consecutiveFailures: 2 }, repository);

  const alerts = await repository.list();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.occurrenceCount, 2);
  assert.equal(alerts[0]?.severity, "warning");
  const notifications = await database.pool.query("select * from notifications where operator = $1", [OPERATOR]);
  const deliveries = await database.pool.query("select * from agon_alert_delivery_outbox");
  assert.equal(notifications.rowCount, 1);
  assert.equal(deliveries.rowCount, 1);
});

test("a cleared warning stays cleared while the same alert keeps firing, and returns only if it turns critical", async () => {
  const OWNER = `0x${"c7".repeat(20)}`;
  await database.pool.query("insert into operators (address) values ($1)", [OWNER]);
  const raise = (severity: "warning" | "critical") => repository.raise({ operator: OWNER, fingerprint: "season:stale", source: "arena", severity, title: "Season 1 leaderboard is older than 6 hours", body: "The last commit was long ago." });
  const feed = async () => (await database.pool.query("select id from notifications where operator = $1", [OWNER])).rowCount;
  await raise("warning");
  assert.equal(await feed(), 1);
  await repository.clearNotifications(OWNER);
  assert.equal(await feed(), 0);
  await raise("warning");
  await raise("warning");
  assert.equal(await feed(), 0, "the same open warning does not come back after it was cleared");
  await raise("critical");
  assert.equal(await feed(), 1, "it comes back once it becomes critical");
});

test("the owner can acknowledge a critical alert from the bell, which then clears it for good", async () => {
  const OWNER = `0x${"d7".repeat(20)}`;
  const OTHER = `0x${"e7".repeat(20)}`;
  await database.pool.query("insert into operators (address) values ($1), ($2)", [OWNER, OTHER]);
  const alert = await repository.raise({ operator: OWNER, fingerprint: "refund:job-1", source: "stage", severity: "critical", title: "A refund failed", body: "Send it by hand." });
  const id = Number((await database.pool.query<{ id: string }>("select id::text from notifications where operator = $1", [OWNER])).rows[0]!.id);
  await repository.clearNotifications(OWNER);
  assert.equal((await database.pool.query("select 1 from notifications where id = $1", [id])).rowCount, 1, "clear keeps an open critical alert");
  assert.equal(await repository.acknowledgeNotification(OTHER, id), false, "only its owner can acknowledge it");
  assert.equal(await repository.acknowledgeNotification(OWNER, id), true);
  assert.equal((await repository.list()).find((a) => a.alertId === alert.alertId)?.status, "acknowledged");
  assert.equal((await database.pool.query("select 1 from notifications where id = $1", [id])).rowCount, 0);
  await repository.raise({ operator: OWNER, fingerprint: "refund:job-1", source: "stage", severity: "critical", title: "A refund failed", body: "Send it by hand." });
  assert.equal((await database.pool.query("select 1 from notifications where operator = $1", [OWNER])).rowCount, 1, "a new incident after acknowledgement notifies again");
});

test("critical Arena incidents remain open until an authenticated acknowledgement path records them", async () => {
  await alertAgonArenaOperator({
    operator: OPERATOR,
    intentId: "00000000-0000-4000-8000-000000000901",
    listingReference: `5042002:0x${"11".repeat(20)}:2`,
    reasons: ["reconciliation_unknown"],
  }, repository);
  const critical = (await repository.list()).find((alert) => alert.source === "arena")!;
  assert.equal(critical.severity, "critical");
  assert.equal(critical.status, "open");
  assert.equal(await repository.resolve(OPERATOR, critical.fingerprint), false);
  const acknowledged = await repository.acknowledge(critical.alertId, "admin-console");
  assert.equal(acknowledged?.status, "acknowledged");
  assert.ok(acknowledged?.acknowledgedAt);
});

test("fans one canonical service incident out to the default operator and subscribed provider", async () => {
  await database.pool.query("insert into operators (address, telegram_id) values ($1, $2)", [SUBSCRIBER, "654321"]);
  const listingReference = `5042002:0x${"33".repeat(20)}:7`;
  await database.pool.query(
    `insert into agon_listings
       (chain_id, service_registry_address, listing_id, agent_id, service_key, category, current_version,
        manifest_hash, manifest_uri, payment_rail, provider_snapshot, chain_status, status, verification,
        source_block_number, source_tx_hash, source_log_index, created_at, updated_at)
     values (5042002,$1,7,99,$2,3,1,$3,'https://example.com/manifest.json','X402',$4,'Listed','Listed','Verified',1,$5,0,now(),now())`,
    [`0x${"33".repeat(20)}`, `0x${"44".repeat(32)}`, `0x${"55".repeat(32)}`, SUBSCRIBER, `0x${"66".repeat(32)}`],
  );
  assert.equal(await repository.ownsListing(SUBSCRIBER, listingReference), true);
  assert.equal(await repository.ownsListing(OPERATOR, listingReference), false);
  await repository.upsertSubscription({
    operatorAddress: SUBSCRIBER,
    scopeType: "service",
    scopeReference: listingReference,
    source: "certification",
    minimumSeverity: "warning",
    inApp: true,
    telegram: true,
    enabled: true,
  });
  const raised = await repository.raise({
    operator: OPERATOR,
    fingerprint: `certification:${listingReference}@1`,
    source: "certification",
    scopeReference: listingReference,
    severity: "warning",
    title: "Service check needs attention",
  });
  await repository.raise({
    operator: OPERATOR,
    fingerprint: raised.fingerprint,
    source: "certification",
    scopeReference: listingReference,
    severity: "warning",
    title: "Service check still needs attention",
  });
  const recipients = await database.pool.query(
    "select recipient_operator, notification_id from agon_alert_recipients where alert_id = $1 order by recipient_operator",
    [raised.alertId],
  );
  const deliveries = await database.pool.query(
    "select recipient_operator from agon_alert_delivery_outbox where alert_id = $1 order by recipient_operator",
    [raised.alertId],
  );
  assert.equal(recipients.rowCount, 2);
  assert.equal(recipients.rows.every((row) => row.notification_id !== null), true);
  assert.deepEqual(deliveries.rows.map((row) => row.recipient_operator), [OPERATOR, SUBSCRIBER].sort());
  assert.equal((await repository.list()).find((alert) => alert.alertId === raised.alertId)?.occurrenceCount, 2);
});

test("a recovery resolves the active warning but still leaves a single informational audit record", async () => {
  const listingReference = `5042002:0x${"22".repeat(20)}:9`;
  await alertAgonCertificationOperator({
    operator: OPERATOR, listingReference, listingVersion: "1", status: "warning",
    reasons: ["provider_timeout"], consecutiveFailures: 1,
  }, repository);
  await alertAgonCertificationOperator({
    operator: OPERATOR, listingReference, listingVersion: "1", status: "recovered",
    reasons: [], consecutiveFailures: 0,
  }, repository);
  const matching = (await repository.list()).filter((alert) => alert.fingerprint.includes(`${listingReference}@1`));
  assert.equal(matching.filter((alert) => alert.status === "open").length, 0);
  assert.equal(matching.filter((alert) => alert.status === "resolved").length, 2);
});

test("Telegram delivery retries from the durable outbox without changing incident state", async () => {
  const delivery: AgonAlertDelivery = {
    delivery_id: "00000000-0000-4000-8000-000000000902",
    alert_id: "00000000-0000-4000-8000-000000000903",
    operator: OPERATOR,
    chat_id: "123456",
    title: "Service check failed",
    body: "The provider timed out.",
    href: "/admin",
    severity: "warning",
    attempts: 0,
    max_attempts: 8,
  };
  const deferred: Array<{ increment: boolean; error: string }> = [];
  const fake: AgonOperationsAlertDeliveryRepository = {
    claimDelivery: async () => delivery,
    completeDelivery: async () => { throw new Error("not expected"); },
    deferDelivery: async (_id, error, options) => { deferred.push({ increment: options.increment, error }); },
  };
  const result = await deliverAgonOperationsAlertOnce({
    repository: fake,
    sendTelegram: async () => { throw new Error("telegram unavailable"); },
    appUrl: "https://agon.surf",
    now: () => new Date("2026-09-22T12:00:00.000Z"),
  });
  assert.equal(result, "deferred");
  assert.deepEqual(deferred, [{ increment: true, error: "telegram unavailable" }]);
});

test("health readiness verifies the configured operations recipient and Telegram link", async () => {
  const ready = await repository.readiness({
    operator: OPERATOR,
    enabled: true,
    workerEnabled: true,
    telegramConfigured: true,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.recipientExists, true);
  assert.equal(ready.telegramLinked, true);
  assert.deepEqual(ready.reasons, []);

  const missing = await repository.readiness({
    operator: `0x${"cd".repeat(20)}`,
    enabled: true,
    workerEnabled: true,
    telegramConfigured: true,
  });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.reasons, ["recipient_not_found"]);
});

test("an alert never stores or delivers a raw RPC error: URL paths, request bodies and calldata are removed", async () => {
  const leaked = "marketplace_state_write_failed: RPC Request failed. URL: https://rpc.testnet.arc-node.example.com/v1/swrm_00000000fakekey00000000 Request body: {\"method\":\"eth_sendRawTransaction\",\"params\":[\"0x02f8" + "ab".repeat(80) + "\"]}";
  await alertAgonCertificationOperator({
    operator: OPERATOR, listingReference: `5042002:0x${"22".repeat(20)}:7`, listingVersion: "1", status: "warning", reasons: [leaked], consecutiveFailures: 1,
  }, repository);
  const stored = await database.pool.query("select a.title, a.body, a.context::text as context, n.body as notification from agon_operations_alerts a join agon_alert_recipients r on r.alert_id = a.alert_id join notifications n on n.id = r.notification_id where a.fingerprint = $1", [`certification:5042002:0x${"22".repeat(20)}:7@1`]);
  assert.equal(stored.rowCount, 1);
  for (const field of [stored.rows[0].body, stored.rows[0].context, stored.rows[0].notification]) {
    assert.doesNotMatch(field, /swrm_|fakekey|Request body|eth_sendRawTransaction|0x02f8abab/, field);
  }
  assert.match(stored.rows[0].body, /marketplace_state_write_failed/);
});
