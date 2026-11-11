import { z } from "zod";

/**
 * AMC PPM schedule (BRD v0.3 5.10; Phase 8: DEV-354, 388, 389, 390).
 * Pure rules: the tentative schedule a contract's service lines make,
 * service windows and working days, what moving a visit means, what can
 * be clubbed, and the completed / remaining / overdue counts. No imports
 * beyond the AMC rules, so routes, screens and tests share them.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const VISIT_STATUSES = [
  "not_scheduled",
  "scheduled",
  "confirmed",
  "in_progress",
  "submitted",
  "completed",
  "completed_with_additional_work",
  "partially_completed",
  "pending_access",
  "rescheduled",
  "not_completed",
  "cancelled",
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  not_scheduled: "Not scheduled",
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  in_progress: "In progress",
  submitted: "Submitted",
  completed: "Completed",
  completed_with_additional_work: "Completed with additional work",
  partially_completed: "Partially completed",
  pending_access: "Pending access",
  rescheduled: "Rescheduled",
  not_completed: "Not completed",
  cancelled: "Cancelled",
};

/** The visit was delivered. */
export const DONE_STATUSES: readonly VisitStatus[] = ["completed", "completed_with_additional_work"];
/** Nothing more will happen on the visit itself. */
export const CLOSED_STATUSES: readonly VisitStatus[] = ["completed", "completed_with_additional_work", "not_completed", "cancelled"];
/** Still to be done; these can be moved, clubbed and removed. */
export const PLANNABLE_STATUSES: readonly VisitStatus[] = ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access"];

export const VISIT_CHANGE_LABELS: Record<string, string> = {
  generated: "Schedule generated",
  adjusted: "Date adjusted (tentative plan)",
  moved_in_window: "Moved inside its window",
  rescheduled: "Rescheduled outside its window",
  added: "Visit added",
  removed: "Visit removed",
  clubbed: "Visits clubbed",
  separated: "Trade separated",
  confirmed: "Schedule confirmed",
  rules_changed: "Schedule rules changed",
};

/* ------------------------------------------------------------------ */
/* Dates and the working calendar                                      */
/* ------------------------------------------------------------------ */

export interface WorkingCalendar {
  /** 0 = Sunday … 6 = Saturday. */
  weekendDays: number[];
  holidays: Array<{ date: string; name?: string }>;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole months later; 31 Jan + 1 month is the last day of February. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(Date.UTC(y, m - 1 + months, d));
  if (out.getUTCDate() !== d) out.setUTCDate(0);
  return out.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const month = (date: string) => Number(date.slice(5, 7));

export function isWorkingDay(date: string, calendar: WorkingCalendar): boolean {
  return !calendar.weekendDays.includes(weekday(date)) && !calendar.holidays.some((h) => h.date === date);
}

/**
 * The first working day from `from` to `to` (inclusive) that suits the
 * client's preferred weekdays when they gave some; else the first working
 * day; else `from` (a window of holidays still has a date).
 */
export function firstWorkingDay(from: string, to: string, calendar: WorkingCalendar, preferredDays: number[] = []): string {
  let fallback: string | null = null;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWorkingDay(d, calendar)) continue;
    if (!preferredDays.length || preferredDays.includes(weekday(d))) return d;
    fallback ??= d;
  }
  return fallback ?? from;
}

/* ------------------------------------------------------------------ */
/* The tentative schedule (DEV-388)                                    */
/* ------------------------------------------------------------------ */

export interface ServiceLineInput {
  entitlementId: string;
  serviceId: string;
  label: string;
  /** Visits a year (6 a year is every 2 months). */
  frequencyPerYear: number;
  /** Client preferences (1-12, 0-6); from the property's scope, when known. */
  preferredMonths?: number[];
  preferredDays?: number[];
}

export interface PlannedLineVisit {
  entitlementId: string;
  serviceId: string;
  label: string;
  occurrence: number;
  cycleStart: string;
  cycleEnd: string;
  windowStart: string;
  windowEnd: string;
  targetDate: string;
}

export interface ScheduleInput {
  lines: ServiceLineInput[];
  commencementDate: string;
  /** The contract's last day (inclusive). */
  endDate: string;
  termMonths: number;
  /** The window inside each cycle, in days (BRD: the first 15 days, configurable per contract). */
  windowDays: number;
  calendar: WorkingCalendar;
}

/** How many visits a line makes over the term: frequency a year, pro rata, at least one. */
export function visitsOverTerm(frequencyPerYear: number, termMonths: number): number {
  return Math.max(1, Math.round((Math.max(1, frequencyPerYear) * Math.max(1, termMonths)) / 12));
}

/**
 * One line's visits: the term split into equal cycles (6 a year is every
 * 2 months), each with a window of `windowDays` from its start and a
 * target on the first working day in the window. A preferred month inside
 * the cycle moves the window to start in that month; preferred weekdays
 * pick the target day.
 */
export function planLine(line: ServiceLineInput, input: Omit<ScheduleInput, "lines">): PlannedLineVisit[] {
  const n = visitsOverTerm(line.frequencyPerYear, input.termMonths);
  const span = daysBetween(input.commencementDate, input.endDate) + 1;
  /* Whole months when the term divides evenly (6 a year: 1 Nov, 1 Jan, 1 Mar…); else equal days. */
  const monthsPerCycle = input.termMonths % n === 0 ? input.termMonths / n : null;
  const startOf = (k: number) =>
    monthsPerCycle ? addMonths(input.commencementDate, k * monthsPerCycle) : addDays(input.commencementDate, Math.floor((k * span) / n));
  const months = (line.preferredMonths ?? []).filter((m) => m >= 1 && m <= 12);
  const out: PlannedLineVisit[] = [];
  for (let k = 0; k < n; k += 1) {
    const cycleStart = startOf(k);
    const cycleEnd = k === n - 1 ? input.endDate : addDays(startOf(k + 1), -1);
    let windowStart = cycleStart;
    if (months.length && !months.includes(month(cycleStart))) {
      /* The first preferred month that begins inside the cycle. */
      for (let d = cycleStart; d <= cycleEnd; d = addDays(d, 1)) {
        if (d.endsWith("-01") && months.includes(month(d))) {
          windowStart = d;
          break;
        }
      }
    }
    const windowEnd = minDate(addDays(windowStart, Math.max(1, input.windowDays) - 1), cycleEnd);
    const targetDate = firstWorkingDay(windowStart, windowEnd, input.calendar, line.preferredDays);
    out.push({
      entitlementId: line.entitlementId,
      serviceId: line.serviceId,
      label: line.label,
      occurrence: k + 1,
      cycleStart,
      cycleEnd,
      windowStart,
      windowEnd,
      targetDate,
    });
  }
  return out;
}

/** Every line's visits, in date order (one visit per line occurrence; clubbing is the team's choice). */
export function buildPpmSchedule(input: ScheduleInput): PlannedLineVisit[] {
  return input.lines
    .flatMap((line) => planLine(line, input))
    .sort((a, b) => (a.targetDate === b.targetDate ? a.label.localeCompare(b.label) : a.targetDate < b.targetDate ? -1 : 1));
}

const minDate = (a: string, b: string) => (a <= b ? a : b);
const maxDate = (a: string, b: string) => (a >= b ? a : b);

/* ------------------------------------------------------------------ */
/* Moving a visit (DEV-389)                                            */
/* ------------------------------------------------------------------ */

export type MoveKind = "in_window" | "outside_window";

/**
 * What a new date means (BRD 5.10): inside the service window it is not a
 * reschedule; outside it, once the plan is confirmed, it is -- it needs a
 * reason and keeps the original date for adherence. Before the plan is
 * confirmed the team is still planning, so any date is a plain adjustment.
 */
export function classifyMove(
  visit: { windowStart: string; windowEnd: string },
  newDate: string,
  planConfirmed: boolean,
): { kind: MoveKind; needsReason: boolean } {
  const inside = newDate >= visit.windowStart && newDate <= visit.windowEnd;
  if (inside) return { kind: "in_window", needsReason: false };
  return { kind: "outside_window", needsReason: planConfirmed };
}

/**
 * A tentative visit moved outside its window takes a new window starting
 * on the new date; a confirmed one keeps its window, because adherence is
 * measured against it.
 */
export function windowAfterMove(
  visit: { windowStart: string; windowEnd: string },
  newDate: string,
  windowDays: number,
  planConfirmed: boolean,
): { windowStart: string; windowEnd: string } {
  if (planConfirmed || (newDate >= visit.windowStart && newDate <= visit.windowEnd)) {
    return { windowStart: visit.windowStart, windowEnd: visit.windowEnd };
  }
  return { windowStart: newDate, windowEnd: addDays(newDate, Math.max(1, windowDays) - 1) };
}

/* ------------------------------------------------------------------ */
/* Clubbing (DEV-390)                                                  */
/* ------------------------------------------------------------------ */

/** Two windows overlap: the visits can share one trip. */
export function windowsOverlap(a: { windowStart: string; windowEnd: string }, b: { windowStart: string; windowEnd: string }): boolean {
  return a.windowStart <= b.windowEnd && b.windowStart <= a.windowEnd;
}

/**
 * The clubbed visit's window and target: where the windows meet, the
 * earlier target inside it. Null when they do not meet.
 */
export function clubbedWindow(
  visits: Array<{ windowStart: string; windowEnd: string; targetDate: string }>,
  calendar: WorkingCalendar,
): { windowStart: string; windowEnd: string; targetDate: string } | null {
  if (visits.length < 2) return null;
  const windowStart = visits.map((v) => v.windowStart).reduce(maxDate);
  const windowEnd = visits.map((v) => v.windowEnd).reduce(minDate);
  if (windowStart > windowEnd) return null;
  const earliest = visits.map((v) => v.targetDate).reduce(minDate);
  const targetDate = earliest >= windowStart && earliest <= windowEnd ? earliest : firstWorkingDay(windowStart, windowEnd, calendar);
  return { windowStart, windowEnd, targetDate };
}

/**
 * Visits of different service lines whose windows meet, grouped: what the
 * "club overlapping visits" action proposes. A group never takes two
 * visits of the same line.
 */
export function clubbingGroups<T extends { id: string; windowStart: string; windowEnd: string; lineIds: string[] }>(visits: T[]): T[][] {
  const sorted = [...visits].sort((a, b) => (a.windowStart < b.windowStart ? -1 : a.windowStart > b.windowStart ? 1 : 0));
  const groups: T[][] = [];
  const used = new Set<string>();
  for (const v of sorted) {
    if (used.has(v.id)) continue;
    const group = [v];
    const lines = new Set(v.lineIds);
    for (const w of sorted) {
      if (w.id === v.id || used.has(w.id) || w.lineIds.some((l) => lines.has(l))) continue;
      if (group.every((g) => windowsOverlap(g, w))) {
        group.push(w);
        w.lineIds.forEach((l) => lines.add(l));
      }
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g.id));
      groups.push(group);
    }
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Progress (the contract always shows it)                             */
/* ------------------------------------------------------------------ */

export interface PpmProgress {
  total: number;
  completed: number;
  remaining: number;
  overdue: number;
  cancelled: number;
  nextVisit: { id: string; targetDate: string } | null;
}

/** Completed, remaining and overdue (window passed and not done) over a contract's visits. */
export function ppmProgress(visits: Array<{ id: string; status: VisitStatus; windowEnd: string; targetDate: string }>, today: string): PpmProgress {
  let completed = 0;
  let remaining = 0;
  let overdue = 0;
  let cancelled = 0;
  let next: { id: string; targetDate: string } | null = null;
  for (const v of visits) {
    if (v.status === "cancelled") {
      cancelled += 1;
      continue;
    }
    if (DONE_STATUSES.includes(v.status)) {
      completed += 1;
      continue;
    }
    if (v.status === "not_completed") continue;
    remaining += 1;
    if (v.windowEnd < today && v.status !== "submitted" && v.status !== "in_progress") overdue += 1;
    if (v.targetDate >= today && (!next || v.targetDate < next.targetDate)) next = { id: v.id, targetDate: v.targetDate };
  }
  return { total: visits.length - cancelled, completed, remaining, overdue, cancelled, nextVisit: next };
}

/* ------------------------------------------------------------------ */
/* What the routes accept                                              */
/* ------------------------------------------------------------------ */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const uuid = z.string().uuid();
const reason = z.string().trim().min(3, "Say why").max(500);
const optionalReason = z.string().trim().max(500).optional().nullable().transform((v) => (v && v.length ? v : null));

export const ppmActionSchema = z.discriminatedUnion("action", [
  /* Make (or, before confirmation, make again) the tentative schedule. */
  z.object({ action: z.literal("generate"), replace: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("move"), visitId: uuid, date: isoDate, reason: optionalReason }).strict(),
  z.object({ action: z.literal("add"), entitlementId: uuid, date: isoDate, reason }).strict(),
  z.object({ action: z.literal("remove"), visitId: uuid, reason }).strict(),
  z.object({ action: z.literal("club"), visitIds: z.array(uuid).min(2).max(10) }).strict(),
  z.object({ action: z.literal("club_overlapping") }).strict(),
  z.object({ action: z.literal("separate"), lineId: uuid }).strict(),
  z.object({ action: z.literal("confirm") }).strict(),
  z
    .object({
      action: z.literal("rules"),
      windowDays: z.number().int().min(1).max(120).nullable(),
      attemptCount: z.number().int().min(1).max(10).nullable(),
      attemptIntervalDays: z.number().int().min(0).max(30).nullable(),
      attemptChannels: z.array(z.enum(["whatsapp", "call", "sms", "email"])).min(1).nullable(),
      escalationUserId: uuid.nullable(),
    })
    .strict(),
]);
export type PpmAction = z.infer<typeof ppmActionSchema>;
