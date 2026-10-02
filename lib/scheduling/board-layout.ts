// Where a job is drawn on the schedule boards.
//
// The daily board has two grids, Night and Morning, each a window of hours.
// It used to file a job under ONE shift by its start time, draw it only in
// that grid, clipped to the configured window, and give a technician a row
// only in the grid of their own shift. A job that started before the morning
// window opened (05:00 - 17:00, AP-3869) was therefore filed under Night,
// where none of its morning-shift technicians had a row: on the board in the
// database, invisible on the screen. In Aug-Sep 2026 that hid 332 of 848 live
// FSM appointments, and clipped part of 393.
//
// The rules now (decided with the team, 2 Oct 2026), used by the daily
// board, its PDF and the wall display:
//
//   1. A TECHNICIAN'S ROW IS IN THE GRID OF THEIR OWN SHIFT, whatever the
//      hours of their jobs. Night technicians are night technicians because
//      the team made them so; a technician with no shift set is in both.
//   2. A ROW DRAWS EVERY JOB OF THAT TECHNICIAN THAT DAY, in full.
//   3. THE GRID FITS THE WORK. A grid's hours stretch, in whole hours, to
//      show every job on its rows -- so a night job running past 09:00, or a
//      morning job starting at 05:00, is drawn, not pinned to an edge. The
//      team sets each grid's usual hours on the board itself.
//   4. ONLY MIDNIGHT CUTS A BAR. A job that runs on into the next day is
//      drawn to the end of the day with an open, dashed edge, and again on
//      the next day from its left edge.
//
// Times are minutes from midnight of the BOARD's date in the org's timezone.
// They are not minutes of the day: a job that runs past midnight ends after
// 1440, and yesterday's job still running this morning starts below 0.
//
// Pure and dependency-free (apart from org-time), so the server uses it too.

import { getOrgTimeZone, zonedTimeToUtc } from "./org-time";

export const DAY_MINUTES = 1440;

export type ShiftKey = "day" | "night";
export type Bounds = { start: number; end: number };
export type ShiftWindows = Record<ShiftKey, Bounds>;
export type MinuteRange = { startMin: number; endMin: number };

export type ShiftWindowConfig = {
  night_shift_start: string;
  night_shift_end: string;
  day_shift_start: string;
  day_shift_end: string;
};

// A grid's window for one day: the configured hours, stretched to fit.
export type FittedBounds = Bounds & { configured: Bounds; stretched: boolean };

export type BarPlacement = {
  // The job's real times, relative to the board's date.
  startMin: number;
  endMin: number;
  // The part of it inside this grid.
  visibleStart: number;
  visibleEnd: number;
  leftPct: number;
  widthPct: number;
  // It starts before / ends after what this grid shows.
  clippedStart: boolean;
  clippedEnd: boolean;
};

export function clockToMinutes(value: string): number {
  const [h, m] = (value || "").split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** The two shift windows as configured. A window that ends at or before its
 *  start is read as running past midnight. */
export function configuredWindows(config: ShiftWindowConfig): ShiftWindows {
  const make = (start: string, end: string): Bounds => {
    const s = clockToMinutes(start);
    let e = clockToMinutes(end);
    if (e <= s) e += DAY_MINUTES;
    return { start: s, end: e };
  };
  return {
    night: make(config.night_shift_start, config.night_shift_end),
    day: make(config.day_shift_start, config.day_shift_end),
  };
}

/** The span of one board day: midnight to midnight, or to the end of a shift
 *  window that itself runs past midnight. */
export function dayLimits(windows: ShiftWindows): Bounds {
  return { start: 0, end: Math.max(DAY_MINUTES, windows.day.end, windows.night.end) };
}

/** Minutes from midnight of `date` (org timezone) to an instant. */
export function minutesFromDayStart(
  at: string | number | Date,
  date: string,
  timeZone: string = getOrgTimeZone(),
): number {
  const instant = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Math.round((instant - zonedTimeToUtc(date, "00:00:00", timeZone).getTime()) / 60_000);
}

/** A job's times relative to the board's date. */
export function entryRange(
  entry: { start_at: string; end_at: string },
  date: string,
  timeZone: string = getOrgTimeZone(),
): MinuteRange {
  const startMin = minutesFromDayStart(entry.start_at, date, timeZone);
  const endMin = Math.max(minutesFromDayStart(entry.end_at, date, timeZone), startMin + 1);
  return { startMin, endMin };
}

/** Whether any of the job falls on the board's day at all. */
export function isOnDay(range: MinuteRange, windows: ShiftWindows): boolean {
  const limits = dayLimits(windows);
  return range.endMin > limits.start && range.startMin < limits.end;
}

function clipToDay(range: MinuteRange, windows: ShiftWindows): MinuteRange {
  const limits = dayLimits(windows);
  return {
    startMin: Math.max(range.startMin, limits.start),
    endMin: Math.min(range.endMin, limits.end),
  };
}

function overlapMinutes(range: MinuteRange, bounds: Bounds) {
  return Math.max(0, Math.min(range.endMin, bounds.end) - Math.max(range.startMin, bounds.start));
}

function gapMinutes(range: MinuteRange, bounds: Bounds) {
  if (range.endMin < bounds.start) return bounds.start - range.endMin;
  if (range.startMin > bounds.end) return range.startMin - bounds.end;
  return 0;
}

/** The shift a moment belongs to. The windows overlap (08:00 - 09:00 today)
 *  and the morning shift wins. null when it is in neither. */
export function shiftAtMinute(minute: number, windows: ShiftWindows): ShiftKey | null {
  if (minute >= windows.day.start && minute < windows.day.end) return "day";
  if (minute >= windows.night.start && minute < windows.night.end) return "night";
  return null;
}

/** The shift a job's TIMES belong to: the one that covers most of it (equal
 *  cover: the one it starts in, morning winning the shared hour; no cover:
 *  the nearer one). This is the label stored on an entry and used in
 *  messages. It does not decide where a job is drawn; the technician's shift
 *  does (rule 1). */
export function homeShift(range: MinuteRange, windows: ShiftWindows): ShiftKey {
  const onDay = clipToDay(range, windows);
  const day = overlapMinutes(onDay, windows.day);
  const night = overlapMinutes(onDay, windows.night);
  if (day !== night) return day > night ? "day" : "night";
  if (day > 0) return shiftAtMinute(onDay.startMin, windows) ?? "day";
  const dayGap = gapMinutes(onDay, windows.day);
  const nightGap = gapMinutes(onDay, windows.night);
  if (dayGap !== nightGap) return dayGap < nightGap ? "day" : "night";
  return "day";
}

/** Rule 3: a grid's hours for the day, stretched in whole hours to show all
 *  of the jobs on its rows. Never reaches outside the board's day. */
export function fitGrid(bounds: Bounds, ranges: MinuteRange[], windows: ShiftWindows): FittedBounds {
  const limits = dayLimits(windows);
  const fitted: Bounds = { ...bounds };
  for (const range of ranges) {
    const start = Math.max(range.startMin, limits.start);
    const end = Math.min(range.endMin, limits.end);
    if (end <= start) continue;
    fitted.start = Math.max(limits.start, Math.min(fitted.start, Math.floor(start / 60) * 60));
    fitted.end = Math.min(limits.end, Math.max(fitted.end, Math.ceil(end / 60) * 60));
  }
  return {
    ...fitted,
    configured: bounds,
    stretched: fitted.start !== bounds.start || fitted.end !== bounds.end,
  };
}

/** Left/width percentages for a time range inside a grid: never runs off the
 *  right edge and keeps a clickable minimum width. */
export function spanPercent(startMin: number, endMin: number, bounds: Bounds, minWidthPct = 6) {
  const span = bounds.end - bounds.start || 1;
  const leftPct = ((startMin - bounds.start) / span) * 100;
  const rawWidth = ((endMin - startMin) / span) * 100;
  const widthPct = Math.max(Math.min(rawWidth, 100 - leftPct), Math.min(minWidthPct, 100 - leftPct));
  return { leftPct, widthPct };
}

/** How a job sits in one grid, or null when none of it is in there. With a
 *  grid fitted to its jobs (fitGrid), only midnight can clip a bar. */
export function placeRange(range: MinuteRange, bounds: Bounds, minWidthPct = 6): BarPlacement | null {
  const visibleStart = Math.max(range.startMin, bounds.start);
  const visibleEnd = Math.min(range.endMin, bounds.end);
  if (visibleEnd <= visibleStart) return null;
  return {
    startMin: range.startMin,
    endMin: range.endMin,
    visibleStart,
    visibleEnd,
    clippedStart: range.startMin < bounds.start,
    clippedEnd: range.endMin > bounds.end,
    ...spanPercent(visibleStart, visibleEnd, bounds, minWidthPct),
  };
}

/** A single timeline for the whole day (the wall display): both windows
 *  together, stretched to fit the day's work. */
export function fitDayWindow(windows: ShiftWindows, ranges: MinuteRange[]): FittedBounds {
  const configured: Bounds = {
    start: Math.min(windows.day.start, windows.night.start),
    end: Math.max(windows.day.end, windows.night.end),
  };
  return fitGrid(configured, ranges, windows);
}

/** How many calendar days after the board's date a minute value falls
 *  (-1 = the day before). */
export function dayOffsetOf(minute: number): number {
  return Math.floor(minute / DAY_MINUTES);
}
