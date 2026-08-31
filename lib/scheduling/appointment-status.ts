// Maps a Zoho FSM appointment status onto the four states the display
// screen colour-codes, per the client's spec:
//
//   Blue   - scheduled     (booked, not started)
//   Orange - in progress   (technician is on it now)
//   Green  - completed     (done)
//   Red    - delayed       (should have started by now, but hasn't)
//
// Cancelled is a fifth, neutral state: it isn't in the spec, but a cancelled
// job still sits in the day's plan and must not read as "scheduled" (blue)
// or alarm anyone (red).
//
// FSM's Status is a per-org editable picklist, so matching is done on a
// normalised string and anything unrecognised falls back to "scheduled"
// rather than throwing. Delay is derived, not read from FSM -- FSM has no
// "delayed" status; it means "start time has passed and work hasn't begun".

export type AppointmentState = "scheduled" | "in_progress" | "completed" | "delayed" | "cancelled";

function normalise(value?: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

// Substring matching, so "Job In Progress" or "In-Progress" both land right.
const COMPLETED = ["completed", "complete", "closed", "finished", "done"];
const IN_PROGRESS = ["in progress", "inprogress", "started", "on site", "working", "en route", "enroute"];
const CANCELLED = ["cancelled", "canceled", "void", "rejected"];

/**
 * Resolve an entry's display state.
 *
 * @param fsmStatus raw Status from FSM (null until reconcile has seen it)
 * @param startAt   scheduled start, ISO
 * @param now       injected so the caller controls "now" and renders are
 *                  deterministic between server and client
 */
export function resolveAppointmentState(
  fsmStatus: string | null | undefined,
  startAt: string,
  now: number = Date.now(),
): AppointmentState {
  const status = normalise(fsmStatus);

  if (CANCELLED.some((s) => status.includes(s))) return "cancelled";
  if (COMPLETED.some((s) => status.includes(s))) return "completed";
  if (IN_PROGRESS.some((s) => status.includes(s))) return "in_progress";

  // Not started. If its slot has already begun, it is running late -- this is
  // the one state FSM cannot tell us, so we work it out from the clock.
  const start = new Date(startAt).getTime();
  if (Number.isFinite(start) && start < now) return "delayed";

  return "scheduled";
}

export const APPOINTMENT_STATE_LABELS: Record<AppointmentState, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  delayed: "Delayed",
  cancelled: "Cancelled",
};

// Solid, high-contrast fills: this is read from across a room, not from a
// desk, so the bars carry the colour rather than a tint. Each pairs a bar
// style with a matching legend dot.
export const APPOINTMENT_STATE_STYLES: Record<
  AppointmentState,
  { bar: string; dot: string; text: string }
> = {
  scheduled: {
    bar: "bg-blue-600 text-white ring-blue-700/30",
    dot: "bg-blue-600",
    text: "text-blue-700 dark:text-blue-400",
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
  delayed: {
    bar: "bg-red-600 text-white ring-red-700/30",
    dot: "bg-red-600",
    text: "text-red-700 dark:text-red-400",
  },
  cancelled: {
    bar: "bg-slate-400 text-white ring-slate-500/30 line-through",
    dot: "bg-slate-400",
    text: "text-slate-600 dark:text-slate-400",
  },
};

// The order the legend and the counter row read in: the two that need
// attention first, then the rest.
export const APPOINTMENT_STATE_ORDER: AppointmentState[] = [
  "delayed",
  "in_progress",
  "scheduled",
  "completed",
  "cancelled",
];
