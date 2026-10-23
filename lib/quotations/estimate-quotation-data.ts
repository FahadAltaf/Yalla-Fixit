import type { QuotationData, QuotationLineItem } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";

/*
  A Zoho FSM estimate as the quotation templates take it. Moved from
  app/api/estimates/route.ts unchanged, so the Finance work order page shows
  the same quotation document the Extensions screens do.
*/

function buildIdNameValue(id: string, name: string): string {
  return `${id}_${name}`;
}

function parseRevisionType(
  value: unknown,
): "Internal" | "External" | undefined {
  if (value === "Internal" || value === "External") {
    return value;
  }
  return undefined;
}

function relationId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.trim()
  ) {
    return value.id;
  }
  return undefined;
}

export function mapToQuotationData(payload: any): QuotationData {
  const estimate = payload?.estimate?.data?.[0];
  if (!estimate) {
    throw new Error("No estimate data found");
  }

  // Try to capture Zoho FSM estimate record id (field name may vary slightly).
  const zohoEstimateId: string | null =
    typeof estimate.id === "string"
      ? estimate.id
      : typeof estimate.ID === "string"
        ? estimate.ID
        : null;

  const companyName = estimate.Territory?.name ?? "Yalla Fix It";

  const companyAddress = estimate.Billing_Address?.Billing_Address_Name ?? "";

  const customerCompanyName = estimate.Company?.name || "";

  const customerContact = estimate.Contact?.name ?? null;
  const customerPhone = estimate.Phone ?? null;
  const customerEmail = estimate.Email ?? null;

  const serviceAddressParts = [
    estimate.Service_Address?.Service_Street_1,
    estimate.Service_Address?.Service_Street_2,
    estimate.Service_Address?.Service_City,
    estimate.Service_Address?.Service_Country,
  ].filter((part) => typeof part === "string" && part.trim().length > 0);

  const serviceAddress =
    serviceAddressParts.length > 0 ? serviceAddressParts.join(", ") : null;
  const customerId = payload?.contact?.data?.[0]?.Customer_Id__C ?? null;
  const quotationNumber = estimate.Name ?? "";
  const currentQuotationKey =
    zohoEstimateId && quotationNumber
      ? buildIdNameValue(zohoEstimateId, quotationNumber)
      : null;
  const matchedRevision =
    currentQuotationKey && Array.isArray(payload?.revisions)
      ? payload.revisions.find(
          (row: any) => row?.revision_quotation_number === currentQuotationKey,
        )
      : null;

  const quotationDateRaw =
    estimate.Creation_Date__C ?? estimate.Created_Time ?? null;
  const quotationDate = quotationDateRaw
    ? new Date(quotationDateRaw).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "";

  let validityDays: number | undefined;
  if (estimate.Creation_Date__C && estimate.Expiry_Date) {
    const created = new Date(estimate.Creation_Date__C);
    const expiry = new Date(estimate.Expiry_Date);
    const diffMs = expiry.getTime() - created.getTime();
    validityDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
  }

  const serviceLineItems: any[] = estimate.Service_Line_Items ?? [];

  const sortedServiceLineItems = [...serviceLineItems].sort((a, b) => {
    const aSequence =
      typeof a?.Sequence === "number" ? a.Sequence : Number.MAX_SAFE_INTEGER;
    const bSequence =
      typeof b?.Sequence === "number" ? b.Sequence : Number.MAX_SAFE_INTEGER;
    return aSequence - bSequence;
  });

  const lineItems: QuotationLineItem[] = sortedServiceLineItems.map((item) => ({
    serviceItemId: relationId(item.Service),
    description: item.Service?.name ?? item.Name ?? "Service",
    details: item.Description ?? undefined,
    quantity: typeof item.Quantity === "number" ? item.Quantity : 1,
    unit: item.Unit ?? "L/S",
    unitPrice:
      typeof item.List_Price === "number"
        ? item.List_Price
        : typeof item.Amount === "number"
          ? item.Amount
          : 0,
    taxRate:
      typeof item.Tax?.Tax_Percentage === "number"
        ? item.Tax.Tax_Percentage
        : 0,
    lineAmount:
      typeof item.Line_Item_Amount === "number"
        ? item.Line_Item_Amount
        : undefined,
    discountAmount:
      typeof item.Discount === "number" ? item.Discount : undefined,
    discountType: item.Discount_Type ?? undefined,
  }));

  const discountAmount =
    typeof estimate.Discount === "number" ? estimate.Discount : 0;

  const subTotal =
    typeof estimate.Sub_Total === "number" ? estimate.Sub_Total : undefined;
  const taxAmount =
    typeof estimate.Tax_Amount === "number" ? estimate.Tax_Amount : undefined;
  const grandTotal =
    typeof estimate.Grand_Total === "number" ? estimate.Grand_Total : undefined;

  const termsAndConditions =
    typeof estimate.Terms_And_Conditions?.value === "string"
      ? estimate.Terms_And_Conditions.value
      : undefined;

  const notes: string | undefined = estimate.Summary ?? undefined;

  const quotation: QuotationData = {
    companyName,
    companyAddress,
    companyWebsite: undefined,
    companyPhone: undefined,
    companyLogo: undefined,
    customerId,
    customerCompanyName,
    customerContact: customerContact ?? undefined,
    customerPhone: customerPhone ?? undefined,
    customerEmail: customerEmail ?? undefined,

    serviceAddress: serviceAddress ?? undefined,
    ownerName: estimate.Owner?.name ?? undefined,
    ownerEmail: estimate.Owner?.email ?? undefined,
    quotationNumber,
    quotationDate,
    validityDays,
    quotationType:
      typeof estimate.Quotation_Type__C === "string"
        ? estimate.Quotation_Type__C
        : undefined,
    revisionType:
      parseRevisionType(estimate.Revision_Type__C) ??
      parseRevisionType(matchedRevision?.revision_type),
    revisionNumber:
      typeof matchedRevision?.revision_number === "number"
        ? matchedRevision.revision_number
        : undefined,
    totalDiscount: estimate.Discount_value__C,
    totalDiscountType: estimate.DiscountType__C,
    lineItems,
    discountAmount,
    subTotal,
    taxAmount,
    grandTotal,
    termsAndConditions,

    notes,
    zohoEstimateId: zohoEstimateId ?? undefined,
  };

  return quotation;
}
