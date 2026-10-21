/**
 * FSM records to read-model rows (migration 20261020130000).
 *
 * Pure functions, so they are tested on recorded shapes without FSM. Field
 * names and shapes are the ones discovery saw on production on 20 Oct 2026
 * (scripts/finance/fsm-discovery-*.ts): lookups are `{ id, name, ... }`,
 * line items and an appointment's crew come only on the detail call, and
 * the crew sits under `$Service_Resources`, not `Service_Resources`.
 */

type FsmRecord = Record<string, unknown>;

/** A lookup's id: FSM sends `{ id, name }`, occasionally a bare string. */
export function lookupId(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id || null;
  }
  return null;
}

export function lookupName(value: unknown): string | null {
  if (value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string") {
    return (value as { name: string }).name || null;
  }
  return null;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** An instant as ISO UTC, or null. FSM sends offsets ("+04:00"). */
export function instant(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** A calendar date (YYYY-MM-DD), or null. */
function date(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

export function recordId(record: FsmRecord): string | null {
  return text(record.id);
}

export function modifiedTime(record: FsmRecord): string | null {
  return instant(record.Modified_Time);
}

export type EstimateRow = ReturnType<typeof mapEstimate>;
export function mapEstimate(e: FsmRecord) {
  return {
    fsm_estimate_id: text(e.id),
    number: text(e.Name),
    status: text(e.Status),
    post_to_maher: text(e.Post_To_Maher__C),
    maher_invoice_number: text(e.Invoice_Number_from_Maher__C),
    grand_total: num(e.Grand_Total),
    sub_total: num(e.Sub_Total),
    tax_amount: num(e.Tax_Amount),
    owner_name: lookupName(e.Owner),
    owner_email: e.Owner && typeof e.Owner === "object" ? text((e.Owner as FsmRecord).email) : null,
    fsm_company_id: lookupId(e.Company),
    company_name: lookupName(e.Company),
    fsm_contact_id: lookupId(e.Contact),
    contact_name: lookupName(e.Contact),
    expiry_date: date(e.Expiry_Date),
    created_in_fsm_at: instant(e.Created_Time),
    approved_at: instant(e.Approved_Time),
    rejected_at: instant(e.Rejected_Time),
    expired_at: instant(e.Expired_Time),
    cancelled_at: instant(e.Cancelled_Time),
    closed_at: instant(e.Closed_Time),
    quotation_type: text(e.Quotation_Type__C),
    root_number: text(e.Root_Quotation_Number__C),
    fsm_work_order_id: lookupId(e.Work_Order),
    modified_time: instant(e.Modified_Time),
  };
}

export type WorkOrderRow = ReturnType<typeof mapWorkOrder>;
export function mapWorkOrder(w: FsmRecord) {
  return {
    fsm_work_order_id: text(w.id),
    number: text(w.Name),
    status: text(w.Status),
    type: text(w.Type),
    work_type: text(w.Work_Type__C),
    completed_at: instant(w.Completed_Time),
    fsm_estimate_id: lookupId(w.Estimate),
    grand_total: num(w.Grand_Total),
    sub_total: num(w.Sub_Total),
    tax_amount: num(w.Tax_Amount),
    billing_status: text(w.Billing_Status),
    amc_contract_ref: lookupId(w.AMC_Contract_Ref__C) ?? text(w.AMC_Contract_Ref__C),
    parent_fsm_work_order_id: lookupId(w.Parent_Work_Order),
    fsm_company_id: lookupId(w.Company),
    company_name: lookupName(w.Company),
    fsm_contact_id: lookupId(w.Contact),
    contact_name: lookupName(w.Contact),
    created_in_fsm_at: instant(w.Created_Time),
    modified_time: instant(w.Modified_Time),
  };
}

export type LineItemRow = ReturnType<typeof mapLineItem>;
/** A line from a work order's detail; `estimateId` is the work order's, used when the line has none. */
export function mapLineItem(l: FsmRecord, estimateId: string | null) {
  const tax = l.Tax && typeof l.Tax === "object" ? (l.Tax as FsmRecord) : null;
  return {
    fsm_line_id: text(l.id),
    fsm_estimate_id: lookupId(l.Estimate) ?? estimateId,
    fsm_service_id: lookupId(l.Service),
    name: lookupName(l.Service) ?? text(l.Name),
    description: text(l.Description),
    quantity: num(l.Quantity),
    unit: text(l.Unit),
    unit_price: num(l.List_Price),
    discount: num(l.Discount),
    /* Line_Item_Amount is Amount plus VAT (seen on live data: 199 -> 208.95
       at 5 %); Amount is the pre-tax value. */
    line_amount: num(l.Line_Item_Amount),
    amount: num(l.Amount),
    tax_percent: tax ? num(tax.Tax_Percentage) : null,
    status: text(l.Status),
    sequence: num(l.Sequence),
    is_optional: bool(l.Is_Optional),
    billing_status: text(l.Billing_Status),
    actual_start: instant(l.Actual_Start_Date_Time),
    actual_end: instant(l.Actual_End_Date_Time),
    modified_time: instant(l.Modified_Time),
  };
}

export type AppointmentRow = ReturnType<typeof mapAppointment>;
export function mapAppointment(a: FsmRecord) {
  const actualStart = instant(a.Actual_Start_Date_Time);
  let actualEnd = instant(a.Actual_End_Date_Time);
  /* An end before the start is not a time anyone worked; keep the start and
     drop the end rather than refuse the whole record. */
  if (actualStart && actualEnd && Date.parse(actualEnd) < Date.parse(actualStart)) actualEnd = null;
  return {
    fsm_appointment_id: text(a.id),
    number: text(a.Name),
    fsm_work_order_id: lookupId(a.Work_Order),
    status: text(a.Status),
    type: text(a.Type),
    scheduled_start: instant(a.Scheduled_Start_Date_Time),
    scheduled_end: instant(a.Scheduled_End_Date_Time),
    actual_start: actualStart,
    actual_end: actualEnd,
    lead_technician_fsm_id: lookupId(a.Lead),
    cancelled_at: instant(a.Cancelled_Or_Terminated_Time),
    cancellation_reason: text(a.Cancellation_Reason),
    modified_time: instant(a.Modified_Time),
  };
}

export type CrewMember = { technician_fsm_id: string; is_lead: boolean };
/**
 * An appointment's crew from its full record: `$Service_Resources`, with the
 * plain field read too in case FSM fills it one day, and the lead included
 * even when the list leaves them out.
 */
export function crewFromDetail(a: FsmRecord): CrewMember[] {
  const leadId = lookupId(a.Lead);
  const ids = new Set<string>();
  for (const key of ["$Service_Resources", "Service_Resources"]) {
    const list = a[key];
    if (Array.isArray(list)) for (const item of list) {
      const id = lookupId(item);
      if (id) ids.add(id);
    }
  }
  if (leadId) ids.add(leadId);
  return [...ids].map((id) => ({ technician_fsm_id: id, is_lead: id === leadId }));
}

/** Rows that cannot be stored (no id or no Modified_Time) are left out and counted. */
export function storable<T extends { modified_time: string | null }>(
  rows: T[],
  idOf: (row: T) => string | null,
): { rows: T[]; rejected: number } {
  const ok = rows.filter((row) => idOf(row) && row.modified_time);
  return { rows: ok, rejected: rows.length - ok.length };
}
