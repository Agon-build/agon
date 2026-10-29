import assert from "node:assert/strict";
import test from "node:test";

import { ratedLine, refusalText, starsLabel } from "./job-rating-view.ts";

test("the rating panel speaks only when a rating is closed, and states a rating plainly", () => {
  assert.equal(refusalText("too_late"), "Ratings close 14 days after delivery.");
  for (const r of ["not_found", "not_yours", "not_delivered", "already_rated"] as const) assert.equal(refusalText(r), null);
  assert.equal(starsLabel(4), "4 of 5");
  assert.equal(ratedLine(4, "2026-10-29T12:00:00Z", "en-GB"), "Rated 4 of 5 on 29 Oct");
  assert.equal(ratedLine(2, "not a date"), "Rated 2 of 5");
});
