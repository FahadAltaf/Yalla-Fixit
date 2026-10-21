/**
 * The two conditions that put work in front of Finance (BRD 5.1 Step 1),
 * in one place so the queue trigger (DEV-433) and the exception report
 * (DEV-453) can never disagree. Both are provisional until decided:
 *
 *   D-01  what "job completed in FSM" means. Until answered: the work
 *         order is Completed or Closed in FSM, or has a completion time.
 *         (Seen 20 Oct: work orders are rarely completed while their
 *         appointments are, so this may well change.)
 *   D-02  which FSM field is "Ready to be Invoiced". Until answered:
 *         the quotation's Post_To_Maher__C is "To Be Invoiced".
 */

const COMPLETE_STATUSES = new Set(["completed", "closed"]);

export function isWorkComplete(workOrder: { status: string | null; completedAt: string | null }): boolean {
  return Boolean(workOrder.completedAt) || COMPLETE_STATUSES.has((workOrder.status ?? "").trim().toLowerCase());
}

export const READY_TO_INVOICE_VALUE = "To Be Invoiced";

export function isFlaggedForInvoice(estimate: { postToMaher: string | null }): boolean {
  return (estimate.postToMaher ?? "").trim().toLowerCase() === READY_TO_INVOICE_VALUE.toLowerCase();
}
