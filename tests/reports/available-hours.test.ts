import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeAvailability,
  coveredMinutes,
  datesBetween,
  hours,
  isoWeekday,
  type AvailabilityInput,
  type AvailabilityTechnician,
} from "@/lib/reports/available-hours";

/* The portal's shifts: day 08:00-17:00 (9 h), night 20:00-08:00 (12 h). */
const SHIFTS = { dayStart: "08:00", dayEnd: "17:00", nightStart: "20:00", nightEnd: "08:00" };
const tech = (patch: Partial<AvailabilityTechnician> = {}): AvailabilityTechnician => ({
  fsmId: "T1",
  shift: "morning",
  restWeekdays: [7],
  leavingDate: null,
  ...patch,
});
const run = (patch: Partial<AvailabilityInput>) =>
  computeAvailability({
    technicians: [tech()],
    from: "2026-10-01",
    to: "2026-10-31",
    shiftTimes: SHIFTS,
    holidays: [],
    leave: [],
    unpaidBreakMinutes: 60,
    timeZone: "Asia/Dubai",
    ...patch,
  });
/* Dubai is UTC+4 all year. */
const dubai = (date: string, time: string) => `${date}T${time}:00+04:00`;

test("calendar helpers", () => {
  assert.equal(isoWeekday("2026-10-04"), 7); // a Sunday
  assert.equal(isoWeekday("2026-10-05"), 1);
  assert.equal(datesBetween("2026-10-30", "2026-11-02").length, 4);
  assert.throws(() => datesBetween("2026-01-01", "2027-06-01"));
  assert.equal(
    coveredMinutes(0, 600 * 60_000, [
      { start: 60 * 60_000, end: 180 * 60_000 },
      { start: 120 * 60_000, end: 240 * 60_000 },
    ]),
    180,
    "overlapping intervals count once",
  );
});

test("BRD B2 example: 26 shift days of 8 h less 2 days of leave = 192 h (TC08: leave takes off 16 h)", () => {
  /* October 2026: 27 days without Sundays; one public holiday leaves 26.
     A 9 h shift less a 1 h unpaid break is the BRD's 8 h day (D-22). */
  const holidays = ["2026-10-15"];
  const without = run({ holidays })[0];
  assert.equal(without.totals.shiftDays, 26);
  assert.equal(hours(without.totals.availableMinutes), 208);

  const withLeave = run({
    holidays,
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-12", "00:00"), endAt: dubai("2026-10-13", "23:59") }],
  })[0];
  assert.equal(hours(withLeave.totals.availableMinutes), 192);
  assert.equal(hours(without.totals.availableMinutes - withLeave.totals.availableMinutes), 16);
  assert.equal(hours(withLeave.totals.leaveMinutes), 16, "leave never takes more than the working day");
  assert.equal(withLeave.totals.holidayDays, 1);
  assert.equal(withLeave.totals.restDays, 4);
});

test("TC15: from the leaving date on, days are not counted at all", () => {
  const [t] = run({ technicians: [tech({ leavingDate: "2026-10-20" })] });
  assert.equal(t.totals.leftDays, 12);
  assert.ok(t.days.filter((d) => d.date >= "2026-10-20").every((d) => d.status === "left" && d.availableMinutes === 0));
  assert.equal(t.totals.shiftDays, 16, "19 days before the leaving date, less 3 Sundays");
});

test("a night shift crosses midnight and belongs to the day it starts on", () => {
  const [t] = run({
    technicians: [tech({ shift: "night", restWeekdays: [] })],
    from: "2026-10-05",
    to: "2026-10-05",
    unpaidBreakMinutes: 0,
    /* Leave from midnight takes the second half of Monday night's shift. */
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-06", "00:00"), endAt: dubai("2026-10-06", "12:00") }],
  });
  const [day] = t.days;
  assert.equal(day.windowMinutes, 12 * 60);
  assert.equal(day.windowStart, "2026-10-05T16:00:00.000Z");
  assert.equal(day.windowEnd, "2026-10-06T04:00:00.000Z");
  assert.equal(day.leaveMinutes, 8 * 60);
  assert.equal(day.availableMinutes, 4 * 60);
});

test("part-day leave comes off the day; overlapping records count once", () => {
  const [t] = run({
    from: "2026-10-05",
    to: "2026-10-05",
    leave: [
      { technicianFsmId: "T1", startAt: dubai("2026-10-05", "08:00"), endAt: dubai("2026-10-05", "10:00") },
      { technicianFsmId: "T1", startAt: dubai("2026-10-05", "09:00"), endAt: dubai("2026-10-05", "10:00") },
      { technicianFsmId: "T2", startAt: dubai("2026-10-05", "08:00"), endAt: dubai("2026-10-05", "17:00") },
    ],
  });
  assert.equal(t.days[0].leaveMinutes, 120);
  assert.equal(t.days[0].availableMinutes, 6 * 60, "9 h less 1 h break less 2 h leave");
});

test("holidays and rest days count zero; a day with nothing available adds nothing", () => {
  const [t] = run({ from: "2026-10-03", to: "2026-10-04", holidays: ["2026-10-03"] });
  assert.deepEqual(
    t.days.map((d) => [d.status, d.availableMinutes]),
    [
      ["holiday", 0],
      ["rest_day", 0],
    ],
  );
  assert.equal(t.totals.shiftDays, 0);
  assert.equal(t.totals.availableMinutes, 0);
});

test("a technician without a shift is counted on the day shift and flagged", () => {
  const [t] = run({ technicians: [tech({ shift: null })], from: "2026-10-05", to: "2026-10-05", unpaidBreakMinutes: 0 });
  assert.equal(t.shiftAssumed, true);
  assert.equal(t.days[0].availableMinutes, 9 * 60);
});
