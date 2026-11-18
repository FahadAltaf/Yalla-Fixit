/**
 * The two conditions that put work in front of Finance (BRD 5.1 Step 1),
 * in one place so the queue trigger (DEV-433) and the exception report
 * (DEV-453) can never disagree. Both are provisional until decided:
 *
 *   D-01  what "job completed in FSM" means. Answered 13 Nov: the work
 *         order is Completed in FSM (or has a completion time and is not
 *         Closed, Cancelled or Void). Closed = cancelled.
 *   D-02  which FSM field is "Ready to be Invoiced". Until answered:
 *         the quotation's Post_To_Maher__C is "To Be Invoiced".
 */

/*
  D-01 answered by Sami (13 Nov): only "Completed" is completed. "Closed"
  means cancelled in YFI's FSM and is never invoiced, so a Closed (or
  Cancelled, Void) work order is not complete even when FSM gave it a
  completion time.
*/
const NOT_COMPLETE_STATUSES = new Set(["closed", "cancelled", "canceled", "void", "voided"]);

export function isWorkComplete(workOrder: { status: string | null; completedAt: string | null }): boolean {
  const status = (workOrder.status ?? "").trim().toLowerCase();
  if (NOT_COMPLETE_STATUSES.has(status)) return false;
  return status === "completed" || Boolean(workOrder.completedAt);
}

export const READY_TO_INVOICE_VALUE = "To Be Invoiced";

export function isFlaggedForInvoice(estimate: { postToMaher: string | null }): boolean {
  return (estimate.postToMaher ?? "").trim().toLowerCase() === READY_TO_INVOICE_VALUE.toLowerCase();
}
