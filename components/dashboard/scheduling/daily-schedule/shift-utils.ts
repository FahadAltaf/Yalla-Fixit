import type { SchedulingConfig, ShiftType } from "@/modules/scheduling";
import { formatTimeAmPm } from "@/components/ui/time-select";
import { DAY_MINUTES, configuredWindows, homeShift } from "@/lib/scheduling/board-layout";

// FSM Service Appointment Type picklist (per YFI + FSM). "-None-" is the
// unset value; the team must choose a real type before saving.
export const APPOINTMENT_TYPES = [
  "-None-",
  "Service",
  "Inspection",
  "Installation",
  "Maintenance",
  "Emergency",
  "Scheduled Maintenance",
  "Standard",
] as const;

export type ScheduleTypeValue = "Time-bound" | "All Day";

// A deep link to a record in the Zoho FSM web app, if the base URL is
// configured via NEXT_PUBLIC_FSM_APP_URL. Two ways to set it:
//
//   1. A template containing {id} (and optionally {module}) — use this to
//      paste the EXACT URL shape your FSM tenant uses. Examples:
//        https://fsm.zoho.com/org123/index.do#Service_Appointments/{id}
//        https://fsm.zoho.com/org123/ui/#/{module}/{id}/detail
//   2. A plain base with no placeholders — the record is appended as
//      "<base>#<module>/<id>".
//
// Returns null (renders as plain text, no link) when unset or the id is null.
export function fsmRecordUrl(module: "Work_Orders" | "Service_Appointments", id: string | null | undefined) {
  const base = process.env.NEXT_PUBLIC_FSM_APP_URL;
  if (!base || !id) return null;
  const encodedId = encodeURIComponent(id);
  if (base.includes("{id}")) {
    return base.replace(/\{module\}/g, module).replace(/\{id\}/g, encodedId);
  }
  return `${base.replace(/\/+$/, "")}#${module}/${encodedId}`;
}

export function hhmmToMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function shiftBoundsFor(shift: ShiftType, config: SchedulingConfig) {
  return shift === "night"
    ? { start: hhmmToMinutes(config.night_shift_start), end: hhmmToMinutes(config.night_shift_end) }
    : { start: hhmmToMinutes(config.day_shift_start), end: hhmmToMinutes(config.day_shift_end) };
}

export function shiftWindowLabel(shift: ShiftType, config: SchedulingConfig) {
  const { start, end } = shiftBoundsFor(shift, config);
  const toHhmm = (m: number) =>
    `${String(Math.floor((m >= 1440 ? 1439 : m) / 60)).padStart(2, "0")}:${String((m >= 1440 ? 1439 : m) % 60).padStart(2, "0")}`;
  return `${formatTimeAmPm(toHhmm(start))}–${formatTimeAmPm(toHhmm(end))}`;
}

// The grid a job with these clock times is shown in: the shift that covers
// most of it (the board's rule, lib/scheduling/board-layout.ts). An end at or
// before the start is read as ending the next day.
export function resolveHomeShift(startTime: string, endTime: string, config: SchedulingConfig): ShiftType {
  const startMin = hhmmToMinutes(startTime);
  let endMin = hhmmToMinutes(endTime);
  if (endMin <= startMin) endMin += DAY_MINUTES;
  return homeShift({ startMin, endMin }, configuredWindows(config));
}

// Whether any of the job lies outside both shifts' usual hours. Not an error:
// the grid stretches to show it. Worth saying, so it is never a surprise.
export function reachesOutsideUsualHours(startTime: string, endTime: string, config: SchedulingConfig): boolean {
  const startMin = hhmmToMinutes(startTime);
  let endMin = hhmmToMinutes(endTime);
  if (endMin <= startMin) endMin += DAY_MINUTES;
  const windows = configuredWindows(config);
  const from = Math.min(windows.day.start, windows.night.start);
  const to = Math.max(windows.day.end, windows.night.end);
  const gapFrom = Math.min(windows.day.end, windows.night.end);
  const gapTo = Math.max(windows.day.start, windows.night.start);
  if (startMin < from || endMin > to) return true;
  // A gap between the two windows, if the configuration has one.
  return gapTo > gapFrom && startMin < gapTo && endMin > gapFrom;
}

// Which shift a start time belongs to. The configured windows currently
// overlap (night 00:00–09:00, morning 08:00–17:00), so 08:00–09:00 matches
// both — the morning shift wins because that is when the day crew starts.
// Returns null when a time falls in neither window (e.g. after 17:00 with
// the current configuration), which the UI surfaces rather than hides.
export function resolveShift(startTime: string, config: SchedulingConfig): ShiftType | null {
  const minutes = hhmmToMinutes(startTime);
  const day = shiftBoundsFor("day", config);
  const night = shiftBoundsFor("night", config);
  if (minutes >= day.start && minutes < day.end) return "day";
  if (minutes >= night.start && minutes < night.end) return "night";
  return null;
}
