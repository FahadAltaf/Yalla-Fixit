import { isFsmCompleted } from "./line-status";

/**
 * When work can be invoiced, how much, and what is recognised as revenue
 * (invoicing changes 1, 2, 4, 5 and 7, decided 26 Oct). Pure, so the list,
 * the work order, the server's checks and the tests all agree.
 *
 *  - Ready for Finance: the work order is Completed in FSM and its
 *    quotation's Post to MAHER is "To Be Invoiced". All of what is left can
 *    be invoiced.
 *  - Before that, Operations can say "X % done, invoice this": Finance may
 *    invoice up to X % of the line. "X % done, revenue only" invoices
 *    nothing.
 *  - Non-billable (completed, not to be invoiced: AMC, free service), and
 *    Void, Cancelled or Closed work orders (30 Oct) are never invoiced.
 *  - Recognised value: all of a Completed work order; otherwise the latest
 *    percentage Operations gave, whatever its purpose; never less than what
 *    has been invoiced.
 *
 * Amounts are before VAT, like FSM's line Amount.
 */

export type ProgressPurpose = "invoice" | "revenue_only";

export const PROGRESS_PURPOSE_LABELS: Record<ProgressPurpose, string> = {
  invoice: "To invoice",
  revenue_only: "Revenue only",
};

export type ProgressEntry = {
  /** Null: the whole work order. */
  lineId: string | null;
  percent: number;
  purpose: ProgressPurpose;
  recordedAt: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** FSM's "Non-billable": completed, not to be invoiced. */
export function isNonBillable(status: string | null | undefined): boolean {
  return /^non[\s-]?billable$/i.test((status ?? "").trim());
}

/**
 * The status the invoicing rules read: FSM's status, or "Non-billable" when
 * FSM's separate Billing Status says Non Billable (a work order can be In
 * Progress and Non Billable at once, as WO3000 is). Shown statuses stay FSM's.
 */
export function invoicingStatus(status: string | null | undefined, billingStatus: string | null | undefined): string | null {
  if (isNonBillable(billingStatus) && !isEnded(status)) return "Non-billable";
  return status ?? null;
}

/**
 * Whether a line may be invoiced by FSM's Billing Status: the line's own
 * ("Not yet Invoiced" is billable, "Non Billable" is not), else the work
 * order's. A work order can mix billable and non-billable lines (27 Oct).
 */
export function lineBillable(lineBillingStatus: string | null | undefined, workOrderBillingStatus: string | null | undefined): boolean {
  return !isNonBillable(lineBillingStatus?.trim() ? lineBillingStatus : workOrderBillingStatus);
}

/** FSM's "Void": nothing to invoice or recognise. */
export function isVoid(status: string | null | undefined): boolean {
  return /^void(ed)?$/i.test((status ?? "").trim());
}

/** FSM's "Cancelled" or "Closed" (30 Oct): the work order is over. */
export function isCancelledOrClosed(status: string | null | undefined): boolean {
  return /^(cancell?ed|closed)$/i.test((status ?? "").trim());
}

/**
 * Void, Cancelled or Closed in FSM (30 Oct): nothing more is done on it in
 * the portal: no completion, no invoice, nothing newly recognised. What was
 * already invoiced stays.
 */
export function isEnded(status: string | null | undefined): boolean {
  return isVoid(status) || isCancelledOrClosed(status);
}

/** The quotation's Post to MAHER says the work is to be invoiced. */
export function isFlaggedToInvoice(postToMaher: string | null | undefined): boolean {
  return (postToMaher ?? "").trim().toLowerCase() === "to be invoiced";
}

/** Completed in FSM and flagged To Be Invoiced: Finance invoices all of it. */
export function readyForFinance(workOrderStatus: string | null | undefined, postToMaher: string | null | undefined): boolean {
  return isFsmCompleted(workOrderStatus) && isFlaggedToInvoice(postToMaher);
}

/** The entry that counts for a line: the latest of its own and the whole work order's. */
export function effectiveEntry(lineId: string, entries: ProgressEntry[]): ProgressEntry | null {
  let best: ProgressEntry | null = null;
  for (const e of entries) {
    if (e.lineId !== null && e.lineId !== lineId) continue;
    if (!best || e.recordedAt > best.recordedAt) best = e;
  }
  return best;
}

export type LineMoney = { amount: number | null; invoicedAmount: number };

/**
 * What Finance may invoice of a line now, before VAT: what is left once the
 * work order is ready for Finance; else the latest "invoice" percentage less
 * what is already invoiced; nothing for Non-billable or Void work.
 */
export function invoiceCap(
  line: LineMoney,
  context: { workOrderStatus: string | null; postToMaher: string | null; entry: ProgressEntry | null },
): number {
  if (isNonBillable(context.workOrderStatus) || isEnded(context.workOrderStatus)) return 0;
  const amount = Math.max(0, line.amount ?? 0);
  const left = Math.max(0, round2(amount - line.invoicedAmount));
  if (readyForFinance(context.workOrderStatus, context.postToMaher)) return left;
  const e = context.entry;
  if (!e || e.purpose !== "invoice") return 0;
  return Math.min(left, Math.max(0, round2((amount * e.percent) / 100 - line.invoicedAmount)));
}

/** Recognised value of a line, before VAT: all of it once Completed, else the latest percentage; never below what is invoiced. */
export function recognisedValue(line: LineMoney, context: { workOrderStatus: string | null; entry: ProgressEntry | null }): number {
  if (isEnded(context.workOrderStatus) || isNonBillable(context.workOrderStatus)) return round2(line.invoicedAmount);
  const amount = Math.max(0, line.amount ?? 0);
  if (isFsmCompleted(context.workOrderStatus)) return round2(Math.max(amount, line.invoicedAmount));
  const byProgress = context.entry ? round2((amount * context.entry.percent) / 100) : 0;
  return round2(Math.max(byProgress, line.invoicedAmount));
}

/** Percent of a line's amount that a before-VAT figure is, for display. */
export function percentOf(part: number, amount: number | null): number | null {
  return amount && amount > 0 ? Math.round((part / amount) * 1000) / 10 : null;
}

// ---------------------------------------------------------------------
// Complete and partially complete (30 Oct)
// ---------------------------------------------------------------------

/*
  Operations marks each line Complete (100 %) or Partially complete (a %
  below 100), either to invoice or revenue only. The work order
  follows its lines: Complete only once every billable line is, otherwise
  Partially complete while any line has a %. Operations then confirms the
  work order Complete, which is refused until every line is.
*/

export type Completion = "not_started" | "partial" | "complete";

export const COMPLETION_LABELS: Record<Completion, string> = {
  not_started: "Not started",
  partial: "Partially complete",
  complete: "Complete",
};

/** A line's completion from the entry that counts for it. */
export function lineCompletion(entry: Pick<ProgressEntry, "percent"> | null | undefined): Completion {
  if (!entry || entry.percent <= 0) return "not_started";
  return entry.percent >= 100 ? "complete" : "partial";
}

/** The work order's, from its billable lines: Complete only when every one is. */
export function workOrderCompletion(lines: Array<{ billable: boolean; completion: Completion }>): {
  completion: Completion;
  complete: number;
  billable: number;
} {
  const billable = lines.filter((l) => l.billable);
  const complete = billable.filter((l) => l.completion === "complete").length;
  const completion: Completion =
    billable.length > 0 && complete === billable.length ? "complete" : billable.some((l) => l.completion !== "not_started") ? "partial" : "not_started";
  return { completion, complete, billable: billable.length };
}

/**
 * Why a completion entry is refused, or null. Complete is 100 %, Partially
 * complete above 0 and below it, either to invoice or revenue only; the whole work order
 * is only ever marked Complete, and only once every billable line is (after
 * this request's own lines are applied).
 */
export function completionRefusal(
  entries: Array<{ line: string | null; percent: number; purpose: ProgressPurpose }>,
  lines: Array<{ id: string; name: string | null; billable: boolean; completion: Completion }>,
): string | null {
  for (const e of entries) {
    if (e.line === null) {
      if (e.percent < 100) return "Partially complete is entered line by line, not for the whole work order.";
      continue;
    }
    if (e.percent <= 0) return "Partially complete needs a % above 0.";
  }
  if (entries.some((e) => e.line === null)) {
    const after = new Map(lines.map((l) => [l.id, l.completion]));
    for (const e of entries) if (e.line !== null) after.set(e.line, lineCompletion(e));
    const open = lines.filter((l) => l.billable && after.get(l.id) !== "complete");
    if (open.length) {
      return `The work order can be complete only when every line is. Not complete yet: ${open.map((l) => l.name ?? "a line").join(", ")}.`;
    }
  }
  return null;
}
