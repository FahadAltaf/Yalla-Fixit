import { isFlaggedForInvoice, isWorkComplete } from "@/lib/finance/eligibility";
import { zonedDateString } from "@/lib/scheduling/org-time";

import { calendarDays } from "./quotations";

/**
 * The two exception reports (BRD 5.2 B5; DEV-453).
 *
 *  1. Completed without the invoice flag: work that is done (D-01) on a
 *     quotation with value that nobody has marked Ready to be Invoiced
 *     (D-02) and that is not already in the queue. Past the setting's days
 *     it is overdue and its coordinator is told (N13). Leakage protection
 *     for the queue.
 *  2. Completed appointments without actual times: they drop out of job
 *     hours, so utilization would be wrong. Shown with the data
 *     completeness % per technician and team that sits beside utilization.
 */

// ---------------------------------------------------------------------
// 1. Completed without the invoice flag
// ---------------------------------------------------------------------

export type ExceptionWorkOrder = {
  id: string;
  number: string | null;
  status: string | null;
  completedAt: string | null;
  estimateId: string | null;
  clientName: string | null;
};

export type ExceptionEstimate = {
  id: string;
  number: string | null;
  postToMaher: string | null;
  value: number;
  ownerName: string | null;
  ownerEmail: string | null;
};

export type UnflaggedRow = {
  workOrderId: string;
  workOrderNumber: string | null;
  quotationId: string;
  quotationNumber: string | null;
  clientName: string | null;
  coordinatorName: string | null;
  coordinatorEmail: string | null;
  value: number;
  completedAt: string | null;
  completedDate: string | null;
  /** Days since completion; null when FSM has no completion time. */
  daysSinceCompleted: number | null;
  overdue: boolean;
};

export function findUnflagged(input: {
  workOrders: ExceptionWorkOrder[];
  estimates: Map<string, ExceptionEstimate>;
  /** Work orders that already have a queue item, whatever its status. */
  queuedWorkOrderIds: Set<string>;
  today: string;
  afterDays: number;
  timeZone?: string;
}): UnflaggedRow[] {
  const rows: UnflaggedRow[] = [];
  for (const wo of input.workOrders) {
    if (!isWorkComplete(wo) || !wo.estimateId || input.queuedWorkOrderIds.has(wo.id)) continue;
    const estimate = input.estimates.get(wo.estimateId);
    /* No quotation, or nothing to charge: not an invoicing leak. */
    if (!estimate || !(estimate.value > 0) || isFlaggedForInvoice(estimate)) continue;
    const completedDate = wo.completedAt ? zonedDateString(wo.completedAt, input.timeZone) : null;
    const days = completedDate ? calendarDays(completedDate, input.today) : null;
    rows.push({
      workOrderId: wo.id,
      workOrderNumber: wo.number,
      quotationId: estimate.id,
      quotationNumber: estimate.number,
      clientName: wo.clientName,
      coordinatorName: estimate.ownerName,
      coordinatorEmail: estimate.ownerEmail,
      value: estimate.value,
      completedAt: wo.completedAt,
      completedDate,
      daysSinceCompleted: days,
      overdue: days !== null && days > input.afterDays,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (b.daysSinceCompleted ?? -1) - (a.daysSinceCompleted ?? -1) ||
      (a.workOrderNumber ?? "").localeCompare(b.workOrderNumber ?? ""),
  );
}

// ---------------------------------------------------------------------
// 2. Completed appointments without actual times
// ---------------------------------------------------------------------

export type ExceptionAppointment = {
  id: string;
  number: string | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  scheduledStart: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  /** The crew; an appointment counts once for each technician on it. */
  technicianIds: string[];
};

export type ExceptionTechnician = { fsmId: string; name: string; teamLeaderId: string | null };

export type MissingActualsRow = ExceptionAppointment & {
  missing: "start" | "end" | "both";
  technicianNames: string[];
  scheduledDate: string | null;
};

export type CompletenessRow = {
  key: string;
  name: string;
  completed: number;
  withActualTimes: number;
  /** withActualTimes ÷ completed; null when nothing was completed. */
  completenessPercent: number | null;
};

export function missingOf(a: { actualStart: string | null; actualEnd: string | null }): MissingActualsRow["missing"] | null {
  if (a.actualStart && a.actualEnd) return null;
  if (!a.actualStart && !a.actualEnd) return "both";
  return a.actualStart ? "end" : "start";
}

const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export function analyseActualTimes(input: {
  /** Completed appointments in the period. */
  appointments: ExceptionAppointment[];
  technicians: Map<string, ExceptionTechnician>;
  timeZone?: string;
}): {
  rows: MissingActualsRow[];
  overall: { completed: number; withActualTimes: number; completenessPercent: number | null };
  byTechnician: CompletenessRow[];
  byTeam: CompletenessRow[];
} {
  const rows: MissingActualsRow[] = [];
  const tech = new Map<string, CompletenessRow>();
  const team = new Map<string, CompletenessRow>();
  const nameOf = (id: string) => input.technicians.get(id)?.name ?? id;
  const bump = (map: Map<string, CompletenessRow>, key: string, name: string, complete: boolean) => {
    const row = map.get(key) ?? { key, name, completed: 0, withActualTimes: 0, completenessPercent: null };
    row.completed += 1;
    if (complete) row.withActualTimes += 1;
    map.set(key, row);
  };

  let withTimes = 0;
  for (const a of input.appointments) {
    const missing = missingOf(a);
    if (!missing) withTimes += 1;
    for (const id of a.technicianIds) {
      bump(tech, id, nameOf(id), !missing);
      /* D-20: a team is a team leader and the technicians who report to them. */
      const leader = input.technicians.get(id)?.teamLeaderId ?? null;
      bump(team, leader ?? "none", leader ? `${nameOf(leader)}'s team` : "No team", !missing);
    }
    if (missing) {
      rows.push({
        ...a,
        missing,
        technicianNames: a.technicianIds.map(nameOf),
        scheduledDate: a.scheduledStart ? zonedDateString(a.scheduledStart, input.timeZone) : null,
      });
    }
  }
  /* Least complete first: that is who to talk to. */
  const finish = (map: Map<string, CompletenessRow>) =>
    [...map.values()]
      .map((r) => ({ ...r, completenessPercent: percent(r.withActualTimes, r.completed) }))
      .sort((a, b) => (a.completenessPercent ?? 101) - (b.completenessPercent ?? 101) || a.name.localeCompare(b.name));

  return {
    rows: rows.sort((a, b) => (b.scheduledStart ?? "").localeCompare(a.scheduledStart ?? "")),
    overall: {
      completed: input.appointments.length,
      withActualTimes: withTimes,
      completenessPercent: percent(withTimes, input.appointments.length),
    },
    byTechnician: finish(tech),
    byTeam: finish(team),
  };
}
