import { addDaysToDateString, formatZonedTime, zonedDateString } from "@/lib/scheduling/org-time";

import type { OpenAlert } from "./alerts-plan";

/**
 * Check-in alerts to coordinators (BRD 5.2 B3; 6.2 N5, N6), worked out
 * from today's roster, FSM Attendance and today's FSM appointments. Pure:
 * the runner (lib/server/reports/checkin-alerts.ts) reads, sends and
 * resolves.
 *
 *  N5  "{technician} has not checked in for the {shift} shift ({time}).
 *      Today: {appointments}". {delay} minutes after the shift start
 *      (Reporting Settings, 15), no shift check-in in FSM Attendance.
 *  N6  "{technician} has not checked in at {client}, {location}, due
 *      {time}." {delay} minutes after the scheduled start, the
 *      appointment not started in FSM (no actual start: FSM's appointment
 *      check-in sets it). One alert per appointment, naming its lead and
 *      the crew: a crew of 30 is one miss, not 30.
 *
 * Suppressed (BRD B3): a technician on leave, on a rest day, a public
 * holiday or after their leaving date; a cancelled appointment; anyone
 * taken off an appointment (the crew is read as it is now). A technician
 * with no rest day set is only alerted on a day they have appointments,
 * so their day off is never raised as a missed check-in.
 *
 * One alert per miss, never a stream: the dedupe key is the technician and
 * day (N5) or the appointment and its scheduled start (N6). An alert stops
 * showing when the check-in is recorded, the appointment is cancelled,
 * moved or reassigned, or the day is over; it stays in the notifications
 * table, so repeat patterns are reportable.
 */

export const CHECK_IN_ALERT_EVENTS = {
  shift: "reports.shift_check_in_missed",
  appointment: "reports.appointment_check_in_missed",
} as const;

export type CheckInAlertDay = {
  technicianFsmId: string;
  name: string;
  /** A working day, not on leave, not a rest day or holiday, before any leaving date. */
  working: boolean;
  /** The technician has a rest day set in Scheduling. */
  restDaySet: boolean;
  shift: "morning" | "night";
  /** The shift's start today (ISO), from Scheduling. */
  shiftStart: string | null;
};

export type CheckInAlertAppointment = {
  id: string;
  number: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  location: string | null;
  status: string | null;
  scheduledStart: string | null;
  actualStart: string | null;
  leadId: string | null;
  crew: string[];
};

export type PlannedCheckInAlert = {
  event: string;
  entityType: "technician_day" | "fsm_appointment";
  entityId: string;
  dedupeKey: string;
  title: string;
  body: string;
  link: string;
};

/* FSM statuses that mean the appointment has been started, finished or called off. */
const NOT_WAITING = new Set(["in progress", "completed", "cannot complete", "cancelled", "terminated"]);
/* A check-in this long before the shift start belongs to it (a night shift's 23:50 check-in). */
const EARLY_CHECK_IN_MS = 4 * 3_600_000;
const MINUTE = 60_000;

const keyDate = (dedupeKey: string) => /(\d{4}-\d{2}-\d{2})/.exec(dedupeKey)?.[1] ?? null;

export function planCheckInAlerts(input: {
  now: string;
  timeZone?: string;
  shiftDelayMinutes: number;
  appointmentDelayMinutes: number;
  days: CheckInAlertDay[];
  /** FSM Attendance check-ins (any day around today). */
  checkIns: Array<{ technicianFsmId: string; at: string }>;
  appointments: CheckInAlertAppointment[];
  open: OpenAlert[];
}): { send: PlannedCheckInAlert[]; resolve: OpenAlert[] } {
  const now = Date.parse(input.now);
  const today = zonedDateString(input.now, input.timeZone);
  const time = (iso: string | null) => (iso ? formatZonedTime(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, input.timeZone) : "—");
  const dayOf = new Map(input.days.map((d) => [d.technicianFsmId, d]));
  const nameOf = (id: string) => dayOf.get(id)?.name ?? id;

  /* Today's appointments still to run, by technician. */
  const todays = input.appointments.filter(
    (a) => a.scheduledStart && zonedDateString(a.scheduledStart, input.timeZone) === today && !NOT_WAITING.has((a.status ?? "").toLowerCase()),
  );
  const bookedToday = new Map<string, CheckInAlertAppointment[]>();
  for (const a of input.appointments) {
    if (!a.scheduledStart || zonedDateString(a.scheduledStart, input.timeZone) !== today) continue;
    if ((a.status ?? "").toLowerCase() === "cancelled") continue;
    for (const t of new Set(a.crew)) bookedToday.set(t, [...(bookedToday.get(t) ?? []), a]);
  }

  const missing = new Map<string, PlannedCheckInAlert>();

  /* N5: no shift check-in, the delay after the shift start passed. */
  for (const day of input.days) {
    if (!day.working || !day.shiftStart) continue;
    const start = Date.parse(day.shiftStart);
    if (now < start + input.shiftDelayMinutes * MINUTE) continue;
    if (zonedDateString(day.shiftStart, input.timeZone) !== today) continue;
    const booked = bookedToday.get(day.technicianFsmId) ?? [];
    if (!day.restDaySet && booked.length === 0) continue;
    const checkedIn = input.checkIns.some((c) => c.technicianFsmId === day.technicianFsmId && Date.parse(c.at) >= start - EARLY_CHECK_IN_MS);
    if (checkedIn) continue;
    const shiftName = day.shift === "night" ? "night" : "morning";
    const list = booked
      .sort((a, b) => (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""))
      .map((a) => `${a.number ?? "an appointment"} ${time(a.scheduledStart)}${a.clientName ? ` (${a.clientName})` : ""}`);
    const dedupeKey = `n5:${day.technicianFsmId}:${today}`;
    missing.set(dedupeKey, {
      event: CHECK_IN_ALERT_EVENTS.shift,
      entityType: "technician_day",
      entityId: `${day.technicianFsmId}:${today}`,
      dedupeKey,
      title: `${day.name}: no shift check-in`,
      body: `${day.name} has not checked in for the ${shiftName} shift (${time(day.shiftStart)}). Today: ${list.length ? list.join("; ") : "no appointments"}.`,
      link: `/reports/attendance?technician=${encodeURIComponent(day.technicianFsmId)}&from=${today}&to=${today}`,
    });
  }

  /* N6: an appointment not started, the delay after its scheduled start passed. */
  for (const a of todays) {
    if (a.actualStart) continue;
    const due = Date.parse(a.scheduledStart!);
    if (now < due + input.appointmentDelayMinutes * MINUTE) continue;
    /* Only people at work today: someone on leave or off shift is never raised (B3). */
    const crew = [...new Set(a.crew)].filter((t) => dayOf.get(t)?.working);
    if (!crew.length) continue;
    const lead = a.leadId && crew.includes(a.leadId) ? a.leadId : crew[0];
    const others = crew.length - 1;
    const who = `${nameOf(lead)}${others ? ` (+${others} on the crew)` : ""}`;
    const where = [a.clientName, a.location].filter(Boolean).join(", ") || "the client";
    const dedupeKey = `n6:${a.id}:${a.scheduledStart}`;
    missing.set(dedupeKey, {
      event: CHECK_IN_ALERT_EVENTS.appointment,
      entityType: "fsm_appointment",
      entityId: a.id,
      dedupeKey,
      title: `${a.number ?? "Appointment"}: no check-in`,
      body: `${who} has not checked in at ${where}, due ${time(a.scheduledStart)}${a.workOrderNumber ? ` (${a.workOrderNumber})` : ""}.`,
      link: "/scheduling",
    });
  }

  const openKeys = new Set(input.open.map((o) => o.dedupeKey));
  const yesterday = addDaysToDateString(today, -1);
  return {
    send: [...missing.values()].filter((a) => !openKeys.has(a.dedupeKey)),
    /* Over: checked in, started, cancelled, moved or reassigned; or a day already gone. */
    resolve: input.open.filter((o) => {
      if (!o.dedupeKey.startsWith("n5:") && !o.dedupeKey.startsWith("n6:")) return false;
      const date = keyDate(o.dedupeKey);
      if (date && date <= yesterday) return true;
      return !missing.has(o.dedupeKey);
    }),
  };
}
