import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAvailability, datesBetween, type AvailabilityTechnician } from "@/lib/reports/available-hours";
import { cellStatus, computeCapacity, type CapacityAppointment } from "@/lib/reports/capacity";

const SHIFTS = { dayStart: "08:00", dayEnd: "17:00", nightStart: "20:00", nightEnd: "08:00" };
const TZ = "Asia/Dubai";
const dubai = (date: string, time: string) => `${date}T${time}:00+04:00`;

const tech = (fsmId: string, teamLeaderId: string | null, patch: Partial<AvailabilityTechnician> = {}) => ({
  avail: { fsmId, shift: "morning" as const, restWeekdays: [7], leavingDate: null, ...patch },
  ref: { fsmId, name: `Tech ${fsmId}`, teamLeaderId },
});

let seq = 0;
const booking = (techs: string[], date: string, start: string, end: string, patch: Partial<CapacityAppointment> = {}): CapacityAppointment => ({
  id: `A${++seq}`,
  number: `AP-${seq}`,
  workOrderNumber: null,
  clientName: null,
  status: "Dispatched",
  scheduledStart: dubai(date, start),
  scheduledEnd: dubai(date, end),
  technicianIds: techs,
  ...patch,
});

/* Monday 5 Oct to Sunday 11 Oct 2026; 8 h available a working day (one-hour break). */
function run(appointments: CapacityAppointment[], spareBelowPercent = 50) {
  const people = [tech("T1", "L1"), tech("T2", "L1"), tech("T3", null), tech("T9", "L1", { leavingDate: "2026-09-01" })];
  const dates = datesBetween("2026-10-05", "2026-10-11");
  const availability = computeAvailability({
    technicians: people.map((p) => p.avail),
    from: dates[0],
    to: dates[dates.length - 1],
    shiftTimes: SHIFTS,
    holidays: [],
    leave: [],
    unpaidBreakMinutes: 60,
    timeZone: TZ,
  });
  return computeCapacity({
    dates,
    availability,
    technicians: new Map(people.map((p) => [p.ref.fsmId, p.ref])),
    appointments,
    spareBelowPercent,
    timeZone: TZ,
  });
}

test("cell status", () => {
  assert.equal(cellStatus(600, 480, 50), "over");
  assert.equal(cellStatus(100, 480, 50), "spare");
  assert.equal(cellStatus(240, 480, 50), "ok", "exactly half is not spare");
  assert.equal(cellStatus(0, 0, 50), "off");
  assert.equal(cellStatus(60, 0, 50), "over", "booked on a day with nothing available");
});

test("booked hours: overlapping bookings once, cancelled ones not at all", () => {
  const result = run([
    booking(["T1"], "2026-10-05", "08:00", "12:00"),
    booking(["T1"], "2026-10-05", "10:00", "14:00"),
    booking(["T1"], "2026-10-05", "14:00", "18:00", { status: "Cancelled" }),
  ]);
  const t1 = result.technicians.find((t) => t.key === "T1")!;
  assert.equal(t1.cells[0].bookedMinutes, 360);
  assert.equal(t1.cells[0].availableMinutes, 480);
  assert.equal(t1.cells[0].status, "ok");
  assert.equal(result.days[0].appointments, 2);
});

test("over-booked days and N14's list, by team", () => {
  const result = run([
    booking(["T1", "T2"], "2026-10-06", "07:00", "17:00"), // 10 h each against 8 h
    booking(["T3"], "2026-10-06", "09:00", "10:00"),
  ]);
  const team = result.teams.find((t) => t.key === "L1")!;
  assert.equal(team.technicians, 2, "the leaver is not on the board");
  assert.equal(team.cells[1].bookedMinutes, 1200);
  assert.equal(team.cells[1].availableMinutes, 960);
  assert.equal(team.cells[1].status, "over");
  assert.deepEqual(result.overbooked, [
    { date: "2026-10-06", teamKey: "L1", teamName: "L1's team", bookedMinutes: 1200, availableMinutes: 960 },
  ]);
  const solo = result.teams.find((t) => t.key === "none")!;
  assert.equal(solo.cells[1].status, "spare");
  assert.equal(result.totals.overTechnicianDays, 2);
  assert.equal(result.teams[result.teams.length - 1].key, "none", "No team last");
});

test("a booking on a rest day is over-booking", () => {
  const result = run([booking(["T3"], "2026-10-11", "09:00", "11:00")]);
  const t3 = result.technicians.find((t) => t.key === "T3")!;
  assert.equal(t3.cells[6].availableMinutes, 0);
  assert.equal(t3.cells[6].dayStatus, "rest_day");
  assert.equal(t3.cells[6].status, "over");
});

test("unassigned hours are shown apart, never in a team", () => {
  const result = run([booking([], "2026-10-07", "09:00", "12:00"), booking([], "2026-10-07", "10:00", "12:00")]);
  assert.equal(result.days[2].unassignedMinutes, 300, "separate jobs add up");
  assert.equal(result.days[2].bookedMinutes, 0);
  assert.equal(result.totals.unassignedMinutes, 300);
});

test("spare days follow the setting", () => {
  const appointments = [booking(["T3"], "2026-10-05", "08:00", "11:00")]; // 3 of 8 h
  assert.equal(run(appointments, 50).technicians.find((t) => t.key === "T3")!.cells[0].status, "spare");
  assert.equal(run(appointments, 25).technicians.find((t) => t.key === "T3")!.cells[0].status, "ok");
});
