import assert from "node:assert/strict";
import test from "node:test";

import { parseFirstPartyIds } from "../../src/agon/first-party.ts";

test("first-party agent ids parse from a comma list, ignoring junk", () => {
  assert.deepEqual([...parseFirstPartyIds("41, 42,43")], ["41", "42", "43"]);
  assert.deepEqual([...parseFirstPartyIds("")], []);
  assert.deepEqual([...parseFirstPartyIds(undefined)], []);
  assert.deepEqual([...parseFirstPartyIds("41,abc,-3,0x2a, 44 ,007")], ["41", "44"]);
});
