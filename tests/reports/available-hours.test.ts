import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeAvailability,
  coveredMinutes,
  datesBetween,
  hours,
  isoWeekday,
  valueOn,
  type AvailabilityInput,
  type AvailabilityTechnician,
} from "@/lib/reports/available-hours";

/* The portal's shift windows (for check-in times): day 08:00-17:00, night 20:00-08:00.
   Available hours are the working day's 8 hours (Sami, 28 Oct), not the window. */
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
    unpaidBreakMinutes: 0,
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
     The 8 h day without a break (D-22, answered 28 Oct). */
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
    technicians: [tech({ shift: "night", restWeekdays: [7] })],
    from: "2026-10-05",
    to: "2026-10-05",
    /* Leave from midnight takes 8 hours of Monday night's shift: the whole 8-hour day. */
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-06", "00:00"), endAt: dubai("2026-10-06", "12:00") }],
  });
  const [day] = t.days;
  assert.equal(day.windowMinutes, 12 * 60, "the window, for check-in times");
  assert.equal(day.windowStart, "2026-10-05T16:00:00.000Z");
  assert.equal(day.windowEnd, "2026-10-06T04:00:00.000Z");
  assert.equal(day.dailyMinutes, 8 * 60);
  assert.equal(day.leaveMinutes, 8 * 60);
  assert.equal(day.availableMinutes, 0);
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
  assert.equal(t.days[0].availableMinutes, 6 * 60, "8 h less 2 h leave");
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
  const [t] = run({ technicians: [tech({ shift: null })], from: "2026-10-05", to: "2026-10-05" });
  assert.equal(t.shiftAssumed, true);
  assert.equal(t.days[0].availableMinutes, 8 * 60);
  assert.equal(t.days[0].windowStart, "2026-10-05T04:00:00.000Z", "the day shift's window, for check-ins");
});

test("Sami, 28 Oct: 8 hours a day, or the technician's own (12 for data centre staff)", () => {
  const [standard, own] = run({
    technicians: [tech(), tech({ fsmId: "T2", dailyHours: 12 })],
    from: "2026-10-05",
    to: "2026-10-11",
  });
  assert.equal(hours(standard.totals.availableMinutes), 6 * 8, "Monday to Saturday, Sunday off");
  assert.equal(hours(own.totals.availableMinutes), 6 * 12);
  assert.equal(own.dailyMinutes, 12 * 60);
  const [eight] = run({ standardDailyMinutes: 9 * 60, from: "2026-10-05", to: "2026-10-05" });
  assert.equal(eight.days[0].availableMinutes, 9 * 60, "the standard day is a setting");
});

test("one day off in seven: with no rest day entered, 6 of every 7 days count, flagged", () => {
  const [t] = run({ technicians: [tech({ restWeekdays: [] })], from: "2026-10-05", to: "2026-10-11" });
  assert.equal(t.restDaysAssumed, true);
  assert.equal(t.totals.shiftDays, 7);
  assert.equal(hours(t.totals.availableMinutes), 48, "7 days × 8 h × 6/7");
  const [entered] = run({ from: "2026-10-05", to: "2026-10-11" });
  assert.equal(entered.restDaysAssumed, false);
  assert.equal(hours(entered.totals.availableMinutes), 48, "the same hours once Sunday is entered");
});

test("a past day uses the shift, rest days, hours and team in force then", () => {
  const history = {
    rest_weekdays: [
      { from: "2026-10-01", value: [5] },
      { from: "2026-10-08", value: [7] },
    ],
    team_leader_fsm_id: [{ from: "2026-10-07", value: "L2" }],
    daily_hours: [{ from: "2000-01-01", value: null }, { from: "2026-10-09", value: 12 }],
  };
  assert.deepEqual(valueOn(history, "rest_weekdays", "2026-09-20", [7]), [5], "before the first change: its value");
  assert.deepEqual(valueOn(history, "rest_weekdays", "2026-10-08", [7]), [7]);
  assert.equal(valueOn(history, "team_leader_fsm_id", "2026-10-06", "L2"), "L2", "before the first change: its value");
  assert.equal(valueOn(history, "shift", "2026-10-06", "night"), "night", "no history: the current value");
  assert.equal(valueOn(history, "daily_hours", "2026-10-30", 8, "2026-10-28"), 8, "from today: the current value");

  const [t] = run({
    technicians: [tech({ restWeekdays: [7], teamLeaderId: "L2", dailyHours: 12, history })],
    from: "2026-10-05",
    to: "2026-10-11",
    today: "2026-10-28",
  });
  const byDate = Object.fromEntries(t.days.map((d) => [d.date, d]));
  assert.equal(byDate["2026-10-09"].status, "working", "Friday was a rest day until 8 Oct");
  assert.equal(byDate["2026-10-09"].availableMinutes, 12 * 60, "12 h from 9 Oct");
  assert.equal(byDate["2026-10-05"].availableMinutes, 8 * 60, "the standard day before");
  assert.equal(byDate["2026-10-11"].status, "rest_day");
});

test("29 Oct: a Data Center technician's day is 12 hours, unless their own hours say otherwise", () => {
  const day = { from: "2026-10-05", to: "2026-10-05" };
  const [dc] = run({ ...day, technicians: [tech({ serviceType: "Data Center" })] });
  assert.equal(dc.totals.availableMinutes, 12 * 60, "12 h available, not 8 + 4 overtime");
  const [own] = run({ ...day, technicians: [tech({ serviceType: "Data Center", dailyHours: 10 })] });
  assert.equal(own.totals.availableMinutes, 10 * 60, "hours set on the technician come first");
  const [set] = run({ ...day, dataCentreDailyMinutes: 11 * 60, technicians: [tech({ serviceType: "data centre" })] });
  assert.equal(set.totals.availableMinutes, 11 * 60, "the setting, and either spelling");
  const [maint] = run({ ...day, technicians: [tech({ serviceType: "Maintenance" })] });
  assert.equal(maint.totals.availableMinutes, 8 * 60);
});
