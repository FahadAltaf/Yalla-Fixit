import type { SupabaseClient } from "@supabase/supabase-js";

import type { DigestItem } from "@/lib/finance/digest-plan";
import { queueStatus, workOrderInvoicing, type QueueStatus, type WorkflowStatus } from "@/lib/finance/line-status";
import type { MetricExclusion, MetricInvoice, MetricItem } from "@/lib/finance/metrics";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Ready to invoice as the invoicing metrics (BRD 5.1 Step 8, 6.9; DEV-441)
 * and the daily digest (DEV-439) see it: one item per work order the
 * portal holds records for, read from schema finance only. FSM is never
 * called here: what a work order looked like is the snapshot kept when
 * someone last acted on it (migration 20261025100000).
 *
 *  - In the queue: a work order with a line marked Ready, an invoice, or a
 *    workflow status. One whose marks were all taken off, with nothing
 *    invoiced, has left it (Not ready) and is not counted.
 *  - Entered: when a line of it was first marked Ready.
 *  - Value: what is ready and not yet invoiced while it waits; what was
 *    invoiced once invoiced; its value before VAT once excluded.
 *  - Invoices: a row per work order an invoice covers, so a MAHER invoice
 *    across two work orders counts once (invoiceId) but times each. The
 *    variance (invoice total against the lines it covers) sits on its
 *    first row. Days to invoice run from the lines being marked Ready.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const earliest = (values: (string | null | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort()[0] ?? null;

export type LedgerWorkOrder = {
  id: string;
  label: string;
  number: string | null;
  quotationNumber: string | null;
  clientName: string | null;
  status: QueueStatus;
  enteredAt: string;
  statusChangedAt: string;
  value: number;
  subTotal: number | null;
  invoicedValue: number;
  holdReason: string | null;
};

export type LedgerMetrics = {
  ready: boolean;
  workOrders: LedgerWorkOrder[];
  items: MetricItem[];
  invoices: MetricInvoice[];
  exclusions: MetricExclusion[];
};

function missing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /PGRST205|42P01|line_states|line_invoices|line_events|work_order_states|wo_exclusions|schema cache/i.test(message);
}

export async function readLedgerForMetrics(admin: SupabaseClient): Promise<LedgerMetrics> {
  const finance = () => admin.schema("finance");
  let rows: Record<string, unknown>[][];
  try {
    rows = await Promise.all([
      readAllRows<Record<string, unknown>>(
        (from, to) =>
          finance()
            .from("line_states")
            .select("fsm_line_id, fsm_work_order_id, work_order_number, amount, ready, ready_at, invoiced_amount")
            .order("fsm_line_id")
            .range(from, to),
        "line states",
      ),
      readAllRows<Record<string, unknown>>((from, to) => finance().from("work_order_states").select("*").order("fsm_work_order_id").range(from, to), "work order states"),
      readAllRows<Record<string, unknown>>(
        (from, to) => finance().from("line_invoices").select("id, total_amount, recorded_at, recorded_by_label").order("id").range(from, to),
        "invoices",
      ),
      readAllRows<Record<string, unknown>>(
        (from, to) => finance().from("line_invoice_allocations").select("id, invoice_id, fsm_line_id, fsm_work_order_id, amount").order("id").range(from, to),
        "allocations",
      ),
      readAllRows<Record<string, unknown>>(
        (from, to) => finance().from("wo_exclusions").select("id, fsm_work_order_id, reason, decision").order("id").range(from, to),
        "exclusions",
      ),
      readAllRows<Record<string, unknown>>(
        (from, to) =>
          finance()
            .from("line_events")
            .select("id, fsm_work_order_id, event_type, created_at")
            .in("event_type", ["marked_ready", "invoiced"])
            .order("id")
            .range(from, to),
        "ready marks",
      ),
    ]);
  } catch (error) {
    if (missing(error)) return { ready: false, workOrders: [], items: [], invoices: [], exclusions: [] };
    throw error;
  }
  const [lines, flows, invoiceRows, allocations, exclusionRows, events] = rows;

  const linesOf = new Map<string, Record<string, unknown>[]>();
  for (const l of lines) {
    const id = String(l.fsm_work_order_id);
    linesOf.set(id, [...(linesOf.get(id) ?? []), l]);
  }
  const flowOf = new Map(flows.map((f) => [String(f.fsm_work_order_id), f]));
  /* Entered: the first Ready mark; an invoice also marks its lines Ready. */
  const enteredOf = new Map<string, string>();
  for (const e of events) {
    const id = String(e.fsm_work_order_id);
    const at = String(e.created_at);
    if (!enteredOf.has(id) || at < enteredOf.get(id)!) enteredOf.set(id, at);
  }

  const workOrders: LedgerWorkOrder[] = [];
  for (const id of new Set([...linesOf.keys(), ...flowOf.keys()])) {
    const states = linesOf.get(id) ?? [];
    const flow = flowOf.get(id);
    const subTotal = flow?.sub_total === null || flow?.sub_total === undefined ? null : Number(flow.sub_total);
    let invoicing = workOrderInvoicing(
      states.map((s) => ({ amount: Number(s.amount ?? 0), ready: Boolean(s.ready), invoicedAmount: Number(s.invoiced_amount ?? 0) })),
    );
    /* Lines the portal never kept do not count: invoiced in full only when it reaches FSM's total. */
    if (invoicing.status === "invoiced" && subTotal !== null && invoicing.invoicedValue < subTotal - 0.01) {
      invoicing = { ...invoicing, status: "partially_invoiced" };
    }
    const workflow = ((flow?.status as WorkflowStatus | undefined) ?? "open") as WorkflowStatus;
    const status = queueStatus(workflow, invoicing.status);
    if (status === "not_ready") continue;

    const firstReady = earliest(states.filter((s) => s.ready).map((s) => str(s.ready_at)));
    const enteredAt = enteredOf.get(id) ?? firstReady ?? str(flow?.status_changed_at) ?? new Date().toISOString();
    const statusChangedAt = workflow !== "open" && flow ? String(flow.status_changed_at) : (firstReady ?? enteredAt);
    const linesValue = round2(states.reduce((sum, s) => sum + Number(s.amount ?? 0), 0));
    const value =
      status === "excluded" ? (subTotal ?? linesValue) : status === "invoiced" ? invoicing.invoicedValue : invoicing.readyValue;
    const number = str(flow?.work_order_number) ?? str(states[0]?.work_order_number);
    const quotationNumber = str(flow?.quotation_number);
    workOrders.push({
      id,
      label: quotationNumber ? `Quotation ${quotationNumber}` : (number ?? id),
      number,
      quotationNumber,
      clientName: str(flow?.client_name),
      status,
      enteredAt,
      statusChangedAt,
      value,
      subTotal,
      invoicedValue: invoicing.invoicedValue,
      holdReason: str(flow?.hold_reason),
    });
  }

  /* One row per invoice and work order; the variance on the invoice's first row. */
  const readyAtOf = new Map(lines.map((l) => [String(l.fsm_line_id), str(l.ready_at)]));
  const invoiceById = new Map(invoiceRows.map((i) => [String(i.id), i]));
  const groups = new Map<string, { invoiceId: string; workOrderId: string; amount: number; startedAt: string | null }>();
  for (const a of allocations) {
    const key = `${a.invoice_id}|${a.fsm_work_order_id}`;
    const group = groups.get(key) ?? { invoiceId: String(a.invoice_id), workOrderId: String(a.fsm_work_order_id), amount: 0, startedAt: null };
    group.amount = round2(group.amount + Number(a.amount));
    group.startedAt = earliest([group.startedAt, readyAtOf.get(String(a.fsm_line_id))]);
    groups.set(key, group);
  }
  const allocatedOf = new Map<string, number>();
  for (const g of groups.values()) allocatedOf.set(g.invoiceId, round2((allocatedOf.get(g.invoiceId) ?? 0) + g.amount));
  const varianceGiven = new Set<string>();
  const invoices: MetricInvoice[] = [];
  for (const g of groups.values()) {
    const invoice = invoiceById.get(g.invoiceId);
    if (!invoice) continue;
    const variance = varianceGiven.has(g.invoiceId) ? 0 : round2(Number(invoice.total_amount) - (allocatedOf.get(g.invoiceId) ?? 0));
    varianceGiven.add(g.invoiceId);
    invoices.push({
      queueItemId: g.workOrderId,
      invoiceId: g.invoiceId,
      amount: round2(g.amount + variance),
      queueValue: g.amount,
      recordedAt: String(invoice.recorded_at),
      recordedByLabel: str(invoice.recorded_by_label),
      startedAt: g.startedAt,
    });
  }

  return {
    ready: true,
    workOrders,
    items: workOrders.map((w) => ({
      id: w.id,
      status: w.status as MetricItem["status"],
      value: w.value,
      enteredAt: w.enteredAt,
      statusChangedAt: w.statusChangedAt,
      holdReason: w.holdReason,
    })),
    invoices,
    exclusions: exclusionRows.map((x) => ({ queueItemId: String(x.fsm_work_order_id), reason: String(x.reason), decision: str(x.decision) })),
  };
}

/** The digest's view of the same work orders. */
export function digestItemsOf(workOrders: LedgerWorkOrder[]): DigestItem[] {
  return workOrders.map((w) => ({
    id: w.id,
    label: w.label,
    status: w.status,
    statusChangedAt: w.statusChangedAt,
    enteredAt: w.enteredAt,
    value: w.value,
    quotationNumber: w.quotationNumber,
    workOrderNumber: w.number,
    clientName: w.clientName,
    completionPercent: w.subTotal ? Math.min(100, Math.round((w.invoicedValue / w.subTotal) * 1000) / 10) : null,
  }));
}
