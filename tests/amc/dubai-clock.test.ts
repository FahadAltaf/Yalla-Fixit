import { test } from "node:test";
import assert from "node:assert/strict";

import { dubaiInputIn, formatDubaiDate, formatDubaiDateTime, formatDubaiShort, fromDubaiInput, toDubaiInput } from "@/lib/amc/dubai-clock";

/* 26 Nov 2026: a site visit booked for 18:00 Dubai showed 19:00 to a viewer in Pakistan. AMC times are Dubai's on every screen. */

test("an instant reads as Dubai's wall clock, wherever the viewer is", () => {
  const at = "2026-11-26T14:00:00.000Z";
  assert.equal(formatDubaiDateTime(at), "26 Nov 2026, 18:00");
  assert.equal(formatDubaiShort(at), "26 Nov 18:00");
  assert.equal(formatDubaiDate("2026-11-26T21:30:00Z"), "27/11/2026", "after 20:00 UTC it is the next day in Dubai");
  assert.equal(formatDubaiDateTime(null), "—");
  assert.equal(formatDubaiDateTime("not a date"), "—");
});

test("a typed date-time is Dubai time, and round-trips", () => {
  assert.equal(fromDubaiInput("2026-11-26T18:00"), "2026-11-26T14:00:00.000Z");
  assert.equal(toDubaiInput("2026-11-26T14:00:00.000Z"), "2026-11-26T18:00");
  assert.equal(toDubaiInput(fromDubaiInput("2026-12-31T23:30")), "2026-12-31T23:30");
  assert.equal(fromDubaiInput(""), null);
  assert.equal(fromDubaiInput("26/11/2026"), null);
});

test("days ahead count from Dubai's date, not the viewer's", () => {
  /* 22:00 UTC on the 26th is 02:00 on the 27th in Dubai. */
  const now = new Date("2026-11-26T22:00:00Z");
  assert.equal(dubaiInputIn(0, undefined, now), "2026-11-27T02:00");
  assert.equal(dubaiInputIn(1, 10, now), "2026-11-28T10:00");
  assert.equal(dubaiInputIn(5, 9, new Date("2026-12-29T08:00:00Z")), "2027-01-03T09:00");
});
