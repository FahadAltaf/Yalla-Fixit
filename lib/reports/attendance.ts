import { zonedDateString } from "@/lib/scheduling/org-time";

import type { DayStatus, TechnicianAvailability } from "./available-hours";
import { shiftDateFor, type RecordedCheckIn, type ShiftWindow } from "./compliance";

/**
 * Daily attendance (BRD 5.2 B5; DEV-451): per technician per day, the
 * shift, check-in and check-out, hours present, and the flags.
 *
 * Check-ins are FSM Attendance records as they are (29 Oct): one per
 * technician per day, its first check-in and last check-out kept together,
 * so a night's 06:00 check-out belongs to the evening it started. Each
 * record is filed under the shift day its check-in is nearest.
 *
 * The expected hours follow the Scheduling board's rules (2 Oct): the
 * technician's own shift, widened to that day's scheduled jobs. They say
 * whether someone worked within their hours at all. Late and early stay
 * measured against the shift as set (BRD): crews booked from 05:00-07:00
 * start work a median 87 minutes after the booking (30 Sep - 29 Oct), so a
 * booking is a planning block, not a time to report.
 *
 *  - Late: the check-in after the shift start + the tolerance
 *    (Reporting Settings, default 15 min).
 *  - Left early: the check-out before the shift end.
 *  - Outside shift: checked in, but at no time within the expected hours
 *    (e.g. a night worker set up on the morning shift). Not late or early:
 *    the shift itself does not fit, and says so.
 *  - Absent: a working day, not wholly on leave, with no check-in and no
 *    work of their own in FSM that day.
 *  - Worked, no check-in: no check-in, but FSM shows them doing the work
 *    (the appointment's lead, or their own time sheet). Not absent.
 *  - No check-out: a past day's record still open.
 *  - Hours present: check-in to check-out, when both are recorded.
 *
 * Days come from the available-hours engine, so holidays, rest days, the
 * leaving date and leave are the same as everywhere else. A technician
 * with no rest day set has every day as a working day; those days carry
 * `restDayMissing`, so an absence on what may be their day off is never
 * passed off as certain. Pure: no database, no clock.
 */

export type AttendanceLeave = { technicianFsmId: string; startAt: string; endAt: string; category: string | null };

export type AttendanceDay = {
  technicianFsmId: string;
  date: string;
  status: DayStatus | "leave";
  /** The expected hours: the shift, widened to the day's scheduled jobs. */
  shiftStart: string | null;
  shiftEnd: string | null;
  /** The shift as set in Scheduling, before widening. */
  windowStart: string | null;
  windowEnd: string | null;
  /** The expected hours were widened to fit the day's scheduled jobs. */
  widenedForJobs: boolean;
  checkIn: string | null;
  checkOut: string | null;
  presentMinutes: number | null;
  /** False while shift check-ins cannot be read: the flags below say nothing. */
  measured: boolean;
  late: boolean;
  lateMinutes: number;
  early: boolean;
  outsideShift: boolean;
  absent: boolean;
  workedWithoutCheckIn: boolean;
  noCheckOut: boolean;
  /** No rest day set for the technician: this day is a working day by default. */
  restDayMissing: boolean;
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
  outsideShiftDays: number;
  absentDays: number;
  workedWithoutCheckInDays: number;
  noCheckOutDays: number;
  leaveDays: number;
  presentMinutes: number;
  restDayMissing: boolean;
};

const MINUTE = 60_000;

export function computeAttendance(input: {
  availability: TechnicianAvailability[];
  recorded: RecordedCheckIn[];
  leave: AttendanceLeave[];
  lateToleranceMinutes: number;
  /** Each technician's scheduled jobs (not cancelled), to widen the expected hours. */
  scheduled?: Array<{ technicianFsmId: string; start: string; end: string }>;
  /** When FSM shows each technician doing work: as the lead, or on their own time sheet. */
  worked?: Array<{ technicianFsmId: string; at: string }>;
  /** YYYY-MM-DD: a record still open before this day was never checked out. */
  today?: string;
  /** Now: nobody is absent before their expected hours are over. */
  now?: string;
  /** Whether shift check-ins can be read at all (B-01). Default true. */
  shiftCheckInsAvailable?: boolean;
  timeZone?: string;
}): AttendanceDay[] {
  const measured = input.shiftCheckInsAvailable !== false;
  const windows = new Map<string, ShiftWindow[]>(
    input.availability.map((t) => [t.fsmId, t.days.map((d) => ({ date: d.date, start: d.windowStart, end: d.windowEnd }))]),
  );
  const dayOf = (tech: string, at: string) => `${tech}|${shiftDateFor(windows.get(tech) ?? [], at, input.timeZone)}`;

  /* FSM's records, rebuilt from the check-in and check-out of each: never split across days. */
  const sessions = new Map<string, { checkIn: string; checkOut: string | null }>();
  for (const r of input.recorded) {
    if (r.kind !== "shift_check_in" && r.kind !== "shift_check_out") continue;
    const start = r.sessionStart ?? r.at;
    const key = `${r.technicianFsmId}|${start}`;
    const session = sessions.get(key) ?? { checkIn: start, checkOut: null };
    if (r.kind === "shift_check_out" && (!session.checkOut || r.at > session.checkOut)) session.checkOut = r.at;
    sessions.set(key, session);
  }
  /* By shift day: the first check-in and the last check-out; open when any record is. */
  const byDay = new Map<string, { checkIn: string; checkOut: string | null; open: boolean; spans: Array<[number, number]> }>();
  for (const [key, s] of sessions) {
    const tech = key.slice(0, key.indexOf("|"));
    const dayKey = dayOf(tech, s.checkIn);
    const span: [number, number] = [Date.parse(s.checkIn), s.checkOut ? Date.parse(s.checkOut) : Date.parse(s.checkIn) + MINUTE];
    const seen = byDay.get(dayKey);
    if (!seen) {
      byDay.set(dayKey, { checkIn: s.checkIn, checkOut: s.checkOut, open: !s.checkOut, spans: [span] });
      continue;
    }
    if (s.checkIn < seen.checkIn) seen.checkIn = s.checkIn;
    if (s.checkOut && (!seen.checkOut || s.checkOut > seen.checkOut)) seen.checkOut = s.checkOut;
    seen.open ||= !s.checkOut;
    seen.spans.push(span);
  }

  /* The day's scheduled jobs, filed under shift days the same way. */
  const jobs = new Map<string, { start: number; end: number }>();
  for (const j of input.scheduled ?? []) {
    const start = Date.parse(j.start);
    const end = Date.parse(j.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const key = dayOf(j.technicianFsmId, j.start);
    const seen = jobs.get(key);
    jobs.set(key, seen ? { start: Math.min(seen.start, start), end: Math.max(seen.end, end) } : { start, end });
  }
  const workedOn = new Set((input.worked ?? []).map((w) => dayOf(w.technicianFsmId, w.at)));

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
      const record = byDay.get(key);
      const checkIn = record?.checkIn ?? null;
      const checkOut = record?.checkOut ?? null;
      const wholeLeave = day.status === "working" && day.dailyMinutes > 0 && day.leaveMinutes >= day.dailyMinutes;
      const working = day.status === "working" && !wholeLeave && measured;

      /* Scheduling's rule: the shift, widened to every job of theirs that day. */
      const job = jobs.get(key);
      const winStart = day.windowStart ? Date.parse(day.windowStart) : null;
      const winEnd = day.windowEnd ? Date.parse(day.windowEnd) : null;
      const expStart = winStart === null ? null : job ? Math.min(winStart, job.start) : winStart;
      const expEnd = winEnd === null ? null : job ? Math.max(winEnd, job.end) : winEnd;
      const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());

      const overlaps =
        record && expStart !== null && expEnd !== null ? record.spans.some(([s, e]) => s < expEnd && e > expStart) : false;
      const outsideShift = working && Boolean(record) && expStart !== null && !overlaps;
      const lateMinutes =
        working && checkIn && winStart !== null && !outsideShift ? Math.max(0, Math.floor((Date.parse(checkIn) - winStart) / MINUTE)) : 0;
      const worked = workedOn.has(key);
      /* Today is not over: no check-in yet is only an absence once their hours have passed. */
      const over = !input.now || expEnd === null || Date.parse(input.now) > expEnd;

      rows.push({
        technicianFsmId: tech.fsmId,
        date: day.date,
        status: wholeLeave ? "leave" : day.status,
        shiftStart: iso(expStart),
        shiftEnd: iso(expEnd),
        windowStart: day.windowStart,
        windowEnd: day.windowEnd,
        widenedForJobs: expStart !== winStart || expEnd !== winEnd,
        checkIn,
        checkOut,
        /* Whole minutes, cut as FSM's Working_Duration is (24:09:31 is 24 h 09 m). */
        presentMinutes: checkIn && checkOut && checkOut > checkIn ? Math.floor((Date.parse(checkOut) - Date.parse(checkIn)) / MINUTE) : null,
        measured,
        late: lateMinutes > input.lateToleranceMinutes,
        lateMinutes,
        early: working && !outsideShift && !!checkOut && winEnd !== null && Date.parse(checkOut) < winEnd,
        outsideShift,
        absent: working && !checkIn && !worked && over,
        workedWithoutCheckIn: working && !checkIn && worked,
        noCheckOut: measured && Boolean(record?.open) && (!input.today || day.date < input.today),
        restDayMissing: day.status === "working" && day.restDaysAssumed,
        leaveCategory: day.leaveMinutes > 0 ? leaveCategory(tech.fsmId, day.date) : null,
        partLeave: day.status === "working" && !wholeLeave && day.leaveMinutes > 0,
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
      outsideShiftDays: 0,
      absentDays: 0,
      workedWithoutCheckInDays: 0,
      noCheckOutDays: 0,
      leaveDays: 0,
      presentMinutes: 0,
      restDayMissing: false,
    };
    if (d.status === "working") s.shiftDays += 1;
    if (d.status === "leave") s.leaveDays += 1;
    if (d.checkIn) s.presentDays += 1;
    if (d.late) s.lateDays += 1;
    if (d.early) s.earlyDays += 1;
    if (d.outsideShift) s.outsideShiftDays += 1;
    if (d.absent) s.absentDays += 1;
    if (d.workedWithoutCheckIn) s.workedWithoutCheckInDays += 1;
    if (d.noCheckOut) s.noCheckOutDays += 1;
    if (d.restDayMissing) s.restDayMissing = true;
    s.presentMinutes += d.presentMinutes ?? 0;
    byTech.set(d.technicianFsmId, s);
  }
  return [...byTech.values()];
}
