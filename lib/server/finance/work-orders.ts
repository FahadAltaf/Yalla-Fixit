import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  lineRemaining,
  lineStatus,
  workOrderInvoicing,
  type InvoiceStatus,
  type LineState,
  type WorkOrderInvoicing,
} from "@/lib/finance/line-status";
import {
  addDaysToDateString,
  todayInZone,
  zonedTimeToUtc,
} from "@/lib/scheduling/org-time";
import {
  createFsmReader,
  financeFsmReadEnabled,
} from "@/lib/server/finance/fsm-read";
import {
  readWorkOrderInFull,
  runFsmSync,
  type SyncSummary,
} from "@/lib/server/finance/fsm-sync/engine";
import {
  supabaseSyncStore,
  type SyncResource,
} from "@/lib/server/finance/fsm-sync/store";
import { readAllByIds, readAllRows } from "@/lib/server/snagging/read-all";
import { getFsmAccessToken } from "@/lib/server/zoho/fsm-client";

/**
 * Work orders for invoicing, read from the portal's copy of FSM.
 *
 * How FSM is used, and what it costs (decided with the user, 22 Oct):
 *
 *  - The list is the copy's work-order headers for the chosen dates (the
 *    last 30 days by default, never more than four months back). Refresh
 *    reads FSM's work order, quotation and appointment LISTS for what
 *    changed since the last sync: a page or two of calls, no detail calls.
 *  - A work order's line items exist only on FSM's detail call, so they
 *    are read when somebody opens the work order: one call, and only when
 *    the copy's lines are older than the work order's (or one of its
 *    appointments') last change, or when the user asks for a refresh.
 *  - Everything read is kept, so going back to the list, or opening the
 *    same work order again, costs nothing.
 *
 * FSM is only read here (FINANCE_FSM_READ, GET-only reader).
 */

/** The furthest back the invoicing screens look: four months. */
export const WORK_ORDER_MAX_DAYS = 122;
export const WORK_ORDER_DEFAULT_DAYS = 30;
/** A list refresh within this long of the last one is not repeated. */
const REFRESH_MIN_GAP_MS = 60_000;
/** Calls a list refresh may spend per resource. */
const REFRESH_BUDGET = 20;
/** Clock drift between the portal and FSM: a read this close to a change is not trusted. */
const DRIFT_MS = 10 * 60_000;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const workOrderFiltersSchema = z.object({
  from: DATE.optional(),
  to: DATE.optional(),
  q: z.string().trim().max(200).optional(),
  client: z.string().trim().max(200).optional(),
  status: z.string().trim().max(60).optional(),
  /** Where invoicing stands (Not ready, Ready, Partially invoiced, Invoiced). */
  invoice: z
    .enum(["not_ready", "ready", "partially_invoiced", "invoiced"])
    .optional(),
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type WorkOrderFilters = z.infer<typeof workOrderFiltersSchema>;

/** The dates asked for, kept inside the four-month window. */
export function workOrderPeriod(
  filters: { from?: string; to?: string },
  today = todayInZone(),
) {
  const earliest = addDaysToDateString(today, -(WORK_ORDER_MAX_DAYS - 1));
  let to = filters.to && filters.to <= today ? filters.to : today;
  let from =
    filters.from ?? addDaysToDateString(to, -(WORK_ORDER_DEFAULT_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  const clamped = from < earliest;
  if (clamped) from = earliest;
  if (to < earliest) to = earliest;
  return { from, to, earliest, today, clamped };
}

export type FsmFreshness = {
  resource: SyncResource;
  lastSuccessAt: string | null;
  lastError: string | null;
  running: boolean;
};

export async function readFreshness(
  admin: SupabaseClient,
): Promise<FsmFreshness[]> {
  const { data, error } = await admin
    .schema("fsm")
    .from("sync_state")
    .select("resource, last_success_at, last_error, lease_until")
    .order("resource");
  if (error) throw new Error(`sync state: ${error.message}`);
  const now = Date.now();
  return (data ?? []).map((r) => ({
    resource: r.resource as SyncResource,
    lastSuccessAt: (r.last_success_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    running: Boolean(
      r.lease_until && Date.parse(r.lease_until as string) > now,
    ),
  }));
}

// ---------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------

export type WorkOrderQuotation = {
  id: string;
  number: string | null;
  status: string | null;
  subTotal: number | null;
  postToMaher: string | null;
};

export type WorkOrderListRow = {
  id: string;
  number: string | null;
  status: string | null;
  type: string | null;
  clientName: string | null;
  contactName: string | null;
  createdAt: string | null;
  completedAt: string | null;
  /** Before VAT, as FSM totals it. */
  value: number | null;
  quotation: WorkOrderQuotation | null;
  /** Null until the work order has been opened (its lines read from FSM). */
  lines: {
    count: number;
    completed: number;
    value: number;
    seenAt: string;
  } | null;
  /** Where its invoicing stands; null until its lines are read. */
  invoicing: WorkOrderInvoicing | null;
};

export type WorkOrderList = {
  from: string;
  to: string;
  earliest: string;
  clamped: boolean;
  rows: WorkOrderListRow[];
  total: number;
  summary: {
    workOrders: number;
    completed: number;
    withQuotation: number;
    value: number;
    linesRead: number;
    /** Ready lines not yet invoiced, before VAT: what Finance can invoice now. */
    readyValue: number;
    invoicedValue: number;
    byStatus: Record<InvoiceStatus, number>;
  };
  options: { clients: string[]; statuses: string[] };
  freshness: FsmFreshness[];
  /** False until migration 20261024100000 is applied: no Ready marks or invoices yet. */
  ledgerReady: boolean;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const round2 = (n: number) => Math.round(n * 100) / 100;
const isCompleted = (status: string | null) =>
  status === "Completed" || status === "Closed";

/* The ledger tables arrive with migration 20261024100000; before it, everything reads as Not ready. */
function ledgerMissing(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /line_states|line_invoices|line_events|schema cache/i.test(
      error.message ?? "",
    )
  );
}

type StateRow = {
  fsm_line_id: string;
  ready: boolean;
  invoiced_amount: number;
  ready_at: string | null;
  ready_by_label: string | null;
};

/** Each line's ledger state, keyed by line id; empty (and flagged) before the migration. */
async function loadLineStates(
  admin: SupabaseClient,
  workOrderIds: string[],
): Promise<{ states: Map<string, StateRow>; ready: boolean }> {
  try {
    const rows = await readAllByIds<Record<string, unknown>>(
      workOrderIds,
      (chunk, from, to) =>
        admin
          .schema("finance")
          .from("line_states")
          .select(
            "fsm_line_id, ready, invoiced_amount, ready_at, ready_by_label",
          )
          .in("fsm_work_order_id", chunk)
          .order("fsm_line_id")
          .range(from, to),
      "line states",
    );
    return {
      ready: true,
      states: new Map(
        rows.map((r) => [
          String(r.fsm_line_id),
          {
            fsm_line_id: String(r.fsm_line_id),
            ready: Boolean(r.ready),
            invoiced_amount: Number(r.invoiced_amount ?? 0),
            ready_at: str(r.ready_at),
            ready_by_label: str(r.ready_by_label),
          },
        ]),
      ),
    };
  } catch (error) {
    if (
      ledgerMissing({
        message: error instanceof Error ? error.message : String(error),
      })
    )
      return { ready: false, states: new Map() };
    throw error;
  }
}

export async function listWorkOrders(
  admin: SupabaseClient,
  filters: WorkOrderFilters,
): Promise<WorkOrderList> {
  const period = workOrderPeriod(filters);
  const startIso = zonedTimeToUtc(period.from).toISOString();
  const endIso = zonedTimeToUtc(
    addDaysToDateString(period.to, 1),
  ).toISOString();

  const [all, freshness] = await Promise.all([
    readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .schema("fsm")
          .from("work_orders")
          .select(
            "fsm_work_order_id, number, status, type, company_name, contact_name, created_in_fsm_at, completed_at, sub_total, fsm_estimate_id, lines_seen_at",
          )
          .gte("created_in_fsm_at", startIso)
          .lt("created_in_fsm_at", endIso)
          .order("created_in_fsm_at", { ascending: false })
          .order("fsm_work_order_id")
          .range(from, to),
      "work orders",
    ),
    readFreshness(admin),
  ]);

  /* Lines and their ledger state for every work order in the dates: the
     summary and the invoicing filter count them all, not only this page. */
  const allIds = all.map((w) => String(w.fsm_work_order_id));
  const [lineRows, ledger] = await Promise.all([
    readAllByIds<Record<string, unknown>>(
      allIds,
      (chunk, from, to) =>
        admin
          .schema("fsm")
          .from("line_items")
          .select("fsm_line_id, fsm_work_order_id, status, amount")
          .in("fsm_work_order_id", chunk)
          .is("removed_at", null)
          .order("fsm_line_id")
          .range(from, to),
      "line items",
    ),
    loadLineStates(admin, allIds),
  ]);
  const linesByWorkOrder = new Map<
    string,
    Array<LineState & { status: string | null }>
  >();
  for (const l of lineRows) {
    const state = ledger.states.get(String(l.fsm_line_id));
    const list = linesByWorkOrder.get(String(l.fsm_work_order_id)) ?? [];
    list.push({
      amount: num(l.amount),
      ready: state?.ready ?? false,
      invoicedAmount: state?.invoiced_amount ?? 0,
      status: str(l.status),
    });
    linesByWorkOrder.set(String(l.fsm_work_order_id), list);
  }
  const invoicingOf = (w: Record<string, unknown>) =>
    w.lines_seen_at
      ? workOrderInvoicing(
          linesByWorkOrder.get(String(w.fsm_work_order_id)) ?? [],
        )
      : null;

  const needle = (filters.q ?? "").toLowerCase();
  const matching = all.filter((w) => {
    if (filters.client && w.company_name !== filters.client) return false;
    if (filters.status && w.status !== filters.status) return false;
    if (
      filters.invoice &&
      (invoicingOf(w)?.status ?? "not_ready") !== filters.invoice
    )
      return false;
    if (
      needle &&
      !`${w.number ?? ""} ${w.company_name ?? ""} ${w.contact_name ?? ""}`
        .toLowerCase()
        .includes(needle)
    )
      return false;
    return true;
  });
  const pageRows = matching.slice(
    filters.page * filters.pageSize,
    (filters.page + 1) * filters.pageSize,
  );

  const estimateIds = [
    ...new Set(
      pageRows
        .map((w) => str(w.fsm_estimate_id))
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const estimates = estimateIds.length
    ? await admin
        .schema("fsm")
        .from("estimates")
        .select("fsm_estimate_id, number, status, sub_total, post_to_maher")
        .in("fsm_estimate_id", estimateIds)
    : { data: [], error: null };
  if (estimates.error)
    throw new Error(`quotations: ${estimates.error.message}`);
  const quotations = new Map<string, WorkOrderQuotation>(
    (estimates.data ?? []).map((e): [string, WorkOrderQuotation] => [
      String(e.fsm_estimate_id),
      {
        id: String(e.fsm_estimate_id),
        number: str(e.number),
        status: str(e.status),
        subTotal: num(e.sub_total),
        postToMaher: str(e.post_to_maher),
      },
    ]),
  );

  const rows: WorkOrderListRow[] = pageRows.map((w) => {
    const id = String(w.fsm_work_order_id);
    const seenAt = str(w.lines_seen_at);
    const lines = linesByWorkOrder.get(id) ?? [];
    return {
      id,
      number: str(w.number),
      status: str(w.status),
      type: str(w.type),
      clientName: str(w.company_name),
      contactName: str(w.contact_name),
      createdAt: str(w.created_in_fsm_at),
      completedAt: str(w.completed_at),
      value: num(w.sub_total),
      quotation: w.fsm_estimate_id
        ? (quotations.get(String(w.fsm_estimate_id)) ?? null)
        : null,
      lines: seenAt
        ? {
            count: lines.length,
            completed: lines.filter((l) => l.status === "Completed").length,
            value: round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0)),
            seenAt,
          }
        : null,
      invoicing: invoicingOf(w),
    };
  });

  const byStatus: Record<InvoiceStatus, number> = {
    not_ready: 0,
    ready: 0,
    partially_invoiced: 0,
    invoiced: 0,
  };
  let readyValue = 0;
  let invoicedValue = 0;
  for (const w of matching) {
    const inv = invoicingOf(w);
    byStatus[inv?.status ?? "not_ready"] += 1;
    readyValue += inv?.readyValue ?? 0;
    invoicedValue += inv?.invoicedValue ?? 0;
  }

  const distinct = (values: unknown[]) =>
    [...new Set(values.map(str).filter((v): v is string => Boolean(v)))].sort(
      (a, b) => a.localeCompare(b),
    );

  return {
    from: period.from,
    to: period.to,
    earliest: period.earliest,
    clamped: period.clamped,
    rows,
    total: matching.length,
    summary: {
      workOrders: matching.length,
      completed: matching.filter((w) => isCompleted(str(w.status))).length,
      withQuotation: matching.filter((w) => w.fsm_estimate_id).length,
      value: round2(
        matching.reduce((sum, w) => sum + (num(w.sub_total) ?? 0), 0),
      ),
      linesRead: matching.filter((w) => w.lines_seen_at).length,
      readyValue: round2(readyValue),
      invoicedValue: round2(invoicedValue),
      byStatus,
    },
    options: {
      clients: distinct(all.map((w) => w.company_name)),
      statuses: distinct(all.map((w) => w.status)),
    },
    freshness,
    ledgerReady: ledger.ready,
  };
}

// ---------------------------------------------------------------------
// Refresh from FSM: lists only
// ---------------------------------------------------------------------

export class FsmUnavailableError extends Error {}

export type RefreshResult = {
  skipped: boolean;
  calls: number;
  written: number;
  results: Array<Pick<SyncSummary, "resource" | "status" | "error">>;
};

/**
 * What changed in FSM since the last sync: work order, quotation and
 * appointment headers. No detail calls. Repeated within a minute it does
 * nothing, so several people pressing Refresh cost one refresh.
 */
export async function refreshWorkOrderHeaders(
  admin: SupabaseClient,
): Promise<RefreshResult> {
  if (!financeFsmReadEnabled())
    throw new FsmUnavailableError(
      "Reading from Zoho FSM is switched off (FINANCE_FSM_READ).",
    );
  const freshness = await readFreshness(admin);
  const newest = freshness.find(
    (f) => f.resource === "work_orders",
  )?.lastSuccessAt;
  if (newest && Date.now() - Date.parse(newest) < REFRESH_MIN_GAP_MS)
    return { skipped: true, calls: 0, written: 0, results: [] };

  const token = await getFsmAccessToken(admin);
  const store = supabaseSyncStore(admin);
  const out: RefreshResult = {
    skipped: false,
    calls: 0,
    written: 0,
    results: [],
  };
  for (const resource of [
    "work_orders",
    "estimates",
    "appointments",
  ] as SyncResource[]) {
    const reader = createFsmReader({ token, budget: REFRESH_BUDGET });
    const summary = await runFsmSync({
      resource,
      kind: "incremental",
      reader,
      store,
      options: { details: false },
    });
    out.calls += summary.counts.calls;
    out.written += summary.counts.recordsWritten;
    out.results.push({
      resource,
      status: summary.status,
      error: summary.error,
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// One work order, with its lines read from FSM when they are out of date
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
  status: string | null;
  sequence: number | null;
  isOptional: boolean;
  actualStart: string | null;
  actualEnd: string | null;
  /* Invoicing, from the ledger. */
  ready: boolean;
  readyAt: string | null;
  readyBy: string | null;
  invoicedAmount: number;
  remaining: number;
  invoiceStatus: InvoiceStatus;
};

export type WorkOrderInvoice = {
  id: string;
  number: string;
  date: string;
  total: number;
  recordedBy: string | null;
  recordedAt: string;
  hasFile: boolean;
  /** What this invoice covers on this work order. */
  allocations: Array<{
    lineId: string;
    lineName: string | null;
    amount: number;
  }>;
};

export type WorkOrderEvent = {
  id: number;
  type: "marked_ready" | "unmarked_ready" | "invoiced";
  lineId: string | null;
  lineName: string | null;
  amount: number | null;
  actor: string | null;
  note: string | null;
  at: string;
};

export type WorkOrderDetail = {
  workOrder: Omit<WorkOrderListRow, "invoicing"> & {
    workType: string | null;
    billingStatus: string | null;
    amcContractRef: string | null;
    grandTotal: number | null;
    taxAmount: number | null;
    modifiedAt: string | null;
  };
  quotation:
    | (WorkOrderQuotation & {
        grandTotal: number | null;
        ownerName: string | null;
        contactName: string | null;
        expiryDate: string | null;
      })
    | null;
  lines: WorkOrderLine[];
  appointments: Array<{
    id: string;
    number: string | null;
    status: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    actualStart: string | null;
    actualEnd: string | null;
    technicians: Array<{ name: string; lead: boolean }>;
  }>;
  invoicing: WorkOrderInvoicing;
  invoices: WorkOrderInvoice[];
  events: WorkOrderEvent[];
  /** False until migration 20261024100000 is applied: Ready marks and invoices are off. */
  ledgerReady: boolean;
  /** When the lines were last read from FSM; null if they could not be. */
  linesSeenAt: string | null;
  /** True when this request read the work order from FSM. */
  readFromFsm: boolean;
  /** Why FSM could not be read (the copy is shown instead). */
  fsmError: string | null;
};

async function loadWorkOrderRow(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .schema("fsm")
    .from("work_orders")
    .select("*")
    .eq("fsm_work_order_id", id)
    .maybeSingle();
  if (error) throw new Error(`work order: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** The copy's lines are current when read after the work order's and its appointments' last change. */
async function linesAreCurrent(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<boolean> {
  const seen = str(row.lines_seen_at);
  if (!seen) return false;
  const { data, error } = await admin
    .schema("fsm")
    .from("appointments")
    .select("modified_time")
    .eq("fsm_work_order_id", String(row.fsm_work_order_id))
    .order("modified_time", { ascending: false })
    .limit(1);
  if (error) throw new Error(`appointments: ${error.message}`);
  const changes = [
    str(row.modified_time),
    str(data?.[0]?.modified_time),
  ].filter((v): v is string => Boolean(v));
  const lastChange = Math.max(...changes.map((v) => Date.parse(v)));
  return Date.parse(seen) - DRIFT_MS >= lastChange;
}

export async function readWorkOrderDetail(
  admin: SupabaseClient,
  id: string,
  options: { refresh?: boolean } = {},
): Promise<WorkOrderDetail | null> {
  let row = await loadWorkOrderRow(admin, id);
  let readFromFsm = false;
  let fsmError: string | null = null;

  if (options.refresh || !row || !(await linesAreCurrent(admin, row))) {
    if (!financeFsmReadEnabled()) {
      fsmError =
        "Reading from Zoho FSM is switched off (FINANCE_FSM_READ); showing the last copy.";
    } else {
      try {
        const token = await getFsmAccessToken(admin);
        const reader = createFsmReader({ token, budget: 2 });
        const result = await readWorkOrderInFull({
          workOrderId: id,
          get: (path) => reader.get(path),
          store: supabaseSyncStore(admin),
          now: () => new Date(),
        });
        readFromFsm = result.found;
        if (result.found) row = await loadWorkOrderRow(admin, id);
        else if (row)
          fsmError =
            "This work order is no longer in Zoho FSM; showing the last copy.";
      } catch (error) {
        fsmError = `Zoho FSM could not be read (${error instanceof Error ? error.message : "unknown error"}); showing the last copy.`;
      }
    }
  }
  if (!row) return null;

  const estimateId = str(row.fsm_estimate_id);
  const [lineRows, estimate, appointmentRows] = await Promise.all([
    admin
      .schema("fsm")
      .from("line_items")
      .select("*")
      .eq("fsm_work_order_id", id)
      .is("removed_at", null)
      .order("sequence", { ascending: true }),
    estimateId
      ? admin
          .schema("fsm")
          .from("estimates")
          .select(
            "fsm_estimate_id, number, status, sub_total, grand_total, post_to_maher, owner_name, contact_name, expiry_date",
          )
          .eq("fsm_estimate_id", estimateId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .schema("fsm")
      .from("appointments")
      .select(
        "fsm_appointment_id, number, status, scheduled_start, scheduled_end, actual_start, actual_end",
      )
      .eq("fsm_work_order_id", id)
      .order("scheduled_start", { ascending: true }),
  ]);
  for (const result of [lineRows, estimate, appointmentRows])
    if (result.error) throw new Error(result.error.message);

  /* Who attended: each appointment's crew, by name from the roster. */
  const apptIds = (appointmentRows.data ?? []).map((a) =>
    String(a.fsm_appointment_id),
  );
  const crew = apptIds.length
    ? ((
        await admin
          .schema("fsm")
          .from("appointment_resources")
          .select("fsm_appointment_id, technician_fsm_id, is_lead")
          .in("fsm_appointment_id", apptIds)
      ).data ?? [])
    : [];
  const techIds = [...new Set(crew.map((c) => String(c.technician_fsm_id)))];
  const names = new Map<string, string>();
  if (techIds.length) {
    const { data } = await admin
      .from("technician_reference")
      .select("fsm_resource_id, display_name")
      .in("fsm_resource_id", techIds);
    for (const t of data ?? [])
      names.set(
        String(t.fsm_resource_id),
        String(t.display_name ?? t.fsm_resource_id),
      );
  }

  const ledger = await loadLineStates(admin, [id]);
  const lines: WorkOrderLine[] = (lineRows.data ?? []).map((l) => {
    const state = ledger.states.get(String(l.fsm_line_id));
    const amount = num(l.amount);
    const ls: LineState = {
      amount,
      ready: state?.ready ?? false,
      invoicedAmount: state?.invoiced_amount ?? 0,
    };
    return {
      id: String(l.fsm_line_id),
      name: str(l.name),
      description: str(l.description),
      quantity: num(l.quantity),
      unit: str(l.unit),
      unitPrice: num(l.unit_price),
      discount: num(l.discount),
      amount: num(l.amount),
      lineAmount: num(l.line_amount),
      taxPercent: num(l.tax_percent),
      status: str(l.status),
      sequence: num(l.sequence),
      isOptional: Boolean(l.is_optional),
      actualStart: str(l.actual_start),
      actualEnd: str(l.actual_end),
      ready: ls.ready,
      readyAt: state?.ready_at ?? null,
      readyBy: state?.ready_by_label ?? null,
      invoicedAmount: ls.invoicedAmount,
      remaining: lineRemaining(ls),
      invoiceStatus: lineStatus(ls),
    };
  });
  const seenAt = str(row.lines_seen_at);
  const { invoices, events } = ledger.ready
    ? await loadInvoicesAndEvents(admin, id, lines)
    : { invoices: [], events: [] };
  const e = estimate.data as Record<string, unknown> | null;

  return {
    workOrder: {
      id,
      number: str(row.number),
      status: str(row.status),
      type: str(row.type),
      workType: str(row.work_type),
      billingStatus: str(row.billing_status),
      amcContractRef: str(row.amc_contract_ref),
      clientName: str(row.company_name),
      contactName: str(row.contact_name),
      createdAt: str(row.created_in_fsm_at),
      completedAt: str(row.completed_at),
      modifiedAt: str(row.modified_time),
      value: num(row.sub_total),
      grandTotal: num(row.grand_total),
      taxAmount: num(row.tax_amount),
      quotation: null,
      lines: seenAt
        ? {
            count: lines.length,
            completed: lines.filter((l) => l.status === "Completed").length,
            value: round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0)),
            seenAt,
          }
        : null,
    },
    quotation: e
      ? {
          id: String(e.fsm_estimate_id),
          number: str(e.number),
          status: str(e.status),
          subTotal: num(e.sub_total),
          grandTotal: num(e.grand_total),
          postToMaher: str(e.post_to_maher),
          ownerName: str(e.owner_name),
          contactName: str(e.contact_name),
          expiryDate: str(e.expiry_date),
        }
      : null,
    lines,
    appointments: (appointmentRows.data ?? []).map((a) => ({
      id: String(a.fsm_appointment_id),
      number: str(a.number),
      status: str(a.status),
      scheduledStart: str(a.scheduled_start),
      scheduledEnd: str(a.scheduled_end),
      actualStart: str(a.actual_start),
      actualEnd: str(a.actual_end),
      technicians: crew
        .filter((c) => c.fsm_appointment_id === a.fsm_appointment_id)
        .sort((x, y) => Number(y.is_lead) - Number(x.is_lead))
        .map((c) => ({
          name: names.get(String(c.technician_fsm_id)) ?? "Unknown technician",
          lead: Boolean(c.is_lead),
        })),
    })),
    invoicing: workOrderInvoicing(lines),
    invoices,
    events,
    ledgerReady: ledger.ready,
    linesSeenAt: seenAt,
    readFromFsm,
    fsmError,
  };
}

/** The invoices recorded against this work order's lines, and its invoicing history. */
async function loadInvoicesAndEvents(
  admin: SupabaseClient,
  workOrderId: string,
  lines: WorkOrderLine[],
): Promise<{ invoices: WorkOrderInvoice[]; events: WorkOrderEvent[] }> {
  const names = new Map(lines.map((l) => [l.id, l.name]));
  const fin = admin.schema("finance");
  const [allocations, events] = await Promise.all([
    fin
      .from("line_invoice_allocations")
      .select("invoice_id, fsm_line_id, amount")
      .eq("fsm_work_order_id", workOrderId)
      .order("id"),
    fin
      .from("line_events")
      .select(
        "id, event_type, fsm_line_id, amount, actor_label, note, created_at",
      )
      .eq("fsm_work_order_id", workOrderId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (allocations.error)
    throw new Error(`allocations: ${allocations.error.message}`);
  if (events.error)
    throw new Error(`invoicing history: ${events.error.message}`);

  const invoiceIds = [
    ...new Set((allocations.data ?? []).map((a) => String(a.invoice_id))),
  ];
  const headers = invoiceIds.length
    ? await fin
        .from("line_invoices")
        .select(
          "id, maher_invoice_number, invoice_date, total_amount, recorded_by_label, recorded_at, file_path",
        )
        .in("id", invoiceIds)
    : { data: [], error: null };
  if (headers.error) throw new Error(`invoices: ${headers.error.message}`);

  const invoices: WorkOrderInvoice[] = (headers.data ?? [])
    .map((h) => ({
      id: String(h.id),
      number: String(h.maher_invoice_number),
      date: String(h.invoice_date),
      total: Number(h.total_amount),
      recordedBy: str(h.recorded_by_label),
      recordedAt: String(h.recorded_at),
      hasFile: Boolean(h.file_path),
      allocations: (allocations.data ?? [])
        .filter((a) => String(a.invoice_id) === String(h.id))
        .map((a) => ({
          lineId: String(a.fsm_line_id),
          lineName: names.get(String(a.fsm_line_id)) ?? null,
          amount: Number(a.amount),
        })),
    }))
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));

  return {
    invoices,
    events: (events.data ?? []).map((e) => ({
      id: Number(e.id),
      type: e.event_type as WorkOrderEvent["type"],
      lineId: str(e.fsm_line_id),
      lineName: e.fsm_line_id
        ? (names.get(String(e.fsm_line_id)) ?? null)
        : null,
      amount: num(e.amount),
      actor: str(e.actor_label),
      note: str(e.note),
      at: String(e.created_at),
    })),
  };
}

// ---------------------------------------------------------------------
// Actions: Ready to invoice, and recording a MAHER invoice
// ---------------------------------------------------------------------

export class InvoicingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function invoicingError(
  error: { code?: string; message: string },
  fn: string,
): never {
  const message = error.message.replace(new RegExp(`^${fn}: `), "");
  if (error.code === "23514") throw new InvoicingError(message, 409);
  if (error.code === "23505") throw new InvoicingError(message, 409);
  if (ledgerMissing(error))
    throw new InvoicingError(
      "Invoicing needs migration 20261024100000 to be applied first.",
      409,
    );
  throw new Error(error.message);
}

export const readyRequestSchema = z
  .object({
    /** The lines to mark; left out, every current line of the work order. */
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
  let lines = input.lines;
  if (!lines?.length) {
    const { data, error } = await admin
      .schema("fsm")
      .from("line_items")
      .select("fsm_line_id")
      .eq("fsm_work_order_id", workOrderId)
      .is("removed_at", null);
    if (error) throw new Error(error.message);
    lines = (data ?? []).map((l) => String(l.fsm_line_id));
    if (!lines.length)
      throw new InvoicingError(
        "This work order has no line items read from FSM yet.",
        409,
      );
  }
  const { data, error } = await admin.schema("finance").rpc("set_lines_ready", {
    p_work_order_id: workOrderId,
    p_lines: lines,
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
    total: z.number().positive().max(100_000_000),
    note: z.string().trim().max(2000).nullish(),
    /** Before VAT; in full or part of each line. */
    allocations: z
      .array(
        z
          .object({
            line: z.string().min(1).max(40),
            amount: z.number().positive().max(100_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    /** Set by the upload (P-C): the stored file and what the scan read. */
    filePath: z
      .string()
      .max(500)
      .refine((v) => v.startsWith("invoices/") && !v.includes(".."), "Not an uploaded invoice")
      .nullish(),
    scan: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

export async function recordLineInvoice(
  admin: SupabaseClient,
  input: z.infer<typeof invoiceRequestSchema>,
  actor: { id: string; label: string },
): Promise<string> {
  const { data, error } = await admin
    .schema("finance")
    .rpc("record_line_invoice", {
      p_key: input.idempotencyKey,
      p_number: input.number,
      p_date: input.date,
      p_total: input.total,
      p_allocations: input.allocations.map((a) => ({
        line: a.line,
        amount: Math.round(a.amount * 100) / 100,
      })),
      p_actor: actor.id,
      p_actor_label: actor.label,
      p_note: input.note ?? null,
      p_file_path: input.filePath ?? null,
      p_scan: input.scan ?? null,
    });
  if (error) invoicingError(error, "record_line_invoice");
  return String(data);
}
