import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  AWAITING_ACTION,
  isFsmCompleted,
  lineCanBeInvoiced,
  lineRemaining,
  lineStatus,
  withVat,
  queueStatus,
  workOrderInvoicing,
  type InvoiceStatus,
  type LineState,
  type QueueStatus,
  type WorkflowStatus,
  type WorkOrderInvoicing,
} from "@/lib/finance/line-status";
import {
  effectiveEntry,
  invoiceCap,
  isFlaggedToInvoice,
  isNonBillable,
  isVoid,
  lineBillable,
  readyForFinance,
  recognisedValue,
  type ProgressEntry,
  type ProgressPurpose,
} from "@/lib/finance/progress";
import { addDaysToDateString, todayInZone, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import {
  fetchEstimateLive,
  fetchQuotationFlagsLive,
  fetchWorkOrderLive,
  fetchWorkOrdersLive,
  forgetLists,
  FsmLiveError,
  type LiveWorkOrder,
} from "@/lib/server/finance/fsm-live";
import { readReportingSettings } from "@/lib/server/reporting/settings";
import type { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";
import { readAllByIds, readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Ready to invoice, by FSM work order (the user's direction, 22 Oct).
 *
 * The work orders, their line items and quotations are read live from Zoho
 * FSM (lib/server/finance/fsm-live.ts), never from the portal's synced
 * copy. What the portal itself decides is kept in schema finance
 * (migration 20261024100000): MAHER invoices against lines in full or in
 * part, and the queue's workflow on the work order (query, hold, not to be
 * invoiced).
 *
 * Two views (26 Oct): Finance sees work Completed in FSM with its
 * quotation flagged "To Be Invoiced", and work Operations has said is X %
 * done to invoice (lib/finance/progress.ts); Operations sees every work
 * order, with those whose appointments are all done but which nobody has
 * marked Completed. Non-billable and Void (FSM) are never invoiced.
 * Recording an invoice moves an open work order to In Progress.
 *
 * One status per work order: Not ready, Pending, In Progress, Query
 * Raised, On Hold, Partially invoiced, Invoiced, Excluded. "Awaiting
 * action" is the work Finance still has to do something with.
 */

/** The furthest back Ready to invoice looks: four months. */
export const WORK_ORDER_MAX_DAYS = 122;
export const WORK_ORDER_DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const workOrderFiltersSchema = z.object({
  from: DATE.optional(),
  to: DATE.optional(),
  q: z.string().trim().max(200).optional(),
  client: z.string().trim().max(200).optional(),
  /** FSM's owner of the work order. */
  coordinator: z.string().trim().max(200).optional(),
  /** The work order's status in Zoho FSM, as fsmStatusLabel words it (27 Oct). */
  fsm: z.string().trim().max(60).optional(),
  /** "all" (the default), "open" (awaiting action), or one queue status. */
  status: z
    .enum([
      "open",
      "all",
      "not_ready",
      "pending",
      "in_progress",
      "query_raised",
      "on_hold",
      "partially_invoiced",
      "invoiced",
      "excluded",
      "non_billable",
      "void",
    ])
    .optional(),
  /** Finance (ready to invoice) or Operations (every work order). */
  view: z.enum(["finance", "operations"]).optional(),
  /** "1": Operations' reminder only: appointments all done, not marked Completed in FSM. */
  attention: z.enum(["0", "1"]).optional(),
  /** "1": pending longer than the aged setting. */
  aged: z.enum(["0", "1"]).optional(),
  /** "1": ask FSM again rather than use the last ten minutes' answer. */
  refresh: z.enum(["0", "1"]).optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type WorkOrderFilters = z.infer<typeof workOrderFiltersSchema>;

/** The dates asked for, kept inside the four-month window. */
export function workOrderPeriod(filters: { from?: string; to?: string }, today = todayInZone()) {
  const earliest = addDaysToDateString(today, -(WORK_ORDER_MAX_DAYS - 1));
  let to = filters.to && filters.to <= today ? filters.to : today;
  let from = filters.from ?? addDaysToDateString(to, -(WORK_ORDER_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  const clamped = from < earliest;
  if (clamped) from = earliest;
  if (to < earliest) to = earliest;
  return { from, to, earliest, today, clamped };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A work order's status in Zoho FSM for the filter: Non-billable by its Billing Status too. */
export function fsmStatusLabel(w: Pick<LiveWorkOrder, "status" | "invoicingStatus">): string {
  return isNonBillable(w.invoicingStatus) ? "Non-billable" : (w.status ?? "No status");
}

/* FSM's statuses in the order work moves through them; the four Finance asked for always offered. */
const FSM_STATUS_ORDER = ["New", "Scheduled Appointment", "Dispatched", "In Progress", "Completed", "Cannot Complete", "Cancelled", "Non-billable", "Void"];
const FSM_STATUS_ALWAYS = ["In Progress", "Completed", "Non-billable", "Void"];

function fsmStatusOptions(present: string[]): string[] {
  const all = [...new Set([...FSM_STATUS_ALWAYS, ...present])];
  const rank = (s: string) => (FSM_STATUS_ORDER.includes(s) ? FSM_STATUS_ORDER.indexOf(s) : FSM_STATUS_ORDER.length);
  return all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/*
  The status a line's invoicing reads: the work order's, or Non-billable when
  FSM's Billing Status (the line's own, else the work order's) says so.
*/
const lineBilling = (line: { billing_status?: string | null }, wo: LiveWorkOrder) =>
  lineBillable(line.billing_status, wo.billingStatus) || isVoid(wo.status) ? wo.status : "Non-billable";
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ---------------------------------------------------------------------
// The portal's own records for some work orders
// ---------------------------------------------------------------------

/* The ledger tables arrive with migration 20261024100000; before it, everything reads as Not ready. */
function ledgerMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /line_states|line_invoices|line_events|work_order_states|wo_exclusions|schema cache/i.test(error.message ?? "")
  );
}

type StateRow = {
  lineId: string;
  workOrderId: string;
  name: string | null;
  amount: number;
  ready: boolean;
  invoicedAmount: number;
  readyAt: string | null;
  readyBy: string | null;
  /** When FSM said the line was completed, as last seen (migration 20261025100000). */
  completedAt: string | null;
};

type ProgressRow = ProgressEntry & {
  id: string;
  workOrderId: string;
  lineName: string | null;
  valueBeforeVat: number;
  note: string | null;
  recordedBy: string | null;
};

/* Operations' "% done" (migration 20261026100000); before it, nobody has recorded any. */
async function loadProgress(admin: SupabaseClient, workOrderIds: string[]): Promise<{ ready: boolean; byWorkOrder: Map<string, ProgressRow[]> }> {
  const byWorkOrder = new Map<string, ProgressRow[]>();
  if (!workOrderIds.length) return { ready: true, byWorkOrder };
  try {
    const rows = await readAllByIds<Record<string, unknown>>(
      workOrderIds,
      (chunk, from, to) =>
        admin.schema("finance").from("progress_entries").select("*").in("fsm_work_order_id", chunk).order("recorded_at").range(from, to),
      "progress",
    );
    for (const r of rows) {
      const row: ProgressRow = {
        id: String(r.id),
        workOrderId: String(r.fsm_work_order_id),
        lineId: str(r.fsm_line_id),
        lineName: str(r.line_name),
        percent: Number(r.percent),
        purpose: r.purpose === "revenue_only" ? "revenue_only" : "invoice",
        valueBeforeVat: Number(r.value_before_vat ?? 0),
        note: str(r.note),
        recordedBy: str(r.recorded_by_label),
        recordedAt: String(r.recorded_at),
      };
      byWorkOrder.set(row.workOrderId, [...(byWorkOrder.get(row.workOrderId) ?? []), row]);
    }
    return { ready: true, byWorkOrder };
  } catch (error) {
    if (/progress_entries|PGRST205|42P01|schema cache/i.test(error instanceof Error ? error.message : String(error))) {
      return { ready: false, byWorkOrder };
    }
    throw error;
  }
}

/**
 * In the list, where FSM gives no lines: what Operations' "invoice"
 * percentages allow, over the lines the portal knows and, for a whole-work-
 * order entry, the rest of the work order's value.
 */
function progressCap(entries: ProgressRow[], states: StateRow[], subTotal: number | null, workOrderStatus: string | null): number {
  if (!entries.length) return 0;
  const known = new Map(states.map((s) => [s.lineId, { amount: s.amount, invoiced: s.invoicedAmount }]));
  for (const e of entries) if (e.lineId && !known.has(e.lineId)) known.set(e.lineId, { amount: e.valueBeforeVat, invoiced: 0 });
  let cap = 0;
  let knownValue = 0;
  for (const [lineId, m] of known) {
    knownValue += m.amount;
    cap += invoiceCap({ amount: m.amount, invoicedAmount: m.invoiced }, { workOrderStatus, postToMaher: null, entry: effectiveEntry(lineId, entries) });
  }
  const whole = entries.filter((e) => e.lineId === null).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
  if (whole && whole.purpose === "invoice" && subTotal && !isNonBillable(workOrderStatus) && !isVoid(workOrderStatus)) {
    cap += (Math.max(0, subTotal - knownValue) * whole.percent) / 100;
  }
  return round2(cap);
}

type WorkflowRow = {
  status: WorkflowStatus;
  statusChangedAt: string;
  assigneeId: string | null;
  assignee: string | null;
  holdReason: string | null;
  queryText: string | null;
};

async function loadLedger(
  admin: SupabaseClient,
  workOrderIds: string[],
): Promise<{ states: StateRow[]; workflow: Map<string, WorkflowRow>; ready: boolean }> {
  try {
    const [states, flows] = await Promise.all([
      readAllByIds<Record<string, unknown>>(
        workOrderIds,
        (chunk, from, to) =>
          admin
            .schema("finance")
            .from("line_states")
            /* Every column: fsm_completed_at arrives with 20261025100000. */
            .select("*")
            .in("fsm_work_order_id", chunk)
            .order("fsm_line_id")
            .range(from, to),
        "line states",
      ),
      readAllByIds<Record<string, unknown>>(
        workOrderIds,
        (chunk, from, to) =>
          admin
            .schema("finance")
            .from("work_order_states")
            .select("fsm_work_order_id, status, status_changed_at, assignee_id, assignee_label, hold_reason, query_text")
            .in("fsm_work_order_id", chunk)
            .order("fsm_work_order_id")
            .range(from, to),
        "work order states",
      ),
    ]);
    return {
      ready: true,
      states: states.map((r) => ({
        lineId: String(r.fsm_line_id),
        workOrderId: String(r.fsm_work_order_id),
        name: str(r.name),
        amount: Number(r.amount ?? 0),
        ready: Boolean(r.ready),
        invoicedAmount: Number(r.invoiced_amount ?? 0),
        readyAt: str(r.ready_at),
        readyBy: str(r.ready_by_label),
        completedAt: str(r.fsm_completed_at),
      })),
      workflow: new Map(
        flows.map((f) => [
          String(f.fsm_work_order_id),
          {
            status: f.status as WorkflowStatus,
            statusChangedAt: String(f.status_changed_at),
            assigneeId: str(f.assignee_id),
            assignee: str(f.assignee_label),
            holdReason: str(f.hold_reason),
            queryText: str(f.query_text),
          },
        ]),
      ),
    };
  } catch (error) {
    if (ledgerMissing({ message: error instanceof Error ? error.message : String(error) })) {
      return { ready: false, states: [], workflow: new Map() };
    }
    throw error;
  }
}

/**
 * Where a work order's invoicing stands in the list, where FSM gives no
 * lines: what the portal recorded as invoiced against FSM's total, ready
 * when the work order is completed in FSM. Invoiced in full only when the
 * invoiced amount reaches FSM's total.
 */
function invoicingFrom(states: StateRow[], subTotal: number | null, completed: boolean, progressValue = 0): WorkOrderInvoicing {
  const invoicedValue = round2(states.reduce((sum, s) => sum + s.invoicedAmount, 0));
  const value = subTotal ?? round2(states.reduce((sum, s) => sum + s.amount, 0));
  const remainingValue = Math.max(0, round2(value - invoicedValue));
  /* Ready for Finance: all that is left; before that, what Operations' percentages allow. */
  const readyValue = completed ? remainingValue : Math.min(remainingValue, progressValue);
  const status: InvoiceStatus =
    invoicedValue > 0 && remainingValue <= 0.01
      ? "invoiced"
      : invoicedValue > 0
        ? "partially_invoiced"
        : readyValue > 0.01
          ? "ready"
          : "not_ready";
  return {
    status,
    lines: states.length,
    readyLines: completed ? states.length : states.filter((s) => s.completedAt).length,
    readyValue,
    invoicedValue,
    remainingValue,
  };
}

/** VAT-inclusive, at the work order's own rate (FSM's Grand_Total over Sub_Total). */
function vatOf(w: { subTotal: number | null; grandTotal: number | null }, amount: number): number {
  return w.subTotal && w.grandTotal !== null && w.subTotal > 0 ? round2((amount * w.grandTotal) / w.subTotal) : amount;
}

/**
 * Work orders the portal holds records for that are not among the live
 * rows: their header as FSM gave it when someone last acted on them
 * (migration 20261025100000), so work still waiting is listed whatever
 * the dates, without reading FSM for it. Before that migration only the
 * work order number is known.
 */
async function ledgerWorkOrdersOutside(admin: SupabaseClient, live: Set<string>): Promise<LiveWorkOrder[]> {
  try {
    const [flows, ready] = await Promise.all([
      readAllRows<Record<string, unknown>>(
        (from, to) => admin.schema("finance").from("work_order_states").select("*").order("fsm_work_order_id").range(from, to),
        "work order states",
      ),
      readAllRows<Record<string, unknown>>(
        (from, to) =>
          admin
            .schema("finance")
            .from("line_states")
            .select("fsm_line_id, fsm_work_order_id, work_order_number")
            .eq("ready", true)
            .order("fsm_line_id")
            .range(from, to),
        "ready lines",
      ),
    ]);
    const blank = (id: string, number: string | null): LiveWorkOrder => ({
      id,
      number,
      status: null,
      type: null,
      workType: null,
      billingStatus: null,
      invoicingStatus: null,
      companyName: null,
      contactName: null,
      ownerName: null,
      estimateId: null,
      estimateNumber: null,
      createdAt: null,
      completedAt: null,
      modifiedAt: null,
      subTotal: null,
      grandTotal: null,
      taxAmount: null,
      appointmentStatuses: [],
    });
    const outside = new Map<string, LiveWorkOrder>();
    for (const r of flows) {
      const id = String(r.fsm_work_order_id);
      if (live.has(id)) continue;
      outside.set(id, {
        ...blank(id, str(r.work_order_number)),
        status: str(r.fsm_status),
        type: str(r.work_order_type),
        companyName: str(r.client_name),
        contactName: str(r.contact_name),
        ownerName: str(r.coordinator_name),
        estimateNumber: str(r.quotation_number),
        createdAt: str(r.fsm_created_at),
        completedAt: str(r.fsm_completed_at),
        subTotal: r.sub_total === null || r.sub_total === undefined ? null : Number(r.sub_total),
        grandTotal: r.grand_total === null || r.grand_total === undefined ? null : Number(r.grand_total),
      });
    }
    for (const r of ready) {
      const id = String(r.fsm_work_order_id);
      if (!live.has(id) && !outside.has(id)) outside.set(id, blank(id, str(r.work_order_number)));
    }
    return [...outside.values()];
  } catch (error) {
    if (ledgerMissing({ message: error instanceof Error ? error.message : String(error) })) return [];
    throw error;
  }
}

// ---------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------

export type WorkOrderListRow = {
  id: string;
  number: string | null;
  fsmStatus: string | null;
  type: string | null;
  clientName: string | null;
  contactName: string | null;
  coordinatorName: string | null;
  quotationNumber: string | null;
  createdAt: string | null;
  completedAt: string | null;
  /** Before VAT, as FSM totals it. */
  value: number | null;
  /** With VAT (FSM's Grand_Total). */
  valueWithVat: number | null;
  invoicing: WorkOrderInvoicing;
  queueStatus: QueueStatus;
  /** Since when it has been in its queue status. */
  statusSince: string | null;
  assigneeName: string | null;
  /** The quotation's Post to MAHER is "To Be Invoiced"; null when there is no quotation. */
  flagged: boolean | null;
  /** Completed in FSM and flagged: Finance invoices all of it. */
  readyForFinance: boolean;
  /** Operations' reminder: its appointments are all done, but it is not marked Completed in FSM. */
  needsCompleting: boolean;
  /** Operations' latest whole-work-order "% done", if any. */
  progressPercent: number | null;
  progressPurpose: ProgressPurpose | null;
};

export type WorkOrderQueueSummary = Record<
  "pending" | "inProgress" | "queryRaised" | "onHold" | "partiallyInvoiced" | "excluded" | "invoiced" | "notReady" | "nonBillable" | "void",
  /** What is still to invoice (or, Not ready and Excluded, the work order's value), before and with VAT. */
  { count: number; value: number; valueWithVat: number }
> & {
  /** Mean days from a line being completed in FSM to the invoice recording it. */
  averageDaysToInvoice: number | null;
  invoices: number;
};

export type WorkOrderList = {
  from: string;
  to: string;
  earliest: string;
  clamped: boolean;
  rows: WorkOrderListRow[];
  total: number;
  summary: WorkOrderQueueSummary;
  options: { clients: string[]; coordinators: string[]; fsmStatuses: string[] };
  agedAfterDays: number;
  /** When FSM was read for this list, and what it cost. */
  fsm: { fetchedAt: string; calls: number; cached: boolean };
  /** Work awaiting action raised outside these dates, listed anyway (from what the portal kept, not FSM). */
  outsideDates: number;
  /** False until migration 20261024100000 is applied: Ready marks, workflow and invoices are off. */
  ledgerReady: boolean;
  view: "finance" | "operations";
  /** Operations: work orders whose appointments are all done but not marked Completed in FSM. */
  needsCompleting: number;
  /** False until migration 20261026100000 is applied: nobody can record "% done". */
  progressReady: boolean;
};

const SUMMARY_KEY: Record<QueueStatus, keyof Omit<WorkOrderQueueSummary, "averageDaysToInvoice" | "invoices">> = {
  pending: "pending",
  in_progress: "inProgress",
  query_raised: "queryRaised",
  on_hold: "onHold",
  partially_invoiced: "partiallyInvoiced",
  excluded: "excluded",
  invoiced: "invoiced",
  not_ready: "notReady",
  non_billable: "nonBillable",
  void: "void",
};

export async function listWorkOrders(admin: SupabaseClient, filters: WorkOrderFilters): Promise<WorkOrderList> {
  const period = workOrderPeriod(filters);
  const fromIso = zonedTimeToUtc(period.from).toISOString();
  const toIso = zonedTimeToUtc(addDaysToDateString(period.to, 1)).toISOString();

  const refresh = filters.refresh === "1";
  const listView = filters.view ?? "finance";
  const [live, settings, flags] = await Promise.all([
    fetchWorkOrdersLive(admin, { fromIso, toIso }, { refresh }),
    readReportingSettings(admin),
    fetchQuotationFlagsLive(admin, { refresh }),
  ]);
  /* Operations' reminder: each work order's appointment statuses come with the list (27 Oct): no separate read. */
  const agedAfterDays = settings.finance.agedAfterDays;
  const outside = await ledgerWorkOrdersOutside(admin, new Set(live.rows.map((w) => w.id)));
  const everyId = [...live.rows, ...outside].map((w) => w.id);
  const [ledger, progress] = await Promise.all([loadLedger(admin, everyId), loadProgress(admin, everyId)]);
  const statesOf = new Map<string, StateRow[]>();
  for (const s of ledger.states) statesOf.set(s.workOrderId, [...(statesOf.get(s.workOrderId) ?? []), s]);

  const now = Date.now();
  const view = (w: LiveWorkOrder) => {
    const states = statesOf.get(w.id) ?? [];
    const entries = progress.byWorkOrder.get(w.id) ?? [];
    const flag = w.estimateId ? (flags.byId.get(w.estimateId)?.postToMaher ?? null) : null;
    /* Non Billable by FSM's Billing Status counts as Non-billable, whatever the status. */
    const billing = w.invoicingStatus;
    const finance = readyForFinance(billing, flag);
    const invoicing = invoicingFrom(states, w.subTotal, finance, finance ? 0 : progressCap(entries, states, w.subTotal, billing));
    const flow = ledger.workflow.get(w.id);
    const workflow: WorkflowStatus = flow?.status ?? "open";
    const status = queueStatus(workflow, invoicing.status, billing);
    const firstReady = states.map((s) => s.readyAt).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
    const statusSince = workflow !== "open" && flow ? flow.statusChangedAt : (firstReady ?? w.completedAt ?? w.createdAt);
    const done = w.appointmentStatuses;
    const finished = isFsmCompleted(billing) || isNonBillable(billing) || isVoid(billing) || /^cancel/i.test(billing ?? "");
    const whole = entries.filter((e) => e.lineId === null).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
    return {
      invoicing,
      status,
      statusSince,
      assignee: flow?.assignee ?? null,
      flagged: w.estimateId ? isFlaggedToInvoice(flag) : null,
      finance,
      /* Finance's view: ready for Finance, as far as Operations allows, or work Finance has already started. */
      forFinance:
        !isVoid(billing) &&
        (finance || invoicing.readyValue > 0.01 || invoicing.invoicedValue > 0 || workflow !== "open" || isNonBillable(billing)),
      needsCompleting: !finished && done.length > 0 && done.every((st) => isFsmCompleted(st)),
      progressPercent: whole?.percent ?? null,
      progressPurpose: whole?.purpose ?? null,
    };
  };
  const views = new Map([...live.rows, ...outside].map((w) => [w.id, view(w)]));
  /* Work still waiting is never hidden by the dates. */
  const earlier = outside.filter((w) => AWAITING_ACTION.includes(views.get(w.id)!.status));
  const inView = (w: LiveWorkOrder) => listView === "operations" || views.get(w.id)!.forFinance;
  const all = [...live.rows, ...earlier].filter(inView).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const ids = all.map((w) => w.id);
  const daysIn = (since: string | null) => (since ? Math.max(0, Math.floor((now - Date.parse(since)) / DAY_MS)) : 0);

  const wanted: QueueStatus[] | null =
    filters.status === "open" ? AWAITING_ACTION : !filters.status || filters.status === "all" ? null : [filters.status as QueueStatus];
  const needle = (filters.q ?? "").toLowerCase();
  const matching = all.filter((w) => {
    const v = views.get(w.id)!;
    /* "In Progress" is one choice in the one status filter (27 Oct): in progress in the portal or in Zoho FSM. */
    if (wanted && !wanted.includes(v.status) && !(filters.status === "in_progress" && fsmStatusLabel(w) === "In Progress")) return false;
    if (filters.attention === "1" && !v.needsCompleting) return false;
    if (filters.client && (w.contactName ?? w.companyName) !== filters.client) return false;
    if (filters.coordinator && w.ownerName !== filters.coordinator) return false;
    if (filters.fsm && fsmStatusLabel(w) !== filters.fsm) return false;
    if (filters.aged === "1" && !(v.status === "pending" && daysIn(v.statusSince) >= agedAfterDays)) return false;
    if (needle && !`${w.number ?? ""} ${w.estimateNumber ?? ""} ${w.companyName ?? ""} ${w.contactName ?? ""}`.toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });

  const rows: WorkOrderListRow[] = matching.slice(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize).map((w) => {
    const v = views.get(w.id)!;
    return {
      id: w.id,
      number: w.number,
      fsmStatus: w.status,
      type: w.type,
      clientName: w.companyName,
      contactName: w.contactName,
      coordinatorName: w.ownerName,
      quotationNumber: w.estimateNumber,
      createdAt: w.createdAt,
      completedAt: w.completedAt,
      value: w.subTotal,
      valueWithVat: w.grandTotal,
      invoicing: v.invoicing,
      queueStatus: v.status,
      statusSince: v.statusSince,
      assigneeName: v.assignee,
      flagged: v.flagged,
      readyForFinance: v.finance,
      needsCompleting: v.needsCompleting,
      progressPercent: v.progressPercent,
      progressPurpose: v.progressPurpose,
    };
  });

  /* The summary strip counts every work order listed, whatever the status filter. */
  const blank = () => ({ count: 0, value: 0, valueWithVat: 0 });
  const summary: WorkOrderQueueSummary = {
    pending: blank(),
    inProgress: blank(),
    queryRaised: blank(),
    onHold: blank(),
    partiallyInvoiced: blank(),
    excluded: blank(),
    invoiced: blank(),
    notReady: blank(),
    nonBillable: blank(),
    void: blank(),
    averageDaysToInvoice: null,
    invoices: 0,
  };
  for (const w of all) {
    const v = views.get(w.id)!;
    const b = summary[SUMMARY_KEY[v.status]];
    b.count += 1;
    const value =
      v.status === "excluded" || v.status === "not_ready" || v.status === "non_billable" || v.status === "void"
        ? (w.subTotal ?? 0)
        : v.status === "invoiced"
          ? v.invoicing.invoicedValue
          : v.invoicing.remainingValue;
    b.value = round2(b.value + value);
    b.valueWithVat = round2(b.valueWithVat + vatOf(w, value));
  }
  const completedAtOf = new Map(all.map((w) => [w.id, w.completedAt]));
  Object.assign(summary, await daysToInvoice(admin, ids, ledger.ready, completedAtOf));

  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));

  return {
    from: period.from,
    to: period.to,
    earliest: period.earliest,
    clamped: period.clamped,
    rows,
    total: matching.length,
    summary,
    options: {
      clients: distinct(all.map((w) => w.contactName ?? w.companyName)),
      coordinators: distinct(all.map((w) => w.ownerName)),
      fsmStatuses: fsmStatusOptions(all.map(fsmStatusLabel)),
    },
    agedAfterDays,
    fsm: {
      fetchedAt: live.fetchedAt,
      calls: (live.cached ? 0 : live.calls) + (flags.cached ? 0 : flags.calls),
      cached: live.cached,
    },
    outsideDates: earlier.length,
    ledgerReady: ledger.ready,
    view: listView,
    needsCompleting: all.filter((w) => views.get(w.id)!.needsCompleting).length,
    progressReady: progress.ready,
  };
}

/**
 * Mean days from a line being completed in FSM to the invoice that
 * recorded it, over these work orders: the line's completion as last seen,
 * else the work order's, else (before 20261025100000) its old Ready mark.
 */
async function daysToInvoice(
  admin: SupabaseClient,
  workOrderIds: string[],
  ledgerReady: boolean,
  completedAtOf: Map<string, string | null>,
): Promise<{ averageDaysToInvoice: number | null; invoices: number }> {
  if (!ledgerReady || !workOrderIds.length) return { averageDaysToInvoice: null, invoices: 0 };
  const allocations = await readAllByIds<Record<string, unknown>>(
    workOrderIds,
    (chunk, from, to) =>
      admin
        .schema("finance")
        .from("line_invoice_allocations")
        .select("id, invoice_id, fsm_line_id, fsm_work_order_id")
        .in("fsm_work_order_id", chunk)
        .order("id")
        .range(from, to),
    "allocations",
  );
  if (!allocations.length) return { averageDaysToInvoice: null, invoices: 0 };
  const invoiceIds = [...new Set(allocations.map((a) => String(a.invoice_id)))];
  const lineIds = [...new Set(allocations.map((a) => String(a.fsm_line_id)))];
  const [invoices, states] = await Promise.all([
    readAllByIds<Record<string, unknown>>(
      invoiceIds,
      (chunk, from, to) => admin.schema("finance").from("line_invoices").select("id, recorded_at").in("id", chunk).order("id").range(from, to),
      "invoices",
    ),
    readAllByIds<Record<string, unknown>>(
      lineIds,
      (chunk, from, to) =>
        admin.schema("finance").from("line_states").select("*").in("fsm_line_id", chunk).order("fsm_line_id").range(from, to),
      "completion times",
    ),
  ]);
  const recorded = new Map(invoices.map((i) => [String(i.id), Date.parse(String(i.recorded_at))]));
  const lineStart = new Map(states.map((s) => [String(s.fsm_line_id), str(s.fsm_completed_at) ?? str(s.ready_at)]));
  /* One span per invoice and work order (as the metrics count it): from its earliest line's start to the invoice. */
  const startOf = new Map<string, { start: number; at: number }>();
  for (const a of allocations) {
    const start = str(completedAtOf.get(String(a.fsm_work_order_id))) ?? lineStart.get(String(a.fsm_line_id)) ?? null;
    const at = recorded.get(String(a.invoice_id));
    if (!start || !at) continue;
    const key = `${a.invoice_id}|${a.fsm_work_order_id}`;
    const earliest = Math.min(Date.parse(start), startOf.get(key)?.start ?? Infinity);
    startOf.set(key, { start: earliest, at });
  }
  const spans = [...startOf.values()].map((g) => Math.max(0, (g.at - g.start) / DAY_MS));
  return {
    averageDaysToInvoice: spans.length ? Math.round((spans.reduce((a, b) => a + b, 0) / spans.length) * 10_000) / 10_000 : null,
    invoices: invoiceIds.length,
  };
}

// ---------------------------------------------------------------------
// One work order
// ---------------------------------------------------------------------

export type WorkOrderLine = {
  id: string;
  name: string | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  discount: number | null;
  /** Before VAT (D-05). */
  amount: number | null;
  /** FSM's Line_Item_Amount, VAT included. */
  lineAmount: number | null;
  taxPercent: number | null;
  /** FSM's Billing Status of the line ("Non Billable" is never invoiced). */
  billingStatus: string | null;
  /** May be invoiced: by its Billing Status, else the work order's. Not: no cap, nothing remaining. */
  billable: boolean;
  status: string | null;
  sequence: number | null;
  isOptional: boolean;
  actualStart: string | null;
  actualEnd: string | null;
  ready: boolean;
  readyAt: string | null;
  readyBy: string | null;
  invoicedAmount: number;
  remaining: number;
  invoiceStatus: InvoiceStatus;
  /** What Finance may invoice of it now, before VAT (lib/finance/progress.ts). */
  cap: number;
  /** Recognised as revenue, before VAT. */
  recognised: number;
  /** Operations' latest "% done" that counts for this line (its own or the whole work order's). */
  progress: { percent: number; purpose: ProgressPurpose; recordedAt: string; recordedBy: string | null; wholeWorkOrder: boolean } | null;
};

export type WorkOrderInvoice = {
  id: string;
  number: string;
  date: string;
  total: number;
  recordedBy: string | null;
  recordedAt: string;
  hasFile: boolean;
  allocations: Array<{ lineId: string; lineName: string | null; amount: number }>;
};

export type WorkOrderEventType =
  | "marked_ready"
  | "unmarked_ready"
  | "invoiced"
  | "picked_up"
  | "released"
  | "query_raised"
  | "query_answered"
  | "put_on_hold"
  | "resumed"
  | "exclusion_requested"
  | "exclusion_verified"
  | "exclusion_rejected"
  | "progress_recorded";

export type WorkOrderEvent = {
  id: number;
  type: WorkOrderEventType;
  lineId: string | null;
  lineName: string | null;
  amount: number | null;
  actor: string | null;
  note: string | null;
  at: string;
};

export type WorkOrderExclusion = {
  id: string;
  reason: string;
  notes: string | null;
  evidence: string[];
  requestedBy: string | null;
  requestedAt: string;
  decision: "verified" | "rejected" | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type WorkOrderDetail = {
  workOrder: LiveWorkOrder;
  quotation: {
    id: string;
    number: string | null;
    status: string | null;
    subTotal: number | null;
    grandTotal: number | null;
    postToMaher: string | null;
    ownerName: string | null;
    contactName: string | null;
    expiryDate: string | null;
    /** The quotation as the quotation templates draw it, when FSM gave it. */
    document: QuotationData | null;
  } | null;
  lines: WorkOrderLine[];
  invoicing: WorkOrderInvoicing;
  queueStatus: QueueStatus;
  workflow: WorkflowStatus;
  statusSince: string | null;
  assigneeName: string | null;
  holdReason: string | null;
  queryText: string | null;
  exclusions: WorkOrderExclusion[];
  invoices: WorkOrderInvoice[];
  events: WorkOrderEvent[];
  /** False until migration 20261024100000 is applied. */
  ledgerReady: boolean;
  /** When FSM was read for this work order. */
  fetchedAt: string;
  fromCache: boolean;
  /** The quotation's Post to MAHER is "To Be Invoiced"; null when there is no quotation. */
  flagged: boolean | null;
  /** Completed in FSM and flagged: Finance invoices all of it. */
  readyForFinance: boolean;
  /** Recognised, invoiced and still to invoice, before VAT (change 7). */
  revenue: { recognised: number; invoiced: number; remaining: number };
  /** Its appointments, for their service reports. */
  appointmentIds: string[];
  /** False until migration 20261026100000 is applied. */
  progressReady: boolean;
};

export async function readWorkOrderDetail(
  admin: SupabaseClient,
  id: string,
  options: { refresh?: boolean } = {},
): Promise<WorkOrderDetail | null> {
  const live = await fetchWorkOrderLive(admin, id, { refresh: options.refresh });
  if (!live) return null;
  if (options.refresh) forgetLists();
  const wo = live.workOrder;
  /* One round (27 Oct): the quotation, the ledger, % done and the history together. */
  const [estimate, ledger, progress, history] = await Promise.all([
    wo.estimateId ? fetchEstimateLive(admin, wo.estimateId, { refresh: options.refresh }).catch(() => null) : Promise.resolve(null),
    loadLedger(admin, [id]),
    loadProgress(admin, [id]),
    readHistoryRows(admin, id).catch(() => null),
  ]);
  const stateOf = new Map(ledger.states.map((s) => [s.lineId, s]));
  const entries = progress.byWorkOrder.get(id) ?? [];
  const postToMaher = estimate?.post_to_maher ?? null;

  const lines: WorkOrderLine[] = live.lines.map((l) => {
    const lineId = String(l.fsm_line_id);
    const state = stateOf.get(lineId);
    const invoicedAmount = state?.invoicedAmount ?? 0;
    const entry = effectiveEntry(lineId, entries) as ProgressRow | null;
    const billable = !isNonBillable(lineBilling(l, wo));
    const cap = invoiceCap({ amount: l.amount, invoicedAmount }, { workOrderStatus: lineBilling(l, wo), postToMaher, entry });
    /* A non-billable line leaves nothing to invoice beyond what already was. */
    const ls: LineState = { amount: billable ? l.amount : invoicedAmount, ready: cap > 0.005, invoicedAmount, cap };
    return {
      id: String(l.fsm_line_id),
      name: l.name,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unit_price,
      discount: l.discount,
      amount: l.amount,
      lineAmount: l.line_amount,
      taxPercent: l.tax_percent,
      billingStatus: l.billing_status ?? null,
      billable,
      status: l.status,
      sequence: l.sequence,
      isOptional: Boolean(l.is_optional),
      actualStart: l.actual_start,
      actualEnd: l.actual_end,
      ready: ls.ready,
      readyAt: state?.readyAt ?? null,
      readyBy: state?.readyBy ?? null,
      invoicedAmount: ls.invoicedAmount,
      remaining: lineRemaining(ls),
      invoiceStatus: lineStatus(ls),
      cap,
      recognised: recognisedValue({ amount: l.amount, invoicedAmount }, { workOrderStatus: lineBilling(l, wo), entry }),
      progress: entry
        ? { percent: entry.percent, purpose: entry.purpose, recordedAt: entry.recordedAt, recordedBy: entry.recordedBy, wholeWorkOrder: entry.lineId === null }
        : null,
    };
  });

  const flow = ledger.workflow.get(id);
  const workflow: WorkflowStatus = flow?.status ?? "open";
  /* Only billable lines are owed; FSM's total counts the non-billable ones too. */
  const billableLines = lines.filter((l) => l.billable);
  let invoicing = workOrderInvoicing(billableLines);
  const owed = billableLines.length === lines.length ? wo.subTotal : round2(billableLines.reduce((sum, l) => sum + (l.amount ?? 0), 0));
  /* As in the list: invoiced in full only when the invoiced amount reaches FSM's total. */
  if (invoicing.status === "invoiced" && owed !== null && invoicing.invoicedValue < owed - 0.01) {
    invoicing = { ...invoicing, status: "partially_invoiced" };
  }
  const status = queueStatus(workflow, invoicing.status, wo.invoicingStatus);
  const firstReady = lines.map((l) => l.readyAt).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const completedAt =
    wo.completedAt ?? lines.filter((l) => isFsmCompleted(l.status)).map((l) => l.actualEnd).filter((v): v is string => Boolean(v)).sort()[0] ?? null;
  const extra = ledger.ready && history ? shapeHistory(history, lines) : { invoices: [], events: [], exclusions: [] };

  return {
    workOrder: wo,
    quotation: estimate
      ? {
          id: String(estimate.fsm_estimate_id),
          number: estimate.number,
          status: estimate.status,
          subTotal: estimate.sub_total,
          grandTotal: estimate.grand_total,
          postToMaher: estimate.post_to_maher,
          ownerName: estimate.owner_name,
          contactName: estimate.contact_name,
          expiryDate: estimate.expiry_date,
          document: estimate.document ?? null,
        }
      : wo.estimateId
        ? { id: wo.estimateId, number: wo.estimateNumber, status: null, subTotal: null, grandTotal: null, postToMaher: null, ownerName: null, contactName: null, expiryDate: null, document: null }
        : null,
    lines,
    invoicing,
    queueStatus: status,
    workflow,
    statusSince: workflow !== "open" && flow ? flow.statusChangedAt : (firstReady ?? completedAt ?? wo.createdAt),
    assigneeName: flow?.assignee ?? null,
    holdReason: flow?.holdReason ?? null,
    queryText: flow?.queryText ?? null,
    ...extra,
    ledgerReady: ledger.ready,
    fetchedAt: live.fetchedAt,
    fromCache: live.cached,
    flagged: wo.estimateId ? isFlaggedToInvoice(postToMaher) : null,
    readyForFinance: readyForFinance(wo.invoicingStatus, postToMaher),
    revenue: {
      recognised: round2(lines.reduce((sum, l) => sum + l.recognised, 0)),
      invoiced: invoicing.invoicedValue,
      remaining: invoicing.remainingValue,
    },
    appointmentIds: live.appointmentIds,
    progressReady: progress.ready,
  };
}

/* A work order's invoices (each allocation with its invoice, one query), history and exclusions: one round. */
async function readHistoryRows(admin: SupabaseClient, workOrderId: string) {
  const fin = admin.schema("finance");
  const [allocations, events, exclusions, states] = await Promise.all([
    fin
      .from("line_invoice_allocations")
      .select("invoice_id, fsm_line_id, amount, line_invoices(id, maher_invoice_number, invoice_date, total_amount, recorded_by_label, recorded_at, file_path)")
      .eq("fsm_work_order_id", workOrderId)
      .order("id"),
    fin
      .from("line_events")
      .select("id, event_type, fsm_line_id, amount, actor_label, note, created_at")
      .eq("fsm_work_order_id", workOrderId)
      .order("created_at", { ascending: false })
      .limit(200),
    fin
      .from("wo_exclusions")
      .select("id, reason, notes, evidence, requested_by_label, requested_at, decision, decision_note, decided_by_label, decided_at")
      .eq("fsm_work_order_id", workOrderId)
      .order("requested_at", { ascending: true }),
    fin.from("line_states").select("fsm_line_id, name").eq("fsm_work_order_id", workOrderId),
  ]);
  for (const r of [allocations, events, exclusions, states]) if (r.error) throw new Error(r.error.message);
  return { allocations: allocations.data ?? [], events: events.data ?? [], exclusions: exclusions.data ?? [], states: states.data ?? [] };
}

type InvoiceHeaderRow = {
  id: string;
  maher_invoice_number: string;
  invoice_date: string;
  total_amount: number;
  recorded_by_label: string | null;
  recorded_at: string;
  file_path: string | null;
};

function shapeHistory(rows: NonNullable<Awaited<ReturnType<typeof readHistoryRows>>>, lines: WorkOrderLine[]) {
  const names = new Map(lines.map((l) => [l.id, l.name]));
  /* A line FSM no longer lists keeps the name it had. */
  for (const s of rows.states) if (!names.has(String(s.fsm_line_id))) names.set(String(s.fsm_line_id), str(s.name));
  const allocations = rows.allocations;
  const headerOf = new Map<string, InvoiceHeaderRow>();
  for (const a of allocations) {
    const h = (Array.isArray(a.line_invoices) ? a.line_invoices[0] : a.line_invoices) as InvoiceHeaderRow | null | undefined;
    if (h) headerOf.set(String(h.id), h);
  }
  const events = { data: rows.events };
  const exclusions = { data: rows.exclusions };

  const invoices: WorkOrderInvoice[] = [...headerOf.values()]
    .map((h) => ({
      id: String(h.id),
      number: String(h.maher_invoice_number),
      date: String(h.invoice_date),
      total: Number(h.total_amount),
      recordedBy: str(h.recorded_by_label),
      recordedAt: String(h.recorded_at),
      hasFile: Boolean(h.file_path),
      allocations: allocations
        .filter((a) => String(a.invoice_id) === String(h.id))
        .map((a) => ({ lineId: String(a.fsm_line_id), lineName: names.get(String(a.fsm_line_id)) ?? null, amount: Number(a.amount) })),
    }))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return {
    invoices,
    events: (events.data ?? []).map((e) => ({
      id: Number(e.id),
      type: e.event_type as WorkOrderEventType,
      lineId: str(e.fsm_line_id),
      lineName: e.fsm_line_id ? (names.get(String(e.fsm_line_id)) ?? null) : null,
      amount: e.amount === null ? null : Number(e.amount),
      actor: str(e.actor_label),
      note: str(e.note),
      at: String(e.created_at),
    })),
    exclusions: (exclusions.data ?? []).map((x) => ({
      id: String(x.id),
      reason: String(x.reason),
      notes: str(x.notes),
      evidence: (x.evidence as string[] | null) ?? [],
      requestedBy: str(x.requested_by_label),
      requestedAt: String(x.requested_at),
      decision: (x.decision as "verified" | "rejected" | null) ?? null,
      decisionNote: str(x.decision_note),
      decidedBy: str(x.decided_by_label),
      decidedAt: str(x.decided_at),
    })),
  };
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

export class InvoicingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function invoicingError(error: { code?: string; message: string }, fn: string): never {
  const message = error.message.replace(new RegExp(`^${fn}: `), "");
  if (error.code === "23514" || error.code === "23505") throw new InvoicingError(message, 409);
  if (error.code === "40001") throw new InvoicingError(`${message}. Reload to see the latest.`, 409);
  if (error.code === "P0002") throw new InvoicingError(message, 404);
  if (ledgerMissing(error)) throw new InvoicingError("Ready to invoice needs migration 20261024100000 to be applied first.", 409);
  throw new Error(error.message);
}

/** The work order as FSM has it now (from the last ten minutes' read, or a new one). */
/**
 * Keeps what FSM says about the work order and all its lines as the
 * portal acts on it (migration 20261025100000): the metrics, the digest
 * and work waiting from before the list's dates read this, never FSM.
 * Never changes a Ready mark, an invoiced amount or a status. Best effort:
 * the action is what matters, and before the migration there is nothing
 * to keep it in.
 */
async function snapshotWorkOrder(admin: SupabaseClient, live: NonNullable<Awaited<ReturnType<typeof fetchWorkOrderLive>>>) {
  const w = live.workOrder;
  const { error } = await admin.schema("finance").rpc("snapshot_work_order", {
    p_work_order_id: w.id,
    p_work_order: {
      number: w.number,
      client: w.companyName,
      contact: w.contactName,
      quotation: w.estimateNumber,
      coordinator: w.ownerName,
      status: w.status,
      type: w.type,
      created_at: w.createdAt,
      completed_at: w.completedAt,
      sub_total: w.subTotal,
      grand_total: w.grandTotal,
    },
    p_lines: live.lines.map((l) => ({
      id: l.fsm_line_id,
      name: l.name,
      amount: Math.max(0, l.amount ?? 0),
      amount_with_vat: l.line_amount === null ? null : Math.max(0, l.line_amount),
      /* When the line was completed: its actual end, else the work order's completion. */
      completed_at: lineCanBeInvoiced(l.status, w.status) ? (l.actual_end ?? w.completedAt ?? new Date().toISOString()) : null,
    })),
  });
  if (error && !/PGRST202|snapshot_work_order|schema cache/i.test(`${error.code} ${error.message}`)) {
    console.error("[finance] work order snapshot failed:", error.message);
  }
}

/** The work order as FSM has it now, for an action on it; kept as a snapshot too. */
/*
  The work order from FSM for an action. Invoicing and % done need the
  latest read (their limits come from it); a query, hold, resume or
  not-invoiceable request does not, and takes the last read whatever its
  age (27 Oct: no FSM wait on those). The snapshot is written only when
  this read has not been written already.
*/
const snapshotted = new Map<string, string>();

async function liveOrFail(admin: SupabaseClient, workOrderId: string, options: { anyAge?: boolean } = {}) {
  try {
    const live = await fetchWorkOrderLive(admin, workOrderId, { anyAge: options.anyAge });
    if (!live) throw new InvoicingError("This work order is not in Zoho FSM any more.", 404);
    if (snapshotted.get(workOrderId) !== live.fetchedAt) {
      await snapshotWorkOrder(admin, live);
      snapshotted.set(workOrderId, live.fetchedAt);
      if (snapshotted.size > 5000) snapshotted.clear();
    }
    return live;
  } catch (error) {
    if (error instanceof FsmLiveError) throw new InvoicingError(error.message, error.status);
    throw error;
  }
}

/**
 * What Finance may invoice of each line of a work order now, before VAT
 * (lib/finance/progress.ts): all of what is left once it is Completed and
 * flagged, else what Operations' "invoice" percentage allows.
 */
export async function invoiceCapsFor(
  admin: SupabaseClient,
  live: NonNullable<Awaited<ReturnType<typeof fetchWorkOrderLive>>>,
): Promise<Map<string, number>> {
  const wo = live.workOrder;
  const [estimate, ledger, progress] = await Promise.all([
    wo.estimateId ? fetchEstimateLive(admin, wo.estimateId).catch(() => null) : Promise.resolve(null),
    loadLedger(admin, [wo.id]),
    loadProgress(admin, [wo.id]),
  ]);
  const invoicedOf = new Map(ledger.states.map((s) => [s.lineId, s.invoicedAmount]));
  const entries = progress.byWorkOrder.get(wo.id) ?? [];
  return new Map(
    live.lines.map((l) => {
      const lineId = String(l.fsm_line_id);
      return [
        lineId,
        invoiceCap(
          { amount: l.amount, invoicedAmount: invoicedOf.get(lineId) ?? 0 },
          { workOrderStatus: lineBilling(l, wo), postToMaher: estimate?.post_to_maher ?? null, entry: effectiveEntry(lineId, entries) },
        ),
      ];
    }),
  );
}

export const readyRequestSchema = z
  .object({
    /** The lines to mark; left out, every line of the work order. */
    lines: z.array(z.string().min(1).max(40)).max(500).optional(),
    ready: z.boolean(),
    note: z.string().trim().max(1000).nullish(),
  })
  .strict();

export async function setLinesReady(
  admin: SupabaseClient,
  workOrderId: string,
  input: z.infer<typeof readyRequestSchema>,
  actor: { id: string; label: string },
): Promise<number> {
  const live = await liveOrFail(admin, workOrderId);
  const wanted = input.lines?.length ? new Set(input.lines) : null;
  const lines = live.lines.filter((l) => !wanted || wanted.has(String(l.fsm_line_id)));
  if (!lines.length) throw new InvoicingError("This work order has no line items in FSM.", 409);
  if (wanted && lines.length !== wanted.size) throw new InvoicingError("Some of these lines are not on the work order in FSM any more. Refresh.", 409);
  const { data, error } = await admin.schema("finance").rpc("set_lines_ready", {
    p_work_order_id: workOrderId,
    p_work_order_number: live.workOrder.number,
    p_lines: lines.map((l) => ({ id: l.fsm_line_id, name: l.name, amount: Math.max(0, l.amount ?? 0) })),
    p_ready: input.ready,
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_note: input.note ?? null,
  });
  if (error) invoicingError(error, "set_lines_ready");
  return Number(data ?? 0);
}

export const invoiceRequestSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(100),
    number: z.string().trim().min(1).max(60),
    date: DATE,
    /* Ignored: the total is the lines with VAT, worked out on the server from FSM (23 Oct). */
    total: z.number().positive().max(100_000_000).nullish(),
    note: z.string().trim().max(2000).nullish(),
    /** Before VAT; in full or part of each line. */
    allocations: z
      .array(
        z
          .object({
            line: z.string().min(1).max(40),
            workOrder: z.string().regex(/^[0-9A-Za-z_-]{1,40}$/),
            amount: z.number().positive().max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    /** The MAHER invoice PDF, uploaded first (26 Oct: required). */
    filePath: z
      .string()
      .max(500)
      .refine((v) => v.startsWith("invoices/") && !v.includes(".."), "Not an uploaded invoice"),
    scan: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

export async function recordLineInvoice(
  admin: SupabaseClient,
  input: z.infer<typeof invoiceRequestSchema>,
  actor: { id: string; label: string },
): Promise<string> {
  /* Every line as FSM has it now, so no line is invoiced beyond its current amount. */
  const byWorkOrder = new Map<string, Awaited<ReturnType<typeof liveOrFail>>>();
  for (const workOrder of new Set(input.allocations.map((a) => a.workOrder))) byWorkOrder.set(workOrder, await liveOrFail(admin, workOrder));
  /* A work order on hold is paused: nothing is invoiced on it until it is resumed (23 Oct). */
  const held = await loadLedger(admin, [...byWorkOrder.keys()]);
  for (const [workOrderId, live] of byWorkOrder) {
    if (held.workflow.get(workOrderId)?.status === "on_hold") {
      throw new InvoicingError(`${live.workOrder.number ?? "This work order"} is on hold. Resume it before recording an invoice.`, 409);
    }
  }
  const capsOf = new Map<string, Map<string, number>>();
  for (const [workOrderId, live] of byWorkOrder) capsOf.set(workOrderId, await invoiceCapsFor(admin, live));
  const allocations = input.allocations.map((a) => {
    const live = byWorkOrder.get(a.workOrder)!;
    const line = live.lines.find((l) => l.fsm_line_id === a.line);
    if (!line) throw new InvoicingError(`A line is no longer on ${live.workOrder.number ?? "the work order"} in FSM. Refresh and try again.`, 409);
    /* No more than may be invoiced now: all of it once Completed and flagged, else Operations' percentage. */
    const cap = capsOf.get(a.workOrder)?.get(String(line.fsm_line_id)) ?? 0;
    if (round2(a.amount) > cap + 0.005) {
      throw new InvoicingError(
        cap > 0
          ? `${line.name ?? "A line"} on ${live.workOrder.number ?? "the work order"} can be invoiced up to ${cap.toFixed(2)} before VAT now, as far as Operations has recorded it done.`
          : `${line.name ?? "A line"} on ${live.workOrder.number ?? "the work order"} cannot be invoiced yet: it needs to be Completed in Zoho FSM with its quotation flagged "To Be Invoiced", or Operations must record how much of it is done to invoice.`,
        409,
      );
    }
    return {
      line: a.line,
      amount: round2(a.amount),
      work_order: a.workOrder,
      work_order_number: live.workOrder.number,
      name: line.name,
      line_amount: Math.max(0, line.amount ?? 0),
      with_vat: withVat(round2(a.amount), { amount: line.amount, lineAmount: line.line_amount, taxPercent: line.tax_percent }),
    };
  });
  /* The invoice total: what the lines come to with VAT, at each line's FSM rate. */
  const total = round2(allocations.reduce((sum, a) => sum + a.with_vat, 0));
  const { data, error } = await admin.schema("finance").rpc("record_line_invoice", {
    p_key: input.idempotencyKey,
    p_number: input.number,
    p_date: input.date,
    p_total: total,
    p_allocations: allocations,
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_note: input.note ?? null,
    p_file_path: input.filePath,
    p_scan: input.scan ?? null,
  });
  if (error) invoicingError(error, "record_line_invoice");
  for (const [workOrderId, live] of byWorkOrder) await moveToInProgress(admin, workOrderId, live.workOrder.subTotal, actor);
  return String(data);
}

/**
 * An invoice on an open work order moves it to In Progress, with the
 * person who recorded it (the user's direction, 23 Oct: nobody picks work
 * up by hand). Not when it is now invoiced in full, or already in a query,
 * on hold or in progress. Best effort: the invoice is what matters.
 */
async function moveToInProgress(admin: SupabaseClient, workOrderId: string, subTotal: number | null, actor: { id: string; label: string }) {
  const ledger = await loadLedger(admin, [workOrderId]);
  if ((ledger.workflow.get(workOrderId)?.status ?? "open") !== "open") return;
  if (invoicingFrom(ledger.states, subTotal, false).status === "invoiced") return;
  const { error } = await admin.schema("finance").rpc("wo_apply_action", {
    p_work_order_id: workOrderId,
    p_action: "pick_up",
    p_expected: "open",
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_note: null,
    p_work_order_number: null,
  });
  if (error) console.error("[finance] moving the work order to In Progress failed:", error.message);
}

/* Picking up is automatic now (an invoice does it), and nothing is released. */
export const WORKFLOW_ACTIONS = ["raise_query", "answer_query", "put_on_hold", "resume"] as const;
export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[number];

export const actionRequestSchema = z
  .object({
    action: z.enum(WORKFLOW_ACTIONS),
    /** The workflow status the person was looking at. */
    expectedStatus: z.enum(["open", "in_progress", "query_raised", "on_hold", "excluded"]),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

export async function applyWorkOrderAction(
  admin: SupabaseClient,
  workOrderId: string,
  input: z.infer<typeof actionRequestSchema>,
  actor: { id: string; label: string },
): Promise<{ status: WorkflowStatus; workOrderNumber: string | null }> {
  const live = await liveOrFail(admin, workOrderId, { anyAge: true });
  const { data, error } = await admin.schema("finance").rpc("wo_apply_action", {
    p_work_order_id: workOrderId,
    p_action: input.action,
    p_expected: input.expectedStatus,
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_note: input.note ?? null,
    p_work_order_number: live.workOrder.number,
  });
  if (error) invoicingError(error, "wo_apply_action");
  return { status: data as WorkflowStatus, workOrderNumber: live.workOrder.number };
}

export async function requestWorkOrderExclusion(
  admin: SupabaseClient,
  workOrderId: string,
  input: { reason: string; notes?: string | null; evidence?: string[] },
  actor: { id: string; label: string },
): Promise<{ exclusionId: string; workOrderNumber: string | null; value: number }> {
  const live = await liveOrFail(admin, workOrderId, { anyAge: true });
  const { data, error } = await admin.schema("finance").rpc("request_wo_exclusion", {
    p_work_order_id: workOrderId,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
    p_evidence: input.evidence ?? [],
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_work_order_number: live.workOrder.number,
  });
  if (error) invoicingError(error, "request_wo_exclusion");
  return { exclusionId: String(data), workOrderNumber: live.workOrder.number, value: live.workOrder.subTotal ?? 0 };
}

export async function decideWorkOrderExclusion(
  admin: SupabaseClient,
  exclusionId: string,
  input: { decision: "verified" | "rejected"; note?: string | null },
  actor: { id: string; label: string },
): Promise<{ status: WorkflowStatus; workOrderId: string | null }> {
  const { data, error } = await admin.schema("finance").rpc("decide_wo_exclusion", {
    p_exclusion_id: exclusionId,
    p_decision: input.decision,
    p_note: input.note ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) invoicingError(error, "decide_wo_exclusion");
  const { data: row } = await admin.schema("finance").from("wo_exclusions").select("fsm_work_order_id").eq("id", exclusionId).maybeSingle();
  return { status: data as WorkflowStatus, workOrderId: (row?.fsm_work_order_id as string | undefined) ?? null };
}

// ---------------------------------------------------------------------
// Operations: "X % done" (26 Oct, changes 4 and 5)
// ---------------------------------------------------------------------

export const progressRequestSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            /** Null: the whole work order. */
            line: z.string().min(1).max(40).nullable(),
            percent: z.number().min(0).max(100),
            purpose: z.enum(["invoice", "revenue_only"]),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

export async function recordProgress(
  admin: SupabaseClient,
  workOrderId: string,
  input: z.infer<typeof progressRequestSchema>,
  actor: { id: string; label: string },
): Promise<number> {
  const live = await liveOrFail(admin, workOrderId);
  const wo = live.workOrder;
  if (isVoid(wo.invoicingStatus) || isNonBillable(wo.invoicingStatus)) {
    throw new InvoicingError(`${wo.number ?? "This work order"} is ${wo.invoicingStatus} in FSM: there is nothing to invoice or recognise.`, 409);
  }
  const lineOf = new Map(live.lines.map((l) => [String(l.fsm_line_id), l]));
  const total = wo.subTotal ?? round2(live.lines.reduce((sum, l) => sum + Math.max(0, l.amount ?? 0), 0));
  const entries = input.entries.map((e) => {
    if (e.line === null) return { line: null, name: null, percent: round2(e.percent), purpose: e.purpose, value: Math.max(0, total) };
    const line = lineOf.get(e.line);
    if (!line) throw new InvoicingError(`A line is no longer on ${wo.number ?? "the work order"} in FSM. Refresh and try again.`, 409);
    if (!lineBillable(line.billing_status, wo.billingStatus)) {
      throw new InvoicingError(`${line.name ?? "A line"} is Non Billable in FSM: there is nothing to invoice or recognise on it.`, 409);
    }
    return { line: e.line, name: line.name, percent: round2(e.percent), purpose: e.purpose, value: Math.max(0, line.amount ?? 0) };
  });
  const { data, error } = await admin.schema("finance").rpc("record_progress", {
    p_work_order_id: workOrderId,
    p_work_order_number: wo.number,
    p_entries: entries,
    p_actor: actor.id,
    p_actor_label: actor.label,
    p_note: input.note ?? null,
  });
  if (error) {
    if (/record_progress|progress_entries|PGRST202/.test(`${error.code} ${error.message}`) && /schema cache|PGRST202|does not exist/i.test(error.message)) {
      throw new InvoicingError("Recording progress needs migration 20261026100000 to be applied first.", 409);
    }
    invoicingError(error, "record_progress");
  }
  forgetLists();
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------
// Coordinators' queries (26 Oct, change 9)
// ---------------------------------------------------------------------

export type OpenQuery = {
  workOrderId: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  coordinatorName: string | null;
  question: string | null;
  raisedAt: string;
  raisedBy: string | null;
};

// ---------------------------------------------------------------------
// The Queries page (27 Oct): every query and not-invoiceable request,
// answered or not, one page at a time from the server.
// ---------------------------------------------------------------------

export type FinanceRequestStatus = "waiting" | "answered" | "verified" | "rejected";

export type FinanceRequest = {
  /** "query-<event id>" or "exclusion-<request id>". */
  id: string;
  kind: "query" | "exclusion";
  workOrderId: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  /** The question, or the reason it is not to be invoiced. */
  text: string | null;
  notes: string | null;
  evidence: string[];
  askedBy: string | null;
  askedAt: string;
  status: FinanceRequestStatus;
  /** The answer, or the verifier's note. */
  response: string | null;
  respondedBy: string | null;
  respondedAt: string | null;
  /** For Verify / Reject. */
  exclusionId: string | null;
};

export const requestFiltersSchema = z.object({
  /** waiting: not answered or decided yet; done: answered, verified or rejected. */
  status: z.enum(["waiting", "done", "all"]).default("waiting"),
  kind: z.enum(["all", "query", "exclusion"]).default("all"),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type FinanceRequestList = {
  rows: FinanceRequest[];
  total: number;
  counts: { waitingQueries: number; waitingExclusions: number; done: number; oldestWaitingAt: string | null; overWeek: number };
  ledgerReady: boolean;
};

/**
 * Every query (each question paired with the answer that closed it) and
 * every not-invoiceable request (with its decision), from the portal's
 * records only (no FSM call). Waiting ones oldest first; done ones newest
 * first. Filtered and paged here, so the page gets one page.
 */
export async function listFinanceRequests(admin: SupabaseClient, filters: z.infer<typeof requestFiltersSchema>): Promise<FinanceRequestList> {
  const fin = admin.schema("finance");
  const [events, exclusions] = await Promise.all([
    fin
      .from("line_events")
      .select("id, fsm_work_order_id, event_type, actor_label, note, created_at")
      .in("event_type", ["query_raised", "query_answered"])
      .order("created_at")
      .order("id")
      .range(0, 9999),
    fin
      .from("wo_exclusions")
      .select("id, fsm_work_order_id, work_order_number, reason, notes, evidence, requested_by_label, requested_at, decision, decision_note, decided_by_label, decided_at")
      .order("requested_at")
      .range(0, 9999),
  ]);
  for (const r of [events, exclusions]) {
    if (r.error) {
      if (ledgerMissing(r.error)) return { rows: [], total: 0, counts: { waitingQueries: 0, waitingExclusions: 0, done: 0, oldestWaitingAt: null, overWeek: 0 }, ledgerReady: false };
      throw new Error(r.error.message);
    }
  }

  /* Each question, and the answer that closed it (the next answer on the same work order). */
  const queries: FinanceRequest[] = [];
  const openOf = new Map<string, FinanceRequest>();
  for (const e of events.data ?? []) {
    const wo = String(e.fsm_work_order_id);
    if (e.event_type === "query_raised") {
      const q: FinanceRequest = {
        id: `query-${e.id}`,
        kind: "query",
        workOrderId: wo,
        number: null,
        quotationNumber: null,
        clientName: null,
        text: str(e.note),
        notes: null,
        evidence: [],
        askedBy: str(e.actor_label),
        askedAt: String(e.created_at),
        status: "waiting",
        response: null,
        respondedBy: null,
        respondedAt: null,
        exclusionId: null,
      };
      queries.push(q);
      openOf.set(wo, q);
    } else {
      const q = openOf.get(wo);
      if (q) {
        q.status = "answered";
        q.response = str(e.note);
        q.respondedBy = str(e.actor_label);
        q.respondedAt = String(e.created_at);
        openOf.delete(wo);
      }
    }
  }
  const requests: FinanceRequest[] = (exclusions.data ?? []).map((x) => ({
    id: `exclusion-${x.id}`,
    kind: "exclusion",
    workOrderId: String(x.fsm_work_order_id),
    number: str(x.work_order_number),
    quotationNumber: null,
    clientName: null,
    text: String(x.reason),
    notes: str(x.notes),
    evidence: Array.isArray(x.evidence) ? x.evidence.map(String) : [],
    askedBy: str(x.requested_by_label),
    askedAt: String(x.requested_at),
    status: x.decision === "verified" ? "verified" : x.decision === "rejected" ? "rejected" : "waiting",
    response: str(x.decision_note),
    respondedBy: str(x.decided_by_label),
    respondedAt: str(x.decided_at),
    exclusionId: String(x.id),
  }));

  const all = [...queries, ...requests];
  const waiting = all.filter((r) => r.status === "waiting").sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  const done = all.filter((r) => r.status !== "waiting").sort((a, b) => (b.respondedAt ?? b.askedAt).localeCompare(a.respondedAt ?? a.askedAt));
  const now = Date.now();
  const counts = {
    waitingQueries: waiting.filter((r) => r.kind === "query").length,
    waitingExclusions: waiting.filter((r) => r.kind === "exclusion").length,
    done: done.length,
    oldestWaitingAt: waiting[0]?.askedAt ?? null,
    overWeek: waiting.filter((r) => now - Date.parse(r.askedAt) >= 7 * DAY_MS).length,
  };

  const listed = (filters.status === "waiting" ? waiting : filters.status === "done" ? done : [...waiting, ...done]).filter(
    (r) => filters.kind === "all" || r.kind === filters.kind,
  );
  const rows = listed.slice(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize);

  /* The work order's number, quotation and client, as the portal last saw them, for this page's rows. */
  const ids = [...new Set(rows.map((r) => r.workOrderId))];
  const states = ids.length
    ? await fin.from("work_order_states").select("fsm_work_order_id, work_order_number, quotation_number, contact_name, client_name").in("fsm_work_order_id", ids)
    : { data: [], error: null };
  const stateOf = new Map((states.error ? [] : (states.data ?? [])).map((s) => [String(s.fsm_work_order_id), s]));
  for (const r of rows) {
    const s = stateOf.get(r.workOrderId);
    if (!s) continue;
    r.number = r.number ?? str(s.work_order_number);
    r.quotationNumber = str(s.quotation_number);
    r.clientName = str(s.contact_name) ?? str(s.client_name);
  }
  return { rows, total: listed.length, counts, ledgerReady: true };
}

/** A request to mark a work order not invoiceable, waiting to be verified (27 Oct: on the Queries page). */
export type OpenExclusion = {
  id: string;
  workOrderId: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  reason: string;
  notes: string | null;
  evidence: string[];
  requestedBy: string | null;
  requestedAt: string;
};

/** Not-invoiceable requests nobody has verified or rejected yet, oldest first; portal records only (no FSM call). */
export async function listOpenExclusions(admin: SupabaseClient): Promise<OpenExclusion[]> {
  const fin = admin.schema("finance");
  const open = await fin
    .from("wo_exclusions")
    .select("id, fsm_work_order_id, work_order_number, reason, notes, evidence, requested_by_label, requested_at")
    .is("decision", null)
    .order("requested_at");
  if (open.error) {
    if (ledgerMissing(open.error)) return [];
    throw new Error(open.error.message);
  }
  const ids = [...new Set((open.data ?? []).map((x) => String(x.fsm_work_order_id)))];
  /* Its quotation and client, as the portal last saw them (the snapshot), when there is one. */
  const states = ids.length
    ? await fin.from("work_order_states").select("fsm_work_order_id, quotation_number, contact_name, client_name").in("fsm_work_order_id", ids)
    : { data: [], error: null };
  const stateOf = new Map((states.error ? [] : (states.data ?? [])).map((s) => [String(s.fsm_work_order_id), s]));
  return (open.data ?? []).map((x) => {
    const s = stateOf.get(String(x.fsm_work_order_id));
    return {
      id: String(x.id),
      workOrderId: String(x.fsm_work_order_id),
      number: str(x.work_order_number),
      quotationNumber: s ? str(s.quotation_number) : null,
      clientName: s ? (str(s.contact_name) ?? str(s.client_name)) : null,
      reason: String(x.reason),
      notes: str(x.notes),
      evidence: Array.isArray(x.evidence) ? x.evidence.map(String) : [],
      requestedBy: str(x.requested_by_label),
      requestedAt: String(x.requested_at),
    };
  });
}

/** Work orders waiting on a coordinator's answer, oldest first, from the portal's records only (no FSM call). */
export async function listOpenQueries(admin: SupabaseClient): Promise<{ rows: OpenQuery[]; ledgerReady: boolean }> {
  const fin = admin.schema("finance");
  const flows = await fin.from("work_order_states").select("*").eq("status", "query_raised").order("status_changed_at");
  if (flows.error) {
    if (ledgerMissing(flows.error)) return { rows: [], ledgerReady: false };
    throw new Error(flows.error.message);
  }
  const ids = (flows.data ?? []).map((f) => String(f.fsm_work_order_id));
  const raised = ids.length
    ? await fin
        .from("line_events")
        .select("fsm_work_order_id, actor_label, created_at")
        .in("fsm_work_order_id", ids)
        .eq("event_type", "query_raised")
        .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (raised.error) throw new Error(raised.error.message);
  const raisedBy = new Map<string, string | null>();
  for (const e of raised.data ?? []) if (!raisedBy.has(String(e.fsm_work_order_id))) raisedBy.set(String(e.fsm_work_order_id), str(e.actor_label));
  return {
    ledgerReady: true,
    rows: (flows.data ?? []).map((f) => ({
      workOrderId: String(f.fsm_work_order_id),
      number: str(f.work_order_number),
      quotationNumber: str(f.quotation_number),
      clientName: str(f.contact_name) ?? str(f.client_name),
      coordinatorName: str(f.coordinator_name),
      question: str(f.query_text),
      raisedAt: String(f.status_changed_at),
      raisedBy: raisedBy.get(String(f.fsm_work_order_id)) ?? null,
    })),
  };
}
