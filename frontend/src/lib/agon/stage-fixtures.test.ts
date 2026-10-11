import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEW_JOB_ID, PREVIEW_RUN_MS, previewAsk, previewLive } from "./stage-fixtures.ts";

test("the preview run reveals events over time and ends answered, always labelled preview", () => {
  const start = 1_000_000;
  const early = previewLive(PREVIEW_JOB_ID, start, start + 500);
  const middle = previewLive(PREVIEW_JOB_ID, start, start + 4_000);
  const done = previewLive(PREVIEW_JOB_ID, start, start + PREVIEW_RUN_MS + 1);
  assert.equal(early.preview, true);
  assert.ok(early.events.length < middle.events.length && middle.events.length < done.events.length);
  assert.equal(middle.phase, "working");
  assert.equal(done.phase, "answered");
  assert.equal(done.answer!.probabilityBps, 3400);
  assert.ok(done.receipt!.children.length === 1);
  assert.equal(previewLive(PREVIEW_JOB_ID, null, start).phase, "answered", "a receipt opened later shows the finished run");
  const ask = previewAsk("What's the real chance BTC closes above $120k on Friday?");
  assert.ok(ask.ok && ask.step === "confirm_code" && ask.jobId === PREVIEW_JOB_ID);
});
