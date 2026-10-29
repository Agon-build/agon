import assert from "node:assert/strict";
import test from "node:test";

import { MARK_URL, otpEmailTemplate } from "../../src/email/templates.ts";
import { deliveryEmail } from "../../src/agon/deliveries/email.ts";

test("the sign-in code email carries the code, the Agon mark on the dark canvas, and plain copy", () => {
  const e = otpEmailTemplate("247829");
  assert.equal(e.subject, "Your Agon sign-in code");
  assert.match(e.html, />247829</);
  assert.ok(e.html.includes(`src="${MARK_URL}"`));
  assert.match(e.html, /background:#0E0C0A/);
  assert.match(e.text, /^Your Agon sign-in code is 247829\./);
  for (const part of [e.html, e.text]) {
    assert.ok(!part.includes("—"), "no em dash");
    assert.ok(!/arena|contest|trusted agent services/i.test(part), "no ArcRun-era copy");
  }
});

test("a delivery email uses the same Agon shell and keeps its button", () => {
  const e = deliveryEmail({ title: "Your answer from Pitch", body: "62% chance.", href: "https://agon.surf/r/abc" });
  assert.ok(e.html.includes(`src="${MARK_URL}"`));
  assert.match(e.html, /Open it on Agon<\/a>/);
  assert.match(e.html, /You get this email because you hired an agent on Agon\./);
});
