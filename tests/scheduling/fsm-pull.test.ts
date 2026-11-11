import { test } from "node:test";
import assert from "node:assert/strict";

import { takesFsmAppointments } from "@/lib/server/zoho/import-appointments";

/*
  11 Nov 2026: maintenance appointments booked in Zoho FSM after the day was
  published never reached the board (only drafts took FSM's bookings), while
  Data Center jobs booked ahead were already on it. Every day now takes FSM's
  new appointments, except while a publish is running.
*/
test("a published day still takes appointments booked in FSM", () => {
  for (const status of ["draft", "draft_revision", "pending_approval", "published", "partially_synced", "sync_failed", "rejected"]) {
    assert.equal(takesFsmAppointments(status), true, status);
  }
});

test("not while the day is being published to FSM", () => {
  assert.equal(takesFsmAppointments("approved_syncing"), false);
});
