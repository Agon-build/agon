import assert from "node:assert/strict";
import test from "node:test";

import { telegramStart } from "./delivery-view.ts";

test("the Telegram link becomes a bot name and the exact message to send", () => {
  assert.deepEqual(telegramStart(`https://t.me/agon_surf_bot?start=dl_${"a".repeat(24)}`), {
    url: `https://t.me/agon_surf_bot?start=dl_${"a".repeat(24)}`, bot: "agon_surf_bot", command: `/start dl_${"a".repeat(24)}`,
  });
  assert.equal(telegramStart("not a url").command, "/start");
});
