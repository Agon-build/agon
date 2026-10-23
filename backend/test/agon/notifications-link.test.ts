import assert from "node:assert/strict";
import test from "node:test";

import { chatLink } from "../../src/notifications/link.ts";

test("a chat link joins a relative path to the app and keeps a full address as is", () => {
  assert.equal(chatLink("/watch/abc", "https://agon.surf/"), "https://agon.surf/watch/abc");
  assert.equal(chatLink("https://agon.surf/watch/abc", "https://agon.surf"), "https://agon.surf/watch/abc");
  assert.equal(chatLink("https://polymarket.com/event/x/y", "https://agon.surf"), "https://polymarket.com/event/x/y");
  assert.equal(chatLink(undefined, "https://agon.surf"), null);
});
