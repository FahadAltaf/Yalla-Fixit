import assert from "node:assert/strict";
import test from "node:test";

import { isLeadTimeWarning, leadTimeMessage, leadTimeShortfall, longestLeadTime } from "@/lib/amc/lead-time";
import { checkFieldLeadTime, checkLeadTime } from "@/lib/server/amc/lead-time";
import { fakeSupabase } from "./fake-supabase";

/* DEV-493 (20 Nov 2026): a booking inside the property's access lead time is warned about before it is saved. */
const rules = [
  { accessType: "community_gate_pass", issuer: "Emaar", leadTimeDays: 2 },
  { accessType: "work_permit", issuer: null, leadTimeDays: 5 },
];

test("the rule most short of its notice is the one named", () => {
  assert.equal(leadTimeShortfall(rules, "2026-11-30", "2026-11-22"), null, "8 days: every rule has its notice");
  const s = leadTimeShortfall(rules, "2026-11-24", "2026-11-22");
  assert.deepEqual(s, { rule: "Work permit", leadTimeDays: 5, daysNotice: 2 });
  assert.equal(leadTimeShortfall([{ accessType: "community_gate_pass", issuer: "Emaar", leadTimeDays: 2 }], "2026-11-23", "2026-11-22")?.rule, "Community gate pass (Emaar)");
  assert.equal(leadTimeShortfall([{ accessType: "x", leadTimeDays: 0 }], "2026-11-22", "2026-11-22"), null, "no notice needed");
  const msg = leadTimeMessage(s!);
  assert.ok(isLeadTimeWarning(msg));
  assert.match(msg, /needs 5 days' notice and this booking is in 2 days/);
  assert.equal(longestLeadTime(rules), 5);
});

function seed(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeSupabase({
    amc_property_access_rules: [
      { property_id: "p1", access_type: "work_permit", issuer: null, lead_time_days: 5, active: true },
      { property_id: "p1", access_type: "old", issuer: null, lead_time_days: 30, active: false },
    ],
    amc_contracts: [{ id: "c1", property_id: "p1" }],
    ...extra,
  });
}
const now = new Date("2026-11-22T06:00:00Z");

test("inside the lead time is refused until the user books anyway; access in hand needs no notice", async () => {
  const w = seed();
  await assert.rejects(() => checkLeadTime(w.client as never, "p1", "2026-11-24", { now }), (e: { status?: number; message: string }) => e.status === 409 && isLeadTimeWarning(e.message));
  assert.equal((await checkLeadTime(w.client as never, "p1", "2026-11-24", { now, acknowledged: true }))?.leadTimeDays, 5);
  assert.equal(await checkLeadTime(w.client as never, "p1", "2026-11-24", { now, accessReady: true }), null);
  assert.equal(await checkLeadTime(w.client as never, "p1", "2026-11-28", { now }), null, "6 days: enough notice (the inactive rule is ignored)");
  assert.equal(await checkLeadTime(w.client as never, null, "2026-11-22", { now }), null, "no property, no rule");
});

test("a call out booked anyway is written to its history; an approved pass needs nothing", async () => {
  const w = seed({ amc_call_outs: [{ id: "co1", access_status: null, access_valid_until: null }, { id: "co2", access_status: "approved", access_valid_until: "2026-12-31" }] });
  const actor = { id: "u1", label: "Ops" };
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await assert.rejects(() => checkFieldLeadTime(w.client as never, { kind: "call_out", id: "co1", contractId: "c1", day }, actor), (e: { status?: number }) => e.status === 409);
  await checkFieldLeadTime(w.client as never, { kind: "call_out", id: "co1", contractId: "c1", day, acknowledged: true }, actor);
  const events = w.table("amc_audit_events").filter((e) => e.event_type === "booked_inside_lead_time");
  assert.equal(events.length, 1);
  assert.equal(events[0].entity_id, "co1");
  assert.equal(await checkFieldLeadTime(w.client as never, { kind: "call_out", id: "co2", contractId: "c1", day }, actor), null);
});
