import { addDaysToDateString, zonedDateString } from "@/lib/scheduling/org-time";

import type { TechnicianAvailability } from "./available-hours";

/**
 * App usage compliance and penalties (BRD 5.2 B4; DEV-447, 448, 450).
 *
 *  - Required: on each eligible day a shift check-in and check-out, and a
 *    check-in and check-out for every appointment the technician is on
 *    that is not cancelled. A shift with three appointments needs eight.
 *  - Not eligible: off-shift days, holidays, rest days, days from the
 *    leaving date (all from the available-hours engine), and a day the
 *    technician is on leave for the whole shift. Part-day leave keeps the
 *    day's events required (assumption, D-11).
 *  - Performed: recorded at all; a late check-in counts.
 *  - Waived: a miss with a waiver leaves both required and performed. A
 *    waiver on an event that was performed changes nothing.
 *  - Penalty: compliance below the threshold (compared unrounded: TC13's
 *    96.98 % is below 97 %), misses x rate, capped per month. With no
 *    threshold set (D-09) no penalty is worked out at all.
 *
 * Check-ins come from FSM once its token can read them (B-01); until then
 * the caller has none to pass. Cancelled appointments are taken as
 * cancelled before start: the FSM copy has no cancellation time.
 * "Reassigned before start" is the current crew: a technician taken off
 * an appointment is no longer on it.
 *
 * Pure: no database, no clock.
 */

export type ComplianceEventKind = "shift_check_in" | "shift_check_out" | "appointment_check_in" | "appointment_check_out";

export const EVENT_KIND_LABELS: Record<ComplianceEventKind, string> = {
  shift_check_in: "Shift check-in",
  shift_check_out: "Shift check-out",
  appointment_check_in: "Appointment check-in",
  appointment_check_out: "Appointment check-out",
};

/** BRD B4's waiver reasons. */
export const WAIVER_REASONS = [
  "App outage",
  "No network",
  "Device failure",
  "Client not present",
  "Job cancelled on site",
  "Emergency reassignment",
] as const;

export type ComplianceAppointment = {
  id: string;
  number: string | null;
  status: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianIds: string[];
};

export type RecordedCheckIn = {
  technicianFsmId: string;
  kind: ComplianceEventKind;
  at: string;
  /** For the appointment kinds. */
  appointmentId?: string | null;
};

export type Waiver = {
  eventKey: string;
  reason: string;
  waivedBy: string;
  waivedAt: string;
  /** Set when one action waived it for everyone (a confirmed outage). */
  batchId?: string | null;
};

export type RequiredEvent = {
  key: string;
  technicianFsmId: string;
  kind: ComplianceEventKind;
  date: string;
  /** When it was due: shift start or end, appointment start or end. */
  dueAt: string | null;
  appointmentId: string | null;
  appointmentNumber: string | null;
};

export type EventOutcome = RequiredEvent & {
  state: "performed" | "missed" | "waived";
  recordedAt: string | null;
  waiver: Waiver | null;
};

export type ComplianceSettings = {
  thresholdPercent: number | null;
  penaltyPerMissAed: number;
  monthlyCapAed: number;
};

export type TechnicianCompliance = {
  technicianFsmId: string;
  /** After waivers. */
  required: number;
  performed: number;
  missed: number;
  waived: number;
  /** Unrounded; null when nothing was required. */
  compliancePercent: number | null;
  /** null when no threshold is set (D-09). */
  belowThreshold: boolean | null;
  /** null when no threshold is set. */
  penaltyBeforeCapAed: number | null;
  penaltyPayableAed: number | null;
  /** The settings the figures were worked out with, kept on a statement. */
  settings: ComplianceSettings;
  events: EventOutcome[];
};

export function eventKey(technicianFsmId: string, kind: ComplianceEventKind, ref: string) {
  return `${technicianFsmId}|${kind}|${ref}`;
}

const SHIFT_KINDS: ComplianceEventKind[] = ["shift_check_in", "shift_check_out"];
const isShiftKind = (kind: ComplianceEventKind) => SHIFT_KINDS.includes(kind);
export const isCancelled = (a: { status: string | null }) => (a.status ?? "").toLowerCase() === "cancelled";

/** Whether a day counts: a working day not wholly on leave. */
function eligibleDays(tech: TechnicianAvailability) {
  const days = new Map<string, { start: string | null; end: string | null }>();
  for (const day of tech.days) {
    if (day.status !== "working") continue;
    const shiftMinutes = day.windowMinutes - day.breakMinutes;
    if (shiftMinutes > 0 && day.leaveMinutes >= shiftMinutes) continue;
    days.set(day.date, { start: day.windowStart, end: day.windowEnd });
  }
  return days;
}

/** Every event each technician owed in the period, in date order. */
export function requiredEvents(input: {
  availability: TechnicianAvailability[];
  appointments: ComplianceAppointment[];
  timeZone?: string;
}): RequiredEvent[] {
  const out: RequiredEvent[] = [];
  const eligible = new Map(input.availability.map((t) => [t.fsmId, eligibleDays(t)]));
  for (const [tech, days] of eligible) {
    for (const [date, window] of days) {
      out.push(
        { key: eventKey(tech, "shift_check_in", date), technicianFsmId: tech, kind: "shift_check_in", date, dueAt: window.start, appointmentId: null, appointmentNumber: null },
        { key: eventKey(tech, "shift_check_out", date), technicianFsmId: tech, kind: "shift_check_out", date, dueAt: window.end, appointmentId: null, appointmentNumber: null },
      );
    }
  }
  for (const a of input.appointments) {
    if (isCancelled(a) || !a.scheduledStart) continue;
    const date = zonedDateString(a.scheduledStart, input.timeZone);
    for (const tech of new Set(a.technicianIds)) {
      if (!eligible.get(tech)?.has(date)) continue;
      for (const kind of ["appointment_check_in", "appointment_check_out"] as const) {
        out.push({
          key: eventKey(tech, kind, a.id),
          technicianFsmId: tech,
          kind,
          date,
          dueAt: kind === "appointment_check_in" ? a.scheduledStart : (a.scheduledEnd ?? a.scheduledStart),
          appointmentId: a.id,
          appointmentNumber: a.number,
        });
      }
    }
  }
  return out.sort((x, y) => (x.date === y.date ? (x.dueAt ?? "").localeCompare(y.dueAt ?? "") : x.date.localeCompare(y.date)));
}

export type ShiftWindow = { date: string; start: string | null; end: string | null };

const NEAR_SHIFT_MS = 4 * 3_600_000;

/**
 * The shift day a shift check-in or check-out belongs to: the day whose
 * shift window (give or take four hours) holds it, so a night shift's
 * 06:00 check-out counts for the evening it started. Otherwise its
 * calendar date.
 */
export function shiftDateFor(windows: ShiftWindow[], at: string, timeZone?: string): string {
  const t = Date.parse(at);
  let best: { date: string; distance: number } | null = null;
  for (const w of windows) {
    if (!w.start || !w.end) continue;
    const start = Date.parse(w.start);
    const end = Date.parse(w.end);
    if (t < start - NEAR_SHIFT_MS || t > end + NEAR_SHIFT_MS) continue;
    const distance = t < start ? start - t : t > end ? t - end : 0;
    if (!best || distance < best.distance) best = { date: w.date, distance };
  }
  return best?.date ?? zonedDateString(at, timeZone);
}

/** The recorded check-in each required event matches: shift kinds by shift day, appointment kinds by appointment. */
function recordedIndex(recorded: RecordedCheckIn[], windows: Map<string, ShiftWindow[]>, timeZone?: string) {
  const index = new Map<string, string>();
  for (const r of recorded) {
    const ref = isShiftKind(r.kind) ? shiftDateFor(windows.get(r.technicianFsmId) ?? [], r.at, timeZone) : r.appointmentId;
    if (!ref) continue;
    const key = eventKey(r.technicianFsmId, r.kind, ref);
    const earlier = index.get(key);
    // The first check-in of the day counts; the last check-out.
    const keep = !earlier || (r.kind.endsWith("check_out") ? r.at > earlier : r.at < earlier);
    if (keep) index.set(key, r.at);
  }
  return index;
}

export function penaltyFor(
  counts: { required: number; performed: number; missed: number },
  settings: ComplianceSettings,
): { belowThreshold: boolean | null; beforeCap: number | null; payable: number | null } {
  if (settings.thresholdPercent === null) return { belowThreshold: null, beforeCap: null, payable: null };
  // Unrounded, and in whole numbers so 193/200 is exactly 96.5 %.
  const below = counts.required > 0 && counts.performed * 100 < settings.thresholdPercent * counts.required;
  const beforeCap = below ? counts.missed * settings.penaltyPerMissAed : 0;
  return { belowThreshold: below, beforeCap, payable: Math.min(beforeCap, settings.monthlyCapAed) };
}

export function computeCompliance(input: {
  required: RequiredEvent[];
  recorded: RecordedCheckIn[];
  waivers: Waiver[];
  settings: ComplianceSettings;
  timeZone?: string;
}): TechnicianCompliance[] {
  const dueByKey = new Map(input.required.map((e) => [e.key, e.dueAt]));
  const windows = new Map<string, ShiftWindow[]>();
  for (const e of input.required) {
    if (e.kind !== "shift_check_in") continue;
    const end = dueByKey.get(eventKey(e.technicianFsmId, "shift_check_out", e.date)) ?? null;
    const list = windows.get(e.technicianFsmId) ?? [];
    list.push({ date: e.date, start: e.dueAt, end });
    windows.set(e.technicianFsmId, list);
  }
  const recorded = recordedIndex(input.recorded, windows, input.timeZone);
  const waivers = new Map(input.waivers.map((w) => [w.eventKey, w]));
  const byTech = new Map<string, EventOutcome[]>();
  for (const event of input.required) {
    const at = recorded.get(event.key) ?? null;
    const waiver = at ? null : (waivers.get(event.key) ?? null);
    const outcome: EventOutcome = { ...event, state: at ? "performed" : waiver ? "waived" : "missed", recordedAt: at, waiver };
    const list = byTech.get(event.technicianFsmId) ?? [];
    list.push(outcome);
    byTech.set(event.technicianFsmId, list);
  }

  return [...byTech].map(([technicianFsmId, events]) => {
    const performed = events.filter((e) => e.state === "performed").length;
    const missed = events.filter((e) => e.state === "missed").length;
    const waived = events.filter((e) => e.state === "waived").length;
    const required = performed + missed;
    const penalty = penaltyFor({ required, performed, missed }, input.settings);
    return {
      technicianFsmId,
      required,
      performed,
      missed,
      waived,
      compliancePercent: required ? (performed / required) * 100 : null,
      belowThreshold: penalty.belowThreshold,
      penaltyBeforeCapAed: penalty.beforeCap,
      penaltyPayableAed: penalty.payable,
      settings: input.settings,
      events,
    };
  });
}

/**
 * A confirmed outage, waived for everyone in one action: the misses due
 * inside the window, of the kinds chosen (all kinds when none are).
 */
export function missesInOutage(
  compliance: TechnicianCompliance[],
  outage: { from: string; to: string; kinds?: ComplianceEventKind[] },
): EventOutcome[] {
  const from = Date.parse(outage.from);
  const to = Date.parse(outage.to);
  return compliance
    .flatMap((t) => t.events)
    .filter((e) => {
      if (e.state !== "missed" || !e.dueAt) return false;
      if (outage.kinds?.length && !outage.kinds.includes(e.kind)) return false;
      const due = Date.parse(e.dueAt);
      return due >= from && due <= to;
    });
}

/** "YYYY-MM": its first and last day. */
export function monthRange(month: string): { from: string; to: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Not a month: ${month}`);
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to: addDaysToDateString(next, -1) };
}

/**
 * Where a month stands. While it runs the technician sees the running
 * figure; after it ends the statement goes out and disputes stay open
 * until the cut-off day of the following month (default the 25th, before
 * payroll), that day included; after it the month is final and its
 * statement is never recalculated (TC14: a dispute on the 26th is refused).
 */
export function complianceMonthPhase(
  month: string,
  today: string,
  cutoffDay: number,
): { phase: "running" | "disputes_open" | "final"; cutoffDate: string; disputesAllowed: boolean } {
  const { to } = monthRange(month);
  const following = addDaysToDateString(to, 1).slice(0, 7);
  const cutoffDate = `${following}-${String(cutoffDay).padStart(2, "0")}`;
  const phase = today <= to ? "running" : today <= cutoffDate ? "disputes_open" : "final";
  return { phase, cutoffDate, disputesAllowed: phase !== "final" };
}
