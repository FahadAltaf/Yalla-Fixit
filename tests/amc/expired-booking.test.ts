import assert from "node:assert/strict";
import test from "node:test";

import { EXPIRED_BOOKING_REFUSED, contractExpiredOn, isExpiredBookingWarning } from "@/lib/amc/expired-booking";
import { approveExpiredBooking } from "@/lib/server/amc/expired-booking";
import { fakeSupabase } from "./fake-supabase";

/* DEV-496 (BRD v0.4 5.16): a booking on an expired contract shows a warning, needs an approval and is logged. */
test("a contract is expired by its status, or by its end date while still marked live", () => {
  assert.equal(contractExpiredOn({ status: "expired", endDate: "2026-12-31" }, "2026-11-22"), true);
  assert.equal(contractExpiredOn({ status: "active", endDate: "2026-11-21" }, "2026-11-22"), true);
  assert.equal(contractExpiredOn({ status: "active", endDate: "2026-11-22" }, "2026-11-22"), false, "the last day is still in force");
  assert.equal(contractExpiredOn({ status: "cancelled", endDate: "2026-01-01" }, "2026-11-22"), false, "cancelled is not expired: it stays refused");
  assert.equal(contractExpiredOn({ status: "active", endDate: null }, "2026-11-22"), false);
});

const contract = { id: "c1", status: "expired", endDate: "2026-10-31", number: "AMC-C-2026-0001" };
const actor = { id: "u1", label: "Approver" };

test("not an approver: refused; an approver without a reason: asked; with one: booked and logged", async () => {
  const w = fakeSupabase({});
  await assert.rejects(
    () => approveExpiredBooking(w.client as never, { contract, day: "2026-11-25", what: "Call out logged", reason: "x y z", canApprove: false }, actor),
    (e: { status?: number; message: string }) => e.status === 403 && e.message.startsWith(EXPIRED_BOOKING_REFUSED),
  );
  await assert.rejects(
    () => approveExpiredBooking(w.client as never, { contract, day: "2026-11-25", what: "Call out logged", canApprove: true }, actor),
    (e: { status?: number; message: string }) => e.status === 409 && isExpiredBookingWarning(e.message),
  );
  assert.equal(await approveExpiredBooking(w.client as never, { contract, day: "2026-11-25", what: "Call out logged", reason: "Renewal signed, record pending", canApprove: true }, actor), true);
  const logged = w.table("amc_audit_events").filter((e) => e.event_type === "booking_on_expired_contract");
  assert.equal(logged.length, 1);
  assert.equal(logged[0].entity_id, "c1");
  assert.equal(logged[0].justification, "Renewal signed, record pending");
  assert.equal(logged[0].actor_label, "Approver");
});

test("a live contract asks nothing", async () => {
  const w = fakeSupabase({});
  assert.equal(await approveExpiredBooking(w.client as never, { contract: { ...contract, status: "active", endDate: "2027-10-31" }, day: "2026-11-25", what: "x", canApprove: false }, actor), false);
  assert.equal(w.table("amc_audit_events").length, 0);
});
