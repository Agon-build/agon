import assert from "node:assert/strict";
import test from "node:test";

import { emailAddError, telegramStart } from "./delivery-view.ts";

test("the Telegram link becomes a bot name and the exact message to send", () => {
  assert.deepEqual(telegramStart(`https://t.me/agon_surf_bot?start=dl_${"a".repeat(24)}`), {
    url: `https://t.me/agon_surf_bot?start=dl_${"a".repeat(24)}`, bot: "agon_surf_bot", command: `/start dl_${"a".repeat(24)}`,
  });
  assert.equal(telegramStart("not a url").command, "/start");
});

test("adding a delivery email explains each refusal in plain words", () => {
  assert.equal(emailAddError("too_soon"), "A code was just sent. Wait a minute before asking for another.");
  assert.equal(emailAddError("wrong_code"), "That code did not match. Check the email and try again.");
  assert.equal(emailAddError("anything"), "Agon could not save this email right now. Try again.");
});
