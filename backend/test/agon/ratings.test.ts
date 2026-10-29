import assert from "node:assert/strict";
import test from "node:test";
import { Hono, type MiddlewareHandler } from "hono";

import { cleanComment, paidAverages, rateCheck, RATE_WINDOW_MS, starsToScore, type Rating, type RefTotals } from "../../src/agon/ratings/rules.ts";
import { createRatings } from "../../src/agon/ratings/service.ts";
import type { NewRating, RatingsStore } from "../../src/agon/ratings/store.ts";
import type { Job } from "../../src/agon/payments/types.ts";
import { createAppRoutes } from "../../src/agon/stage/app-routes.ts";
import { RATE_TAP, ratableJobOf, rateButtons, rateReply } from "../../src/agon/channels/telegram/rate-tap.ts";
import { deliveryEmail } from "../../src/agon/deliveries/email.ts";
import { CUSTODY_TERMS_VERSION } from "../../src/agon/stage/custody-terms.ts";
import type { StageServices } from "../../src/agon/stage/services.ts";

const ALICE = `0x${"1".repeat(40)}`;
const BOB = `0x${"2".repeat(40)}`;
const JOB = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-10-29T12:00:00Z");

function job(over: Partial<Job> = {}): Job {
  return {
    jobId: JOB, parentId: null, rootId: JOB, depth: 0, buyerRef: `budget:op:${ALICE}`, providerRef: "agent:lead", providerLabel: "Agon Lead Agent",
    network: "arc-testnet", priceAtomic: 300000n, budgetAtomic: 0n, state: "delivered", traceId: "t", request: {}, result: {},
    createdAt: new Date(NOW.getTime() - 3_600_000), updatedAt: new Date(NOW.getTime() - 3_600_000), ...over,
  };
}

function memoryStore(): RatingsStore & { rows: NewRating[] } {
  const rows: NewRating[] = [];
  const toRating = (r: NewRating): Rating => ({ jobId: r.jobId, providerRef: r.providerRef, stars: r.stars, comment: r.comment, createdAt: r.at });
  return {
    rows,
    get: async (jobId) => { const r = rows.find((x) => x.jobId === jobId); return r ? toRating(r) : null; },
    add: async (r) => { if (rows.some((x) => x.jobId === r.jobId)) return false; rows.push(r); return true; },
    totals: async (refs, since, until) => {
      const out = new Map<string, RefTotals>();
      for (const r of rows) {
        if (!refs.includes(r.providerRef) || (since && r.at < since) || (until && r.at >= until)) continue;
        const t = out.get(r.providerRef) ?? { providerRef: r.providerRef, n: 0, scoreSum: 0 };
        t.n += 1; t.scoreSum += starsToScore(r.stars);
        out.set(r.providerRef, t);
      }
      return [...out.values()];
    },
    recent: async (refs, limit) => rows.filter((r) => refs.includes(r.providerRef) && r.comment).reverse().slice(0, limit).map(toRating),
  };
}

test("only the buyer of a delivered top-level job may rate it, once, within 14 days", () => {
  const me = [`budget:op:${ALICE}`];
  assert.deepEqual(rateCheck(job(), me, null, NOW), { canRate: true });
  assert.deepEqual(rateCheck(null, me, null, NOW), { canRate: false, reason: "not_found" });
  assert.deepEqual(rateCheck(job({ depth: 1 }), me, null, NOW), { canRate: false, reason: "not_found" });
  assert.deepEqual(rateCheck(job(), [`budget:op:${BOB}`], null, NOW), { canRate: false, reason: "not_yours" });
  assert.deepEqual(rateCheck(job({ state: "refunded" }), me, null, NOW), { canRate: false, reason: "not_delivered" });
  assert.deepEqual(rateCheck(job({ updatedAt: new Date(NOW.getTime() - RATE_WINDOW_MS - 1) }), me, null, NOW), { canRate: false, reason: "too_late" });
  const existing: Rating = { jobId: JOB, providerRef: "agent:lead", stars: 4, comment: null, createdAt: NOW };
  assert.deepEqual(rateCheck(job(), me, existing, NOW), { canRate: false, reason: "already_rated", rating: existing });
});

test("stars map to the 0 to 100 score, and comments are cleaned", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(starsToScore), [0, 25, 50, 75, 100]);
  assert.equal(cleanComment("  Clear\n\nanswer\u0007 "), "Clear answer");
  assert.equal(cleanComment("   "), null);
  assert.equal(cleanComment(42), null);
  assert.equal(cleanComment("x".repeat(400))!.length, 280);
});

test("the paid part sums every ref an agent's jobs carry, counting each ref once per agent", () => {
  const listings = [{ agentId: "897348", listingReference: "listing-1" }, { agentId: "897348", listingReference: "listing-1b" }, { agentId: "897385", listingReference: "listing-6" }];
  const firstParty = [{ agentId: "897348", providerRef: "agent:lead" }];
  const totals: RefTotals[] = [
    { providerRef: "agent:lead", n: 2, scoreSum: 150 },
    { providerRef: "listing-1", n: 1, scoreSum: 100 },
    { providerRef: "listing-6", n: 1, scoreSum: 25 },
  ];
  const out = paidAverages(listings, firstParty, totals);
  assert.deepEqual(out.get("897348"), { n: 3, avg: 250 / 3 });
  assert.deepEqual(out.get("897385"), { n: 1, avg: 25 });
  assert.equal(paidAverages(listings, firstParty, []).size, 0);
});

test("rating stores one rating per job under the job's provider, and a second one is refused", async () => {
  const store = memoryStore();
  const ratings = createRatings({ store, getJob: async (id) => (id === JOB ? job() : null), refsFor: async () => ["agent:lead"], now: () => NOW });
  const me = [`budget:op:${ALICE}`];
  assert.deepEqual(await ratings.rate(JOB, me, 0), { ok: false, reason: "invalid_stars" });
  assert.deepEqual(await ratings.rate(JOB.toUpperCase(), me, 5, " Spot on "), { ok: true, rating: { jobId: JOB, providerRef: "agent:lead", stars: 5, comment: "Spot on", createdAt: NOW } });
  assert.deepEqual(await ratings.rate(JOB, me, 3), { ok: false, reason: "already_rated" });
  assert.deepEqual(await ratings.rate("not-a-uuid", me, 3), { ok: false, reason: "not_found" });
  assert.equal(store.rows[0]!.rater, `budget:op:${ALICE}`);
  assert.equal((await ratings.recentFor("listing-1")).length, 1);
});

test("the web routes rate a job for the signed-in buyer and show recent comments publicly", async () => {
  const store = memoryStore();
  const ratings = createRatings({ store, getJob: async (id) => (id === JOB ? job() : null), refsFor: async () => ["agent:lead"], now: () => NOW });
  const requireAuth: MiddlewareHandler<{ Variables: { address: string } }> = async (c, next) => {
    const address = c.req.header("x-test-address");
    if (!address) return c.json({ error: "unauthorized" }, 401);
    c.set("address", address.toLowerCase());
    await next();
  };
  const app = new Hono();
  app.route("/agon/app", createAppRoutes({
    services: {} as StageServices, requireAuth, off: () => false, ratings,
    terms: { isAccepted: async () => true, accept: async (_r, v) => v === CUSTODY_TERMS_VERSION },
  }));
  const call = (path: string, init: { body?: unknown; as?: string | null } = {}) => app.request(`/agon/app${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(init.as === null ? {} : { "x-test-address": init.as ?? ALICE }) },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  assert.equal((await call(`/jobs/${JOB}/rating`, { as: null })).status, 401);
  assert.deepEqual(await (await call(`/jobs/${JOB}/rating`)).json(), { canRate: true });
  assert.deepEqual(await (await call(`/jobs/${JOB}/rating`, { as: BOB })).json(), { canRate: false, reason: "not_yours" });
  assert.equal((await call(`/jobs/${JOB}/rating`, { body: { stars: 9 } })).status, 400);
  const bob = await call(`/jobs/${JOB}/rating`, { body: { stars: 2 }, as: BOB });
  assert.equal(bob.status, 409);
  const rated = await call(`/jobs/${JOB}/rating`, { body: { stars: 4, comment: "Clear and fast" } });
  assert.deepEqual(await rated.json(), { ok: true, rating: { stars: 4, comment: "Clear and fast", createdAt: NOW.toISOString() } });
  assert.deepEqual(await (await call(`/jobs/${JOB}/rating`)).json(), { canRate: false, reason: "already_rated", rating: { stars: 4, comment: "Clear and fast", createdAt: NOW.toISOString() } });
  assert.deepEqual(await (await call("/ratings?reference=listing-1", { as: null })).json(), { items: [{ stars: 4, comment: "Clear and fast", createdAt: NOW.toISOString() }] });
  assert.equal((await call("/ratings", { as: null })).status, 400);
});

test("a delivered job gets stars in Telegram and a rating line in email; a refund gets neither", () => {
  assert.equal(ratableJobOf(`job:${JOB}:delivered`), JOB);
  assert.equal(ratableJobOf(`job:${JOB}:refunded`), null);
  assert.equal(ratableJobOf("watch:abc:settled:1"), null);
  const buttons = rateButtons(JOB);
  assert.equal(buttons.length, 5);
  for (const b of buttons) {
    assert.ok(Buffer.byteLength(b.data!) <= 64);
    assert.ok(RATE_TAP.test(b.data!));
  }
  assert.equal(rateReply({ ok: true, rating: { jobId: JOB, providerRef: "agent:lead", stars: 4, comment: null, createdAt: NOW } }), "Thanks. You rated this job 4 of 5.");
  assert.equal(rateReply({ ok: false, reason: "not_yours" }), "Only the person who paid for this job can rate it.");

  const m = { title: "Your answer from Pitch", body: "62% chance.", href: "https://agon.surf/r/abc" };
  const delivered = deliveryEmail({ ...m, eventKey: `job:${JOB}:delivered` });
  assert.match(delivered.html, /Open and rate it<\/a>/);
  assert.match(delivered.text, /You can rate this job on its page\./);
  const refunded = deliveryEmail({ ...m, eventKey: `job:${JOB}:refunded` });
  assert.doesNotMatch(refunded.html, /rate/i);
});
