import { z } from "zod";

import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

/**
 * Moving entries on the Scheduling board (DEV-393, 25 Nov 2026): one or
 * several entries to another day, a new crew for them, or both in one
 * action.
 *
 * An ordinary entry keeps its clock time on the new day (a night job at
 * 01:00 stays at 01:00 of the night it belongs to) and remembers the day it
 * was first planned for. AMC work moves through AMC's own rules: a PPM visit
 * inside its service window is not a reschedule, outside it needs a reason
 * and keeps its original date; the crew checks and the access lead time
 * apply as they do in AMC.
 */

/** As far ahead as a copy may go (FR-15): the days the team plans. */
export const MOVE_MAX_DAYS_AHEAD = 14;
export const MOVE_MAX_ENTRIES = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const moveEntriesSchema = z
  .object({
    entryIds: z.array(z.string().uuid()).min(1, "Select at least one entry").max(MOVE_MAX_ENTRIES, `Move up to ${MOVE_MAX_ENTRIES} entries at a time`),
    /* The day they move to; left out: they stay on their day. */
    toDate: isoDate.optional().nullable(),
    /* The crew they get; left out: each keeps its own. */
    technicianFsmIds: z.array(z.string().trim().min(1).max(40)).min(1, "Choose at least one technician").max(10).optional().nullable(),
    /* Asked by AMC: a PPM visit leaving its service window, or a crew other than the suggested one. */
    reason: z.string().trim().max(500).optional().nullable(),
    /* AMC work booked inside the property's access lead time on purpose (DEV-493). */
    insideLeadTime: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Boolean(d.toDate) || Boolean(d.technicianFsmIds?.length), { message: "Choose a day or a crew", path: ["toDate"] });
export type MoveEntriesInput = z.infer<typeof moveEntriesSchema>;

export interface MoveEntryResult {
  entryId: string;
  label: string;
  status: "moved" | "skipped";
  /** Why it was skipped (a day in the past, someone on leave, an AMC rule). */
  reason?: string;
  /** AMC work: which AMC record it went through. */
  amc?: boolean;
}

/** Why a day cannot take moved entries, or null. */
export function moveDayProblem(toDate: string, today: string): string | null {
  if (toDate < today) return "The day is in the past.";
  if (toDate > addDaysToDateString(today, MOVE_MAX_DAYS_AHEAD)) return `Entries can be moved up to ${MOVE_MAX_DAYS_AHEAD} days ahead.`;
  return null;
}

/**
 * The same slot on another day: the start keeps its offset from midnight of
 * the day the entry is listed on (so a night job after midnight stays after
 * midnight), and the length is unchanged.
 */
export function slotOnDay(
  slot: { startAt: string; endAt: string; operatingDate: string },
  toDate: string,
  timeZone: string,
): { startAt: string; endAt: string } {
  const fromMidnight = zonedTimeToUtc(slot.operatingDate, "00:00:00", timeZone).getTime();
  const toMidnight = zonedTimeToUtc(toDate, "00:00:00", timeZone).getTime();
  const start = toMidnight + (Date.parse(slot.startAt) - fromMidnight);
  const length = Date.parse(slot.endAt) - Date.parse(slot.startAt);
  return { startAt: new Date(start).toISOString(), endAt: new Date(start + length).toISOString() };
}

/** The day an entry was first planned for, when it has been moved since. */
export function movedFrom(entry: { operating_date: string; original_operating_date?: string | null }): string | null {
  const first = entry.original_operating_date ?? null;
  return first && first !== entry.operating_date ? first : null;
}

/** One line for the toast: what moved and what did not. */
export function moveSummary(results: readonly MoveEntryResult[]): string {
  const moved = results.filter((r) => r.status === "moved").length;
  const skipped = results.length - moved;
  const n = (k: number) => `${k} entr${k === 1 ? "y" : "ies"}`;
  if (!skipped) return `${n(moved)} changed`;
  if (!moved) return `Nothing changed: ${n(skipped)} could not be changed`;
  return `${n(moved)} changed, ${n(skipped)} not`;
}
