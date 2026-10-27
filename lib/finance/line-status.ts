/**
 * Where a line item, and a work order, stand for invoicing (decided with
 * the user, 22 Oct; Ready from FSM, 23 Oct). Pure, so the list, the
 * detail and the tests all agree.
 *
 *  Line: Not ready -> Ready (completed in Zoho FSM, or its work order is)
 *        -> Partially invoiced (part of its amount on a MAHER invoice) ->
 *        Invoiced (all of it). Only a Ready line can be invoiced.
 *  Work order: Invoiced when every line is; Partially invoiced when any
 *        amount is invoiced; Ready when any line is ready; else Not ready.
 *
 * Amounts are before VAT, like FSM's line Amount (D-05). A cent either way
 * is rounding, not money left.
 */

/** Completed in Zoho FSM, for a work order or a line. */
export function isFsmCompleted(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === "completed";
}

/** A line can be invoiced once it, or its whole work order, is completed in FSM. */
export function lineCanBeInvoiced(lineStatus: string | null | undefined, workOrderStatus: string | null | undefined): boolean {
  return isFsmCompleted(lineStatus) || isFsmCompleted(workOrderStatus);
}

type VatLine = { amount: number | null; lineAmount: number | null; taxPercent: number | null };

/** The line's own VAT rate as a multiplier: FSM's Line_Item_Amount over Amount, else its tax %. */
export function vatRate(line: VatLine): number {
  return line.amount && line.lineAmount !== null && line.amount > 0 ? line.lineAmount / line.amount : 1 + Math.max(0, line.taxPercent ?? 0) / 100;
}

/** What a before-VAT amount comes to with VAT, at the line's own rate. */
export function withVat(amount: number, line: VatLine): number {
  return Math.round(amount * vatRate(line) * 100) / 100;
}

/** The before-VAT part of an amount with VAT in it, at the line's own rate. */
export function withoutVat(amount: number, line: VatLine): number {
  return Math.round((amount / vatRate(line)) * 100) / 100;
}

export type InvoiceStatus = "not_ready" | "ready" | "partially_invoiced" | "invoiced";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  not_ready: "Not ready",
  ready: "Ready to invoice",
  partially_invoiced: "Partially invoiced",
  invoiced: "Invoiced",
};

const CENT = 0.01;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LineState = {
  amount: number | null;
  ready: boolean;
  invoicedAmount: number;
  /** What may be invoiced of it now (lib/finance/progress.ts); left out, all that is left once ready. */
  cap?: number;
};

export function lineRemaining(line: LineState): number {
  return Math.max(0, round2((line.amount ?? 0) - line.invoicedAmount));
}

export function lineStatus(line: LineState): InvoiceStatus {
  const amount = line.amount ?? 0;
  if (line.invoicedAmount > 0 && line.invoicedAmount >= amount - CENT) return "invoiced";
  if (line.invoicedAmount > 0) return "partially_invoiced";
  return line.ready ? "ready" : "not_ready";
}

export type WorkOrderInvoicing = {
  status: InvoiceStatus;
  lines: number;
  readyLines: number;
  /** What Finance can invoice now: what is left of ready lines, or as much as Operations' percentage allows. */
  readyValue: number;
  invoicedValue: number;
  /** Not yet invoiced, ready or not. */
  remainingValue: number;
};

export function workOrderInvoicing(lines: LineState[]): WorkOrderInvoicing {
  const statuses = lines.map(lineStatus);
  const invoicedValue = round2(lines.reduce((sum, l) => sum + l.invoicedAmount, 0));
  const readyValue = round2(lines.reduce((sum, l) => sum + (l.ready ? Math.min(lineRemaining(l), l.cap ?? lineRemaining(l)) : 0), 0));
  const remainingValue = round2(lines.reduce((sum, l) => sum + lineRemaining(l), 0));
  const status: InvoiceStatus =
    lines.length > 0 && statuses.every((s) => s === "invoiced")
      ? "invoiced"
      : invoicedValue > 0
        ? "partially_invoiced"
        : lines.some((l) => l.ready)
          ? "ready"
          : "not_ready";
  return { status, lines: lines.length, readyLines: lines.filter((l) => l.ready).length, readyValue, invoicedValue, remainingValue };
}

/* ---------------------------------------------------------------------
   Ready to invoice: one status per work order, the queue's (BRD 5.1
   Step 4) over what its lines say. The workflow (picked up, query, hold,
   excluded) is stored per work order; 'open' leaves it to the lines.
   --------------------------------------------------------------------- */

export type WorkflowStatus = "open" | "in_progress" | "query_raised" | "on_hold" | "excluded";

export type QueueStatus =
  | "not_ready"
  | "pending"
  | "in_progress"
  | "query_raised"
  | "on_hold"
  | "partially_invoiced"
  | "invoiced"
  | "excluded"
  | "non_billable"
  | "void";

export const QUEUE_STATUS_LABELS: Record<QueueStatus, string> = {
  not_ready: "Not ready",
  pending: "Pending",
  in_progress: "In Progress",
  query_raised: "Query Raised",
  on_hold: "On Hold",
  partially_invoiced: "Partially invoiced",
  invoiced: "Invoiced",
  excluded: "Excluded",
  non_billable: "Non-billable",
  void: "Void",
};

/** What "Awaiting action" shows: work Finance still has to do something with. */
export const AWAITING_ACTION: QueueStatus[] = ["pending", "in_progress", "query_raised", "on_hold", "partially_invoiced"];

/**
 * FSM's own end states come next to the portal's (26 Oct): Void is never
 * invoiced; Non-billable is completed work not to be invoiced (AMC, free
 * service), handled apart from billable work.
 */
export function queueStatus(workflow: WorkflowStatus, invoicing: InvoiceStatus, fsmStatus?: string | null): QueueStatus {
  if (workflow === "excluded") return "excluded";
  if (invoicing === "invoiced") return "invoiced";
  const fsm = (fsmStatus ?? "").trim().toLowerCase();
  if (fsm === "void" || fsm === "voided") return "void";
  if (/^non[\s-]?billable$/.test(fsm)) return "non_billable";
  if (workflow === "query_raised" || workflow === "on_hold" || workflow === "in_progress") return workflow;
  if (invoicing === "partially_invoiced") return "partially_invoiced";
  return invoicing === "ready" ? "pending" : "not_ready";
}
