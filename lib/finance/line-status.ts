/**
 * Where a line item, and a work order, stand for invoicing (decided with
 * the user, 22 Oct). Pure, so the list, the detail and the tests all
 * agree.
 *
 *  Line: Not ready -> Ready (marked in the portal) -> Partially invoiced
 *        (part of its amount on a MAHER invoice) -> Invoiced (all of it).
 *  Work order: Invoiced when every line is; Partially invoiced when any
 *        amount is invoiced; Ready when any line is ready; else Not ready.
 *
 * Amounts are before VAT, like FSM's line Amount (D-05). A cent either way
 * is rounding, not money left.
 */

export type InvoiceStatus = "not_ready" | "ready" | "partially_invoiced" | "invoiced";

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  not_ready: "Not ready",
  ready: "Ready to invoice",
  partially_invoiced: "Partially invoiced",
  invoiced: "Invoiced",
};

const CENT = 0.01;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LineState = { amount: number | null; ready: boolean; invoicedAmount: number };

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
  /** Ready and not yet invoiced: what Finance can invoice now. */
  readyValue: number;
  invoicedValue: number;
  /** Not yet invoiced, ready or not. */
  remainingValue: number;
};

export function workOrderInvoicing(lines: LineState[]): WorkOrderInvoicing {
  const statuses = lines.map(lineStatus);
  const invoicedValue = round2(lines.reduce((sum, l) => sum + l.invoicedAmount, 0));
  const readyValue = round2(lines.reduce((sum, l) => sum + (l.ready ? lineRemaining(l) : 0), 0));
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
