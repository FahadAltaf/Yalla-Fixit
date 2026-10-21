import type { SupabaseClient } from "@supabase/supabase-js";

import type { MetricExclusion, MetricInvoice, MetricItem } from "@/lib/finance/metrics";
import { readAllRows, chunkIds } from "@/lib/server/snagging/read-all";

import { QueueError, type QueueStatus } from "./queue";

/**
 * Reads for the Finance screens (P4). The list pages and filters on the
 * server through finance.queue_list; the item reads everything Step 3 of
 * BRD §5.1 asks for; the summary and metrics read the queue whole, which is
 * small (an item per invoice batch), and leave the arithmetic to
 * lib/finance/metrics.ts.
 */

export type QueueRow = {
  id: string;
  number: number;
  status: QueueStatus;
  statusChangedAt: string;
  enteredAt: string;
  value: number;
  lineCount: number;
  isTest: boolean;
  assigneeName: string | null;
  workOrderNumber: string | null;
  fsmWorkOrderId: string;
  clientName: string | null;
  quotationNumber: string | null;
  coordinatorName: string | null;
  quotationTotal: number | null;
  completionPercent: number | null;
};

type ListRow = Record<string, unknown>;

function toRow(r: ListRow): QueueRow {
  return {
    id: r.id as string,
    number: Number(r.number),
    status: r.status as QueueStatus,
    statusChangedAt: r.status_changed_at as string,
    enteredAt: r.entered_at as string,
    value: Number(r.value),
    lineCount: Number(r.line_count),
    isTest: r.created_by === "test",
    assigneeName: (r.assignee_name as string | null) ?? null,
    workOrderNumber: (r.work_order_number as string | null) ?? null,
    fsmWorkOrderId: r.fsm_work_order_id as string,
    clientName: (r.client_name as string | null) ?? null,
    quotationNumber: (r.quotation_number as string | null) ?? null,
    coordinatorName: (r.coordinator_name as string | null) ?? null,
    quotationTotal: r.quotation_total === null ? null : Number(r.quotation_total),
    completionPercent: r.completion_percent === null ? null : Number(r.completion_percent),
  };
}

export type QueueFilters = {
  statuses: QueueStatus[];
  client?: string;
  coordinator?: string;
  enteredFrom?: string;
  enteredTo?: string;
  /** Pending longer than this many days (Reporting Settings, N2). */
  agedOlderThanDays?: number | null;
  search?: string;
  page: number;
  pageSize: number;
};

/* Characters PostgREST reads as syntax inside or()/ilike patterns. */
const clean = (text: string) => text.replace(/[,()"'\\%*:]/g, " ").trim().slice(0, 100);

export async function listQueue(admin: SupabaseClient, filters: QueueFilters, now = new Date()) {
  let q = admin
    .schema("finance")
    .from("queue_list")
    .select("*", { count: "exact" })
    .order("entered_at", { ascending: false })
    .order("number", { ascending: false })
    .range(filters.page * filters.pageSize, filters.page * filters.pageSize + filters.pageSize - 1);

  if (filters.statuses.length) q = q.in("status", filters.statuses);
  if (filters.client) q = q.eq("client_name", filters.client);
  if (filters.coordinator) q = q.eq("coordinator_name", filters.coordinator);
  if (filters.enteredFrom) q = q.gte("entered_at", filters.enteredFrom);
  if (filters.enteredTo) q = q.lt("entered_at", filters.enteredTo);
  if (filters.agedOlderThanDays !== undefined && filters.agedOlderThanDays !== null) {
    const cutoff = new Date(now.getTime() - filters.agedOlderThanDays * 86_400_000).toISOString();
    q = q.eq("status", "pending").lt("status_changed_at", cutoff);
  }
  const term = filters.search ? clean(filters.search) : "";
  if (term) {
    const asNumber = Number(term.replace(/^FQ-?/i, ""));
    const ors = [`work_order_number.ilike.%${term}%`, `quotation_number.ilike.%${term}%`, `client_name.ilike.%${term}%`];
    if (Number.isInteger(asNumber) && asNumber > 0) ors.push(`number.eq.${asNumber}`);
    q = q.or(ors.join(","));
  }

  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []).map(toRow), total: count ?? 0 };
}

/** The client and coordinator names the filters offer. */
export async function listQueueFilterOptions(admin: SupabaseClient) {
  const rows = await readAllRows<{ client_name: string | null; coordinator_name: string | null }>(
    (from, to) =>
      admin.schema("finance").from("queue_list").select("client_name, coordinator_name, number").order("number").range(from, to),
    "queue filter options",
  );
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
  return { clients: distinct(rows.map((r) => r.client_name)), coordinators: distinct(rows.map((r) => r.coordinator_name)) };
}

/** Everything the summary strip and the metrics need. */
export async function readQueueForMetrics(admin: SupabaseClient) {
  const [items, invoices, exclusions] = await Promise.all([
    readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin.schema("finance").from("queue_items").select("id, status, value, entered_at, hold_reason").order("id").range(from, to),
      "queue items",
    ),
    readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin.schema("finance").from("invoices").select("queue_item_id, amount, queue_value, recorded_at, recorded_by_label").order("id").range(from, to),
      "invoices",
    ),
    readAllRows<Record<string, unknown>>(
      (from, to) =>
        admin.schema("finance").from("exclusions").select("queue_item_id, reason, decision").order("id").range(from, to),
      "exclusions",
    ),
  ]);
  return {
    items: items.map<MetricItem>((r) => ({
      id: r.id as string,
      status: r.status as MetricItem["status"],
      value: Number(r.value),
      enteredAt: r.entered_at as string,
      holdReason: (r.hold_reason as string | null) ?? null,
    })),
    invoices: invoices.map<MetricInvoice>((r) => ({
      queueItemId: r.queue_item_id as string,
      amount: Number(r.amount),
      queueValue: Number(r.queue_value),
      recordedAt: r.recorded_at as string,
      recordedByLabel: (r.recorded_by_label as string | null) ?? null,
    })),
    exclusions: exclusions.map<MetricExclusion>((r) => ({
      queueItemId: r.queue_item_id as string,
      reason: r.reason as string,
      decision: (r.decision as string | null) ?? null,
    })),
  };
}

export type QueueItemDetail = Awaited<ReturnType<typeof readQueueItem>>;

/** One item, with everything BRD §5.1 Step 3 lists. */
export async function readQueueItem(admin: SupabaseClient, id: string) {
  const { data: head, error } = await admin.schema("finance").from("queue_list").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!head) throw new QueueError("No such item", 404);
  const item = toRow(head);
  const fin = admin.schema("finance");
  const fsm = admin.schema("fsm");

  const [lines, events, exclusions, invoice, raw, quotation, earlier, appointments] = await Promise.all([
    fin.from("queue_item_lines").select("fsm_line_id, name, quantity, unit_price, line_amount, amount, sequence")
      .eq("queue_item_id", id).order("sequence", { ascending: true, nullsFirst: false }),
    fin.from("queue_events").select("id, event_type, from_status, to_status, actor_label, note, created_at")
      .eq("queue_item_id", id).order("id", { ascending: true }),
    fin.from("exclusions").select("id, reason, notes, evidence, requested_by_label, requested_at, decision, decision_note, decided_by_label, decided_at")
      .eq("queue_item_id", id).order("requested_at", { ascending: true }),
    fin.from("invoices").select("maher_invoice_number, invoice_date, amount, queue_value, variance, variance_reason, recorded_by_label, recorded_at")
      .eq("queue_item_id", id).maybeSingle(),
    fin.from("queue_items").select("hold_reason, query_text").eq("id", id).single(),
    item.quotationNumber
      ? fsm.from("estimates").select("number, status, sub_total, grand_total, company_name, contact_name, owner_name, owner_email, fsm_estimate_id")
          .eq("number", item.quotationNumber).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    /* Earlier invoiced batches of the same quotation: "cumulative invoiced to date". */
    item.quotationNumber
      ? fin.from("queue_list").select("value").eq("quotation_number", item.quotationNumber).eq("status", "invoiced").lt("number", item.number)
      : Promise.resolve({ data: [], error: null }),
    fsm.from("appointments").select("fsm_appointment_id, number, status, scheduled_start, scheduled_end, actual_start, actual_end")
      .eq("fsm_work_order_id", item.fsmWorkOrderId).order("scheduled_start", { ascending: true }),
  ]);
  for (const result of [lines, events, exclusions, invoice, raw, quotation, earlier, appointments]) {
    if (result.error) throw new Error(result.error.message);
  }

  /* Who attended: each appointment's crew, by name from the roster. */
  const apptIds = ((appointments.data ?? []) as { fsm_appointment_id: string }[]).map((a) => a.fsm_appointment_id);
  const crew: { fsm_appointment_id: string; technician_fsm_id: string; is_lead: boolean }[] = [];
  for (const ids of chunkIds(apptIds)) {
    const { data, error: crewError } = await fsm.from("appointment_resources").select("fsm_appointment_id, technician_fsm_id, is_lead").in("fsm_appointment_id", ids);
    if (crewError) throw new Error(crewError.message);
    crew.push(...((data ?? []) as typeof crew));
  }
  const techIds = [...new Set(crew.map((c) => c.technician_fsm_id))];
  const names = new Map<string, string>();
  for (const ids of chunkIds(techIds)) {
    const { data } = await admin.from("technician_reference").select("fsm_resource_id, display_name").in("fsm_resource_id", ids);
    for (const t of data ?? []) names.set(t.fsm_resource_id as string, t.display_name as string);
  }

  const cumulativeBefore = ((earlier.data ?? []) as { value: number }[]).reduce((sum, r) => sum + Number(r.value), 0);
  const total = item.quotationTotal;

  return {
    item,
    holdReason: (raw.data?.hold_reason as string | null) ?? null,
    queryText: (raw.data?.query_text as string | null) ?? null,
    quotation: quotation.data,
    value: {
      thisItem: item.value,
      cumulativeBefore: Math.round(cumulativeBefore * 100) / 100,
      cumulativeWithThis: Math.round((cumulativeBefore + item.value) * 100) / 100,
      remaining: total === null ? null : Math.round((total - cumulativeBefore - item.value) * 100) / 100,
      completionPercent: item.completionPercent,
      quotationTotal: total,
    },
    lines: (lines.data ?? []).map((l) => ({
      id: l.fsm_line_id as string,
      name: (l.name as string | null) ?? null,
      quantity: l.quantity === null ? null : Number(l.quantity),
      unitPrice: l.unit_price === null ? null : Number(l.unit_price),
      lineAmount: l.line_amount === null ? null : Number(l.line_amount),
      amount: Number(l.amount),
    })),
    appointments: ((appointments.data ?? []) as Record<string, unknown>[]).map((a) => ({
      id: a.fsm_appointment_id as string,
      number: (a.number as string | null) ?? null,
      status: (a.status as string | null) ?? null,
      scheduledStart: (a.scheduled_start as string | null) ?? null,
      scheduledEnd: (a.scheduled_end as string | null) ?? null,
      actualStart: (a.actual_start as string | null) ?? null,
      actualEnd: (a.actual_end as string | null) ?? null,
      technicians: crew
        .filter((c) => c.fsm_appointment_id === a.fsm_appointment_id)
        .sort((x, y) => Number(y.is_lead) - Number(x.is_lead))
        .map((c) => ({ name: names.get(c.technician_fsm_id) ?? "Unknown technician", lead: c.is_lead })),
    })),
    events: (events.data ?? []).map((e) => ({
      id: Number(e.id),
      type: e.event_type as string,
      from: (e.from_status as string | null) ?? null,
      to: (e.to_status as string | null) ?? null,
      actor: (e.actor_label as string | null) ?? null,
      note: (e.note as string | null) ?? null,
      at: e.created_at as string,
    })),
    exclusions: (exclusions.data ?? []).map((x) => ({
      id: x.id as string,
      reason: x.reason as string,
      notes: (x.notes as string | null) ?? null,
      evidence: (x.evidence as string[] | null) ?? [],
      requestedBy: (x.requested_by_label as string | null) ?? null,
      requestedAt: x.requested_at as string,
      decision: (x.decision as "verified" | "rejected" | null) ?? null,
      decisionNote: (x.decision_note as string | null) ?? null,
      decidedBy: (x.decided_by_label as string | null) ?? null,
      decidedAt: (x.decided_at as string | null) ?? null,
    })),
    invoice: invoice.data
      ? {
          number: invoice.data.maher_invoice_number as string,
          date: invoice.data.invoice_date as string,
          amount: Number(invoice.data.amount),
          queueValue: Number(invoice.data.queue_value),
          variance: Number(invoice.data.variance),
          varianceReason: (invoice.data.variance_reason as string | null) ?? null,
          recordedBy: (invoice.data.recorded_by_label as string | null) ?? null,
          recordedAt: invoice.data.recorded_at as string,
        }
      : null,
  };
}
