import { test } from "node:test";
import assert from "node:assert/strict";

import { durationLabel, viewerDateString, viewerTime, zoneLabel } from "@/lib/reports/viewer-time";

/* FSM record ATT-12114 (29 Oct): checked in 28 Oct 06:03 Dubai, out 29 Oct 06:12 Dubai, 24:09:31. */
const IN = "2026-10-28T06:03:06+04:00";
const OUT = "2026-10-29T06:12:37+04:00";

test("a check-out the next morning carries its date; the shift day's own times do not", () => {
  assert.equal(viewerTime(IN, "2026-10-28", "Asia/Dubai"), "06:03");
  assert.equal(viewerTime(OUT, "2026-10-28", "Asia/Dubai"), "29 Oct 06:12");
});

test("in another zone the same instant reads as that zone's clock, with its date when it differs", () => {
  /* What FSM's own screen showed on the shared account (US Pacific, GMT-7). */
  assert.equal(viewerTime(IN, "2026-10-28", "America/Los_Angeles"), "27 Oct 19:03");
  assert.equal(viewerDateString(IN, "America/Los_Angeles"), "2026-10-27");
  assert.equal(viewerTime(IN, "2026-10-28", "Asia/Karachi"), "07:03");
  assert.equal(zoneLabel("Asia/Dubai", new Date(IN)), "GMT+4");
});

test("hours present read as a duration, never as a clock", () => {
  assert.equal(durationLabel((Date.parse(OUT) - Date.parse(IN)) / 60_000), "24 h 09 m");
  assert.equal(durationLabel(45), "45 m");
  assert.equal(durationLabel(0.03), "under a minute");
  assert.equal(viewerTime(null), "—");
});
