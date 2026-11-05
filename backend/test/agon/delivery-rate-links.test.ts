import assert from "node:assert/strict";
import test from "node:test";

import { bellDelivery, rateHref } from "../../src/agon/deliveries/rate-links.ts";
import { deliveryEmail } from "../../src/agon/deliveries/email.ts";

const JOB = "0ae9c2fe-6cfb-428b-98bb-ee4baf76261f";
const HREF = `https://agon.surf/r/${JOB}`;
const delivered = { title: "Your answer from Kestrel", body: "Yes at 81%.", href: HREF, eventKey: `job:${JOB}:delivered` };
const refunded = { ...delivered, title: "Kestrel could not finish", eventKey: `job:${JOB}:refunded` };

test("a rate link opens the rating step on the job page, with the stars picked when given", () => {
  assert.equal(rateHref(HREF), `${HREF}#rate`);
  assert.equal(rateHref(HREF, 4), `${HREF}?rate=4#rate`);
  assert.equal(rateHref(`${HREF}?x=1#top`, 2), `${HREF}?x=1&rate=2#rate`);
});

test("the bell asks for a rating only on a delivered job and opens the rating step", () => {
  const b = bellDelivery(delivered);
  assert.equal(b.href, `${HREF}#rate`);
  assert.equal(b.body, "Yes at 81%. Rate it on Agon.");
  assert.deepEqual(bellDelivery(refunded), { title: refunded.title, body: refunded.body, href: HREF });
});

test("a delivered job's email carries five star links that open the page with the stars picked", () => {
  const e = deliveryEmail(delivered);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(e.html.includes(`href="${HREF}?rate=${n}#rate"`), `star ${n}`);
  assert.match(e.text, new RegExp(`Rate this job: ${HREF.replace(/[.?]/g, "\$&")}#rate`));
  const r = deliveryEmail(refunded);
  assert.ok(!r.html.includes("?rate="));
  assert.ok(!r.text.includes("Rate this job"));
});
