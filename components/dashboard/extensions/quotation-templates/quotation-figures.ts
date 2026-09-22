import { calculateTotals, type QuotationData } from "./quotation-templates";

/**
 * The figures a quotation prints, worked out the way YallaClassicTemplate
 * works them out, for the places that show them outside the document: the
 * client page summary and the Word export.
 */

export function lineDiscount(item: QuotationData["lineItems"][number]): number {
  const lineTotal = item.quantity * item.unitPrice;
  return item.discountType === "Percent"
    ? ((item.discountAmount || 0) / 100) * lineTotal
    : item.discountAmount || 0;
}

/* Revisions print as ROOT-CR-2 / ROOT-IR-2. */
export function quotationDisplayNumber(data: QuotationData, rootQuotationNumber?: string): string {
  const isRevision =
    typeof data.quotationType === "string" && data.quotationType.trim().toLowerCase() === "revision";
  const code = data.revisionType === "External" ? "CR" : data.revisionType === "Internal" ? "IR" : null;
  const revision = typeof data.revisionNumber === "number" ? String(data.revisionNumber) : "";
  return isRevision && code && rootQuotationNumber
    ? `${rootQuotationNumber}-${code}-${revision}`
    : data.quotationNumber;
}

export function quotationFigures(data: QuotationData) {
  const calculated = calculateTotals(data);
  const subTotal = calculated.subTotal;
  const discount = data.lineItems.reduce((sum, item) => sum + lineDiscount(item), 0);
  return {
    subTotal,
    discount,
    totalAfterDiscount: subTotal - discount,
    taxAmount: data.taxAmount || calculated.taxAmount,
    grandTotal: data.grandTotal || calculated.grandTotal,
    avgTax: calculated.avgTax,
  };
}
