import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

/**
 * Available hours (BRD 5.2 B2; DEV-443): how long each technician could
 * have worked, day by day, so that someone who was not available never
 * looks under-utilized. Rules in reporting-calculation-specification.md,
 * with Sami's answers of 28 Oct:
 *
 *   1. From the leaving date on, a day is not counted at all (TC15).
 *   2. A public holiday or one of the technician's rest days counts zero.
 *   3. Otherwise the technician's daily hours: 8, the standard day, or
 *      their own set in Scheduling, at whatever time of day they work.
 *      A Data Center technician's day is 12 hours (29 Oct) unless their
 *      own hours say otherwise: those hours are their day, not overtime. The shift window (portal settings, day or night) is kept
 *      for check-in times: Attendance and Compliance measure lateness by it.
 *   4. The unpaid break (a setting, 0: the 8-hour day has none) comes off.
 *   5. Leave of any category comes off what is left (part-day leave works:
 *      leave records hold timestamps). Overlapping records count once.
 *   6. Every technician has one day off in seven. Until their rest day is
 *      entered, each day counts 6/7 of its hours and the row is flagged.
 *   7. Shift, rest days, daily hours and team leader are the ones in force
 *      on the day (technician_attribute_history), so a change does not
 *      rewrite past periods. From today on, the current values.
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
  /** Hours a working day, net of breaks; null = the standard day. */
  dailyHours?: number | null;
  /** The Service Type in Scheduling ("Data Center", "Maintenance"): it sets the day when dailyHours is null. */
  serviceType?: string | null;
  /** 2 Nov: the contract's weekly hour limit; null = daily hours x working days. */
  weeklyHours?: number | null;
  /** 2 Nov: days off a week, not fixed weekdays; null = 1. */
  offDaysPerWeek?: number | null;
  /** The team: the technician's supervisor, resolved per day like the rest. */
  teamLeaderId?: string | null;
  /** Dated changes, to resolve the values in force on a past day. */
  history?: AttributeHistory;
};

export type HistoryField = "shift" | "team_leader_fsm_id" | "rest_weekdays" | "daily_hours" | "weekly_hours" | "off_days_per_week";
/** Per field, each value and the day it took effect, oldest first. */
export type AttributeHistory = Partial<Record<HistoryField, Array<{ from: string; value: unknown }>>>;

/** Rest days a week when none are entered (Sami, 28 Oct: one day off in seven). */
export const ASSUMED_WORKING_SHARE = 6 / 7;

/** 29 Oct: a Data Center technician works 12-hour days, and the four hours past 8 are not overtime. */
export const isDataCentre = (serviceType: string | null | undefined) => /^data\s*cent(er|re)$/i.test((serviceType ?? "").trim());

export type LeaveInterval = {
  technicianFsmId: string;
  startAt: string;
  endAt: string;
  /** Annual, sick, public holiday or offset (DEV-456); attendance shows it. */
  category?: string | null;
};

export type DayStatus = "working" | "holiday" | "rest_day" | "left";

export type DayAvailability = {
  date: string;
  status: DayStatus;
  /** The working day's hours less the break: what leave comes off. 0 when not a working day. */
  dailyMinutes: number;
  /** No rest day entered: this day counts 6/7 of its hours. */
  restDaysAssumed: boolean;
  /** The team leader in force that day; undefined when the caller gave no team at all. */
  teamLeaderId?: string | null;
  /** The shift window, before break and leave. 0 when not a working day. */
  windowMinutes: number;
  breakMinutes: number;
  /** What leave took off this day (never more than window − break). */
  leaveMinutes: number;
  availableMinutes: number;
  windowStart: string | null;
  windowEnd: string | null;
  /** 2 Nov, for utilization: the weekly hour limit in force that day (minutes); null = none. */
  weeklyLimitMinutes?: number | null;
  /** 2 Nov, for utilization: days off a week in force that day; null = not entered (1 is used). */
  offDaysPerWeek?: number | null;
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
  /** True when, on some day, no rest day was entered and 6 of 7 days were assumed. */
  restDaysAssumed: boolean;
  /** Hours a working day in force on the last day, for display. */
  dailyMinutes: number;
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
  /** The standard working day, net of breaks (Reporting settings; 8 h). */
  standardDailyMinutes?: number;
  /** A Data Center technician's day (Reporting settings; 12 h, 29 Oct). */
  dataCentreDailyMinutes?: number;
  /** YYYY-MM-DD: from this day on, current values instead of history (the caller's today). */
  today?: string;
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

/**
 * A field's value in force on a day: the latest change on or before it;
 * before the first change, that first value (the audit log holds no value
 * before it). From `today` on, and with no history, the current value.
 */
export function valueOn<T>(history: AttributeHistory | undefined, field: HistoryField, date: string, current: T, today?: string): T {
  const changes = history?.[field];
  if (!changes?.length || (today && date >= today)) return current;
  let value = changes[0].value;
  for (const c of changes) {
    if (c.from > date) break;
    value = c.value;
  }
  return value as T;
}

const asShift = (v: unknown): AvailabilityTechnician["shift"] => (v === "night" ? "night" : v === "morning" ? "morning" : null);
const asWeekdays = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter((n) => n >= 1 && n <= 7) : []);
const asHours = (v: unknown): number | null => (v === null || v === undefined || v === "" || !(Number(v) > 0) ? null : Number(v));

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
  /* Every technician on a shift shares its window for a day: worked out once. */
  const windows = new Map<string, { start: Date; end: Date }>();
  const windowOf = (date: string, start: string, end: string) => {
    const key = `${date}|${start}|${end}`;
    let window = windows.get(key);
    if (!window) {
      window = shiftWindow(date, start, end, input.timeZone);
      windows.set(key, window);
    }
    return window;
  };

  const leaveByTech = new Map<string, Array<{ start: number; end: number }>>();
  for (const l of input.leave) {
    const start = Date.parse(l.startAt);
    const end = Date.parse(l.endAt);
    if (!(end > start)) continue;
    const list = leaveByTech.get(l.technicianFsmId) ?? [];
    list.push({ start, end });
    leaveByTech.set(l.technicianFsmId, list);
  }

  const standardDaily = input.standardDailyMinutes ?? 8 * 60;
  const dataCentreDaily = input.dataCentreDailyMinutes ?? 12 * 60;
  const dayBounds = (date: string) => ({
    start: zonedTimeToUtc(date, "00:00", input.timeZone).getTime(),
    end: zonedTimeToUtc(addDaysToDateString(date, 1), "00:00", input.timeZone).getTime(),
  });

  return input.technicians.map((tech) => {
    const leave = leaveByTech.get(tech.fsmId) ?? [];
    const totals = emptyTotals();
    let shiftAssumed = false;
    let restDaysAssumed = false;
    let dailyMinutesShown = standardDaily;

    const days = dates.map<DayAvailability>((date) => {
      /* What was in force that day (rule 7). */
      const shift = valueOn(tech.history, "shift", date, tech.shift, input.today);
      const restWeekdays = asWeekdays(valueOn(tech.history, "rest_weekdays", date, tech.restWeekdays, input.today));
      const ownHours = asHours(valueOn(tech.history, "daily_hours", date, tech.dailyHours ?? null, input.today));
      const weeklyHours = asHours(valueOn(tech.history, "weekly_hours", date, tech.weeklyHours ?? null, input.today));
      const offDaysValue = valueOn<unknown>(tech.history, "off_days_per_week", date, tech.offDaysPerWeek ?? null, input.today);
      const offDaysPerWeek = offDaysValue === null || offDaysValue === undefined || offDaysValue === "" ? null : Math.min(6, Math.max(0, Math.round(Number(offDaysValue))));
      const limits = { weeklyLimitMinutes: weeklyHours === null ? null : Math.round(weeklyHours * 60), offDaysPerWeek };
      const teamLeaderId =
        tech.teamLeaderId === undefined && !tech.history?.team_leader_fsm_id
          ? undefined
          : ((valueOn(tech.history, "team_leader_fsm_id", date, tech.teamLeaderId ?? null, input.today) as string | null) ?? null);
      const daily = ownHours !== null ? Math.round(ownHours * 60) : isDataCentre(tech.serviceType) ? dataCentreDaily : standardDaily;
      dailyMinutesShown = daily;
      if (asShift(shift) === null) shiftAssumed = true;
      const night = asShift(shift) === "night";
      const [start, end] = night
        ? [input.shiftTimes.nightStart, input.shiftTimes.nightEnd]
        : [input.shiftTimes.dayStart, input.shiftTimes.dayEnd];
      const rest = new Set(restWeekdays);
      const assumed = restWeekdays.length === 0;

      const off = (status: DayStatus): DayAvailability => ({
        date,
        status,
        dailyMinutes: 0,
        restDaysAssumed: false,
        teamLeaderId,
        windowMinutes: 0,
        breakMinutes: 0,
        leaveMinutes: 0,
        availableMinutes: 0,
        windowStart: null,
        windowEnd: null,
        ...limits,
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

      const window = windowOf(date, start, end);
      const windowMinutes = (window.end.getTime() - window.start.getTime()) / MINUTE;
      const breakMinutes = Math.min(breakSetting, daily);
      const working = daily - breakMinutes;
      /* Leave within the shift window or the calendar day, whichever holds more of it (a night
         shift's leave can fall after midnight; a crew's day can start before the window). */
      const bounds = dayBounds(date);
      const onLeave = Math.max(
        coveredMinutes(window.start.getTime(), window.end.getTime(), leave),
        coveredMinutes(bounds.start, bounds.end, leave),
      );
      const leaveMinutes = Math.min(onLeave, working);
      const availableMinutes = (working - leaveMinutes) * (assumed ? ASSUMED_WORKING_SHARE : 1);
      if (assumed) restDaysAssumed = true;

      totals.shiftDays += 1;
      totals.windowMinutes += windowMinutes;
      totals.breakMinutes += breakMinutes;
      totals.leaveMinutes += leaveMinutes;
      totals.availableMinutes += availableMinutes;
      return {
        date,
        status: "working",
        dailyMinutes: working,
        restDaysAssumed: assumed,
        teamLeaderId,
        windowMinutes,
        breakMinutes,
        leaveMinutes,
        availableMinutes,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        ...limits,
      };
    });

    return { fsmId: tech.fsmId, shiftAssumed, restDaysAssumed, dailyMinutes: dailyMinutesShown, days, totals };
  });
}

/** Hours for display, one decimal; decisions use the minutes. */
export const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10;
