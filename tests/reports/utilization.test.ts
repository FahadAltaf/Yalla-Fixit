import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAvailability, type AvailabilityTechnician } from "@/lib/reports/available-hours";
import {
  chargeabilityOf,
  isContractWork,
  computeUtilization,
  weekStart,
  type Chargeability,
  type UtilizationAppointment,
} from "@/lib/reports/utilization";
import { addDaysToDateString } from "@/lib/scheduling/org-time";

/* The 8-hour working day without a break (Sami, 28 Oct); Sundays off. */
const SHIFTS = { dayStart: "08:00", dayEnd: "17:00", nightStart: "20:00", nightEnd: "08:00" };
const TZ = "Asia/Dubai";
const dubai = (date: string, time: string) => `${date}T${time}:00+04:00`;

const tech = (fsmId: string, patch: Partial<AvailabilityTechnician> = {}): AvailabilityTechnician => ({
  fsmId,
  shift: "morning",
  restWeekdays: [7],
  leavingDate: null,
  ...patch,
});

let seq = 0;
const appt = (
  techs: string[],
  date: string,
  start: string,
  end: string,
  patch: Partial<UtilizationAppointment> = {},
): UtilizationAppointment => ({
  id: `A${++seq}`,
  number: `AP-${seq}`,
  workOrderId: null,
  workOrderNumber: null,
  clientName: null,
  status: "Completed",
  type: "Service",
  scheduledStart: dubai(date, start),
  scheduledEnd: dubai(date, end),
  actualStart: dubai(date, start),
  actualEnd: dubai(date, end),
  technicianIds: techs,
  chargeability: "chargeable",
  ...patch,
});

function run(input: {
  from: string;
  to: string;
  techs?: AvailabilityTechnician[];
  appointments: UtilizationAppointment[];
  holidays?: string[];
  leave?: Array<{ technicianFsmId: string; startAt: string; endAt: string }>;
  granularity?: "day" | "week" | "month";
}) {
  const techs = input.techs ?? [tech("T1")];
  const availability = computeAvailability({
    technicians: techs,
    from: input.from,
    to: input.to,
    shiftTimes: SHIFTS,
    holidays: input.holidays ?? [],
    leave: input.leave ?? [],
    unpaidBreakMinutes: 0,
    timeZone: TZ,
  });
  return computeUtilization({
    from: input.from,
    to: input.to,
    availability,
    technicians: new Map(techs.map((t) => [t.fsmId, { fsmId: t.fsmId, name: `Tech ${t.fsmId}`, teamLeaderId: "L1" }])),
    appointments: input.appointments,
    granularity: input.granularity ?? "month",
    timeZone: TZ,
  });
}

test("chargeable comes from the quotation, else the work order (D-08)", () => {
  assert.equal(chargeabilityOf({ quotationTotal: 1200, workOrderTotal: null }), "chargeable");
  assert.equal(chargeabilityOf({ quotationTotal: 0, workOrderTotal: 500 }), "zero_value", "the quotation decides when there is one");
  assert.equal(chargeabilityOf({ quotationTotal: null, workOrderTotal: 500 }), "chargeable");
  assert.equal(chargeabilityOf({ quotationTotal: null, workOrderTotal: 0 }), "no_value");
  assert.equal(chargeabilityOf({ quotationTotal: null, workOrderTotal: null }), "no_value");
});

test("BRD B2 example: 192 available, 150 job, 132 chargeable = 78 % and 69 %", () => {
  /* October 2026, Sundays off: 27 shift days; one holiday makes 26 (× 8 h = 208 h). */
  const from = "2026-10-01";
  const to = "2026-10-31";
  const holiday = "2026-10-01";
  const leaveDays = ["2026-10-14", "2026-10-15"];
  const working: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) {
    const sunday = new Date(`${d}T12:00:00Z`).getUTCDay() === 0;
    if (!sunday && d !== holiday && !leaveDays.includes(d)) working.push(d);
  }
  assert.equal(working.length, 24);

  const appointments: UtilizationAppointment[] = [];
  working.forEach((date, i) => {
    if (i < 18) {
      appointments.push(appt(["T1"], date, "08:00", "14:00"));
    } else {
      appointments.push(appt(["T1"], date, "08:00", "12:00"));
      appointments.push(appt(["T1"], date, "12:00", "15:00", { chargeability: "zero_value" }));
    }
  });

  const result = run({
    from,
    to,
    holidays: [holiday],
    leave: leaveDays.map((d) => ({ technicianFsmId: "T1", startAt: dubai(d, "00:00"), endAt: dubai(addDaysToDateString(d, 1), "00:00") })),
    appointments,
  });
  const t = result.technicians[0];
  assert.equal(t.shiftDays, 26);
  assert.equal(t.availableMinutes, 192 * 60);
  assert.equal(t.jobMinutes, 150 * 60);
  assert.equal(t.chargeableMinutes, 132 * 60);
  assert.equal(t.timePercent, 78.1, "78.125 %");
  assert.equal(t.commercialPercent, 68.8, "68.75 %");
  assert.equal(Math.round(t.timePercent!), 78);
  assert.equal(Math.round(t.commercialPercent!), 69);
  assert.equal(result.overall.timePercent, 78.1, "the team and overall figures are the same sums");
  assert.equal(result.jobMinutesBy.zero_value, 18 * 60);
});

test("TC09: a quotation of zero and a 2-hour job counts for time only", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: [appt(["T1"], "2026-10-05", "09:00", "11:00", { chargeability: chargeabilityOf({ quotationTotal: 0, workOrderTotal: null }) })],
  });
  const t = result.technicians[0];
  assert.equal(t.jobMinutes, 120);
  assert.equal(t.chargeableMinutes, 0);
  assert.equal(t.timePercent, 25, "2 of 8 hours");
  assert.equal(t.commercialPercent, 0);
});

test("overlapping appointments are not counted twice", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: [appt(["T1"], "2026-10-05", "09:00", "11:00"), appt(["T1"], "2026-10-05", "10:00", "12:00")],
  });
  assert.equal(result.technicians[0].jobMinutes, 180);
  assert.equal(result.technicians[0].appointments, 2);
});

test("missing actual times are left out of job hours and lower completeness", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: [
      appt(["T1"], "2026-10-05", "09:00", "11:00"),
      appt(["T1"], "2026-10-05", "12:00", "14:00", { actualEnd: null }),
    ],
  });
  const t = result.technicians[0];
  assert.equal(t.jobMinutes, 120, "never a zero-length job, never the scheduled time");
  assert.equal(t.completed, 2);
  assert.equal(t.withActualTimes, 1);
  assert.equal(t.completenessPercent, 50);
  assert.equal(result.appointments.filter((a) => a.missingActuals).length, 1);
});

test("Cannot Complete counts only with both actual times (Sami, 28 Oct), and not in completeness", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: [
      appt(["T1"], "2026-10-05", "09:00", "10:00", { status: "Cannot Complete" }),
      appt(["T1"], "2026-10-05", "11:00", "12:00", { status: "Cannot Complete", actualStart: null, actualEnd: null }),
    ],
  });
  const t = result.technicians[0];
  assert.equal(t.jobMinutes, 60);
  assert.equal(t.completed, 0);
  assert.equal(t.completenessPercent, null);
});

test("2 Nov: every hour counts, any time of day and on an off day; above the week's expected hours is overtime", () => {
  const result = run({
    from: "2026-10-03",
    to: "2026-10-05",
    appointments: [
      appt(["T1"], "2026-10-05", "05:00", "19:00"), // Monday: a 14-hour crew day, all counted
      appt(["T1"], "2026-10-04", "09:00", "12:00"), // Sunday: counted too; off days are not fixed weekdays
    ],
  });
  const t = result.technicians[0];
  assert.equal(t.jobMinutes, 17 * 60, "a 05:00 start is not outside anything, and nothing is capped");
  /* Sat-Sun of one week (one off day a week: one day due, 8 h) and Monday of the next (worked: 8 h). */
  assert.equal(t.availableMinutes, 2 * 8 * 60);
  assert.equal(t.overtimeMinutes, 6 * 60, "Sunday's 3 h are within that week's 8 h; Monday is 14 h against 8 h");
  assert.equal(t.timePercent, 106.3, "utilization can pass 100 %");
  assert.equal(result.overall.overtimeMinutes, 6 * 60);
});

test("without their own records, each crew member gets the appointment's time (unverified)", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    techs: [tech("T1"), tech("T2")],
    appointments: [appt(["T1", "T2"], "2026-10-05", "09:00", "13:00")],
  });
  assert.deepEqual(
    result.technicians.map((t) => t.jobMinutes),
    [240, 240],
  );
  assert.deepEqual(result.technicians[0].hoursFrom, { time_sheet: 0, attendance: 0, appointment: 1 });
  assert.equal(result.teams[0].jobMinutes, 480);
  assert.equal(result.teams[0].technicians, 2);
});

test("Sami, 28 Oct: individual hours from each one's time sheet or check-in and check-out", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    techs: [tech("T1"), tech("T2"), tech("T3")],
    appointments: [
      appt(["T1", "T2", "T3"], "2026-10-05", "08:00", "23:59", {
        scheduledStart: dubai("2026-10-05", "08:00"),
        scheduledEnd: dubai("2026-10-05", "12:00"),
        work: {
          T1: { start: dubai("2026-10-05", "08:00"), end: dubai("2026-10-05", "11:00"), source: "time_sheet" },
          /* Checked out at 13:00: the never-closed 23:59 end does not count for them. */
          T2: { start: dubai("2026-10-05", "08:00"), end: dubai("2026-10-05", "13:00"), source: "attendance" },
          /* Not checked in during it: nothing. */
          T3: { start: dubai("2026-10-05", "08:00"), end: dubai("2026-10-05", "08:00"), source: "attendance" },
        },
      }),
    ],
  });
  const by = Object.fromEntries(result.technicians.map((t) => [t.fsmId, t]));
  assert.equal(by.T1.jobMinutes, 180);
  assert.equal(by.T2.jobMinutes, 300);
  assert.equal(by.T3.jobMinutes, 0);
  assert.equal(by.T1.varianceMinutes, -60, "their own time against the booking");
  assert.deepEqual(by.T2.hoursFrom, { time_sheet: 0, attendance: 1, appointment: 0 });
  assert.equal(result.overall.completed, 1, "one appointment, not three technician-appointments");
});

test("one off day a week: six 8-hour days make 100 %, a seventh day is overtime", () => {
  const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const six = run({
    from: "2026-10-05",
    to: "2026-10-11",
    techs: [tech("T1", { restWeekdays: [] })],
    appointments: week.slice(0, 6).map((d) => appt(["T1"], d, "05:00", "17:00")),
  }).technicians[0];
  assert.equal(six.availableMinutes, 48 * 60);
  assert.equal(six.jobMinutes, 72 * 60, "12-hour days count in full");
  assert.equal(six.timePercent, 150);
  assert.equal(six.overtimeMinutes, 24 * 60, "72 h worked against 48 h expected");

  const seven = run({
    from: "2026-10-05",
    to: "2026-10-11",
    techs: [tech("T1", { restWeekdays: [] })],
    appointments: week.map((d) => appt(["T1"], d, "08:00", "16:00")),
  }).technicians[0];
  assert.equal(seven.jobMinutes, 56 * 60);
  assert.equal(seven.overtimeMinutes, 8 * 60, "the seventh day");
});

test("2 Nov: the technician's own daily and weekly limits and off days set the week's expected hours", () => {
  const week = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
  const appointments = week.slice(0, 5).map((d) => appt(["T1"], d, "06:00", "18:00"));
  const capped = run({
    from: "2026-10-05",
    to: "2026-10-11",
    techs: [tech("T1", { restWeekdays: [], dailyHours: 12, weeklyHours: 48, offDaysPerWeek: 2 })],
    appointments,
  }).technicians[0];
  assert.equal(capped.availableMinutes, 48 * 60, "12 h x 5 days is 60 h, the weekly limit of 48 h is less");
  assert.equal(capped.jobMinutes, 60 * 60);
  assert.equal(capped.overtimeMinutes, 12 * 60);
  assert.equal(capped.restDaysAssumed, false);

  const daily = run({
    from: "2026-10-05",
    to: "2026-10-11",
    techs: [tech("T1", { restWeekdays: [], dailyHours: 9, offDaysPerWeek: 2 })],
    holidays: ["2026-10-07"],
    leave: [{ technicianFsmId: "T1", startAt: dubai("2026-10-08", "00:00"), endAt: dubai("2026-10-09", "00:00") }],
    appointments: [],
  }).technicians[0];
  assert.equal(daily.availableMinutes, 3 * 9 * 60, "9 h x 5 days, less a holiday and a day of leave");
  assert.equal(daily.timePercent, 0, "still in the report with no work");
});

test("2 Nov: a week cut by the dates expects its days less the off days, or the days worked", () => {
  const one = run({ from: "2026-10-06", to: "2026-10-06", appointments: [] }).technicians[0];
  assert.equal(one.availableMinutes, 0, "a day not worked may be their off day");
  const worked = run({ from: "2026-10-06", to: "2026-10-06", appointments: [appt(["T1"], "2026-10-06", "09:00", "17:00")] }).technicians[0];
  assert.equal(worked.availableMinutes, 8 * 60);
  const three = run({ from: "2026-10-06", to: "2026-10-08", appointments: [] }).technicians[0];
  assert.equal(three.availableMinutes, 2 * 8 * 60, "three days, one may be the off day");
});

test("a past day counts for the team the technician was in that day", () => {
  const availability = computeAvailability({
    technicians: [
      tech("T1", { teamLeaderId: "L2", history: { team_leader_fsm_id: [{ from: "2000-01-01", value: "L1" }, { from: "2026-10-07", value: "L2" }] } }),
    ],
    from: "2026-10-05",
    to: "2026-10-08",
    shiftTimes: SHIFTS,
    holidays: [],
    leave: [],
    unpaidBreakMinutes: 0,
    today: "2026-10-28",
    timeZone: TZ,
  });
  const result = computeUtilization({
    from: "2026-10-05",
    to: "2026-10-08",
    availability,
    technicians: new Map([
      ["T1", { fsmId: "T1", name: "Tech T1", teamLeaderId: "L2" }],
      ["L1", { fsmId: "L1", name: "Lead One", teamLeaderId: null }],
      ["L2", { fsmId: "L2", name: "Lead Two", teamLeaderId: null }],
    ]),
    appointments: [appt(["T1"], "2026-10-05", "09:00", "11:00"), appt(["T1"], "2026-10-08", "09:00", "10:00")],
    granularity: "day",
    timeZone: TZ,
  });
  const team = Object.fromEntries(result.teams.map((t) => [t.key, t]));
  /* Four days of a week, one may be the off day: 3 x 8 h, shared evenly over the four days. */
  assert.equal(team.L1.availableMinutes, 2 * 360, "5 and 6 Oct in Lead One's team");
  assert.equal(team.L1.jobMinutes, 120);
  assert.equal(team.L2.availableMinutes, 2 * 360, "7 and 8 Oct in Lead Two's team");
  assert.equal(team.L2.jobMinutes, 60);
  assert.equal(result.technicians[0].teamName, "Lead Two's team", "the row shows the team of the last day");
});

test("scheduled against actual variance", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: [appt(["T1"], "2026-10-05", "09:00", "12:00", { scheduledStart: dubai("2026-10-05", "09:00"), scheduledEnd: dubai("2026-10-05", "11:00") })],
  });
  const t = result.technicians[0];
  assert.equal(t.scheduledMinutes, 120);
  assert.equal(t.actualMinutes, 180);
  assert.equal(t.varianceMinutes, 60);
  assert.equal(result.appointments[0].varianceMinutes, 60);
});

test("weekly trend buckets add up to the period", () => {
  assert.equal(weekStart("2026-10-07"), "2026-10-05");
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
  assert.equal(weekStart("2026-10-04"), "2026-09-28");
  const result = run({
    from: "2026-10-01",
    to: "2026-10-31",
    granularity: "week",
    appointments: [appt(["T1"], "2026-10-05", "09:00", "11:00"), appt(["T1"], "2026-10-20", "09:00", "13:00")],
  });
  assert.equal(result.trend[0].key, "2026-09-28");
  assert.equal(
    result.trend.reduce((s, p) => s + p.availableMinutes, 0),
    result.overall.availableMinutes,
  );
  assert.equal(
    result.trend.reduce((s, p) => s + p.jobMinutes, 0),
    360,
  );
  const week = result.trend.find((p) => p.key === "2026-10-19")!;
  assert.equal(week.jobMinutes, 240);
  assert.equal(week.timePercent, Math.round((240 / (6 * 480)) * 1000) / 10);
});

test("appointments outside the period, and leavers with nothing, are left out", () => {
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    techs: [tech("T1"), tech("T9", { leavingDate: "2026-09-01" })],
    appointments: [appt(["T1"], "2026-10-06", "09:00", "11:00")],
  });
  assert.deepEqual(
    result.technicians.map((t) => t.fsmId),
    ["T1"],
  );
  assert.equal(result.appointments.length, 0);
  assert.equal(result.technicians[0].jobMinutes, 0);
});

test("chargeability kinds are reported apart", () => {
  const kinds: Chargeability[] = ["chargeable", "contract", "zero_value", "no_value"];
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: kinds.map((k, i) => appt(["T1"], "2026-10-05", `${String(9 + i * 2).padStart(2, "0")}:00`, `${String(10 + i * 2).padStart(2, "0")}:00`, { chargeability: k })),
  });
  assert.deepEqual(result.jobMinutesBy, { chargeable: 60, contract: 60, zero_value: 60, no_value: 60 });
  assert.equal(result.technicians[0].chargeableMinutes, 60, "AMC work counts for time only");
  assert.equal(result.technicians[0].jobMinutes, 240);
});

test("29 Oct: AMC and in-contract work is never chargeable, whatever its value", () => {
  assert.equal(isContractWork({ workType: "AMC PPM", amcContractRef: null }), true);
  assert.equal(isContractWork({ workType: null, amcContractRef: "16607-TALAL-26-27" }), true);
  assert.equal(isContractWork({ workType: null, amcContractRef: "  " }), false);
  assert.equal(isContractWork({ workType: "Maintenance", amcContractRef: null }), false);
  assert.equal(chargeabilityOf({ quotationTotal: 1200, workOrderTotal: 1200, contract: true }), "contract");
  assert.equal(chargeabilityOf({ quotationTotal: 1200, workOrderTotal: 1200, contract: false }), "chargeable");
});
