import { test } from "node:test";
import assert from "node:assert/strict";

import { CHECK_IN_ALERT_EVENTS, planCheckInAlerts, type CheckInAlertAppointment, type CheckInAlertDay } from "@/lib/reports/checkin-alerts";

const TZ = "Asia/Dubai";
const dubai = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`).toISOString();
const TODAY = "2026-10-29";

const day = (id: string, patch: Partial<CheckInAlertDay> = {}): CheckInAlertDay => ({
  technicianFsmId: id,
  name: `Tech ${id}`,
  working: true,
  restDaySet: true,
  shift: "morning",
  shiftStart: dubai(TODAY, "08:00"),
  ...patch,
});
const appt = (id: string, time: string, crew: string[], patch: Partial<CheckInAlertAppointment> = {}): CheckInAlertAppointment => ({
  id,
  number: `AP-${id}`,
  workOrderNumber: `WO${id}`,
  clientName: "ALEC",
  location: "Al Quoz 1",
  status: "Dispatched",
  scheduledStart: dubai(TODAY, time),
  actualStart: null,
  leadId: crew[0] ?? null,
  crew,
  ...patch,
});
const plan = (patch: Partial<Parameters<typeof planCheckInAlerts>[0]>) =>
  planCheckInAlerts({
    now: dubai(TODAY, "08:16"),
    timeZone: TZ,
    shiftDelayMinutes: 15,
    appointmentDelayMinutes: 15,
    days: [day("T1")],
    checkIns: [],
    appointments: [],
    open: [],
    ...patch,
  });

test("TC10: shift starts 08:00, no shift check-in by 08:15: N5 with the day's appointments, once", () => {
  const first = plan({ appointments: [appt("1", "10:00", ["T1"])] });
  assert.equal(first.send.length, 1);
  const [n5] = first.send;
  assert.equal(n5.event, CHECK_IN_ALERT_EVENTS.shift);
  assert.match(n5.body, /Tech T1 has not checked in for the morning shift \(08:00\)\. Today: AP-1 10:00 \(ALEC\)/);
  assert.equal(plan({ now: dubai(TODAY, "08:14") }).send.length, 0, "not before the delay");
  const again = plan({ appointments: [appt("1", "10:00", ["T1"])], open: [{ event: n5.event, entityId: n5.entityId, dedupeKey: n5.dedupeKey }] });
  assert.equal(again.send.length, 0, "one alert per miss, never a stream");
  assert.equal(again.resolve.length, 0);
});

test("N5 stops once the check-in is recorded; a night shift's 23:50 check-in counts", () => {
  const open = [{ event: CHECK_IN_ALERT_EVENTS.shift, entityId: `T1:${TODAY}`, dedupeKey: `n5:T1:${TODAY}` }];
  const after = plan({ open, checkIns: [{ technicianFsmId: "T1", at: dubai(TODAY, "08:40") }] });
  assert.equal(after.send.length, 0);
  assert.deepEqual(after.resolve, open);
  const night = plan({
    now: dubai(TODAY, "00:20"),
    days: [day("T1", { shift: "night", shiftStart: dubai(TODAY, "00:00") })],
    checkIns: [{ technicianFsmId: "T1", at: dubai("2026-10-28", "23:50") }],
  });
  assert.equal(night.send.length, 0);
});

test("no alert on leave, off shift, or on the day off of someone with no rest day set", () => {
  assert.equal(plan({ days: [day("T1", { working: false })] }).send.length, 0, "leave, rest day, holiday or left");
  assert.equal(plan({ days: [day("T1", { restDaySet: false })] }).send.length, 0, "no rest day set and nothing booked: perhaps their day off");
  assert.equal(plan({ days: [day("T1", { restDaySet: false })], appointments: [appt("1", "10:00", ["T1"])] }).send.length, 1, "booked today: expected at work");
});

test("N6: one alert per appointment, naming the lead and the crew, 15 minutes after the scheduled start", () => {
  const crew = ["T1", "T2", "T3"];
  const result = plan({
    now: dubai(TODAY, "09:16"),
    days: crew.map((t) => day(t)),
    checkIns: crew.map((t) => ({ technicianFsmId: t, at: dubai(TODAY, "07:55") })),
    appointments: [appt("1", "09:00", crew)],
  });
  assert.equal(result.send.length, 1);
  const [n6] = result.send;
  assert.equal(n6.event, CHECK_IN_ALERT_EVENTS.appointment);
  assert.equal(n6.body, "Tech T1 (+2 on the crew) has not checked in at ALEC, Al Quoz 1, due 09:00 (WO1).");
});

test("N6 is not raised for a started, cancelled or reassigned appointment, or a crew all on leave", () => {
  const base = { now: dubai(TODAY, "09:16"), days: [day("T1"), day("T2", { working: false })], checkIns: [{ technicianFsmId: "T1", at: dubai(TODAY, "07:55") }] };
  assert.equal(plan({ ...base, appointments: [appt("1", "09:00", ["T1"], { actualStart: dubai(TODAY, "09:05") })] }).send.length, 0);
  assert.equal(plan({ ...base, appointments: [appt("1", "09:00", ["T1"], { status: "Cancelled" })] }).send.length, 0);
  assert.equal(plan({ ...base, appointments: [appt("1", "09:00", ["T1"], { status: "In Progress" })] }).send.length, 0);
  assert.equal(plan({ ...base, appointments: [appt("1", "09:00", ["T2"])] }).send.length, 0, "the only crew member is on leave");
  const open = [{ event: CHECK_IN_ALERT_EVENTS.appointment, entityId: "1", dedupeKey: `n6:1:${dubai(TODAY, "09:00")}` }];
  assert.deepEqual(plan({ ...base, open, appointments: [appt("1", "09:00", ["T2"])] }).resolve, open, "reassigned to someone on leave: the alert is over");
});

test("yesterday's alerts close when the day is over", () => {
  const open = [{ event: CHECK_IN_ALERT_EVENTS.shift, entityId: "T1:2026-10-28", dedupeKey: "n5:T1:2026-10-28" }];
  assert.deepEqual(plan({ open, days: [] }).resolve, open);
});
