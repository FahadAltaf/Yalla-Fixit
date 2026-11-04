import type { SupabaseClient } from "@supabase/supabase-js";

import type { AttributeHistory, AvailabilityInput, AvailabilityTechnician, HistoryField, LeaveInterval, ShiftTimes } from "@/lib/reports/available-hours";
import type { CapacityAppointment } from "@/lib/reports/capacity";
import type { RecordedCheckIn } from "@/lib/reports/compliance";
import type {
  ExceptionAppointment,
  ExceptionEstimate,
  ExceptionTechnician,
  ExceptionWorkOrder,
} from "@/lib/reports/exceptions";
import type { QuotationRecord } from "@/lib/reports/quotations";
import type { RevenueCrew, RevenueRating, RevenueWorkOrder } from "@/lib/reports/revenue";
import { chargeabilityOf, isContractWork, type TechnicianWork, type UtilizationAppointment } from "@/lib/reports/utilization";
import { addDaysToDateString, todayInZone, zonedDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import {
  fetchPlannedCrewsLive,
  fetchQuotationFlagsLive,
  fetchTechniciansLive,
  fetchTimeOffLive,
  fetchWorkOrderLive,
  type QuotationFlag,
  readModuleSince,
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
/* `refresh`: read FSM now, not the ten-minute copy (the check-in alerts need what is true this minute). */
type Fresh = { refresh?: boolean };

async function liveAppointments(admin: SupabaseClient, fromIso: string, options: Fresh = {}): Promise<LiveAppointment[]> {
  const { rows } = await readModuleSince(
    admin,
    {
      module: "Service_Appointments",
      sortField: "Scheduled_Start_Date_Time",
      fields: APPOINTMENT_FIELDS,
      fromIso,
      resource: "appointments",
    },
    options,
  );
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
async function liveTimeSheets(admin: SupabaseClient, fromIso: string, options: Fresh = {}): Promise<TimeSheet[]> {
  const { rows } = await readModuleSince(admin, {
    module: "Time_Sheets",
    sortField: "Start_Date_Time",
    fields: ["Service_Resource", "Service_Appointment", "Start_Date_Time", "End_Date_Time"],
    fromIso,
    resource: "time_sheets",
  }, options);
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

type LiveWorkOrderValue = {
  id: string;
  number: string | null;
  subTotal: number | null;
  estimateId: string | null;
  clientName: string | null;
  /** AMC work (29 Oct): FSM's Work Type and AMC contract reference. */
  workType: string | null;
  amcContractRef: string | null;
};

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
    fields: ["Name", "Sub_Total", "Estimate", "Company", "Contact", "Status", "Completed_Time", "Work_Type__C", "AMC_Contract_Ref__C"],
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
      workType: str(r.Work_Type__C),
      amcContractRef: lookupName(r.AMC_Contract_Ref__C) ?? str(r.AMC_Contract_Ref__C),
    });
  }
  const older = ids.filter((x) => !out.has(x) && !hasQuotation(x)).slice(0, MAX_OLDER_WORK_ORDERS);
  for (let i = 0; i < older.length; i += 8) {
    const read = await Promise.all(older.slice(i, i + 8).map((id) => fetchWorkOrderLive(admin, id).catch(() => null)));
    for (const live of read) {
      if (!live) continue;
      const w = live.workOrder;
      out.set(w.id, {
        id: w.id,
        number: w.number,
        subTotal: w.subTotal,
        estimateId: w.estimateId,
        clientName: w.companyName ?? w.contactName,
        workType: w.workType,
        amcContractRef: null,
      });
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
      /* With VAT (3 Nov): FSM's grand total; the before-VAT total only when FSM gives none. */
      value: q.grandTotal ?? q.subTotal ?? 0,
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
  AvailabilityTechnician & {
    isActive: boolean;
    employmentStatus: string | null;
    email: string | null;
    /** Their portal account (technician_reference.user_profile_id), for their own compliance (N9, N11). */
    userProfileId: string | null;
  };

/* Until migration 20261028100000 is applied there is no daily_hours column: everyone has the standard day.
   service_type: the Service Type in Scheduling; a Data Center technician's day is 12 hours (29 Oct). */
async function technicianRows(admin: SupabaseClient): Promise<Record<string, unknown>[]> {
  /* 2 Nov: weekly_hours and off_days_per_week arrive with 20261102100000. */
  try {
    return await readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("technician_reference")
          .select(
            "fsm_resource_id, display_name, is_active, shift, team_leader_fsm_id, rest_weekdays, leaving_date, employment_status, email, user_profile_id, hidden_from_lists, daily_hours, weekly_hours, off_days_per_week, service_type:lookup_options!technician_reference_service_type_id_fkey(name)",
          )
          .order("fsm_resource_id")
          .range(from, to),
      "technicians",
    );
  } catch (error) {
    if (!/weekly_hours|off_days_per_week/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
  try {
    return await readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("technician_reference")
          .select(
            "fsm_resource_id, display_name, is_active, shift, team_leader_fsm_id, rest_weekdays, leaving_date, employment_status, email, user_profile_id, hidden_from_lists, daily_hours, service_type:lookup_options!technician_reference_service_type_id_fkey(name)",
          )
          .order("fsm_resource_id")
          .range(from, to),
      "technicians",
    );
  } catch (error) {
    if (!/daily_hours/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("technician_reference")
          .select(
            "fsm_resource_id, display_name, is_active, shift, team_leader_fsm_id, rest_weekdays, leaving_date, employment_status, email, user_profile_id, hidden_from_lists, service_type:lookup_options!technician_reference_service_type_id_fkey(name)",
          )
          .order("fsm_resource_id")
          .range(from, to),
      "technicians",
    );
  }
}

/**
 * The dated changes of each technician's shift, team leader, rest days and
 * daily hours (Sami, 28 Oct: past reports keep the assignments of the
 * time). Empty until migration 20261028100000 is applied.
 */
export async function loadAttributeHistory(admin: SupabaseClient): Promise<Map<string, AttributeHistory>> {
  const out = new Map<string, AttributeHistory>();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("technician_attribute_history")
          .select("fsm_resource_id, field, value, effective_date, recorded_at")
          .order("fsm_resource_id")
          .order("effective_date")
          .order("recorded_at")
          .range(from, to),
      "technician history",
    );
  } catch (error) {
    if (!/technician_attribute_history|PGRST205|42P01|schema cache/i.test(error instanceof Error ? error.message : String(error))) throw error;
    return out;
  }
  for (const r of rows) {
    const id = String(r.fsm_resource_id);
    const field = String(r.field) as HistoryField;
    const history = out.get(id) ?? {};
    (history[field] ??= []).push({ from: String(r.effective_date), value: r.value });
    out.set(id, history);
  }
  return out;
}

/**
 * The technicians (28 Oct): live from Zoho FSM, as the scheduling sync picks
 * them (active users with a technician profile and a service resource). What
 * FSM does not hold comes from the portal's record of each: the team leader,
 * shift, rest days, leaving date and employment status. A technician no
 * longer in FSM is kept from the portal's record, inactive, so the work they
 * did in the dates still counts (history keeps leavers). Accounts hidden from
 * lists (test and development, DEV-458) are left out.
 */
function serviceTypeOf(r: Record<string, unknown> | undefined): string | null {
  const s = r?.service_type as { name?: unknown } | Array<{ name?: unknown }> | null | undefined;
  return str(Array.isArray(s) ? s[0]?.name : s?.name);
}

export async function loadTechnicians(admin: SupabaseClient): Promise<Map<string, ReportTechnician>> {
  const [live, rows, history] = await Promise.all([fetchTechniciansLive(admin), technicianRows(admin), loadAttributeHistory(admin)]);
  const portalOf = new Map(rows.map((r) => [String(r.fsm_resource_id), r]));
  const extras = (r: Record<string, unknown> | undefined) => ({
    dailyHours: r?.daily_hours === null || r?.daily_hours === undefined ? null : Number(r.daily_hours),
    weeklyHours: r?.weekly_hours === null || r?.weekly_hours === undefined ? null : Number(r.weekly_hours),
    offDaysPerWeek: r?.off_days_per_week === null || r?.off_days_per_week === undefined ? null : Number(r.off_days_per_week),
    serviceType: serviceTypeOf(r),
    history: r ? history.get(String(r.fsm_resource_id)) : undefined,
    teamLeaderId: str(r?.team_leader_fsm_id),
    shift: (r?.shift === "night" ? "night" : r?.shift === "morning" ? "morning" : null) as ReportTechnician["shift"],
    restWeekdays: Array.isArray(r?.rest_weekdays) ? (r.rest_weekdays as unknown[]).map(Number) : [],
    leavingDate: str(r?.leaving_date),
    employmentStatus: str(r?.employment_status),
    userProfileId: str(r?.user_profile_id),
  });
  const out = new Map<string, ReportTechnician>();
  /* From FSM: who is a technician now, their name, email and whether active. */
  for (const t of live) {
    const portal = portalOf.get(t.fsmResourceId);
    if (portal?.hidden_from_lists === true) continue;
    out.set(t.fsmResourceId, { fsmId: t.fsmResourceId, name: t.displayName, isActive: t.isActive, email: t.email, ...extras(portal) });
  }
  /* No longer in FSM: kept from the portal's record, inactive, for the work they did. */
  for (const r of rows) {
    const fsmId = String(r.fsm_resource_id);
    if (out.has(fsmId) || r.hidden_from_lists === true) continue;
    out.set(fsmId, { fsmId, name: String(r.display_name ?? fsmId), isActive: false, email: str(r.email), ...extras(r) });
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
  const [all, sheets, quotations, checkIns] = await Promise.all([
    liveAppointments(admin, isoFrom(range.from, -7)),
    liveTimeSheets(admin, isoFrom(range.from, -7)),
    liveQuotations(admin),
    /* Each technician's own day (FSM Attendance), for their own hours on a crew's job. */
    /* Not caught (29 Oct): a failed read must not look like nobody checked in. */
    loadShiftCheckIns(admin, { from: addDaysToDateString(range.from, -1), to: range.to }),
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

  /* Own time sheets on an appointment (earliest start, latest end), and each technician's day. */
  const ownSheet = new Map<string, { start: number; end: number }>();
  for (const t of sheets) {
    const start = t.start ? Date.parse(t.start) : NaN;
    const end = t.end ? Date.parse(t.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const key = `${t.technicianId}|${t.appointmentId}`;
    const seen = ownSheet.get(key);
    ownSheet.set(key, seen ? { start: Math.min(seen.start, start), end: Math.max(seen.end, end) } : { start, end });
  }
  /* Each FSM Attendance record as it is (29 Oct): one check-in and its check-out, which may be the next morning. */
  const sessionsOf = new Map<string, Array<{ start: number; end: number | null; date: string }>>();
  const sessionByKey = new Map<string, { start: number; end: number | null; date: string }>();
  for (const c of checkIns) {
    const startIso = c.sessionStart ?? c.at;
    const key = `${c.technicianFsmId}|${startIso}`;
    let session = sessionByKey.get(key);
    if (!session) {
      session = { start: Date.parse(startIso), end: null, date: zonedDateString(startIso) };
      sessionByKey.set(key, session);
      sessionsOf.set(c.technicianFsmId, [...(sessionsOf.get(c.technicianFsmId) ?? []), session]);
    }
    if (c.kind === "shift_check_out") session.end = Date.parse(c.at);
  }
  /**
   * Sami, 28 Oct: individual hours, not the crew's. Their own time sheet;
   * else the appointment's actual times trimmed to their own check-in and
   * check-out (nothing, if they were checked in that day but not during
   * it); else nothing here, and the appointment's times count, as
   * unverified. A session still open counts to the appointment's end.
   */
  const workOf = (a: LiveAppointment, crew: string[]): Record<string, TechnicianWork> | undefined => {
    const start = a.actualStart ? Date.parse(a.actualStart) : NaN;
    const end = a.actualEnd ? Date.parse(a.actualEnd) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
    const out: Record<string, TechnicianWork> = {};
    for (const id of crew) {
      const sheet = ownSheet.get(`${id}|${a.id}`);
      if (sheet) {
        out[id] = { start: new Date(sheet.start).toISOString(), end: new Date(sheet.end).toISOString(), source: "time_sheet" };
        continue;
      }
      const date = zonedDateString(a.actualStart!);
      const mine = sessionsOf.get(id) ?? [];
      const during = mine.filter((s) => s.start < end && (s.end ?? end) > start);
      if (during.length) {
        const from = Math.max(start, Math.min(...during.map((s) => s.start)));
        const to = Math.max(from, Math.min(end, Math.max(...during.map((s) => s.end ?? end))));
        out[id] = { start: new Date(from).toISOString(), end: new Date(to).toISOString(), source: "attendance" };
      } else if (mine.some((s) => s.date === date)) {
        out[id] = { start: new Date(start).toISOString(), end: new Date(start).toISOString(), source: "attendance" };
      }
    }
    return out;
  };

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
        contract: wo ? isContractWork(wo) : false,
      }),
      work: workOf(a, crews.get(a.id) ?? []),
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
// Revenue (DEV-454)
// ---------------------------------------------------------------------

/* A work order completed in the dates may have been worked on long before: appointments are read back this far. */
const REVENUE_LOOKBACK_DAYS = 180;

/**
 * What the revenue report counts (4 Nov): the work orders FSM completed in
 * the dates, who worked on each and for how long, the customers' ratings
 * given in the dates, and what has been invoiced against them (MAHER, as
 * recorded in Ready to invoice). Read live from Zoho FSM like every
 * report; the work orders by last change, so one completed in the dates is
 * always among them.
 */
export async function loadRevenueInputs(
  admin: SupabaseClient,
  range: { from: string; to: string },
): Promise<{ workOrders: RevenueWorkOrder[]; crews: Map<string, RevenueCrew>; ratings: RevenueRating[]; invoicedByWorkOrder: Map<string, number> }> {
  const fromMs = Date.parse(isoFrom(range.from));
  const endMs = Date.parse(isoFrom(range.to, 1));
  const inDates = (at: string | null) => {
    const ms = at ? Date.parse(at) : NaN;
    return Number.isFinite(ms) && ms >= fromMs && ms < endMs;
  };
  const [{ rows: woRows }, quotations, { rows: reportRows }, invoicedByWorkOrder] = await Promise.all([
    readModuleSince(admin, {
      module: "Work_Orders",
      sortField: "Modified_Time",
      fields: ["Name", "Sub_Total", "Estimate", "Company", "Contact", "Status", "Completed_Time", "Closed_Time", "Created_Time", "Work_Type__C", "AMC_Contract_Ref__C"],
      fromIso: isoFrom(range.from),
      resource: "work_orders",
    }),
    liveQuotations(admin),
    readModuleSince(admin, {
      module: "Service_Reports",
      sortField: "Created_Time",
      fields: ["Customer_Rating", "Appointment", "Work_Order", "Company", "Created_Time"],
      fromIso: isoFrom(range.from),
      resource: "service_reports",
    }),
    invoicedSoFar(admin),
  ]);

  const workOrders: RevenueWorkOrder[] = [];
  const created = new Map<string, string>();
  for (const r of woRows) {
    const status = str(r.Status);
    const completedAt = str(r.Completed_Time) ?? str(r.Closed_Time);
    if ((status !== "Completed" && status !== "Closed") || !completedAt || !inDates(completedAt)) continue;
    const id = String(r.id);
    const own = r.Sub_Total === null || r.Sub_Total === undefined ? 0 : Number(r.Sub_Total);
    const estimateId = lookupId(r.Estimate);
    const quotation = (estimateId ? quotations.byId.get(estimateId) : undefined) ?? quotations.byWorkOrder.get(id);
    const fromQuotation = quotation?.subTotal ?? 0;
    const valueSource = own > 0 ? "work_order" : fromQuotation > 0 ? "quotation" : "none";
    workOrders.push({
      id,
      number: str(r.Name),
      clientName: lookupName(r.Company) ?? lookupName(r.Contact),
      completedAt,
      completedDate: zonedDateString(completedAt),
      value: valueSource === "work_order" ? own : valueSource === "quotation" ? fromQuotation : 0,
      valueSource,
      amc: isContractWork({ workType: str(r.Work_Type__C), amcContractRef: lookupName(r.AMC_Contract_Ref__C) ?? str(r.AMC_Contract_Ref__C) }),
    });
    const createdAt = str(r.Created_Time);
    if (createdAt) created.set(id, createdAt);
  }

  /* Ratings: FSM writes 0 when the customer gave none (4 Nov: 44 of 60 "rated" reports), so only 1 to 5 count. */
  const rated = reportRows
    .map((r) => ({ r, stars: Number(r.Customer_Rating) }))
    .filter(({ r, stars }) => Number.isInteger(stars) && stars >= 1 && stars <= 5 && inDates(str(r.Created_Time)));

  /* Appointments from the earliest of those work orders' creation (at most half a year back) or the dates' start. */
  const earliest = [...created.values(), isoFrom(range.from)].reduce((min, at) => (Date.parse(at) < Date.parse(min) ? at : min));
  const floor = isoFrom(addDaysToDateString(range.from, -REVENUE_LOOKBACK_DAYS));
  const sinceIso = Date.parse(earliest) < Date.parse(floor) ? floor : new Date(Date.parse(earliest) - 86_400_000).toISOString();
  const [appointments, sheets] = await Promise.all([liveAppointments(admin, sinceIso), liveTimeSheets(admin, sinceIso)]);
  const completedIds = new Set(workOrders.map((w) => w.id));
  const ratedAppointments = new Set(rated.map(({ r }) => lookupId(r.Appointment)).filter((v): v is string => Boolean(v)));
  const worked = appointments.filter(
    (a) => a.status !== "Cancelled" && ((a.workOrderId && completedIds.has(a.workOrderId)) || ratedAppointments.has(a.id)),
  );
  const { crews: appointmentCrews } = await crewsOf(admin, worked, sheets);

  /* Each technician's minutes on an appointment: their own time sheet, else the appointment's actual times. */
  const sheetMinutes = new Map<string, number>();
  for (const t of sheets) {
    const start = t.start ? Date.parse(t.start) : NaN;
    const end = t.end ? Date.parse(t.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const key = `${t.technicianId}|${t.appointmentId}`;
    sheetMinutes.set(key, (sheetMinutes.get(key) ?? 0) + (end - start) / 60_000);
  }
  const crews = new Map<string, RevenueCrew>();
  for (const a of worked) {
    if (!a.workOrderId || !completedIds.has(a.workOrderId)) continue;
    const crew = crews.get(a.workOrderId) ?? { technicianIds: [], minutes: {} };
    const start = a.actualStart ? Date.parse(a.actualStart) : NaN;
    const end = a.actualEnd ? Date.parse(a.actualEnd) : NaN;
    const appointmentMinutes = Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60_000 : 0;
    for (const id of appointmentCrews.get(a.id) ?? []) {
      if (!crew.technicianIds.includes(id)) crew.technicianIds.push(id);
      crew.minutes[id] = (crew.minutes[id] ?? 0) + (sheetMinutes.get(`${id}|${a.id}`) ?? appointmentMinutes);
    }
    crews.set(a.workOrderId, crew);
  }

  const clientOfAppointment = new Map(appointments.map((a) => [a.id, a.clientName]));
  const ratings: RevenueRating[] = rated.map(({ r, stars }) => {
    const appointmentId = lookupId(r.Appointment);
    return {
      id: String(r.id),
      workOrderId: lookupId(r.Work_Order),
      clientName: lookupName(r.Company) ?? (appointmentId ? (clientOfAppointment.get(appointmentId) ?? null) : null),
      technicianIds: appointmentId ? (appointmentCrews.get(appointmentId) ?? []) : [],
      stars,
      date: zonedDateString(str(r.Created_Time)!),
    };
  });
  return { workOrders, crews, ratings, invoicedByWorkOrder };
}

/** Invoiced so far per work order, before VAT: MAHER invoices recorded in Ready to invoice (schema finance). */
async function invoicedSoFar(admin: SupabaseClient): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await readAllRows<Record<string, unknown>>(
      (from, to) => admin.schema("finance").from("line_invoice_allocations").select("fsm_work_order_id, amount").order("id").range(from, to),
      "invoice allocations",
    );
    for (const r of rows) {
      const id = str(r.fsm_work_order_id);
      if (id) out.set(id, (out.get(id) ?? 0) + Number(r.amount ?? 0));
    }
  } catch (error) {
    /* Before the finance ledger exists nothing has been invoiced through the portal. */
    if (!/line_invoice_allocations|PGRST205|42P01|schema cache/i.test(error instanceof Error ? error.message : String(error))) throw error;
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

export type ComplianceAppointmentRow = CapacityAppointment & {
  actualStart: string | null;
  actualEnd: string | null;
  /** Who FSM shows did the work (29 Oct): the lead, and anyone who logged a time sheet on it. A planned crew member is not evidence. */
  workedBy: string[];
  leadId: string | null;
};

/** Every appointment scheduled in the dates, any status (the calculation drops cancelled ones), with who was on it and its actual times. */
export async function loadComplianceAppointments(
  admin: SupabaseClient,
  range: { from: string; to: string },
  options: Fresh = {},
): Promise<{ appointments: ComplianceAppointmentRow[]; crewsUnknown: number }> {
  const startIso = isoFrom(range.from);
  const endIso = isoFrom(range.to, 1);
  const [all, sheets] = await Promise.all([liveAppointments(admin, startIso, options), liveTimeSheets(admin, startIso, options)]);
  const rows = all.filter((a) => a.scheduledStart && a.scheduledStart >= startIso && a.scheduledStart < endIso);
  const { crews, unknown } = await crewsOf(admin, rows, sheets);
  const logged = new Map<string, Set<string>>();
  for (const t of sheets) logged.set(t.appointmentId, (logged.get(t.appointmentId) ?? new Set()).add(t.technicianId));
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
      workedBy: [...new Set([...(a.leadId ? [a.leadId] : []), ...(logged.get(a.id) ?? [])])],
      leadId: a.leadId,
    })),
    crewsUnknown: unknown,
  };
}

/** Shift check-ins and check-outs (FSM Attendance: first check-in, last check-out of each day), around the dates. */
export async function loadShiftCheckIns(admin: SupabaseClient, range: { from: string; to: string }, options: Fresh = {}): Promise<RecordedCheckIn[]> {
  const { rows } = await readModuleSince(
    admin,
    {
      module: "Attendance",
      sortField: "First_Check_In",
      fields: ["Service_Resource", "Date", "First_Check_In", "Last_Check_Out", "Status", "Working_Duration"],
      fromIso: isoFrom(range.from, -1),
      resource: "attendance",
    },
    options,
  );
  const endIso = isoFrom(range.to, 2);
  const out: RecordedCheckIn[] = [];
  for (const r of rows) {
    const technicianFsmId = lookupId(r.Service_Resource);
    const checkIn = str(r.First_Check_In);
    if (!technicianFsmId || !checkIn || checkIn >= endIso) continue;
    /* One record per technician per day: its check-out stays with its check-in (29 Oct). */
    out.push({ technicianFsmId, kind: "shift_check_in", at: checkIn, sessionStart: checkIn });
    const checkOut = str(r.Last_Check_Out);
    if (checkOut) out.push({ technicianFsmId, kind: "shift_check_out", at: checkOut, sessionStart: checkIn });
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
  input: {
    from: string;
    to: string;
    technicians: AvailabilityTechnician[];
    unpaidBreakMinutes: number;
    standardDailyHours?: number;
    dataCentreDailyHours?: number;
  },
): Promise<AvailabilityInput> {
  /* Leave overlapping the range, with a day either side for night shifts. */
  const startIso = zonedTimeToUtc(addDaysToDateString(input.from, -1)).toISOString();
  const endIso = zonedTimeToUtc(addDaysToDateString(input.to, 2)).toISOString();
  const [{ data: config, error }, { data: holidayRows, error: holidayError }, leaveRows, timeOff] = await Promise.all([
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
    /* Time off entered in Zoho FSM counts as leave too (28 Oct). */
    /* Not caught (29 Oct): FSM leave that cannot be read must not count as nobody on leave. */
    fetchTimeOffLive(admin),
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
  const leave: LeaveInterval[] = [
    ...leaveRows
      .filter((r) => wanted.has(String(r.technician_fsm_id)))
      .map((r) => ({
        technicianFsmId: String(r.technician_fsm_id),
        startAt: String(r.start_at),
        endAt: String(r.end_at),
        category: str(r.leave_category) ?? str(r.leave_type),
      })),
    ...timeOff.filter((t) => wanted.has(t.technicianFsmId) && t.startAt < endIso && t.endAt > startIso),
  ];

  return {
    technicians: input.technicians,
    from: input.from,
    to: input.to,
    shiftTimes,
    holidays: (holidayRows ?? []).map((h) => String(h.holiday_date)),
    leave,
    unpaidBreakMinutes: input.unpaidBreakMinutes,
    standardDailyMinutes: Math.round((input.standardDailyHours ?? 8) * 60),
    dataCentreDailyMinutes: Math.round((input.dataCentreDailyHours ?? 12) * 60),
    today: todayInZone(),
  };
}
