import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

/**
 * Available hours (BRD 5.2 B2; DEV-443): how long each technician could
 * have worked, day by day, so that someone who was not available never
 * looks under-utilized. Rules in reporting-calculation-specification.md:
 *
 *   1. From the leaving date on, a day is not counted at all (TC15).
 *   2. A public holiday or one of the technician's rest days counts zero.
 *   3. Otherwise the shift window from the portal's settings for the
 *      technician's shift. A window whose end is not after its start
 *      crosses midnight and belongs to the day it starts on.
 *   4. The unpaid break (a setting, 0 until D-22) comes off the window.
 *   5. Leave of any category comes off what is left, clipped to the window
 *      (part-day leave works: leave records hold timestamps). Overlapping
 *      leave records count once.
 *
 * Pure: no database, no clock. Minutes throughout; hours only for display.
 */

export type ShiftTimes = {
  /** "HH:mm" or "HH:mm:ss", in the org's zone. */
  dayStart: string;
  dayEnd: string;
  nightStart: string;
  nightEnd: string;
};

export type AvailabilityTechnician = {
  fsmId: string;
  /** technician_reference.shift; not set = the day shift (flagged). */
  shift: "morning" | "night" | null;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  restWeekdays: number[];
  /** YYYY-MM-DD: the first day not worked. */
  leavingDate: string | null;
};

export type LeaveInterval = { technicianFsmId: string; startAt: string; endAt: string };

export type DayStatus = "working" | "holiday" | "rest_day" | "left";

export type DayAvailability = {
  date: string;
  status: DayStatus;
  /** The shift window, before break and leave. 0 when not a working day. */
  windowMinutes: number;
  breakMinutes: number;
  /** What leave took off this day (never more than window − break). */
  leaveMinutes: number;
  availableMinutes: number;
  windowStart: string | null;
  windowEnd: string | null;
};

export type AvailabilityTotals = {
  /** Days the technician was rostered to work (status working), leave days included. */
  shiftDays: number;
  holidayDays: number;
  restDays: number;
  /** Days on or after the leaving date: in none of the other figures. */
  leftDays: number;
  windowMinutes: number;
  breakMinutes: number;
  leaveMinutes: number;
  availableMinutes: number;
};

export type TechnicianAvailability = {
  fsmId: string;
  /** True when the technician has no shift set and the day shift was used. */
  shiftAssumed: boolean;
  days: DayAvailability[];
  totals: AvailabilityTotals;
};

export type AvailabilityInput = {
  technicians: AvailabilityTechnician[];
  /** Inclusive YYYY-MM-DD dates in the org's zone. */
  from: string;
  to: string;
  shiftTimes: ShiftTimes;
  holidays: Iterable<string>;
  /** Active leave only; cancelled records are left out by the caller. */
  leave: LeaveInterval[];
  unpaidBreakMinutes: number;
  timeZone?: string;
};

const MINUTE = 60_000;
/** A range is capped so a typo in a date cannot ask for a century. */
export const MAX_RANGE_DAYS = 400;

/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_RANGE_DAYS; d = addDaysToDateString(d, 1)) out.push(d);
  if (out.length > MAX_RANGE_DAYS) throw new Error(`A range may cover at most ${MAX_RANGE_DAYS} days`);
  return out;
}

const minutesOf = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** The shift window starting on `date`; past midnight when end ≤ start. */
export function shiftWindow(
  date: string,
  start: string,
  end: string,
  timeZone?: string,
): { start: Date; end: Date } {
  const startAt = zonedTimeToUtc(date, start, timeZone);
  const endDate = minutesOf(end) > minutesOf(start) ? date : addDaysToDateString(date, 1);
  return { start: startAt, end: zonedTimeToUtc(endDate, end, timeZone) };
}

/** Minutes of [start, end) covered by the union of the intervals. */
export function coveredMinutes(start: number, end: number, intervals: Array<{ start: number; end: number }>): number {
  const clipped = intervals
    .map((i) => ({ start: Math.max(i.start, start), end: Math.min(i.end, end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursorEnd = -Infinity;
  let cursorStart = -Infinity;
  for (const i of clipped) {
    if (i.start > cursorEnd) {
      if (cursorEnd > cursorStart) total += cursorEnd - cursorStart;
      cursorStart = i.start;
      cursorEnd = i.end;
    } else if (i.end > cursorEnd) {
      cursorEnd = i.end;
    }
  }
  if (cursorEnd > cursorStart) total += cursorEnd - cursorStart;
  return total / MINUTE;
}

const emptyTotals = (): AvailabilityTotals => ({
  shiftDays: 0,
  holidayDays: 0,
  restDays: 0,
  leftDays: 0,
  windowMinutes: 0,
  breakMinutes: 0,
  leaveMinutes: 0,
  availableMinutes: 0,
});

export function computeAvailability(input: AvailabilityInput): TechnicianAvailability[] {
  const dates = datesBetween(input.from, input.to);
  const holidays = new Set(input.holidays);
  const breakSetting = Math.max(0, input.unpaidBreakMinutes);

  const leaveByTech = new Map<string, Array<{ start: number; end: number }>>();
  for (const l of input.leave) {
    const start = Date.parse(l.startAt);
    const end = Date.parse(l.endAt);
    if (!(end > start)) continue;
    const list = leaveByTech.get(l.technicianFsmId) ?? [];
    list.push({ start, end });
    leaveByTech.set(l.technicianFsmId, list);
  }

  return input.technicians.map((tech) => {
    const night = tech.shift === "night";
    const [start, end] = night
      ? [input.shiftTimes.nightStart, input.shiftTimes.nightEnd]
      : [input.shiftTimes.dayStart, input.shiftTimes.dayEnd];
    const rest = new Set(tech.restWeekdays);
    const leave = leaveByTech.get(tech.fsmId) ?? [];
    const totals = emptyTotals();

    const days = dates.map<DayAvailability>((date) => {
      const off = (status: DayStatus): DayAvailability => ({
        date,
        status,
        windowMinutes: 0,
        breakMinutes: 0,
        leaveMinutes: 0,
        availableMinutes: 0,
        windowStart: null,
        windowEnd: null,
      });
      if (tech.leavingDate && date >= tech.leavingDate) {
        totals.leftDays += 1;
        return off("left");
      }
      if (holidays.has(date)) {
        totals.holidayDays += 1;
        return off("holiday");
      }
      if (rest.has(isoWeekday(date))) {
        totals.restDays += 1;
        return off("rest_day");
      }

      const window = shiftWindow(date, start, end, input.timeZone);
      const windowMinutes = (window.end.getTime() - window.start.getTime()) / MINUTE;
      const breakMinutes = Math.min(breakSetting, windowMinutes);
      const working = windowMinutes - breakMinutes;
      const onLeave = coveredMinutes(window.start.getTime(), window.end.getTime(), leave);
      const leaveMinutes = Math.min(onLeave, working);
      const availableMinutes = working - leaveMinutes;

      totals.shiftDays += 1;
      totals.windowMinutes += windowMinutes;
      totals.breakMinutes += breakMinutes;
      totals.leaveMinutes += leaveMinutes;
      totals.availableMinutes += availableMinutes;
      return {
        date,
        status: "working",
        windowMinutes,
        breakMinutes,
        leaveMinutes,
        availableMinutes,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
      };
    });

    return { fsmId: tech.fsmId, shiftAssumed: tech.shift === null, days, totals };
  });
}

/** Hours for display, one decimal; decisions use the minutes. */
export const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
