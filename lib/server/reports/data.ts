import type { SupabaseClient } from "@supabase/supabase-js";

import type { AvailabilityInput, AvailabilityTechnician, LeaveInterval, ShiftTimes } from "@/lib/reports/available-hours";
import type { CapacityAppointment } from "@/lib/reports/capacity";
import type { RecordedCheckIn } from "@/lib/reports/compliance";
import type {
  ExceptionAppointment,
  ExceptionEstimate,
  ExceptionTechnician,
  ExceptionWorkOrder,
} from "@/lib/reports/exceptions";
import type { QuotationRecord } from "@/lib/reports/quotations";
import { chargeabilityOf, type UtilizationAppointment } from "@/lib/reports/utilization";
import { addDaysToDateString, todayInZone, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import {
  fetchPlannedCrewsLive,
  fetchQuotationFlagsLive,
  fetchWorkOrderLive,
  readModuleSince,
  type QuotationFlag,
} from "@/lib/server/finance/fsm-live";
import { lookupId, lookupName } from "@/lib/server/finance/fsm-sync/mappers";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * What the reports read (26 Oct: Zoho FSM live, read-only, no copy).
 *
 *  - Appointments, Time Sheets and Attendance: one list read each from the
 *    start date on (lib/server/finance/fsm-live.ts readModuleSince), shared
 *    by every report and kept ten minutes; a later start reuses it.
 *  - Who was on an appointment: its crew, from the appointment itself
 *    (fsm-live.ts fetchPlannedCrewsLive: read once and again only when it
 *    changes; Time Sheets hold one person per appointment, so they cannot
 *    say who was on it), with anyone who logged time on it and its lead.
 *  - Quotations: every one, once (shared with Ready to invoice).
 *  - Work orders: the list from four months before the dates, and any
 *    older one an appointment needs, read on its own (capped).
 *  - Shift check-ins: FSM Attendance (first check-in, last check-out).
 *    Appointment check-ins: Time Sheets (start and end per technician).
 *  - Technicians, shifts, leave and holidays: the portal's own tables.
 */

const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const isoFrom = (date: string, days = 0) => zonedTimeToUtc(addDaysToDateString(date, days)).toISOString();

// ---------------------------------------------------------------------
// Live reads, shared by the reports
// ---------------------------------------------------------------------

type LiveAppointment = {
  id: string;
  number: string | null;
  status: string | null;
  type: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  leadId: string | null;
  /** FSM's count of service people on it (No_of_SP__C). */
  crewSize: number | null;
  modifiedAt: string | null;
};

const APPOINTMENT_FIELDS = [
  "Name",
  "Status",
  "Type",
  "Scheduled_Start_Date_Time",
  "Scheduled_End_Date_Time",
  "Actual_Start_Date_Time",
  "Actual_End_Date_Time",
  "Work_Order",
  "Company",
  "Lead",
  "No_of_SP__C",
  "Modified_Time",
];

/** Appointments scheduled from a date on (later ones too, future included). */
async function liveAppointments(admin: SupabaseClient, fromIso: string): Promise<LiveAppointment[]> {
  const { rows } = await readModuleSince(admin, {
    module: "Service_Appointments",
    sortField: "Scheduled_Start_Date_Time",
    fields: APPOINTMENT_FIELDS,
    fromIso,
    resource: "appointments",
  });
  return rows.map((r) => ({
    id: String(r.id),
    number: str(r.Name),
    status: str(r.Status),
    type: str(r.Type),
    scheduledStart: str(r.Scheduled_Start_Date_Time),
    scheduledEnd: str(r.Scheduled_End_Date_Time),
    actualStart: str(r.Actual_Start_Date_Time),
    actualEnd: str(r.Actual_End_Date_Time),
    workOrderId: lookupId(r.Work_Order),
    workOrderNumber: lookupName(r.Work_Order),
    clientName: lookupName(r.Company),
    leadId: lookupId(r.Lead),
    crewSize: r.No_of_SP__C === null || r.No_of_SP__C === undefined ? null : Number(r.No_of_SP__C),
    modifiedAt: str(r.Modified_Time),
  }));
}

type TimeSheet = { technicianId: string; appointmentId: string; start: string | null; end: string | null };

/** Time logged per technician per appointment, from a date on. */
async function liveTimeSheets(admin: SupabaseClient, fromIso: string): Promise<TimeSheet[]> {
  const { rows } = await readModuleSince(admin, {
    module: "Time_Sheets",
    sortField: "Start_Date_Time",
    fields: ["Service_Resource", "Service_Appointment", "Start_Date_Time", "End_Date_Time"],
    fromIso,
    resource: "time_sheets",
  });
  return rows
    .map((r) => ({
      technicianId: lookupId(r.Service_Resource) ?? "",
      appointmentId: lookupId(r.Service_Appointment) ?? "",
      start: str(r.Start_Date_Time),
      end: str(r.End_Date_Time),
    }))
    .filter((t) => t.technicianId && t.appointmentId);
}

/* Crews read one by one per report view, at most (the rest count for whom else is known). */
const MAX_CREW_READS = 400;

/**
 * Who was on each appointment: its crew (read from the appointment when it
 * has more than one person), anyone who logged time on it, and its lead.
 * `unknown` counts appointments FSM says had more people than that.
 */
async function crewsOf(
  admin: SupabaseClient,
  appointments: LiveAppointment[],
  sheets: TimeSheet[],
): Promise<{ crews: Map<string, string[]>; unknown: number }> {
  const planned = await fetchPlannedCrewsLive(
    admin,
    appointments.filter((a) => (a.crewSize ?? 1) > 1).map((a) => ({ id: a.id, modifiedAt: a.modifiedAt })),
    MAX_CREW_READS,
  );
  const logged = new Map<string, Set<string>>();
  for (const t of sheets) logged.set(t.appointmentId, (logged.get(t.appointmentId) ?? new Set()).add(t.technicianId));
  const crews = new Map<string, string[]>();
  let unknown = 0;
  for (const a of appointments) {
    const people = new Set([...(planned.crews.get(a.id) ?? []), ...(logged.get(a.id) ?? [])]);
    if (a.leadId) people.add(a.leadId);
    crews.set(a.id, [...people]);
    if (a.crewSize !== null && a.crewSize > people.size) unknown += 1;
  }
  return { crews, unknown };
}

/** Quotations as Zoho FSM has them, by id and by their work order. */
async function liveQuotations(admin: SupabaseClient) {
  const { byId } = await fetchQuotationFlagsLive(admin);
  const byWorkOrder = new Map<string, QuotationFlag & { id: string }>();
  for (const [id, q] of byId) if (q.workOrderId) byWorkOrder.set(q.workOrderId, { ...q, id });
  return { byId, byWorkOrder };
}

type LiveWorkOrderValue = { id: string; number: string | null; subTotal: number | null; estimateId: string | null; clientName: string | null };

/* At most this many older work orders are read one by one for a report. */
const MAX_OLDER_WORK_ORDERS = 40;

/**
 * The work orders these appointments belong to: the list from four months
 * before; an older one is read on its own only when no quotation says what
 * it is worth (8 at a time, capped).
 */
async function workOrdersFor(
  admin: SupabaseClient,
  ids: string[],
  fromDate: string,
  hasQuotation: (id: string) => boolean,
): Promise<Map<string, LiveWorkOrderValue>> {
  const { rows } = await readModuleSince(admin, {
    module: "Work_Orders",
    sortField: "Created_Time",
    fields: ["Name", "Sub_Total", "Estimate", "Company", "Contact", "Status", "Completed_Time"],
    fromIso: isoFrom(fromDate, -120),
    resource: "work_orders",
  });
  const out = new Map<string, LiveWorkOrderValue>();
  for (const r of rows) {
    out.set(String(r.id), {
      id: String(r.id),
      number: str(r.Name),
      subTotal: r.Sub_Total === null || r.Sub_Total === undefined ? null : Number(r.Sub_Total),
      estimateId: lookupId(r.Estimate),
      clientName: lookupName(r.Company) ?? lookupName(r.Contact),
    });
  }
  const older = ids.filter((x) => !out.has(x) && !hasQuotation(x)).slice(0, MAX_OLDER_WORK_ORDERS);
  for (let i = 0; i < older.length; i += 8) {
    const read = await Promise.all(older.slice(i, i + 8).map((id) => fetchWorkOrderLive(admin, id).catch(() => null)));
    for (const live of read) {
      if (!live) continue;
      const w = live.workOrder;
      out.set(w.id, { id: w.id, number: w.number, subTotal: w.subTotal, estimateId: w.estimateId, clientName: w.companyName ?? w.contactName });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------

/* When a quotation entered its status, from the times FSM keeps; otherwise its last change (estimated). */
function statusSince(q: QuotationFlag): { at: string | null; estimated: boolean } {
  const status = (q.status ?? "").toLowerCase();
  if (status === "approved" && q.approvedAt) return { at: q.approvedAt, estimated: false };
  if (status === "rejected" && q.rejectedAt) return { at: q.rejectedAt, estimated: false };
  if (status === "expired" && q.expiredAt) return { at: q.expiredAt, estimated: false };
  if (status === "new" && q.createdAt) return { at: q.createdAt, estimated: false };
  return { at: q.modifiedAt ?? q.createdAt, estimated: true };
}

export async function loadQuotationRecords(admin: SupabaseClient): Promise<QuotationRecord[]> {
  const { byId } = await liveQuotations(admin);
  return [...byId].map(([id, q]) => {
    const since = statusSince(q);
    return {
      id,
      number: q.number,
      status: q.status,
      value: q.subTotal ?? 0,
      ownerName: q.ownerName,
      ownerEmail: q.ownerEmail,
      clientName: q.companyName ?? q.contactName,
      createdAt: q.createdAt,
      expiryDate: q.expiryDate,
      statusChangedAt: since.at,
      statusSinceEstimated: since.estimated,
      approvedAt: q.approvedAt,
      rejectedAt: q.rejectedAt,
      expiredAt: q.expiredAt,
    };
  });
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

/**
 * Work orders FSM changed from the date on (completing one changes it),
 * their quotations, and those Finance already has in hand: an invoice
 * recorded, or a query, hold or exclusion on Ready to invoice.
 */
export async function loadUnflaggedInputs(
  admin: SupabaseClient,
  range: { from: string } = { from: addDaysToDateString(todayInZone(), -29) },
): Promise<{
  workOrders: ExceptionWorkOrder[];
  estimates: Map<string, ExceptionEstimate>;
  queuedWorkOrderIds: Set<string>;
}> {
  const [{ rows }, { byId }] = await Promise.all([
    readModuleSince(admin, {
      module: "Work_Orders",
      sortField: "Modified_Time",
      fields: ["Name", "Status", "Completed_Time", "Estimate", "Company", "Contact"],
      fromIso: isoFrom(range.from),
      resource: "work_orders",
    }),
    liveQuotations(admin),
  ]);
  const workOrders = rows.map<ExceptionWorkOrder>((r) => ({
    id: String(r.id),
    number: str(r.Name),
    status: str(r.Status),
    completedAt: str(r.Completed_Time),
    estimateId: lookupId(r.Estimate),
    clientName: lookupName(r.Company) ?? lookupName(r.Contact),
  }));
  const estimates = new Map<string, ExceptionEstimate>(
    [...byId].map(([id, q]) => [
      id,
      { id, number: q.number, postToMaher: q.postToMaher, value: q.subTotal ?? 0, ownerName: q.ownerName, ownerEmail: q.ownerEmail },
    ]),
  );

  /* In Finance's hands already: invoiced in part or in full, or worked on in Ready to invoice. */
  const queued = new Set<string>();
  try {
    const [lines, flows] = await Promise.all([
      readAllRows<Record<string, unknown>>(
        (from, to) => admin.schema("finance").from("line_states").select("fsm_work_order_id, invoiced_amount").gt("invoiced_amount", 0).order("fsm_line_id").range(from, to),
        "invoiced lines",
      ),
      readAllRows<Record<string, unknown>>(
        (from, to) => admin.schema("finance").from("work_order_states").select("fsm_work_order_id, status").neq("status", "open").order("fsm_work_order_id").range(from, to),
        "work order workflow",
      ),
    ]);
    for (const r of [...lines, ...flows]) queued.add(String(r.fsm_work_order_id));
  } catch (error) {
    if (!/line_states|work_order_states|PGRST205|42P01|schema cache/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  return { workOrders, estimates, queuedWorkOrderIds: queued };
}

/** Completed appointments scheduled to start within the dates, with who was on them. */
export async function loadCompletedAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<ExceptionAppointment[]> {
  const startIso = isoFrom(range.from);
  const endIso = isoFrom(range.to, 1);
  const [appointments, sheets] = await Promise.all([liveAppointments(admin, startIso), liveTimeSheets(admin, startIso)]);
  const inRange = appointments.filter((a) => a.status === "Completed" && a.scheduledStart && a.scheduledStart >= startIso && a.scheduledStart < endIso);
  const { crews } = await crewsOf(admin, inRange, sheets);
  return inRange.map((a) => ({
    id: a.id,
    number: a.number,
    workOrderId: a.workOrderId,
    workOrderNumber: a.workOrderNumber,
    clientName: a.clientName,
    scheduledStart: a.scheduledStart,
    actualStart: a.actualStart,
    actualEnd: a.actualEnd,
    technicianIds: crews.get(a.id) ?? [],
  }));
}

// ---------------------------------------------------------------------
// Utilization (DEV-444)
// ---------------------------------------------------------------------

/**
 * Completed and Cannot Complete appointments that started in the dates
 * (actual start, or scheduled start when there is none), with who worked
 * them and whether each is chargeable (D-08: the quotation's total, else
 * the work order's). A week before is read so work started late counts.
 */
export async function loadUtilizationAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ appointments: UtilizationAppointment[]; crewsUnknown: number }> {
  const startIso = isoFrom(range.from, -1);
  const endIso = isoFrom(range.to, 2);
  const [all, sheets, quotations] = await Promise.all([
    liveAppointments(admin, isoFrom(range.from, -7)),
    liveTimeSheets(admin, isoFrom(range.from, -7)),
    liveQuotations(admin),
    /* The work-order list is read alongside, ready for workOrdersFor below. */
    workOrdersFor(admin, [], range.from, () => true),
  ]);
  const rows = all.filter((a) => {
    if (a.status !== "Completed" && a.status !== "Cannot Complete") return false;
    const at = a.actualStart ?? a.scheduledStart;
    return Boolean(at && at >= startIso && at < endIso);
  });
  const { crews, unknown } = await crewsOf(admin, rows, sheets);
  const wos = await workOrdersFor(
    admin,
    [...new Set(rows.map((a) => a.workOrderId).filter((v): v is string => Boolean(v)))],
    range.from,
    (id) => quotations.byWorkOrder.has(id),
  );

  const appointments = rows.map<UtilizationAppointment>((a) => {
    const wo = a.workOrderId ? wos.get(a.workOrderId) : undefined;
    const quotation = (wo?.estimateId ? quotations.byId.get(wo.estimateId) : undefined) ?? (a.workOrderId ? quotations.byWorkOrder.get(a.workOrderId) : undefined);
    return {
      id: a.id,
      number: a.number,
      workOrderId: a.workOrderId,
      workOrderNumber: a.workOrderNumber ?? wo?.number ?? null,
      clientName: a.clientName ?? wo?.clientName ?? null,
      status: a.status,
      type: a.type,
      scheduledStart: a.scheduledStart,
      scheduledEnd: a.scheduledEnd,
      actualStart: a.actualStart,
      actualEnd: a.actualEnd,
      technicianIds: crews.get(a.id) ?? [],
      chargeability: chargeabilityOf({
        quotationTotal: quotation ? (quotation.subTotal ?? 0) : null,
        workOrderTotal: wo?.subTotal ?? null,
      }),
    };
  });
  return { appointments, crewsUnknown: unknown };
}

/**
 * Travel logged in FSM Trips that started in the dates, per technician.
 * Technicians rarely log trips (20 in all on 26 Oct), so this is what FSM
 * holds, not all the travel there was.
 */
export async function loadTravel(admin: SupabaseClient, range: { from: string; to: string }): Promise<Map<string, { trips: number; minutes: number }>> {
  const { rows } = await readModuleSince(admin, {
    module: "Trips",
    sortField: "Start_Time",
    fields: ["Service_Resource", "Start_Time", "End_Time"],
    fromIso: isoFrom(range.from),
    resource: "trips",
  });
  const endIso = isoFrom(range.to, 1);
  const out = new Map<string, { trips: number; minutes: number }>();
  for (const r of rows) {
    const who = lookupId(r.Service_Resource);
    const start = str(r.Start_Time);
    const end = str(r.End_Time);
    if (!who || !start || start >= endIso) continue;
    const minutes = end && Date.parse(end) > Date.parse(start) ? (Date.parse(end) - Date.parse(start)) / 60_000 : 0;
    const entry = out.get(who) ?? { trips: 0, minutes: 0 };
    entry.trips += 1;
    entry.minutes += minutes;
    out.set(who, entry);
  }
  return out;
}

// ---------------------------------------------------------------------
// Capacity (DEV-452)
// ---------------------------------------------------------------------

/* Planned crews read one by one per Capacity view, at most. */
const MAX_PLANNED_CREWS = 150;

/** Appointments scheduled to overlap the dates, cancelled ones included (the calculation drops them), with their planned crews. */
export async function loadCapacityAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ appointments: CapacityAppointment[]; crewsUnknown: number }> {
  const startIso = isoFrom(range.from);
  const endIso = isoFrom(range.to, 1);
  const all = await liveAppointments(admin, isoFrom(range.from, -2));
  const rows = all.filter((a) => a.scheduledStart && a.scheduledEnd && a.scheduledStart < endIso && a.scheduledEnd > startIso);
  /* One person: the lead. More: who is booked, from the appointment itself. */
  const crewed = rows.filter((a) => (a.crewSize ?? 1) > 1).map((a) => ({ id: a.id, modifiedAt: a.modifiedAt }));
  const planned = await fetchPlannedCrewsLive(admin, crewed, MAX_PLANNED_CREWS);
  const appointments = rows.map<CapacityAppointment>((a) => ({
    id: a.id,
    number: a.number,
    workOrderNumber: a.workOrderNumber,
    clientName: a.clientName,
    status: a.status,
    scheduledStart: a.scheduledStart,
    scheduledEnd: a.scheduledEnd,
    technicianIds: planned.crews.get(a.id) ?? (a.leadId ? [a.leadId] : []),
  }));
  return { appointments, crewsUnknown: planned.unread };
}

// ---------------------------------------------------------------------
// Compliance and attendance (P7)
// ---------------------------------------------------------------------

export type ComplianceAppointmentRow = CapacityAppointment & { actualStart: string | null; actualEnd: string | null };

/** Every appointment scheduled in the dates, any status (the calculation drops cancelled ones), with who was on it and its actual times. */
export async function loadComplianceAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ appointments: ComplianceAppointmentRow[]; crewsUnknown: number }> {
  const startIso = isoFrom(range.from);
  const endIso = isoFrom(range.to, 1);
  const [all, sheets] = await Promise.all([liveAppointments(admin, startIso), liveTimeSheets(admin, startIso)]);
  const rows = all.filter((a) => a.scheduledStart && a.scheduledStart >= startIso && a.scheduledStart < endIso);
  const { crews, unknown } = await crewsOf(admin, rows, sheets);
  return {
    appointments: rows.map((a) => ({
      id: a.id,
      number: a.number,
      workOrderNumber: a.workOrderNumber,
      clientName: a.clientName,
      status: a.status,
      scheduledStart: a.scheduledStart,
      scheduledEnd: a.scheduledEnd,
      actualStart: a.actualStart,
      actualEnd: a.actualEnd,
      technicianIds: crews.get(a.id) ?? [],
    })),
    crewsUnknown: unknown,
  };
}

/** Shift check-ins and check-outs (FSM Attendance: first check-in, last check-out of each day), around the dates. */
export async function loadShiftCheckIns(admin: SupabaseClient, range: { from: string; to: string }): Promise<RecordedCheckIn[]> {
  const { rows } = await readModuleSince(admin, {
    module: "Attendance",
    sortField: "First_Check_In",
    fields: ["Service_Resource", "Date", "First_Check_In", "Last_Check_Out", "Status", "Working_Duration"],
    fromIso: isoFrom(range.from, -1),
    resource: "attendance",
  });
  const endIso = isoFrom(range.to, 2);
  const out: RecordedCheckIn[] = [];
  for (const r of rows) {
    const technicianFsmId = lookupId(r.Service_Resource);
    const checkIn = str(r.First_Check_In);
    if (!technicianFsmId || !checkIn || checkIn >= endIso) continue;
    out.push({ technicianFsmId, kind: "shift_check_in", at: checkIn });
    const checkOut = str(r.Last_Check_Out);
    if (checkOut) out.push({ technicianFsmId, kind: "shift_check_out", at: checkOut });
  }
  return out;
}

/**
 * Appointment check-ins and check-outs, in the dates: a technician's own
 * time sheet on the appointment when there is one (FSM Time Sheets);
 * otherwise the appointment's actual start and end, for everyone on it,
 * as FSM records one per appointment (D-15, provisional).
 */
export async function loadAppointmentCheckIns(
  admin: SupabaseClient,
  range: { from: string; to: string },
  appointments: ComplianceAppointmentRow[],
): Promise<RecordedCheckIn[]> {
  const sheets = await liveTimeSheets(admin, isoFrom(range.from, -1));
  const endIso = isoFrom(range.to, 2);
  const out: RecordedCheckIn[] = [];
  const own = new Set<string>();
  for (const t of sheets) {
    if (!t.start || t.start >= endIso) continue;
    own.add(`${t.technicianId}|${t.appointmentId}`);
    out.push({ technicianFsmId: t.technicianId, kind: "appointment_check_in", at: t.start, appointmentId: t.appointmentId });
    if (t.end) out.push({ technicianFsmId: t.technicianId, kind: "appointment_check_out", at: t.end, appointmentId: t.appointmentId });
  }
  for (const a of appointments) {
    for (const tech of new Set(a.technicianIds)) {
      if (own.has(`${tech}|${a.id}`)) continue;
      if (a.actualStart) out.push({ technicianFsmId: tech, kind: "appointment_check_in", at: a.actualStart, appointmentId: a.id });
      if (a.actualEnd) out.push({ technicianFsmId: tech, kind: "appointment_check_out", at: a.actualEnd, appointmentId: a.id });
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Available hours inputs (DEV-443; used by utilization and capacity)
// ---------------------------------------------------------------------

export async function loadAvailabilityInput(
  admin: SupabaseClient,
  input: { from: string; to: string; technicians: AvailabilityTechnician[]; unpaidBreakMinutes: number },
): Promise<AvailabilityInput> {
  /* Leave overlapping the range, with a day either side for night shifts. */
  const startIso = zonedTimeToUtc(addDaysToDateString(input.from, -1)).toISOString();
  const endIso = zonedTimeToUtc(addDaysToDateString(input.to, 2)).toISOString();
  const [{ data: config, error }, { data: holidayRows, error: holidayError }, leaveRows] = await Promise.all([
    admin.from("settings").select("day_shift_start, day_shift_end, night_shift_start, night_shift_end").eq("id", 1).single(),
    admin.from("org_public_holidays").select("holiday_date").gte("holiday_date", input.from).lte("holiday_date", input.to),
    readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("leave_records")
          .select("id, technician_fsm_id, start_at, end_at, leave_category, leave_type")
          .eq("status", "active")
          .lt("start_at", endIso)
          .gt("end_at", startIso)
          .order("id")
          .range(from, to),
      "leave",
    ),
  ]);
  if (error) throw new Error(`shift settings: ${error.message}`);
  if (holidayError) throw new Error(`public holidays: ${holidayError.message}`);
  const shiftTimes: ShiftTimes = {
    dayStart: String(config.day_shift_start),
    dayEnd: String(config.day_shift_end),
    nightStart: String(config.night_shift_start),
    nightEnd: String(config.night_shift_end),
  };

  const wanted = new Set(input.technicians.map((t) => t.fsmId));
  const leave: LeaveInterval[] = leaveRows
    .filter((r) => wanted.has(String(r.technician_fsm_id)))
    .map((r) => ({
      technicianFsmId: String(r.technician_fsm_id),
      startAt: String(r.start_at),
      endAt: String(r.end_at),
      category: str(r.leave_category) ?? str(r.leave_type),
    }));

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
