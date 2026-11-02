import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";

import { invoicingStatus, lineBillable } from "@/lib/finance/progress";
import { assertReadOnlyRequest, createFsmReader, financeFsmReadEnabled } from "@/lib/server/finance/fsm-read";
import {
  crewFromDetail,
  lookupId,
  lookupName,
  mapAppointment,
  mapEstimate,
  mapLineItem,
  mapWorkOrder,
  type CrewMember,
} from "@/lib/server/finance/fsm-sync/mappers";
import { FSM_BASE_URL, fsmAuthHeaders, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { ACTIVE_CLIENT_STATUS, buildDisplayNamer, TECHNICIAN_PROFILES, type Resource, type ZohoUser } from "@/lib/server/zoho/service-resources";
import type { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { mapToQuotationData } from "@/lib/quotations/estimate-quotation-data";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Ready to invoice reads Zoho FSM live (the user's direction, 22 Oct): work
 * orders, their line items and their quotations come from the FSM API, not
 * from the portal's synced copy. Read-only (the GET-only reader, behind
 * FINANCE_FSM_READ).
 *
 * What a page costs:
 *  - the list: FSM's work orders, newest first, 200 a call, until the dates
 *    asked for are covered (a call or two for 30 days, about 8 for the four
 *    months allowed). FSM's list never carries line items.
 *  - one work order: its detail (header and line items), and its
 *    quotation's, so one or two calls.
 *
 * Each answer is kept here for ten minutes, so paging, filtering and going
 * back and forth cost nothing; Refresh asks FSM again. The browser keeps
 * its own copy too (the section cache).
 */

const TTL_MS = 10 * 60_000;
const PER_PAGE = 200;
/* 4,000 work orders: far more than four months, and a ceiling on calls. */
const MAX_LIST_PAGES = 20;

export class FsmLiveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type FsmRecord = Record<string, unknown>;

export type LiveWorkOrder = {
  id: string;
  number: string | null;
  status: string | null;
  type: string | null;
  workType: string | null;
  billingStatus: string | null;
  /** What the invoicing rules read: the status, or Non-billable by Billing Status. */
  invoicingStatus: string | null;
  companyName: string | null;
  contactName: string | null;
  /** FSM's owner of the work order: the coordinator. */
  ownerName: string | null;
  estimateId: string | null;
  estimateNumber: string | null;
  createdAt: string | null;
  completedAt: string | null;
  modifiedAt: string | null;
  /** Before VAT. */
  subTotal: number | null;
  grandTotal: number | null;
  taxAmount: number | null;
  /** Its appointments' statuses, as the list call gives them (27 Oct: no separate appointments read). */
  appointmentStatuses: string[];
};

export type LiveLine = ReturnType<typeof mapLineItem>;

/** The quotation's figures, and the document as the quotation templates draw it (no extra call). */
export type LiveEstimate = ReturnType<typeof mapEstimate> & { document: QuotationData | null };

function quotationDocument(record: FsmRecord): QuotationData | null {
  try {
    return mapToQuotationData({ estimate: { data: [record] } });
  } catch {
    return null;
  }
}

type Cached<T> = { at: number; value: T };
/* fetchedAt: the last read (full or changes); fullAt: the last full read. */
const listCache = new Map<string, Cached<{ rows: LiveWorkOrder[]; fetchedAt: string; fullAt: string; calls: number }>>();
const detailCache = new Map<string, Cached<{ workOrder: LiveWorkOrder; lines: LiveLine[]; appointmentIds: string[]; fetchedAt: string }>>();
const estimateCache = new Map<string, Cached<LiveEstimate | null>>();

const fresh = <T>(entry: Cached<T> | undefined) => (entry && Date.now() - entry.at < TTL_MS ? entry.value : null);

function liveWorkOrder(record: FsmRecord): LiveWorkOrder {
  const w = mapWorkOrder(record);
  return {
    id: w.fsm_work_order_id ?? "",
    number: w.number,
    status: w.status,
    type: w.type,
    workType: w.work_type,
    billingStatus: w.billing_status,
    invoicingStatus: invoicingStatus(w.status, w.billing_status),
    companyName: w.company_name,
    contactName: w.contact_name,
    ownerName: lookupName(record.Owner),
    estimateId: w.fsm_estimate_id,
    estimateNumber: lookupName(record.Estimate),
    createdAt: w.created_in_fsm_at,
    completedAt: w.completed_at,
    modifiedAt: w.modified_time,
    subTotal: w.sub_total,
    grandTotal: w.grand_total,
    taxAmount: w.tax_amount,
    appointmentStatuses: ((record.Service_Appointments as FsmRecord[] | undefined) ?? [])
      .map((a) => (a && typeof a === "object" && a.status !== null && a.status !== undefined ? String(a.status) : ""))
      .filter(Boolean),
  };
}

async function readerFor(admin: SupabaseClient, budget: number) {
  if (!financeFsmReadEnabled()) throw new FsmLiveError("Reading from Zoho FSM is switched off (FINANCE_FSM_READ).", 503);
  return createFsmReader({ token: await getFsmAccessToken(admin), budget });
}

const dataOf = (json: unknown): FsmRecord[] => {
  const data = (json as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as FsmRecord[]) : [];
};

function failure(status: number, json: unknown): FsmLiveError {
  const body = json as { code?: string; message?: string } | null;
  return new FsmLiveError(`Zoho FSM answered ${status}${body?.message ? `: ${body.message}` : ""}`, 502);
}

/**
 * Work orders FSM raised in [fromIso, toIso), newest first. Read a page at
 * a time until a page reaches back past fromIso.
 */
/*
  Reading a list again (27 Oct): within FULL_READ_MS of the last full read,
  only the records changed since the last read are asked for (newest change
  first, usually one call) and merged in; after that, or for new dates, the
  whole list is read again, which also drops anything deleted in FSM.
*/
const FULL_READ_MS = 60 * 60_000;
/*
  The fields the list reads (what liveWorkOrder uses). Asking for them by name
  is also what makes FSM fill Service_Appointments with each appointment's
  status: without the virtual field it comes back empty (seen 27 Oct).
*/
const WORK_ORDER_LIST_FIELDS = [
  "Name",
  "Status",
  "Type",
  "Work_Type__C",
  "Completed_Time",
  "Estimate",
  "Grand_Total",
  "Sub_Total",
  "Tax_Amount",
  "Billing_Status",
  "AMC_Contract_Ref__C",
  "Parent_Work_Order",
  "Company",
  "Contact",
  "Owner",
  "Created_Time",
  "Modified_Time",
  "FsmServiceAppointments_Status__V",
].join(",");
/* Changes are asked for from a minute before the last read, for clocks a little apart. */
const CHANGE_MARGIN_MS = 60_000;

export async function fetchWorkOrdersLive(
  admin: SupabaseClient,
  range: { fromIso: string; toIso: string },
  options: { refresh?: boolean } = {},
): Promise<{ rows: LiveWorkOrder[]; fetchedAt: string; calls: number; cached: boolean }> {
  const key = `${range.fromIso}|${range.toIso}`;
  const entry = listCache.get(key);
  const cached = options.refresh ? null : fresh(entry);
  if (cached) return { ...cached, cached: true };
  const from = Date.parse(range.fromIso);
  const to = Date.parse(range.toIso);

  /* Only what changed since the last read, merged into it. */
  if (entry && Date.now() - Date.parse(entry.value.fullAt) < FULL_READ_MS) {
    const since = Date.parse(entry.value.fetchedAt) - CHANGE_MARGIN_MS;
    const fetchedAt = new Date().toISOString();
    const reader = await readerFor(admin, MAX_LIST_PAGES);
    const byId = new Map(entry.value.rows.map((w) => [w.id, w]));
    for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
      const res = await reader.get(`/Work_Orders?per_page=${PER_PAGE}&page=${page}&sort_by=Modified_Time&sort_order=desc&fields=${WORK_ORDER_LIST_FIELDS}`);
      if (res.status === 204) break;
      if (!res.ok) throw failure(res.status, res.json);
      let reachedOlder = false;
      for (const record of dataOf(res.json)) {
        const wo = liveWorkOrder(record);
        if (!wo.id) continue;
        if (wo.modifiedAt && Date.parse(wo.modifiedAt) < since) {
          reachedOlder = true;
          break;
        }
        const created = wo.createdAt ? Date.parse(wo.createdAt) : NaN;
        if (!Number.isNaN(created) && created >= from && created < to) byId.set(wo.id, wo);
        else byId.delete(wo.id);
        /* A changed work order's own detail is read again next time it is opened. */
        detailCache.delete(wo.id);
      }
      if (reachedOlder || !(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) break;
    }
    const rows = [...byId.values()].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const value = { rows, fetchedAt, fullAt: entry.value.fullAt, calls: reader.calls() };
    listCache.set(key, { at: Date.now(), value });
    return { ...value, cached: false };
  }

  const reader = await readerFor(admin, MAX_LIST_PAGES);
  const rows: LiveWorkOrder[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const res = await reader.get(`/Work_Orders?per_page=${PER_PAGE}&page=${page}&sort_by=Created_Time&sort_order=desc&fields=${WORK_ORDER_LIST_FIELDS}`);
    if (res.status === 204) break;
    if (!res.ok) throw failure(res.status, res.json);
    const data = dataOf(res.json);
    let reachedOlder = false;
    for (const record of data) {
      const wo = liveWorkOrder(record);
      const created = wo.createdAt ? Date.parse(wo.createdAt) : NaN;
      if (!wo.id || Number.isNaN(created)) continue;
      if (created < from) {
        reachedOlder = true;
        continue;
      }
      if (created < to) rows.push(wo);
    }
    const more = Boolean((res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records);
    if (reachedOlder || !more) break;
  }
  const fetchedAt = new Date().toISOString();
  const value = { rows, fetchedAt, fullAt: fetchedAt, calls: reader.calls() };
  listCache.set(key, { at: Date.now(), value });
  return { ...value, cached: false };
}

/** One work order in full: header and line items. Null when FSM no longer has it. */
export async function fetchWorkOrderLive(
  admin: SupabaseClient,
  id: string,
  options: { refresh?: boolean; anyAge?: boolean } = {},
): Promise<{ workOrder: LiveWorkOrder; lines: LiveLine[]; appointmentIds: string[]; fetchedAt: string; cached: boolean } | null> {
  /* anyAge: the last read, however old (a workflow action that does not depend on FSM's figures). */
  const cached = options.refresh ? null : options.anyAge ? (detailCache.get(id)?.value ?? null) : fresh(detailCache.get(id));
  if (cached) return { ...cached, cached: true };

  const reader = await readerFor(admin, 1);
  const res = await reader.get(`/Work_Orders/${encodeURIComponent(id)}`);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw failure(res.status, res.json);
  const record = dataOf(res.json)[0];
  if (!record) return null;
  const workOrder = liveWorkOrder(record);
  const lines = ((record.Service_Line_Items as FsmRecord[] | undefined) ?? [])
    .map((l) => mapLineItem(l, workOrder.estimateId))
    .filter((l) => l.fsm_line_id)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  /* With its lines known, non-billable only when none of them is billable (a line's own Billing Status wins). */
  if (lines.length) {
    const anyBillable = lines.some((l) => lineBillable(l.billing_status, workOrder.billingStatus));
    workOrder.invoicingStatus = invoicingStatus(workOrder.status, anyBillable ? null : "Non Billable");
  }
  /*
    Its appointments, for their service reports (one per appointment). FSM
    leaves Service_Appointments empty on the detail (seen 26 Oct); each
    line's Appointments_X_Services names its appointment.
  */
  const appointmentIds = [
    ...new Set(
      [
        ...((record.Service_Appointments as unknown[] | undefined) ?? []).map((a) => lookupId(a)),
        ...((record.Appointments_X_Services as FsmRecord[] | undefined) ?? []).map((x) => lookupId(x.Service_Appointment)),
      ].filter((v): v is string => Boolean(v)),
    ),
  ];
  const value = { workOrder, lines, appointmentIds, fetchedAt: new Date().toISOString() };
  detailCache.set(id, { at: Date.now(), value });
  return { ...value, cached: false };
}

/** A quotation, for its status, totals, owner and Post to MAHER. */
export async function fetchEstimateLive(admin: SupabaseClient, id: string, options: { refresh?: boolean } = {}): Promise<LiveEstimate | null> {
  const hit = options.refresh ? undefined : estimateCache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const reader = await readerFor(admin, 1);
  const res = await reader.get(`/Estimates/${encodeURIComponent(id)}`);
  if (res.status === 204 || res.status === 404) {
    estimateCache.set(id, { at: Date.now(), value: null });
    return null;
  }
  if (!res.ok) throw failure(res.status, res.json);
  const record = dataOf(res.json)[0];
  const value = record ? { ...mapEstimate(record), document: quotationDocument(record) } : null;
  estimateCache.set(id, { at: Date.now(), value });
  return value;
}

/** After a refresh of one work order, the lists holding it are re-read next time too. */
export function forgetLists() {
  for (const entry of listCache.values()) entry.at = 0;
  if (quotationFlagsCache) quotationFlagsCache.at = 0;
  appointmentsCache.clear();
}

/* ---------------------------------------------------------------------
   Quotations' Post to MAHER (26 Oct: Finance sees work Completed in FSM
   and flagged "To Be Invoiced" on its quotation). Every quotation, only
   the fields needed, 200 a call: about six calls for the whole book,
   shared by the list and every work order for ten minutes.
   --------------------------------------------------------------------- */

export type QuotationFlag = {
  number: string | null;
  status: string | null;
  postToMaher: string | null;
  /** Before VAT. */
  subTotal: number | null;
  grandTotal: number | null;
  ownerName: string | null;
  ownerEmail: string | null;
  companyName: string | null;
  contactName: string | null;
  createdAt: string | null;
  expiryDate: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  modifiedAt: string | null;
  workOrderId: string | null;
};

let quotationFlagsCache: Cached<{ byId: Map<string, QuotationFlag>; calls: number; fetchedAt: string; fullAt: string }> | null = null;
const QUOTATION_FIELDS = [
  "Name",
  "Status",
  "Post_To_Maher__C",
  "Sub_Total",
  "Grand_Total",
  "Owner",
  "Company",
  "Contact",
  "Created_Time",
  "Expiry_Date",
  "Approved_Time",
  "Rejected_Time",
  "Expired_Time",
  "Modified_Time",
  "Work_Order",
].join(",");
const textOf = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const numberOf = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const MAX_QUOTATION_PAGES = 30;
/*
  How many pages the last read of the book took (27 Oct): the next read asks
  for that many at once, then one page at a time while FSM says there are
  more, so no call is spent on a page past the end (was 8 calls for 6 pages).
*/
let quotationPages = 6;

export async function fetchQuotationFlagsLive(
  admin: SupabaseClient,
  options: { refresh?: boolean } = {},
): Promise<{ byId: Map<string, QuotationFlag>; calls: number; cached: boolean }> {
  const hit = options.refresh ? null : fresh(quotationFlagsCache ?? undefined);
  if (hit) return { ...hit, cached: true };
  const reader = await readerFor(admin, MAX_QUOTATION_PAGES);
  const pageRows: FsmRecord[] = [];
  const startedAt = new Date().toISOString();
  /* Within the hour of the last full read: only the quotations changed since the last read (27 Oct). */
  const previous = quotationFlagsCache && Date.now() - Date.parse(quotationFlagsCache.value.fullAt) < FULL_READ_MS ? quotationFlagsCache.value : null;
  const byId = new Map<string, QuotationFlag>(previous?.byId ?? []);
  if (previous) {
    const since = Date.parse(previous.fetchedAt) - CHANGE_MARGIN_MS;
    for (let page = 1; page <= MAX_QUOTATION_PAGES; page += 1) {
      const res = await reader.get(`/Estimates?per_page=${PER_PAGE}&page=${page}&sort_by=Modified_Time&sort_order=desc&fields=${QUOTATION_FIELDS}`);
      if (res.status === 204) break;
      if (!res.ok) throw failure(res.status, res.json);
      let reachedOlder = false;
      for (const r of dataOf(res.json)) {
        if (r.Modified_Time && Date.parse(String(r.Modified_Time)) < since) {
          reachedOlder = true;
          break;
        }
        pageRows.push(r);
      }
      if (reachedOlder || !(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) break;
    }
  }
  let finished = Boolean(previous);
  let read = 0;
  for (let first = 1; first <= MAX_QUOTATION_PAGES && !finished; ) {
    const batch = first === 1 ? Math.min(quotationPages, MAX_QUOTATION_PAGES) : 1;
    const pages = Array.from({ length: batch }, (_, i) => first + i).filter((p) => p <= MAX_QUOTATION_PAGES);
    first += batch;
    const answers = await Promise.all(
      pages.map((page) => reader.get(`/Estimates?per_page=${PER_PAGE}&page=${page}&sort_by=Created_Time&sort_order=desc&fields=${QUOTATION_FIELDS}`)),
    );
    for (const res of answers) {
      if (res.status === 204) {
        finished = true;
        break;
      }
      if (!res.ok) throw failure(res.status, res.json);
      pageRows.push(...dataOf(res.json));
      read += 1;
      if (!(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) {
        finished = true;
        break;
      }
    }
  }
  {
    for (const r of pageRows) {
      const id = r.id ? String(r.id) : null;
      if (!id) continue;
      const owner = r.Owner && typeof r.Owner === "object" ? (r.Owner as FsmRecord) : null;
      byId.set(id, {
        number: textOf(r.Name),
        status: textOf(r.Status),
        postToMaher: textOf(r.Post_To_Maher__C),
        subTotal: numberOf(r.Sub_Total),
        grandTotal: numberOf(r.Grand_Total),
        ownerName: lookupName(r.Owner),
        ownerEmail: owner?.email ? String(owner.email) : null,
        companyName: lookupName(r.Company),
        contactName: lookupName(r.Contact),
        createdAt: textOf(r.Created_Time),
        expiryDate: textOf(r.Expiry_Date),
        approvedAt: textOf(r.Approved_Time),
        rejectedAt: textOf(r.Rejected_Time),
        expiredAt: textOf(r.Expired_Time),
        modifiedAt: textOf(r.Modified_Time),
        workOrderId: lookupId(r.Work_Order),
      });
    }
  }
  if (!previous) quotationPages = Math.max(1, read);
  const value = { byId, calls: reader.calls(), fetchedAt: startedAt, fullAt: previous ? previous.fullAt : startedAt };
  quotationFlagsCache = { at: Date.now(), value };
  noteRead("estimates");
  return { ...value, cached: false };
}

/* ---------------------------------------------------------------------
   Appointments scheduled from a date on (future ones too), for the
   Operations view's reminder: work orders whose appointments are all done
   but which nobody has marked Completed in FSM. 200 a call, newest first,
   until the start date: a call or two for a month.
   --------------------------------------------------------------------- */

export type LiveAppointment = { id: string; status: string | null; workOrderId: string | null; scheduledStart: string | null };

const appointmentsCache = new Map<string, Cached<{ rows: LiveAppointment[]; calls: number }>>();

export async function fetchAppointmentsSinceLive(
  admin: SupabaseClient,
  fromIso: string,
  options: { refresh?: boolean } = {},
): Promise<{ rows: LiveAppointment[]; calls: number; cached: boolean }> {
  const hit = options.refresh ? null : fresh(appointmentsCache.get(fromIso));
  if (hit) return { ...hit, cached: true };
  const reader = await readerFor(admin, MAX_LIST_PAGES);
  const from = Date.parse(fromIso);
  const rows: LiveAppointment[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const res = await reader.get(
      `/Service_Appointments?per_page=${PER_PAGE}&page=${page}&sort_by=Scheduled_Start_Date_Time&sort_order=desc&fields=Name,Status,Work_Order,Scheduled_Start_Date_Time`,
    );
    if (res.status === 204) break;
    if (!res.ok) throw failure(res.status, res.json);
    let reachedOlder = false;
    for (const r of dataOf(res.json)) {
      const scheduledStart = r.Scheduled_Start_Date_Time ? String(r.Scheduled_Start_Date_Time) : null;
      if (scheduledStart && Date.parse(scheduledStart) < from) {
        reachedOlder = true;
        continue;
      }
      rows.push({
        id: String(r.id),
        status: r.Status === null || r.Status === undefined ? null : String(r.Status),
        workOrderId: lookupId(r.Work_Order),
        scheduledStart,
      });
    }
    if (reachedOlder || !(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) break;
  }
  const value = { rows, calls: reader.calls() };
  appointmentsCache.set(fromIso, { at: Date.now(), value });
  return { ...value, cached: false };
}

/* ---------------------------------------------------------------------
   Files on a work order and its appointments (26 Oct, change 8: the
   client-signed service report, one per appointment). Read when the
   Reports tab opens, kept ten minutes.
   --------------------------------------------------------------------- */

export type LiveAttachment = {
  id: string;
  fileId: string;
  name: string;
  size: number | null;
  createdAt: string | null;
  /** The work order, or the appointment, it is attached to. */
  parent: "work_order" | "appointment";
  parentId: string;
};

const attachmentsCache = new Map<string, Cached<LiveAttachment[]>>();
/* A work order with more appointments than this shows the first ones' files. */
const MAX_APPOINTMENT_FILES = 12;

export async function fetchAttachmentsLive(
  admin: SupabaseClient,
  workOrderId: string,
  appointmentIds: string[],
  options: { refresh?: boolean } = {},
): Promise<LiveAttachment[]> {
  const hit = options.refresh ? null : fresh(attachmentsCache.get(workOrderId));
  if (hit) return hit;
  const parents: Array<{ parent: LiveAttachment["parent"]; id: string; path: string }> = [
    { parent: "work_order", id: workOrderId, path: `/Work_Orders/${encodeURIComponent(workOrderId)}/Attachments` },
    ...appointmentIds.slice(0, MAX_APPOINTMENT_FILES).map((id) => ({
      parent: "appointment" as const,
      id,
      path: `/Service_Appointments/${encodeURIComponent(id)}/Attachments`,
    })),
  ];
  const reader = await readerFor(admin, parents.length);
  const out: LiveAttachment[] = [];
  for (const p of parents) {
    const res = await reader.get(p.path);
    if (res.status === 204 || res.status === 404) continue;
    if (!res.ok) throw failure(res.status, res.json);
    for (const a of dataOf(res.json)) {
      const fileId = a.$file_id ? String(a.$file_id) : null;
      if (!fileId) continue;
      out.push({
        id: String(a.id),
        fileId,
        name: String(a.File_Name ?? "file"),
        size: a.Size === null || a.Size === undefined ? null : Number(a.Size),
        createdAt: a.Created_Time ? String(a.Created_Time) : null,
        parent: p.parent,
        parentId: p.id,
      });
    }
  }
  attachmentsCache.set(workOrderId, { at: Date.now(), value: out });
  return out;
}

/* ---------------------------------------------------------------------
   Service reports (26 Oct, change 8): the client-signed proof of
   completion, one per appointment, from FSM's Service Reports module (read
   since the token's new scopes). FSM lists them by appointment: a call per
   appointment, kept ten minutes.
   --------------------------------------------------------------------- */

export type LiveServiceReport = {
  id: string;
  name: string | null;
  status: string | null;
  appointmentId: string;
  appointmentName: string | null;
  createdAt: string | null;
  pdf: { fileId: string; name: string; size: number | null } | null;
  signedBy: string | null;
  signedAt: string | null;
  rating: string | null;
};

const serviceReportsCache = new Map<string, Cached<LiveServiceReport[]>>();

export async function fetchServiceReportsLive(
  admin: SupabaseClient,
  workOrderId: string,
  appointmentIds: string[],
  options: { refresh?: boolean } = {},
): Promise<LiveServiceReport[]> {
  const hit = options.refresh ? null : fresh(serviceReportsCache.get(workOrderId));
  if (hit) return hit;
  const ids = appointmentIds.slice(0, MAX_APPOINTMENT_FILES);
  if (!ids.length) return [];
  const reader = await readerFor(admin, ids.length);
  const out: LiveServiceReport[] = [];
  for (const appointmentId of ids) {
    const res = await reader.get(`/Service_Appointments/${encodeURIComponent(appointmentId)}/Service_Reports`);
    if (res.status === 204 || res.status === 404) continue;
    if (!res.ok) throw failure(res.status, res.json);
    for (const r of dataOf(res.json)) {
      const file = ((r.Service_Report_PDF as FsmRecord[] | undefined) ?? [])[0];
      const signature = r.Customer_Signature && typeof r.Customer_Signature === "object" ? (r.Customer_Signature as FsmRecord) : null;
      out.push({
        id: String(r.id),
        name: r.Name === null || r.Name === undefined ? null : String(r.Name),
        status: r.Status === null || r.Status === undefined ? null : String(r.Status),
        appointmentId,
        appointmentName: lookupName(r.Appointment),
        createdAt: r.Created_Time ? String(r.Created_Time) : null,
        pdf: file?.file_Id
          ? {
              fileId: String(file.file_Id),
              /* FSM names the PDF with a bare id (no extension): name it after the report. */
              name: /\.pdf$/i.test(String(file.file_Name ?? "")) ? String(file.file_Name) : `${r.Name ?? "service-report"}.pdf`,
              /* FSM sends the size as text ("123 KB" or bytes); a size that is not a plain number is left out. */
              size: Number.isFinite(Number(file.file_Size)) && file.file_Size !== "" && file.file_Size !== null ? Number(file.file_Size) : null,
            }
          : null,
        signedBy: signature?.Customer_Signature_Name ? String(signature.Customer_Signature_Name) : null,
        signedAt: signature?.Customer_Signature_Uploaded_Time ? String(signature.Customer_Signature_Uploaded_Time) : null,
        rating: r.Customer_Rating === null || r.Customer_Rating === undefined || r.Customer_Rating === "" ? null : String(r.Customer_Rating),
      });
    }
  }
  serviceReportsCache.set(workOrderId, { at: Date.now(), value: out });
  return out;
}

/** One FSM file, streamed through (GET only, like every finance read). */
export async function fetchFileLive(admin: SupabaseClient, fileId: string): Promise<Response> {
  if (!financeFsmReadEnabled()) throw new FsmLiveError("Reading from Zoho FSM is switched off (FINANCE_FSM_READ).", 503);
  const path = `/files?file_id=${encodeURIComponent(fileId)}`;
  const init: RequestInit = { method: "GET" };
  assertReadOnlyRequest(path, init);
  const token = await getFsmAccessToken(admin);
  const res = await fetch(`${FSM_BASE_URL}${path}`, {
    ...init,
    headers: { Authorization: fsmAuthHeaders(token).Authorization },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new FsmLiveError(`Zoho FSM answered ${res.status} for the file`, 502);
  return res;
}

/* ---------------------------------------------------------------------
   The reports, read live from FSM (26 Oct: every report reads Zoho FSM,
   the last 30 days unless the dates are changed). One read per module and
   start date, newest first down to the start, only the fields asked for,
   200 a call. Kept ten minutes, and a later start date reuses what was
   read: changing the dates within what is held costs no call.
   --------------------------------------------------------------------- */

type SinceEntry = { fromIso: string; at: number; rows: FsmRecord[]; calls: number };
const sinceCache = new Map<string, SinceEntry>();
/*
  150 pages: 30,000 records. Attendance runs about 50 records a day, so a
  400-day report reads some 20,000 (29 Oct: the old 40 pages stopped at
  about 160 days of it, silently). Reaching the end with more to read is
  an error, never a shorter list.
*/
const MAX_SINCE_PAGES = 150;
const PAGES_AT_ONCE = 4;
const lastRead = new Map<string, string>();

/** When each kind of FSM record was last read for the reports ("data as of"). */
export function noteRead(resource: string, at = new Date().toISOString()) {
  lastRead.set(resource, at);
}
export function readTimes(resources: string[]): Record<string, string | null> {
  return Object.fromEntries(resources.map((r) => [r, lastRead.get(r) ?? null]));
}

export async function readModuleSince(
  admin: SupabaseClient,
  input: { module: string; sortField: string; fields: string[]; fromIso: string; resource: string },
  options: { refresh?: boolean } = {},
): Promise<{ rows: FsmRecord[]; calls: number; cached: boolean }> {
  const key = `${input.module}|${input.sortField}|${input.fields.join(",")}`;
  const from = Date.parse(input.fromIso);
  const hit = sinceCache.get(key);
  const inWindow = (r: FsmRecord) => {
    const v = r[input.sortField];
    return v === null || v === undefined || Date.parse(String(v)) >= from;
  };
  if (!options.refresh && hit && Date.now() - hit.at < TTL_MS && hit.fromIso <= input.fromIso) {
    return { rows: hit.rows.filter(inWindow), calls: 0, cached: true };
  }
  const reader = await readerFor(admin, MAX_SINCE_PAGES);
  const rows: FsmRecord[] = [];
  /* Four pages at a time: a long range costs a quarter of the waiting; a page or three past the start may be read for nothing. */
  let done = false;
  for (let first = 1; first <= MAX_SINCE_PAGES && !done; first += PAGES_AT_ONCE) {
    const pages = Array.from({ length: Math.min(PAGES_AT_ONCE, MAX_SINCE_PAGES - first + 1) }, (_, i) => first + i);
    const answers = await Promise.all(
      pages.map((page) =>
        reader.get(`/${input.module}?per_page=${PER_PAGE}&page=${page}&sort_by=${input.sortField}&sort_order=desc&fields=${input.fields.join(",")}`),
      ),
    );
    for (const res of answers) {
      if (res.status === 204) {
        done = true;
        break;
      }
      if (!res.ok) throw failure(res.status, res.json);
      let reachedOlder = false;
      for (const r of dataOf(res.json)) {
        const v = r[input.sortField];
        if (v !== null && v !== undefined && Date.parse(String(v)) < from) {
          reachedOlder = true;
          continue;
        }
        rows.push(r);
      }
      if (reachedOlder || !(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) {
        done = true;
        break;
      }
    }
  }
  if (!done) {
    throw new FsmLiveError(
      `Zoho FSM holds more ${input.resource} for these dates than one read takes (${MAX_SINCE_PAGES * PER_PAGE} records). Choose shorter dates.`,
      413,
    );
  }
  sinceCache.set(key, { fromIso: input.fromIso, at: Date.now(), rows, calls: reader.calls() });
  noteRead(input.resource);
  return { rows, calls: reader.calls(), cached: false };
}

/* ---------------------------------------------------------------------
   An appointment's crew: everyone on it, which FSM gives only on the
   appointment itself (its list leaves the crew out, and Time Sheets hold
   one person per appointment: 25 of 157 people on 26 Oct). Each crew is
   taken, in order, from:
     1. what this server read before, while the appointment is unchanged;
     2. the portal's earlier copy of FSM (fsm.appointment_resources), when
        FSM's Modified_Time still matches the copy's, so it is current;
     3. FSM itself, 8 at a time, at most `budget` a read; and what is read
        there is saved to that copy (29 Oct), so the next server to start
        finds it in step 2 instead of reading FSM again.
   --------------------------------------------------------------------- */

const crewCache = new Map<string, { modified: string | null; crew: string[] }>();
const CREW_READS_AT_ONCE = 8;
const sameInstant = (a: string | null, b: string | null) => Boolean(a && b && Date.parse(a) === Date.parse(b));

async function crewsFromCopy(admin: SupabaseClient, wanted: Array<{ id: string; modifiedAt: string | null }>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let i = 0; i < wanted.length; i += 200) {
    const chunk = wanted.slice(i, i + 200);
    const ids = chunk.map((a) => a.id);
    /*
      Every crew row, a page at a time (29 Oct): one request returns at most
      1,000 rows, and 200 appointments' crews pass that, so the rest were cut
      off silently and those appointments read from FSM on every load.
    */
    let copies: Array<Record<string, unknown>>;
    let people: Array<Record<string, unknown>>;
    try {
      [copies, people] = await Promise.all([
        readAllRows<Record<string, unknown>>(
          (from, to) =>
            admin.schema("fsm").from("appointments").select("fsm_appointment_id, modified_time").in("fsm_appointment_id", ids).order("fsm_appointment_id").range(from, to),
          "fsm.appointments",
        ),
        readAllRows<Record<string, unknown>>(
          (from, to) =>
            admin
              .schema("fsm")
              .from("appointment_resources")
              .select("fsm_appointment_id, technician_fsm_id")
              .in("fsm_appointment_id", ids)
              .order("fsm_appointment_id")
              .order("technician_fsm_id")
              .range(from, to),
          "fsm.appointment_resources",
        ),
      ]);
    } catch {
      /* No copy (or not readable): FSM is asked instead. */
      return out;
    }
    const copyModified = new Map(copies.map((c) => [String(c.fsm_appointment_id), (c.modified_time as string | null) ?? null]));
    const crewOf = new Map<string, string[]>();
    for (const p of people) crewOf.set(String(p.fsm_appointment_id), [...(crewOf.get(String(p.fsm_appointment_id)) ?? []), String(p.technician_fsm_id)]);
    for (const a of chunk) {
      /* An empty copy is not trusted: FSM is asked (an appointment nobody is on yet is read each time). */
      const crew = crewOf.get(a.id);
      if (crew?.length && sameInstant(copyModified.get(a.id) ?? null, a.modifiedAt)) out.set(a.id, crew);
    }
  }
  return out;
}

export async function fetchPlannedCrewsLive(
  admin: SupabaseClient,
  appointments: Array<{ id: string; modifiedAt: string | null }>,
  budget: number,
): Promise<{ crews: Map<string, string[]>; unread: number }> {
  const crews = new Map<string, string[]>();
  let toRead = appointments.filter((a) => {
    const hit = crewCache.get(a.id);
    if (hit && hit.modified === a.modifiedAt) {
      crews.set(a.id, hit.crew);
      return false;
    }
    return true;
  });
  if (toRead.length) {
    const copied = await crewsFromCopy(admin, toRead);
    for (const [id, crew] of copied) {
      crews.set(id, crew);
      crewCache.set(id, { modified: toRead.find((a) => a.id === id)?.modifiedAt ?? null, crew });
    }
    toRead = toRead.filter((a) => !copied.has(a.id));
  }
  const now = toRead.slice(0, budget);
  let failed: typeof now = [];
  const toSave: Array<{ record: FsmRecord; crew: CrewMember[]; seenAt: string }> = [];
  if (now.length) {
    /* Twice the reads: each one refused may be tried once more. */
    const reader = await readerFor(admin, now.length * 2);
    const read = async (a: (typeof now)[number]) => {
      try {
        const res = await reader.get(`/Service_Appointments/${encodeURIComponent(a.id)}`);
        const record = res.ok ? dataOf(res.json)[0] : undefined;
        if (!record) return false;
        const members = crewFromDetail(record);
        const crew = members.map((m) => m.technician_fsm_id);
        crewCache.set(a.id, { modified: a.modifiedAt, crew });
        crews.set(a.id, crew);
        toSave.push({ record, crew: members, seenAt: new Date().toISOString() });
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < now.length; i += CREW_READS_AT_ONCE) {
      const chunk = now.slice(i, i + CREW_READS_AT_ONCE);
      const ok = await Promise.all(chunk.map(read));
      failed.push(...chunk.filter((_, k) => !ok[k]));
    }
    /*
      29 Oct: a read FSM refused (a cold load reads ~150 at once and some
      come back limited) was dropped, and its crew silently lost a person
      for that load. Once more, two at a time; what still fails is counted
      as unread, never taken as a crew of one.
    */
    const retry = failed;
    failed = [];
    for (let i = 0; i < retry.length; i += 2) {
      const chunk = retry.slice(i, i + 2);
      const ok = await Promise.all(chunk.map(read));
      failed.push(...chunk.filter((_, k) => !ok[k]));
    }
    noteRead("appointments");
  }
  if (toSave.length) saveCrewsAfterResponse(admin, toSave);
  return { crews, unread: toRead.length - now.length + failed.length };
}

const CREW_SAVES_AT_ONCE = 10;

/**
 * The crews just read from FSM, into the portal's copy (fsm.appointments,
 * fsm.appointment_resources) through its own writers, which never let an
 * older FSM record replace a newer one. After the response, so a report
 * never waits on it; a failed save is logged and only means FSM is read
 * again next time. Nothing is written to FSM.
 */
function saveCrewsAfterResponse(admin: SupabaseClient, reads: Array<{ record: FsmRecord; crew: CrewMember[]; seenAt: string }>) {
  const save = async () => {
    try {
      const rows = reads.map((r) => mapAppointment(r.record)).filter((row) => row.fsm_appointment_id && row.modified_time);
      const stored = await admin.schema("fsm").rpc("upsert_appointments", { p_rows: rows });
      if (stored.error) throw new Error(stored.error.message);
      const saved = new Set(rows.map((row) => row.fsm_appointment_id));
      const crews = reads.filter((r) => saved.has(String(r.record.id)));
      for (let i = 0; i < crews.length; i += CREW_SAVES_AT_ONCE) {
        await Promise.all(
          crews.slice(i, i + CREW_SAVES_AT_ONCE).map(async (r) => {
            const { error } = await admin
              .schema("fsm")
              .rpc("set_appointment_crew", { p_appointment_id: String(r.record.id), p_seen_at: r.seenAt, p_crew: r.crew });
            if (error) console.error("[fsm-live] crew not saved:", r.record.id, error.message);
          }),
        );
      }
    } catch (error) {
      console.error("[fsm-live] crews not saved:", error instanceof Error ? error.message : error);
    }
  };
  try {
    after(save);
  } catch {
    /* Outside a request (a script): save now. */
    void save();
  }
}

/* ---------------------------------------------------------------------
   Technicians and their time off, live from Zoho FSM (28 Oct: the reports
   read the roster from FSM, not the portal's six-hourly copy). The same
   rules as the scheduling sync: active FSM users with a technician profile
   and a service resource. One call for each (180 users, a handful of time
   off records), kept ten minutes.
   --------------------------------------------------------------------- */

export type LiveTechnician = Resource & { displayName: string };
export type LiveTimeOff = { technicianFsmId: string; startAt: string; endAt: string; category: string | null };

let techniciansCache: Cached<LiveTechnician[]> | null = null;
let timeOffCache: Cached<LiveTimeOff[]> | null = null;
const MAX_USER_PAGES = 10;

export async function fetchTechniciansLive(admin: SupabaseClient): Promise<LiveTechnician[]> {
  const hit = fresh(techniciansCache ?? undefined);
  if (hit) return hit;
  const reader = await readerFor(admin, MAX_USER_PAGES);
  const resources: Resource[] = [];
  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const res = await reader.get(`/users?page=${page}&per_page=${PER_PAGE}`);
    if (res.status === 204) break;
    if (!res.ok) throw failure(res.status, res.json);
    const body = res.json as { users?: ZohoUser[]; info?: { more_records?: boolean } } | null;
    for (const user of body?.users ?? []) {
      if (!user.Service_Resources?.id) continue;
      if (user.client_status !== ACTIVE_CLIENT_STATUS) continue;
      if (!TECHNICIAN_PROFILES.has(user.profile?.name ?? user.profile?.api_name ?? "")) continue;
      resources.push({
        fsmResourceId: user.Service_Resources.id,
        name: user.full_name ?? user.Service_Resources.Name ?? null,
        email: user.email ?? null,
        isActive: Boolean(user.Service_Resources.isActive),
      });
    }
    if (!body?.info?.more_records) break;
  }
  const displayNameFor = buildDisplayNamer(resources);
  const value = resources.map((r) => ({ ...r, displayName: displayNameFor(r) }));
  techniciansCache = { at: Date.now(), value };
  noteRead("technicians");
  return value;
}

export async function fetchTimeOffLive(admin: SupabaseClient): Promise<LiveTimeOff[]> {
  const hit = fresh(timeOffCache ?? undefined);
  if (hit) return hit;
  const reader = await readerFor(admin, MAX_LIST_PAGES);
  const out: LiveTimeOff[] = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const res = await reader.get(
      `/Time_Off?per_page=${PER_PAGE}&page=${page}&fields=Service_Resource,Start_Date_Time,End_Date_Time,Time_Off_Type,Reason`,
    );
    if (res.status === 204) break;
    if (!res.ok) throw failure(res.status, res.json);
    for (const r of dataOf(res.json)) {
      const technicianFsmId = lookupId(r.Service_Resource);
      if (!technicianFsmId || !r.Start_Date_Time || !r.End_Date_Time) continue;
      out.push({
        technicianFsmId,
        startAt: String(r.Start_Date_Time),
        endAt: String(r.End_Date_Time),
        category: r.Time_Off_Type ? String(r.Time_Off_Type) : r.Reason ? String(r.Reason) : null,
      });
    }
    if (!(res.json as { info?: { more_records?: boolean } } | null)?.info?.more_records) break;
  }
  timeOffCache = { at: Date.now(), value: out };
  noteRead("time_off");
  return out;
}
