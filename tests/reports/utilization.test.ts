import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAvailability, type AvailabilityTechnician } from "@/lib/reports/available-hours";
import {
  chargeabilityOf,
  computeUtilization,
  weekStart,
  type Chargeability,
  type UtilizationAppointment,
} from "@/lib/reports/utilization";
import { addDaysToDateString } from "@/lib/scheduling/org-time";

/* Day shift 08:00-17:00 with a 60-minute unpaid break: the BRD's 8-hour day. */
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
    unpaidBreakMinutes: 60,
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

test("Cannot Complete counts only with both actual times, and not in completeness", () => {
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

test("job time outside the shift is reported beside utilization, not in it", () => {
  const result = run({
    from: "2026-10-03",
    to: "2026-10-05",
    appointments: [
      appt(["T1"], "2026-10-05", "16:00", "19:00"), // Monday: 1 h in the shift, 2 h after it
      appt(["T1"], "2026-10-04", "09:00", "12:00"), // Sunday, a rest day
    ],
  });
  const t = result.technicians[0];
  assert.equal(t.jobMinutes, 60);
  assert.equal(t.outsideShiftMinutes, 5 * 60);
  assert.equal(t.availableMinutes, 2 * 8 * 60, "Saturday and Monday; the rest day adds nothing");
});

test("a crew's job counts in full for each technician", () => {
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
  assert.equal(result.teams[0].jobMinutes, 480);
  assert.equal(result.teams[0].technicians, 2);
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
  const kinds: Chargeability[] = ["chargeable", "zero_value", "no_value"];
  const result = run({
    from: "2026-10-05",
    to: "2026-10-05",
    appointments: kinds.map((k, i) => appt(["T1"], "2026-10-05", `${String(9 + i * 2).padStart(2, "0")}:00`, `${String(10 + i * 2).padStart(2, "0")}:00`, { chargeability: k })),
  });
  assert.deepEqual(result.jobMinutesBy, { chargeable: 60, zero_value: 60, no_value: 60 });
  assert.equal(result.technicians[0].chargeableMinutes, 60);
});
