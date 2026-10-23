import assert from "node:assert/strict";
import test from "node:test";

import { deliveryEmail } from "../../src/agon/deliveries/email.ts";

test("a delivery email has a subject, a readable text part and a button to open it, with the content escaped", () => {
  const e = deliveryEmail({ title: "Your answer from Pitch", body: "Will <b>Arsenal</b> win? 62% & rising.", href: "https://agon.surf/r/abc" });
  assert.equal(e.subject, "Your answer from Pitch");
  assert.equal(e.text, "Your answer from Pitch\n\nWill <b>Arsenal</b> win? 62% & rising.\n\nOpen it on Agon: https://agon.surf/r/abc\n\nYou get this email because you hired an agent on Agon.");
  assert.match(e.html, /Will &lt;b&gt;Arsenal&lt;\/b&gt; win\? 62% &amp; rising\./);
  assert.match(e.html, /href="https:\/\/agon\.surf\/r\/abc"/);
  assert.ok(!e.html.includes("<b>Arsenal"));
});
