import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAttendance, summariseAttendance } from "@/lib/reports/attendance";
import { computeAvailability, type AvailabilityTechnician, type LeaveInterval } from "@/lib/reports/available-hours";
import {
  complianceMonthPhase,
  computeCompliance,
  eventKey,
  missesInOutage,
  monthRange,
  penaltyFor,
  requiredEvents,
  type ComplianceAppointment,
  type ComplianceSettings,
  type RecordedCheckIn,
  type RequiredEvent,
} from "@/lib/reports/compliance";

const SHIFTS = { dayStart: "08:00", dayEnd: "17:00", nightStart: "20:00", nightEnd: "08:00" };
const TZ = "Asia/Dubai";
const dubai = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`).toISOString();
const AT_97: ComplianceSettings = { thresholdPercent: 97, penaltyPerMissAed: 50, monthlyCapAed: 500 };
const AT_90: ComplianceSettings = { ...AT_97, thresholdPercent: 90 };

const tech = (fsmId: string, patch: Partial<AvailabilityTechnician> = {}): AvailabilityTechnician => ({
  fsmId,
  shift: "morning",
  restWeekdays: [7],
  leavingDate: null,
  ...patch,
});

const availability = (opts: { technicians?: AvailabilityTechnician[]; from?: string; to?: string; leave?: LeaveInterval[] } = {}) =>
  computeAvailability({
    technicians: opts.technicians ?? [tech("T1")],
    from: opts.from ?? "2026-10-01",
    to: opts.to ?? "2026-10-31",
    shiftTimes: SHIFTS,
    holidays: [],
    leave: opts.leave ?? [],
    unpaidBreakMinutes: 0,
    timeZone: TZ,
  });

const appointment = (id: string, date: string, start: string, end: string, techs: string[], status = "Scheduled"): ComplianceAppointment => ({
  id,
  number: `AP-${id}`,
  status,
  scheduledStart: dubai(date, start),
  scheduledEnd: dubai(date, end),
  technicianIds: techs,
});

/** Every required event recorded on time, except the keys given. */
const recordAll = (required: RequiredEvent[], skip: Set<string> = new Set()): RecordedCheckIn[] =>
  required
    .filter((e) => !skip.has(e.key))
    .map((e) => ({ technicianFsmId: e.technicianFsmId, kind: e.kind, at: e.dueAt!, appointmentId: e.appointmentId }));

/** n appointment check-ins for T1, on one date, for the BRD's count cases. */
const synthetic = (n: number): RequiredEvent[] =>
  Array.from({ length: n }, (_, i) => ({
    key: eventKey("T1", "appointment_check_in", `A${i}`),
    technicianFsmId: "T1",
    kind: "appointment_check_in" as const,
    date: "2026-10-05",
    dueAt: dubai("2026-10-05", "09:00"),
    appointmentId: `A${i}`,
    appointmentNumber: null,
  }));

const missing = (required: RequiredEvent[], count: number) => new Set(required.slice(0, count).map((e) => e.key));

test("a shift with three appointments requires eight check-ins", () => {
  const avail = availability({ from: "2026-10-05", to: "2026-10-05" });
  const required = requiredEvents({
    availability: avail,
    appointments: [
      appointment("1", "2026-10-05", "09:00", "10:00", ["T1"]),
      appointment("2", "2026-10-05", "11:00", "12:00", ["T1"]),
      appointment("3", "2026-10-05", "14:00", "15:00", ["T1"]),
    ],
    timeZone: TZ,
  });
  assert.equal(required.length, 8);
});

test("cancelled appointments, other crews and off-shift days require nothing", () => {
  const avail = availability({ from: "2026-10-04", to: "2026-10-05" }); // Sunday rest day, then Monday
  const required = requiredEvents({
    availability: avail,
    appointments: [
      appointment("c", "2026-10-05", "09:00", "10:00", ["T1"], "Cancelled"),
      appointment("o", "2026-10-05", "09:00", "10:00", ["T2"]),
      appointment("r", "2026-10-04", "09:00", "10:00", ["T1"]),
    ],
    timeZone: TZ,
  });
  assert.deepEqual(
    required.map((e) => e.kind),
    ["shift_check_in", "shift_check_out"],
    "only Monday's shift: the cancelled one, another crew's and the rest-day booking are not owed",
  );
});

test("TC08: two days of annual leave need no check-ins, and compliance is unaffected", () => {
  const leave = [{ technicianFsmId: "T1", startAt: dubai("2026-10-12", "00:00"), endAt: dubai("2026-10-13", "23:59") }];
  const required = requiredEvents({ availability: availability({ leave }), appointments: [], timeZone: TZ });
  assert.ok(!required.some((e) => e.date === "2026-10-12" || e.date === "2026-10-13"));
  assert.equal(required.length, (27 - 2) * 2, "27 working days in October less 2 on leave");
  const [result] = computeCompliance({ required, recorded: recordAll(required), waivers: [], settings: AT_97, timeZone: TZ });
  assert.equal(result.compliancePercent, 100);
  assert.equal(result.penaltyPayableAed, 0);
});

test("TC15: from the leaving date on, nothing is required", () => {
  const required = requiredEvents({
    availability: availability({ technicians: [tech("T1", { leavingDate: "2026-10-15" })] }),
    appointments: [appointment("late", "2026-10-20", "09:00", "10:00", ["T1"])],
    timeZone: TZ,
  });
  assert.ok(required.every((e) => e.date < "2026-10-15"));
  assert.ok(required.some((e) => e.date === "2026-10-14"), "the days before still count");
});

test("TC11: 200 required, 7 missed at 97 % gives 96.5 % and AED 350; at 90 % nothing", () => {
  const required = synthetic(200);
  const recorded = recordAll(required, missing(required, 7));
  const [at97] = computeCompliance({ required, recorded, waivers: [], settings: AT_97 });
  assert.equal(at97.compliancePercent, 96.5);
  assert.equal(at97.belowThreshold, true);
  assert.equal(at97.penaltyBeforeCapAed, 350);
  assert.equal(at97.penaltyPayableAed, 350);
  const [at90] = computeCompliance({ required, recorded, waivers: [], settings: AT_90 });
  assert.equal(at90.penaltyPayableAed, 0);
});

test("TC12: 14 missed at 97 % is AED 700 capped at 500; at 90 % compliant (D-09)", () => {
  const required = synthetic(200);
  const recorded = recordAll(required, missing(required, 14));
  const [at97] = computeCompliance({ required, recorded, waivers: [], settings: AT_97 });
  assert.equal(at97.compliancePercent, 93);
  assert.equal(at97.penaltyBeforeCapAed, 700);
  assert.equal(at97.penaltyPayableAed, 500);
  const [at90] = computeCompliance({ required, recorded, waivers: [], settings: AT_90 });
  assert.equal(at90.belowThreshold, false);
  assert.equal(at90.penaltyPayableAed, 0);
});

test("TC13: waiving 1 of 7 misses leaves 199 required, 96.98 % (still below 97 %) and AED 300", () => {
  const required = synthetic(200);
  const skip = missing(required, 7);
  const waived = [...skip][0];
  const [result] = computeCompliance({
    required,
    recorded: recordAll(required, skip),
    waivers: [{ eventKey: waived, reason: "No network", waivedBy: "Coordinator", waivedAt: dubai("2026-10-06", "10:00") }],
    settings: AT_97,
  });
  assert.equal(result.required, 199);
  assert.equal(result.performed, 193);
  assert.equal(result.missed, 6);
  assert.equal(result.waived, 1);
  assert.equal(result.compliancePercent!.toFixed(1), "97.0", "it would display as 97.0 %");
  assert.equal(result.belowThreshold, true, "but it is below 97 % unrounded");
  assert.equal(result.penaltyPayableAed, 300);
  const event = result.events.find((e) => e.key === waived)!;
  assert.equal(event.state, "waived");
  assert.equal(event.waiver?.reason, "No network", "the waiver stays reportable");
});

test("with no threshold set (D-09) no penalty is worked out", () => {
  const required = synthetic(10);
  const [result] = computeCompliance({
    required,
    recorded: recordAll(required, missing(required, 5)),
    waivers: [],
    settings: { ...AT_97, thresholdPercent: null },
  });
  assert.equal(result.compliancePercent, 50);
  assert.equal(result.belowThreshold, null);
  assert.equal(result.penaltyPayableAed, null);
  assert.deepEqual(penaltyFor({ required: 0, performed: 0, missed: 0 }, AT_97), { belowThreshold: false, beforeCap: 0, payable: 0 });
});

test("a late check-in counts as performed; a night shift's check-out after midnight counts for its evening", () => {
  const avail = availability({ technicians: [tech("N1", { shift: "night", restWeekdays: [] })], from: "2026-10-05", to: "2026-10-05" });
  const required = requiredEvents({ availability: avail, appointments: [], timeZone: TZ });
  const [result] = computeCompliance({
    required,
    recorded: [
      { technicianFsmId: "N1", kind: "shift_check_in", at: dubai("2026-10-05", "21:10") },
      { technicianFsmId: "N1", kind: "shift_check_out", at: dubai("2026-10-06", "07:55") },
    ],
    waivers: [],
    settings: AT_97,
    timeZone: TZ,
  });
  assert.equal(result.performed, 2);
  assert.equal(result.missed, 0);
});

test("a waiver on an event that was performed changes nothing", () => {
  const required = synthetic(4);
  const [result] = computeCompliance({
    required,
    recorded: recordAll(required),
    waivers: [{ eventKey: required[0].key, reason: "App outage", waivedBy: "x", waivedAt: dubai("2026-10-05", "12:00") }],
    settings: AT_97,
  });
  assert.equal(result.required, 4);
  assert.equal(result.waived, 0);
});

test("a confirmed outage covers every technician's misses inside the window, and only those", () => {
  const avail = availability({ technicians: [tech("T1"), tech("T2")], from: "2026-10-05", to: "2026-10-06" });
  const required = requiredEvents({ availability: avail, appointments: [], timeZone: TZ });
  const compliance = computeCompliance({ required, recorded: [], waivers: [], settings: AT_97, timeZone: TZ });
  const covered = missesInOutage(compliance, { from: dubai("2026-10-05", "07:00"), to: dubai("2026-10-05", "09:00") });
  assert.deepEqual(covered.map((e) => e.key).sort(), [eventKey("T1", "shift_check_in", "2026-10-05"), eventKey("T2", "shift_check_in", "2026-10-05")]);
  assert.equal(missesInOutage(compliance, { from: dubai("2026-10-05", "00:00"), to: dubai("2026-10-06", "23:00"), kinds: ["shift_check_out"] }).length, 4);
});

test("TC14: disputes for October close after 25 November; the 26th is refused", () => {
  assert.equal(complianceMonthPhase("2026-10", "2026-10-20", 25).phase, "running");
  assert.deepEqual(complianceMonthPhase("2026-10", "2026-11-25", 25), { phase: "disputes_open", cutoffDate: "2026-11-25", disputesAllowed: true });
  assert.equal(complianceMonthPhase("2026-10", "2026-11-26", 25).disputesAllowed, false);
  assert.equal(complianceMonthPhase("2026-12", "2027-01-20", 25).cutoffDate, "2027-01-25", "December's window runs into January");
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
});

test("attendance: late beyond the tolerance, early leaving, absent, leave and rest days", () => {
  const avail = availability({
    from: "2026-10-04",
    to: "2026-10-09",
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-09", "00:00"), endAt: dubai("2026-10-10", "00:00") }],
  });
  const days = computeAttendance({
    availability: avail,
    recorded: [
      { technicianFsmId: "T1", kind: "shift_check_in", at: dubai("2026-10-05", "08:10") },
      { technicianFsmId: "T1", kind: "shift_check_out", at: dubai("2026-10-05", "17:05") },
      { technicianFsmId: "T1", kind: "shift_check_in", at: dubai("2026-10-06", "08:20") },
      { technicianFsmId: "T1", kind: "shift_check_out", at: dubai("2026-10-06", "16:30") },
      { technicianFsmId: "T1", kind: "shift_check_in", at: dubai("2026-10-07", "08:00") },
    ],
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-09", "00:00"), endAt: dubai("2026-10-10", "00:00"), category: "sick" }],
    lateToleranceMinutes: 15,
    timeZone: TZ,
  });
  const day = (date: string) => days.find((d) => d.date === date)!;
  assert.equal(day("2026-10-04").status, "rest_day");
  assert.equal(day("2026-10-04").absent, false);
  assert.equal(day("2026-10-05").late, false, "10 minutes is within the tolerance");
  assert.equal(day("2026-10-05").presentMinutes, 9 * 60 - 5);
  assert.equal(day("2026-10-06").late, true);
  assert.equal(day("2026-10-06").lateMinutes, 20);
  assert.equal(day("2026-10-06").early, true);
  assert.equal(day("2026-10-07").presentMinutes, null, "no check-out, no hours present");
  assert.equal(day("2026-10-08").absent, true);
  assert.equal(day("2026-10-09").status, "leave");
  assert.equal(day("2026-10-09").leaveCategory, "sick");
  assert.equal(day("2026-10-09").absent, false);

  const [summary] = summariseAttendance(days);
  assert.deepEqual(
    { shift: summary.shiftDays, present: summary.presentDays, late: summary.lateDays, early: summary.earlyDays, absent: summary.absentDays, leave: summary.leaveDays },
    { shift: 4, present: 3, late: 1, early: 1, absent: 1, leave: 1 },
  );
});

test("without FSM check-ins nobody is marked absent, late or early: the portal just cannot see them (B-01)", () => {
  const days = computeAttendance({
    availability: availability({ from: "2026-10-05", to: "2026-10-06" }),
    recorded: [],
    leave: [],
    lateToleranceMinutes: 15,
    shiftCheckInsAvailable: false,
    timeZone: TZ,
  });
  assert.equal(days.length, 2);
  assert.ok(days.every((d) => !d.measured && !d.absent && !d.late && !d.early));
  assert.equal(summariseAttendance(days)[0].shiftDays, 2, "the roster is still shown");
});

/* 29 Oct: FSM Attendance keeps one record per technician per day; its check-out stays with its check-in. */
const record = (tech: string, checkIn: string, checkOut: string | null): RecordedCheckIn[] => [
  { technicianFsmId: tech, kind: "shift_check_in", at: checkIn, sessionStart: checkIn },
  ...(checkOut ? [{ technicianFsmId: tech, kind: "shift_check_out" as const, at: checkOut, sessionStart: checkIn }] : []),
];

test("attendance: a night worker on the morning shift keeps each night together, outside the shift, never late and early", () => {
  const days = computeAttendance({
    availability: availability({ from: "2026-09-30", to: "2026-10-01" }),
    recorded: [
      ...record("T1", dubai("2026-09-29", "18:46"), dubai("2026-09-30", "06:28")),
      ...record("T1", dubai("2026-09-30", "18:36"), dubai("2026-10-01", "06:03")),
    ],
    leave: [],
    lateToleranceMinutes: 15,
    timeZone: TZ,
  });
  const d = days.find((x) => x.date === "2026-09-30")!;
  assert.equal(d.checkIn, dubai("2026-09-30", "18:36"));
  assert.equal(d.checkOut, dubai("2026-10-01", "06:03"), "the next morning's check-out, not the previous night's");
  assert.equal(d.presentMinutes, 11 * 60 + 27);
  assert.equal(d.outsideShift, true);
  assert.equal(d.late, false);
  assert.equal(d.early, false);
  assert.equal(d.absent, false);
});

test("attendance: the day's jobs widen the expected hours, as on the Scheduling board; late and early stay with the shift", () => {
  const days = computeAttendance({
    availability: availability({ from: "2026-10-05", to: "2026-10-06" }),
    recorded: [
      ...record("T1", dubai("2026-10-05", "06:40"), dubai("2026-10-05", "17:30")),
      /* An evening job only: inside the widened hours, so not outside the shift. */
      ...record("T1", dubai("2026-10-06", "18:10"), dubai("2026-10-06", "22:00")),
    ],
    scheduled: [
      { technicianFsmId: "T1", start: dubai("2026-10-05", "05:00"), end: dubai("2026-10-05", "17:00") },
      { technicianFsmId: "T1", start: dubai("2026-10-06", "18:00"), end: dubai("2026-10-06", "22:00") },
    ],
    leave: [],
    lateToleranceMinutes: 15,
    timeZone: TZ,
  });
  const [mon, tue] = days;
  assert.equal(mon.widenedForJobs, true);
  assert.equal(mon.shiftStart, dubai("2026-10-05", "05:00"));
  assert.equal(mon.windowStart, dubai("2026-10-05", "08:00"), "the shift as set is kept");
  assert.equal(mon.late, false, "a 05:00 booking is a planning block: late counts from the 08:00 shift");
  assert.equal(mon.early, false);
  assert.equal(tue.outsideShift, false, "at their scheduled job");
  assert.equal(tue.late, true, "but after the shift start");
});

test("attendance: work in FSM without a check-in is not an absence; a planned crew place alone is", () => {
  const days = computeAttendance({
    availability: availability({ technicians: [tech("T1"), tech("T2")], from: "2026-10-05", to: "2026-10-05" }),
    recorded: [...record("T1", dubai("2026-09-30", "08:00"), null)],
    scheduled: [
      { technicianFsmId: "T1", start: dubai("2026-10-05", "09:00"), end: dubai("2026-10-05", "12:00") },
      { technicianFsmId: "T2", start: dubai("2026-10-05", "09:00"), end: dubai("2026-10-05", "12:00") },
    ],
    worked: [{ technicianFsmId: "T1", at: dubai("2026-10-05", "09:05") }],
    leave: [],
    lateToleranceMinutes: 15,
    today: "2026-10-29",
    timeZone: TZ,
  });
  const by = Object.fromEntries(days.map((d) => [d.technicianFsmId, d]));
  assert.equal(by.T1.absent, false);
  assert.equal(by.T1.workedWithoutCheckIn, true);
  assert.equal(by.T2.absent, true, "booked on the crew, but nothing shows they worked");
  const [s1] = summariseAttendance(days.filter((d) => d.technicianFsmId === "T1"));
  assert.equal(s1.workedWithoutCheckInDays, 1);
  assert.equal(s1.absentDays, 0);
});

test("attendance: a past record never checked out is flagged; today's open one is not; no rest day set is flagged", () => {
  const days = computeAttendance({
    availability: availability({ technicians: [tech("T1", { restWeekdays: [] })], from: "2026-10-27", to: "2026-10-29" }),
    recorded: [...record("T1", dubai("2026-10-27", "07:00"), null), ...record("T1", dubai("2026-10-29", "07:00"), null)],
    leave: [],
    lateToleranceMinutes: 15,
    today: "2026-10-29",
    timeZone: TZ,
  });
  const by = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(by["2026-10-27"].noCheckOut, true);
  assert.equal(by["2026-10-29"].noCheckOut, false, "still checked in today");
  assert.equal(by["2026-10-28"].absent, true);
  assert.equal(by["2026-10-28"].restDayMissing, true);
});

test("compliance: an overnight check-out counts for the shift day of its own check-in, not the next day", () => {
  const avail = availability({ from: "2026-10-05", to: "2026-10-06" });
  const required = requiredEvents({ availability: avail, appointments: [], timeZone: TZ }).filter((e) => e.date === "2026-10-05");
  const result = computeCompliance({
    required,
    /* Checked in late on the 5th and out at 06:00 on the 6th: FSM's single record for the 5th. */
    recorded: record("T1", dubai("2026-10-05", "09:00"), dubai("2026-10-06", "06:00")),
    waivers: [],
    settings: AT_97,
    timeZone: TZ,
  });
  const out = result[0].events.find((e) => e.kind === "shift_check_out")!;
  assert.equal(out.state, "performed");
  assert.equal(out.recordedAt, dubai("2026-10-06", "06:00"));
});

test("attendance: nobody is absent today before their expected hours are over", () => {
  const days = computeAttendance({
    availability: availability({ from: "2026-10-29", to: "2026-10-29" }),
    recorded: [],
    leave: [],
    lateToleranceMinutes: 15,
    today: "2026-10-29",
    now: dubai("2026-10-29", "12:00"),
    timeZone: TZ,
  });
  assert.equal(days[0].absent, false, "the 08:00-17:00 shift is not over at noon");
  const later = computeAttendance({
    availability: availability({ from: "2026-10-29", to: "2026-10-29" }),
    recorded: [],
    leave: [],
    lateToleranceMinutes: 15,
    today: "2026-10-29",
    now: dubai("2026-10-29", "17:30"),
    timeZone: TZ,
  });
  assert.equal(later[0].absent, true);
});
