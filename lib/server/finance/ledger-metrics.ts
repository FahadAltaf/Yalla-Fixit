import type { SupabaseClient } from "@supabase/supabase-js";

import type { DigestItem } from "@/lib/finance/digest-plan";
import { isFsmCompleted, isZeroValueCompleted, queueStatus, type QueueStatus, type WorkflowStatus } from "@/lib/finance/line-status";
import type { MetricExclusion, MetricInvoice, MetricItem } from "@/lib/finance/metrics";
import { effectiveEntry, isEnded } from "@/lib/finance/progress";
import { billableValue, invoicingFrom, loadProgress, progressCap, type StateRow } from "@/lib/server/finance/work-orders";
import { readAllRows } from "@/lib/server/snagging/read-all";

/**
 * Ready to invoice as the invoicing metrics (BRD 5.1 Step 8, 6.9; DEV-441)
 * and the daily digest (DEV-439) see it: one item per work order the
 * portal holds records for, read from schema finance only. FSM is never
 * called here: what a work order looked like is the snapshot kept when
 * someone last acted on it (migration 20261025100000).
 *
 *  - In the queue: by the same rule as Ready to invoice (Sami, 9 Nov:
 *    the figures differed). Ready once the work order is Completed in FSM
 *    (as last seen), or as far as Operations' "invoice" percentages
 *    allow; or with an invoice, a workflow status, or Non-billable. Not
 *    ready ones, and Void, Cancelled or Closed work with nothing invoiced,
 *    are not counted.
 *  - Entered: when it became invoiceable: FSM completing the work, or
 *    Operations' first "invoice" percentage, or a Ready mark.
 *  - Value: what is ready and not yet invoiced while it waits; what was
 *    invoiced once invoiced; its value before VAT once excluded.
 *  - Invoices: a row per work order an invoice covers, so a MAHER invoice
 *    across two work orders counts once (invoiceId) but times each. The
 *    variance (invoice total against the lines it covers) sits on its
 *    first row: the MAHER total Finance entered (20261118150000) less the
 *    lines. Days to invoice run from when the lines became invoiceable,
 *    never from the invoice itself (an invoice used to set that time, so
 *    some invoices showed 0 days); unknown, the invoice is left out of
 *    the average.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
/* The UAE's standard VAT, for a work order whose own rate the portal has not seen yet. */
const STANDARD_VAT_RATE = 1.05;
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
            /* Every column: fsm_completed_at arrives with 20261025100000. */
            .select("*")
            .order("fsm_line_id")
            .range(from, to),
        "line states",
      ),
      readAllRows<Record<string, unknown>>((from, to) => finance().from("work_order_states").select("*").order("fsm_work_order_id").range(from, to), "work order states"),
      readAllRows<Record<string, unknown>>(
        /* Every column: maher_total arrives with 20261118150000. */
        (from, to) => finance().from("line_invoices").select("*").order("id").range(from, to),
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
            .select("id, fsm_work_order_id, fsm_line_id, event_type, created_at")
            .eq("event_type", "marked_ready")
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
  /* The first Ready mark, per work order and per line (an invoice is not one: it would make the wait 0 days). */
  const enteredOf = new Map<string, string>();
  const markedOf = new Map<string, string>();
  for (const e of events) {
    const id = String(e.fsm_work_order_id);
    const at = String(e.created_at);
    if (!enteredOf.has(id) || at < enteredOf.get(id)!) enteredOf.set(id, at);
    const line = str(e.fsm_line_id);
    if (line && (!markedOf.has(line) || at < markedOf.get(line)!)) markedOf.set(line, at);
  }
  /* Operations' "% done" (20261026100000), as Ready to invoice reads it. */
  const progress = await loadProgress(admin, [...new Set([...linesOf.keys(), ...flowOf.keys()])]);
  /* When Operations first allowed some of a line (or the whole work order) to be invoiced. */
  const firstInvoicePercent = (workOrderId: string, lineId: string | null) =>
    earliest(
      (progress.byWorkOrder.get(workOrderId) ?? [])
        .filter((e) => e.purpose === "invoice" && e.percent > 0 && (e.lineId === null || e.lineId === lineId))
        .map((e) => e.recordedAt),
    );

  /*
    Every value here is with VAT (23 Oct), at the work order's own rate as
    last seen: FSM's Grand_Total over Sub_Total, else its lines'
    Line_Item_Amount over Amount (both kept by 20261025100000), else the
    standard 5 %.
  */
  const woRateOf = (id: string) => {
    const flow = flowOf.get(id);
    const sub = Number(flow?.sub_total ?? 0);
    const grand = Number(flow?.grand_total ?? 0);
    if (sub > 0 && grand > 0) return grand / sub;
    const known = (linesOf.get(id) ?? []).filter((l) => l.amount_with_vat !== null && l.amount_with_vat !== undefined && Number(l.amount) > 0);
    const base = known.reduce((sum, l) => sum + Number(l.amount), 0);
    return base > 0 ? known.reduce((sum, l) => sum + Number(l.amount_with_vat), 0) / base : STANDARD_VAT_RATE;
  };

  const workOrders: LedgerWorkOrder[] = [];
  for (const id of new Set([...linesOf.keys(), ...flowOf.keys()])) {
    const states = linesOf.get(id) ?? [];
    const flow = flowOf.get(id);
    const subTotal = flow?.sub_total === null || flow?.sub_total === undefined ? null : Number(flow.sub_total);
    const fsmStatus = str(flow?.fsm_status);
    /* As Ready to invoice works it out: all that is left once Completed in FSM, else what Operations' percentages allow. */
    const woCompleted = isFsmCompleted(fsmStatus);
    const stateRows: StateRow[] = states.map((s) => ({
      lineId: String(s.fsm_line_id),
      workOrderId: id,
      name: str(s.name),
      amount: Number(s.amount ?? 0),
      ready: Boolean(s.ready),
      invoicedAmount: Number(s.invoiced_amount ?? 0),
      readyAt: str(s.ready_at),
      readyBy: str(s.ready_by_label),
      completedAt: str(s.fsm_completed_at),
      billable: s.billable === null || s.billable === undefined ? null : Boolean(s.billable),
    }));
    const entries = progress.byWorkOrder.get(id) ?? [];
    const invoicing = invoicingFrom(stateRows, subTotal, woCompleted, woCompleted ? 0 : progressCap(entries, stateRows, subTotal, fsmStatus));
    const workflow = ((flow?.status as WorkflowStatus | undefined) ?? "open") as WorkflowStatus;
    const owed = billableValue(stateRows, subTotal);
    /* Operations' complete as Ready to invoice counts it: the whole work order at 100 %, or every billable line known. */
    const billableRows = stateRows.filter((r) => r.billable !== false);
    const operationsComplete =
      entries.some((e) => e.lineId === null && e.percent >= 100) ||
      (billableRows.length > 0 && billableRows.every((r) => (effectiveEntry(r.lineId, entries)?.percent ?? 0) >= 100));
    const zeroValue = isZeroValueCompleted(subTotal, fsmStatus, operationsComplete);
    const status = queueStatus(workflow, invoicing.status, fsmStatus, { zeroValue });
    if (status === "not_ready") continue;
    /* Void, Cancelled or Closed: counted only if something was invoiced before it ended (as Ready to invoice). */
    if (isEnded(fsmStatus) && invoicing.invoicedValue <= 0) continue;

    const firstReady = earliest([
      woCompleted ? str(flow?.fsm_completed_at) : null,
      firstInvoicePercent(id, null),
      ...states.map((s) => firstInvoicePercent(id, String(s.fsm_line_id))),
    ]);
    const enteredAt = earliest([firstReady, enteredOf.get(id)]) ?? str(flow?.status_changed_at) ?? new Date().toISOString();
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
      value: round2(value * woRateOf(id)),
      /* What is owed (less non-billable lines): the daily email's completion % is of this. */
      subTotal: owed,
      invoicedValue: invoicing.invoicedValue,
      holdReason: str(flow?.hold_reason),
    });
  }

  /* One row per invoice and work order; the variance on the invoice's first row. */
  /* Days to invoice run from FSM completing the line (or its work order), else the old Ready mark. */
  /* An invoice total is with VAT (23 Oct): its lines are compared at each line's own rate, as last seen. */
  const vatRateOf = new Map(
    lines.map((l) => {
      const amount = Number(l.amount ?? 0);
      const withVat = l.amount_with_vat === null || l.amount_with_vat === undefined ? null : Number(l.amount_with_vat);
      return [String(l.fsm_line_id), withVat !== null && amount > 0 ? withVat / amount : woRateOf(String(l.fsm_work_order_id))];
    }),
  );
  /* When the line became invoiceable: FSM completing it or its work order, Operations' first "invoice" %, or a Ready mark. */
  const readyAtOf = new Map(
    lines.map((l) => {
      const workOrderId = String(l.fsm_work_order_id);
      const lineId = String(l.fsm_line_id);
      return [
        lineId,
        earliest([
          str(l.fsm_completed_at),
          str(flowOf.get(workOrderId)?.fsm_completed_at),
          firstInvoicePercent(workOrderId, lineId),
          markedOf.get(lineId),
        ]),
      ];
    }),
  );
  const invoiceById = new Map(invoiceRows.map((i) => [String(i.id), i]));
  const groups = new Map<string, { invoiceId: string; workOrderId: string; amount: number; withVat: number; startedAt: string | null }>();
  for (const a of allocations) {
    const key = `${a.invoice_id}|${a.fsm_work_order_id}`;
    const group = groups.get(key) ?? { invoiceId: String(a.invoice_id), workOrderId: String(a.fsm_work_order_id), amount: 0, withVat: 0, startedAt: null };
    group.amount = round2(group.amount + Number(a.amount));
    group.withVat = round2(group.withVat + Number(a.amount) * (vatRateOf.get(String(a.fsm_line_id)) ?? 1));
    group.startedAt = earliest([group.startedAt, readyAtOf.get(String(a.fsm_line_id))]);
    groups.set(key, group);
  }
  const allocatedOf = new Map<string, number>();
  for (const g of groups.values()) allocatedOf.set(g.invoiceId, round2((allocatedOf.get(g.invoiceId) ?? 0) + g.withVat));
  const varianceGiven = new Set<string>();
  const invoices: MetricInvoice[] = [];
  for (const g of groups.values()) {
    const invoice = invoiceById.get(g.invoiceId);
    if (!invoice) continue;
    /* The MAHER total Finance entered, else (before 20261118150000) the portal's own total. */
    const billed = invoice.maher_total === null || invoice.maher_total === undefined ? Number(invoice.total_amount) : Number(invoice.maher_total);
    const variance = varianceGiven.has(g.invoiceId) ? 0 : round2(billed - (allocatedOf.get(g.invoiceId) ?? 0));
    varianceGiven.add(g.invoiceId);
    invoices.push({
      queueItemId: g.workOrderId,
      invoiceId: g.invoiceId,
      amount: round2(g.withVat + variance),
      queueValue: g.withVat,
      recordedAt: String(invoice.recorded_at),
      recordedByLabel: str(invoice.recorded_by_label),
      /* Null: when it became invoiceable is unknown, so it is left out of days to invoice. */
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
