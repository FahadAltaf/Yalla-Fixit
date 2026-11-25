import assert from "node:assert/strict";
import test from "node:test";

import { remindCrewsOnTheDay } from "@/lib/server/amc/visits";
import { fakeSupabase } from "./fake-supabase";

/* DEV-398 (20 Nov 2026 review): the technician gets a reminder on the day of the visit, in the YFI app. */
const now = new Date("2026-11-20T03:00:00Z"); // 07:00 in Dubai
const contract = { contract_number: "AMC-C-2026-0003", customer_name: "Test Client", property_label: "14 East New Street", status: "active" };

function seed() {
  return fakeSupabase({
    amc_visits: [
      { id: "v1", visit_no: 2, status: "confirmed", scheduled_start: "2026-11-20T05:00:00.000Z", technician_ids: ["fsm-1", "fsm-2"], technician_reminded_on: null, contract },
      { id: "v2", visit_no: 3, status: "confirmed", scheduled_start: "2026-11-21T05:00:00.000Z", technician_ids: ["fsm-1"], technician_reminded_on: null, contract },
      { id: "v3", visit_no: 4, status: "confirmed", scheduled_start: "2026-11-20T08:00:00.000Z", technician_ids: [], technician_reminded_on: null, contract },
    ],
    technician_reference: [
      { fsm_resource_id: "fsm-1", user_profile_id: "u1" },
      { fsm_resource_id: "fsm-2", user_profile_id: null },
    ],
    snagging_notifications: [],
  });
}

test("the crew of today's visit is reminded in the app, once", async () => {
  const w = seed();
  const first = await remindCrewsOnTheDay(w.client as never, now);
  assert.equal(first.sent, 1, "only the technician linked to a login gets it");
  const alerts = w.table("snagging_notifications");
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "amc_visit_today");
  assert.equal(alerts[0].amc_kind, "ppm");
  assert.equal(alerts[0].amc_id, "v1");
  assert.equal(alerts[0].user_id, "u1");
  assert.match(String(alerts[0].title), /today at 09:00/);
  assert.equal(w.table("amc_visits").find((v) => v.id === "v1")?.technician_reminded_on, "2026-11-20");

  const second = await remindCrewsOnTheDay(w.client as never, now);
  assert.equal(second.sent, 0, "a second run the same day sends nothing");
  assert.equal(w.table("snagging_notifications").length, 1);
});

test("tomorrow's visit and a visit with no crew are not reminded today", async () => {
  const w = seed();
  await remindCrewsOnTheDay(w.client as never, now);
  assert.equal(w.table("amc_visits").find((v) => v.id === "v2")?.technician_reminded_on, null);
  assert.equal(w.table("amc_visits").find((v) => v.id === "v3")?.technician_reminded_on, null);
});
