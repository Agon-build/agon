import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { CLIENT_EVENT_LIMITS, createClientEventGate, pruneClientEvents, readClientEvent } from "../../src/http/client-events.ts";
import { createAgonTestDatabase, type AgonTestDatabase } from "./database-test-helper.ts";

// Audit B5 (2026-11-09): POST /events took any body from anyone, as often as
// they liked, straight into the events table, and nothing ever removed rows.
// The host lost its disk to a full volume on 23 October.

let db: AgonTestDatabase;
before(async () => { db = await createAgonTestDatabase("client_events"); });
after(async () => db.close());

test("a browser event is kept small and plain", () => {
  const ok = readClientEvent({ level: "error", kind: "client_error", message: "boom", context: { page: "/hire" }, address: `0x${"a".repeat(40)}` });
  assert.ok(ok.ok);
  assert.deepEqual(ok.event, { level: "error", kind: "client_error", message: "boom", context: { page: "/hire" }, address: `0x${"a".repeat(40)}` });

  assert.deepEqual(readClientEvent(null), { ok: false, status: 400, error: "kind required" });
  assert.deepEqual(readClientEvent({ kind: "has spaces and <tags>" }), { ok: false, status: 400, error: "bad kind" });
  assert.deepEqual(readClientEvent({ kind: "k".repeat(65) }), { ok: false, status: 400, error: "bad kind" });
  assert.deepEqual(readClientEvent({ kind: "x", message: "m".repeat(CLIENT_EVENT_LIMITS.messageChars + 1) }), { ok: false, status: 413, error: "too large" });
  assert.deepEqual(readClientEvent({ kind: "x", context: { blob: "c".repeat(CLIENT_EVENT_LIMITS.contextBytes) } }), { ok: false, status: 413, error: "too large" });

  const odd = readClientEvent({ level: "critical", kind: "x", address: "not an address", message: 7 });
  assert.ok(odd.ok);
  assert.deepEqual(odd.event, { level: "info", kind: "x", message: undefined, context: undefined, address: undefined }, "unknown level is info, a bad address is dropped");
});

test("one address and everyone together are limited per minute", () => {
  const gate = createClientEventGate();
  const t = 5_000_000;
  for (let i = 0; i < CLIENT_EVENT_LIMITS.perIpPerMinute; i++) assert.equal(gate("198.51.100.1", t), true);
  assert.equal(gate("198.51.100.1", t), false);
  assert.equal(gate("198.51.100.2", t), true, "another address is unaffected");
  assert.equal(gate("198.51.100.1", t + 60_001), true, "the window slides");

  const all = createClientEventGate();
  let allowed = 0;
  for (let i = 0; i < CLIENT_EVENT_LIMITS.globalPerMinute + 50; i++) if (all(`203.0.113.${i % 250}:${i}`, t)) allowed += 1;
  assert.equal(allowed, CLIENT_EVENT_LIMITS.globalPerMinute);
});

test("browser events older than the retention window are removed; server events are kept", async () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const old = new Date(now.getTime() - (CLIENT_EVENT_LIMITS.retentionDays + 1) * 86_400_000);
  const recent = new Date(now.getTime() - 86_400_000);
  await db.pool.query(
    `insert into events (kind, source, created_at) values ('a', 'web', $1), ('b', 'web', $2), ('c', 'auth', $1)`,
    [old, recent],
  );
  assert.equal(await pruneClientEvents(db.pool, now), 1);
  const { rows } = await db.pool.query<{ kind: string }>("select kind from events order by kind");
  assert.deepEqual(rows.map((r) => r.kind), ["b", "c"]);
});
