// Maps a Zoho FSM appointment status onto the states the boards colour-code.
//
// Decision (18 Sep 2026, product owner): the boards MIRROR FSM's own status
// picklist rather than collapsing it into the FRD's four buckets. That also
// drops the clock-derived "Delayed" state: it depended on technicians pressing
// Start Work in FSM, and read every Dispatched job as late the moment its slot
// began. What FSM says is what the board shows.
//
// FSM's Service Appointment statuses (help.zoho.com, Service Appointments):
//   New -> Scheduled -> Dispatched -> In Progress -> Completed
//   plus Cannot Complete (via Terminate) and Cancelled.
//
// FSM's Status is a per-org editable picklist, so matching is done on a
// normalised string, and anything unrecognised is shown as "Unknown" with the
// raw value alongside it rather than guessed.

export type AppointmentState =
  | "new"
  | "scheduled"
  | "dispatched"
  | "in_progress"
  | "completed"
  | "cannot_complete"
  | "cancelled"
  | "unknown";

function normalise(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

// Order matters: "cannot complete" contains "complete" and "unscheduled"
// contains "scheduled", so the more specific tests run first.
export function resolveAppointmentState(fsmStatus: string | null | undefined): AppointmentState {
  const status = normalise(fsmStatus);
  if (!status) return "unknown";
  if (/cancel|void|rejected/.test(status)) return "cancelled";
  if (/cannot complete|can.?t complete|unable to complete|terminated/.test(status)) return "cannot_complete";
  if (/complet|closed|finished|done/.test(status)) return "completed";
  if (/in progress|inprogress|started|on site|working/.test(status)) return "in_progress";
  if (/dispatch|en route|enroute|on the way/.test(status)) return "dispatched";
  if (/^new$|unscheduled|yet to be|pending/.test(status)) return "new";
  if (/schedul/.test(status)) return "scheduled";
  return "unknown";
}

export const APPOINTMENT_STATE_LABELS: Record<AppointmentState, string> = {
  new: "New",
  scheduled: "Scheduled",
  dispatched: "Dispatched",
  in_progress: "In progress",
  completed: "Completed",
  cannot_complete: "Cannot complete",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

// Solid, high-contrast fills: the display board is read from across a room,
// so the bars carry the colour rather than a tint. Each pairs a bar style
// with a matching legend dot and a text colour for counters.
export const APPOINTMENT_STATE_STYLES: Record<AppointmentState, { bar: string; dot: string; text: string }> = {
  new: {
    bar: "bg-slate-500 text-white ring-slate-600/30",
    dot: "bg-slate-500",
    text: "text-slate-600 dark:text-slate-300",
  },
  scheduled: {
    bar: "bg-blue-600 text-white ring-blue-700/30",
    dot: "bg-blue-600",
    text: "text-blue-700 dark:text-blue-400",
  },
  dispatched: {
    bar: "bg-violet-600 text-white ring-violet-700/30",
    dot: "bg-violet-600",
    text: "text-violet-700 dark:text-violet-400",
  },
  in_progress: {
    bar: "bg-orange-500 text-white ring-orange-600/30",
    dot: "bg-orange-500",
    text: "text-orange-700 dark:text-orange-400",
  },
  completed: {
    bar: "bg-emerald-600 text-white ring-emerald-700/30",
    dot: "bg-emerald-600",
    text: "text-emerald-700 dark:text-emerald-400",
  },
  cannot_complete: {
    bar: "bg-red-600 text-white ring-red-700/30",
    dot: "bg-red-600",
    text: "text-red-700 dark:text-red-400",
  },
  cancelled: {
    bar: "bg-slate-400 text-white ring-slate-500/30 line-through",
    dot: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-400",
  },
  unknown: {
    bar: "bg-zinc-400 text-white ring-zinc-500/30",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-400",
  },
};

// The order legends and counters read in: the one that needs attention
// first, then the work in flight, then the rest.
export const APPOINTMENT_STATE_ORDER: AppointmentState[] = [
  "cannot_complete",
  "in_progress",
  "dispatched",
  "scheduled",
  "new",
  "completed",
  "cancelled",
  "unknown",
];

// States a legend always lists, even when none are on the board; the others
// appear only when something is actually in that state.
export const HEADLINE_STATES: ReadonlySet<AppointmentState> = new Set<AppointmentState>([
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
]);
