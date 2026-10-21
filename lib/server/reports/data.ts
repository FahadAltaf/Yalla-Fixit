import type { SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilityInput, AvailabilityTechnician, LeaveInterval, ShiftTimes } from "@/lib/reports/available-hours";
import type {
  ExceptionAppointment,
  ExceptionEstimate,
  ExceptionTechnician,
  ExceptionWorkOrder,
} from "@/lib/reports/exceptions";
import type { QuotationRecord } from "@/lib/reports/quotations";
import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { readAllByIds, readAllRows } from "@/lib/server/snagging/read-all";

/**
 * What the reports read, from the FSM copy (`fsm`), the queue (`finance`)
 * and the portal's own tables. Every read is paged, so no list is cut at
 * the API's 1,000 rows. Volumes are small (about a thousand quotations,
 * a few thousand work orders and appointments), so the calculation runs in
 * TypeScript on the full set (performance-and-scalability-plan.md).
 */

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------

export async function loadQuotationRecords(admin: SupabaseClient): Promise<QuotationRecord[]> {
  const rows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .schema("fsm")
        .from("estimates")
        .select(
          "fsm_estimate_id, number, status, sub_total, owner_name, owner_email, company_name, created_in_fsm_at, expiry_date, status_changed_at, status_since_estimated, approved_at, rejected_at, expired_at",
        )
        .order("fsm_estimate_id")
        .range(from, to),
    "quotations",
  );
  return rows.map((r) => ({
    id: String(r.fsm_estimate_id),
    number: str(r.number),
    status: str(r.status),
    value: num(r.sub_total),
    ownerName: str(r.owner_name),
    ownerEmail: str(r.owner_email),
    clientName: str(r.company_name),
    createdAt: str(r.created_in_fsm_at),
    expiryDate: str(r.expiry_date),
    statusChangedAt: str(r.status_changed_at),
    statusSinceEstimated: r.status_since_estimated === true,
    approvedAt: str(r.approved_at),
    rejectedAt: str(r.rejected_at),
    expiredAt: str(r.expired_at),
  }));
}

// ---------------------------------------------------------------------
// Technicians (the roster the reports group by)
// ---------------------------------------------------------------------

export type ReportTechnician = ExceptionTechnician &
  AvailabilityTechnician & { isActive: boolean; employmentStatus: string | null; email: string | null };

/**
 * Every technician, active or not (history keeps leavers), except accounts
 * hidden from lists: those are test and development accounts (DEV-458).
 */
export async function loadTechnicians(admin: SupabaseClient): Promise<Map<string, ReportTechnician>> {
  const rows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .from("technician_reference")
        .select(
          "fsm_resource_id, display_name, is_active, shift, team_leader_fsm_id, rest_weekdays, leaving_date, employment_status, email, hidden_from_lists",
        )
        .order("fsm_resource_id")
        .range(from, to),
    "technicians",
  );
  const out = new Map<string, ReportTechnician>();
  for (const r of rows) {
    if (r.hidden_from_lists === true) continue;
    const fsmId = String(r.fsm_resource_id);
    out.set(fsmId, {
      fsmId,
      name: String(r.display_name ?? fsmId),
      teamLeaderId: str(r.team_leader_fsm_id),
      shift: r.shift === "night" ? "night" : r.shift === "morning" ? "morning" : null,
      restWeekdays: Array.isArray(r.rest_weekdays) ? (r.rest_weekdays as unknown[]).map(Number) : [],
      leavingDate: str(r.leaving_date),
      isActive: r.is_active !== false,
      employmentStatus: str(r.employment_status),
      email: str(r.email),
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------

const COMPLETED_WORK_ORDER = "status.in.(Completed,Closed),completed_at.not.is.null";

export async function loadUnflaggedInputs(admin: SupabaseClient): Promise<{
  workOrders: ExceptionWorkOrder[];
  estimates: Map<string, ExceptionEstimate>;
  queuedWorkOrderIds: Set<string>;
}> {
  const woRows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .schema("fsm")
        .from("work_orders")
        .select("fsm_work_order_id, number, status, completed_at, fsm_estimate_id, company_name")
        .or(COMPLETED_WORK_ORDER)
        .order("fsm_work_order_id")
        .range(from, to),
    "completed work orders",
  );
  const workOrders = woRows.map<ExceptionWorkOrder>((r) => ({
    id: String(r.fsm_work_order_id),
    number: str(r.number),
    status: str(r.status),
    completedAt: str(r.completed_at),
    estimateId: str(r.fsm_estimate_id),
    clientName: str(r.company_name),
  }));

  const estimateRows = await readAllByIds<Record<string, unknown>>(
    workOrders.map((w) => w.estimateId).filter((id): id is string => Boolean(id)),
    (chunk, from, to) =>
      admin
        .schema("fsm")
        .from("estimates")
        .select("fsm_estimate_id, number, post_to_maher, sub_total, owner_name, owner_email")
        .in("fsm_estimate_id", chunk)
        .order("fsm_estimate_id")
        .range(from, to),
    "their quotations",
  );
  const estimates = new Map<string, ExceptionEstimate>(
    estimateRows.map((r) => [
      String(r.fsm_estimate_id),
      {
        id: String(r.fsm_estimate_id),
        number: str(r.number),
        postToMaher: str(r.post_to_maher),
        value: num(r.sub_total),
        ownerName: str(r.owner_name),
        ownerEmail: str(r.owner_email),
      },
    ]),
  );

  const queued = await readAllByIds<Record<string, unknown>>(
    workOrders.map((w) => w.id),
    (chunk, from, to) =>
      admin
        .schema("finance")
        .from("queue_items")
        .select("id, fsm_work_order_id")
        .in("fsm_work_order_id", chunk)
        .order("id")
        .range(from, to),
    "queue items",
  );
  return { workOrders, estimates, queuedWorkOrderIds: new Set(queued.map((r) => String(r.fsm_work_order_id))) };
}

/** Completed appointments scheduled to start within the dates, with their crews. */
export async function loadCompletedAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<ExceptionAppointment[]> {
  const startIso = zonedTimeToUtc(range.from).toISOString();
  const endIso = zonedTimeToUtc(addDaysToDateString(range.to, 1)).toISOString();
  const rows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .schema("fsm")
        .from("appointments")
        .select("fsm_appointment_id, number, fsm_work_order_id, scheduled_start, actual_start, actual_end, lead_technician_fsm_id")
        .eq("status", "Completed")
        .gte("scheduled_start", startIso)
        .lt("scheduled_start", endIso)
        .order("fsm_appointment_id")
        .range(from, to),
    "completed appointments",
  );
  const ids = rows.map((r) => String(r.fsm_appointment_id));
  const crewRows = await readAllByIds<Record<string, unknown>>(
    ids,
    (chunk, from, to) =>
      admin
        .schema("fsm")
        .from("appointment_resources")
        .select("fsm_appointment_id, technician_fsm_id")
        .in("fsm_appointment_id", chunk)
        .order("fsm_appointment_id")
        .order("technician_fsm_id")
        .range(from, to),
    "crews",
  );
  const crews = new Map<string, string[]>();
  for (const c of crewRows) {
    const list = crews.get(String(c.fsm_appointment_id)) ?? [];
    list.push(String(c.technician_fsm_id));
    crews.set(String(c.fsm_appointment_id), list);
  }
  const woIds = [...new Set(rows.map((r) => str(r.fsm_work_order_id)).filter((id): id is string => Boolean(id)))];
  const woRows = await readAllByIds<Record<string, unknown>>(
    woIds,
    (chunk, from, to) =>
      admin
        .schema("fsm")
        .from("work_orders")
        .select("fsm_work_order_id, number, company_name")
        .in("fsm_work_order_id", chunk)
        .order("fsm_work_order_id")
        .range(from, to),
    "their work orders",
  );
  const wos = new Map(woRows.map((r) => [String(r.fsm_work_order_id), r]));

  return rows.map((r) => {
    const id = String(r.fsm_appointment_id);
    const wo = wos.get(String(r.fsm_work_order_id));
    /* A crew not read yet falls back to the lead technician. */
    const crew = crews.get(id) ?? (r.lead_technician_fsm_id ? [String(r.lead_technician_fsm_id)] : []);
    return {
      id,
      number: str(r.number),
      workOrderId: str(r.fsm_work_order_id),
      workOrderNumber: wo ? str(wo.number) : null,
      clientName: wo ? str(wo.company_name) : null,
      scheduledStart: str(r.scheduled_start),
      actualStart: str(r.actual_start),
      actualEnd: str(r.actual_end),
      technicianIds: crew,
    };
  });
}

// ---------------------------------------------------------------------
// Available hours inputs (DEV-443; used by utilization and capacity)
// ---------------------------------------------------------------------

export async function loadAvailabilityInput(
  admin: SupabaseClient,
  input: { from: string; to: string; technicians: AvailabilityTechnician[]; unpaidBreakMinutes: number },
): Promise<AvailabilityInput> {
  const { data: config, error } = await admin
    .from("settings")
    .select("day_shift_start, day_shift_end, night_shift_start, night_shift_end")
    .eq("id", 1)
    .single();
  if (error) throw new Error(`shift settings: ${error.message}`);
  const shiftTimes: ShiftTimes = {
    dayStart: String(config.day_shift_start),
    dayEnd: String(config.day_shift_end),
    nightStart: String(config.night_shift_start),
    nightEnd: String(config.night_shift_end),
  };

  const { data: holidayRows, error: holidayError } = await admin
    .from("org_public_holidays")
    .select("holiday_date")
    .gte("holiday_date", input.from)
    .lte("holiday_date", input.to);
  if (holidayError) throw new Error(`public holidays: ${holidayError.message}`);

  /* Leave overlapping the range, with a day either side for night shifts. */
  const startIso = zonedTimeToUtc(addDaysToDateString(input.from, -1)).toISOString();
  const endIso = zonedTimeToUtc(addDaysToDateString(input.to, 2)).toISOString();
  const leaveRows = await readAllRows<Record<string, unknown>>(
    (from, to) =>
      admin
        .from("leave_records")
        .select("id, technician_fsm_id, start_at, end_at")
        .eq("status", "active")
        .lt("start_at", endIso)
        .gt("end_at", startIso)
        .order("id")
        .range(from, to),
    "leave",
  );
  const wanted = new Set(input.technicians.map((t) => t.fsmId));
  const leave: LeaveInterval[] = leaveRows
    .filter((r) => wanted.has(String(r.technician_fsm_id)))
    .map((r) => ({ technicianFsmId: String(r.technician_fsm_id), startAt: String(r.start_at), endAt: String(r.end_at) }));

  return {
    technicians: input.technicians,
    from: input.from,
    to: input.to,
    shiftTimes,
    holidays: (holidayRows ?? []).map((h) => String(h.holiday_date)),
    leave,
    unpaidBreakMinutes: input.unpaidBreakMinutes,
  };
}
