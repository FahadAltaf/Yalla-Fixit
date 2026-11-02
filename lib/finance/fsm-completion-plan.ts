/**
 * What to complete in Zoho FSM when Operations marks work complete in the
 * portal (the user's direction, 2 Nov). Pure: lib/server/finance/
 * fsm-completion.ts reads FSM, asks this, and writes what it says.
 *
 * FSM completes service lines through their appointments, and a work order
 * through its own Complete or its last appointment. Completing an
 * appointment through FSM stamps its actual end with the moment of the
 * sync, and starting one stamps its actual start: those times feed job
 * hours and utilization. So an appointment is completed here only when a
 * technician has already started it (In Progress), and only when every line
 * on it is complete in the portal. One not started is left for the
 * technician or the office to complete in FSM, and said so.
 */

export type FsmAppointmentLink = {
  appointmentId: string;
  appointmentName: string | null;
  lineId: string | null;
  /** The line's status on that appointment (SLI_Status): Scheduled, Dispatched, In Progress, Completed, Cancelled... */
  status: string | null;
  active: boolean;
};

export type CompletionPlan = {
  /** Already done in FSM: nothing to write. */
  alreadyComplete: boolean;
  /** Appointments to complete, with whether completing it should complete the work order. */
  complete: Array<{ appointmentId: string; appointmentName: string | null; completesWorkOrder: boolean }>;
  /** Appointments left as they are, and why, in words. */
  skipped: Array<{ appointmentName: string; reason: string }>;
  /** After the appointments: the work order's own Complete (the whole work order was marked complete). */
  completeWorkOrder: boolean;
};

const DONE = /completed|closed/i;
const STARTED = /in progress/i;
const ENDED = /cancel|cannot complete|completed|closed/i;

export function planFsmCompletion(input: {
  workOrderStatus: string | null;
  links: FsmAppointmentLink[];
  /** Lines complete in the portal now (100 %), after this change. */
  completeLines: Set<string>;
  /** The lines this change marked complete. */
  changedLines: string[];
  /** The whole work order was marked complete. */
  wholeWorkOrder: boolean;
}): CompletionPlan {
  const plan: CompletionPlan = { alreadyComplete: false, complete: [], skipped: [], completeWorkOrder: false };
  if (DONE.test(input.workOrderStatus ?? "")) return { ...plan, alreadyComplete: true };

  const byAppointment = new Map<string, FsmAppointmentLink[]>();
  for (const l of input.links) {
    if (!l.active || ENDED.test(l.status ?? "")) continue;
    byAppointment.set(l.appointmentId, [...(byAppointment.get(l.appointmentId) ?? []), l]);
  }
  const changed = new Set(input.changedLines);
  const touched = [...byAppointment].filter(([, ls]) => input.wholeWorkOrder || ls.some((l) => l.lineId && changed.has(l.lineId)));

  for (const [appointmentId, ls] of touched) {
    const name = ls[0].appointmentName ?? appointmentId;
    const open = ls.filter((l) => !l.lineId || !input.completeLines.has(l.lineId));
    if (!input.wholeWorkOrder && open.length) {
      plan.skipped.push({ appointmentName: name, reason: `it also covers ${open.length === 1 ? "a line" : `${open.length} lines`} not complete in the portal yet` });
      continue;
    }
    if (!ls.some((l) => STARTED.test(l.status ?? ""))) {
      plan.skipped.push({
        appointmentName: name,
        reason: `it is ${ls[0].status ?? "not started"} in FSM: completing it from here would record made-up work times, so the technician or the office completes it in FSM`,
      });
      continue;
    }
    plan.complete.push({ appointmentId, appointmentName: ls[0].appointmentName, completesWorkOrder: false });
  }
  if (input.wholeWorkOrder) {
    /* The last appointment completes the work order with it, when nothing else is left open on it. */
    if (plan.complete.length && !plan.skipped.length) plan.complete[plan.complete.length - 1].completesWorkOrder = true;
    plan.completeWorkOrder = true;
  }
  return plan;
}
