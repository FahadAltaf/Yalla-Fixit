import { zonedDateString } from "@/lib/scheduling/org-time";

import type { DayStatus, TechnicianAvailability } from "./available-hours";
import { shiftDateFor, type RecordedCheckIn, type ShiftWindow } from "./compliance";

/**
 * Daily attendance (BRD 5.2 B5; DEV-451): per technician per day, the
 * shift, check-in and check-out, hours present, and the flags.
 *
 *  - Late: the first shift check-in after shift start + the tolerance
 *    (Reporting Settings, default 15 min).
 *  - Early: the last shift check-out before shift end.
 *  - Absent: a working day with no shift check-in and not wholly on leave.
 *  - Hours present: check-in to check-out, when both are recorded.
 *
 * Days come from the available-hours engine, so holidays, rest days, the
 * leaving date and leave are the same as everywhere else. Check-ins wait
 * on B-01. Pure: no database, no clock.
 */

export type AttendanceLeave = { technicianFsmId: string; startAt: string; endAt: string; category: string | null };

export type AttendanceDay = {
  technicianFsmId: string;
  date: string;
  status: DayStatus | "leave";
  shiftStart: string | null;
  shiftEnd: string | null;
  checkIn: string | null;
  checkOut: string | null;
  presentMinutes: number | null;
  late: boolean;
  lateMinutes: number;
  early: boolean;
  absent: boolean;
  /** Leave category for any leave that day (Annual, Sick, ...). */
  leaveCategory: string | null;
  partLeave: boolean;
};

export type AttendanceSummary = {
  technicianFsmId: string;
  shiftDays: number;
  presentDays: number;
  lateDays: number;
  earlyDays: number;
  absentDays: number;
  leaveDays: number;
  presentMinutes: number;
};

const MINUTE = 60_000;

export function computeAttendance(input: {
  availability: TechnicianAvailability[];
  recorded: RecordedCheckIn[];
  leave: AttendanceLeave[];
  lateToleranceMinutes: number;
  timeZone?: string;
}): AttendanceDay[] {
  const windows = new Map<string, ShiftWindow[]>(
    input.availability.map((t) => [t.fsmId, t.days.map((d) => ({ date: d.date, start: d.windowStart, end: d.windowEnd }))]),
  );
  // First check-in and last check-out per technician and shift day.
  const ins = new Map<string, string>();
  const outs = new Map<string, string>();
  for (const r of input.recorded) {
    if (r.kind !== "shift_check_in" && r.kind !== "shift_check_out") continue;
    const key = `${r.technicianFsmId}|${shiftDateFor(windows.get(r.technicianFsmId) ?? [], r.at, input.timeZone)}`;
    if (r.kind === "shift_check_in") {
      const seen = ins.get(key);
      if (!seen || r.at < seen) ins.set(key, r.at);
    } else {
      const seen = outs.get(key);
      if (!seen || r.at > seen) outs.set(key, r.at);
    }
  }

  const leaveCategory = (tech: string, date: string) => {
    for (const l of input.leave) {
      if (l.technicianFsmId !== tech) continue;
      const from = zonedDateString(l.startAt, input.timeZone);
      // An end at midnight closes the day before.
      const to = zonedDateString(new Date(Date.parse(l.endAt) - 1).toISOString(), input.timeZone);
      if (date >= from && date <= to) return l.category ?? "Leave";
    }
    return null;
  };

  const rows: AttendanceDay[] = [];
  for (const tech of input.availability) {
    for (const day of tech.days) {
      const key = `${tech.fsmId}|${day.date}`;
      const checkIn = ins.get(key) ?? null;
      const checkOut = outs.get(key) ?? null;
      const shiftMinutes = day.windowMinutes - day.breakMinutes;
      const wholeLeave = day.status === "working" && shiftMinutes > 0 && day.leaveMinutes >= shiftMinutes;
      const working = day.status === "working" && !wholeLeave;
      const lateMinutes =
        working && checkIn && day.windowStart
          ? Math.max(0, Math.floor((Date.parse(checkIn) - Date.parse(day.windowStart)) / MINUTE))
          : 0;
      rows.push({
        technicianFsmId: tech.fsmId,
        date: day.date,
        status: wholeLeave ? "leave" : day.status,
        shiftStart: day.windowStart,
        shiftEnd: day.windowEnd,
        checkIn,
        checkOut,
        presentMinutes: checkIn && checkOut && checkOut > checkIn ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / MINUTE) : null,
        late: lateMinutes > input.lateToleranceMinutes,
        lateMinutes,
        early: working && !!checkOut && !!day.windowEnd && checkOut < day.windowEnd,
        absent: working && !checkIn,
        leaveCategory: day.leaveMinutes > 0 ? leaveCategory(tech.fsmId, day.date) : null,
        partLeave: working && day.leaveMinutes > 0,
      });
    }
  }
  return rows;
}

/** The monthly summary for HR. */
export function summariseAttendance(days: AttendanceDay[]): AttendanceSummary[] {
  const byTech = new Map<string, AttendanceSummary>();
  for (const d of days) {
    const s = byTech.get(d.technicianFsmId) ?? {
      technicianFsmId: d.technicianFsmId,
      shiftDays: 0,
      presentDays: 0,
      lateDays: 0,
      earlyDays: 0,
      absentDays: 0,
      leaveDays: 0,
      presentMinutes: 0,
    };
    if (d.status === "working") s.shiftDays += 1;
    if (d.status === "leave") s.leaveDays += 1;
    if (d.checkIn) s.presentDays += 1;
    if (d.late) s.lateDays += 1;
    if (d.early) s.earlyDays += 1;
    if (d.absent) s.absentDays += 1;
    s.presentMinutes += d.presentMinutes ?? 0;
    byTech.set(d.technicianFsmId, s);
  }
  return [...byTech.values()];
}
