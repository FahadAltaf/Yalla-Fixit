import type { QuotationData } from "@/components/dashboard/extensions/quotation-templates/quotation-templates";

/**
 * The stored quotation shape that both the coordinator panel and the public
 * client page build from a quote's immutable snapshot. Kept independent of the
 * service DTO so the snapshot — not the live pricing config — always drives the
 * document.
 */
export type SnaggingQuoteDoc = {
  quote_number: string;
  status: string;
  created_at?: string | null;
  sent_at?: string | null;
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  lines: { description: string; qty: number; unit: string; unit_price: number; amount: number }[];
  scope_of_work?: string | null;
  terms?: string | null;
  property?: {
    unit_label?: string | null;
    building_name?: string | null;
    community?: string | null;
    developer_name?: string | null;
    property_type?: string | null;
    bedrooms?: number | null;
    built_up_area_sqft?: number | null;
    client_name?: string | null;
    client_email?: string | null;
    client_phone?: string | null;
    client_ref?: string | null;
  } | null;
};

function quotationDate(value?: string | null): string {
  const d = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
}

function propertyTypeLabel(t?: string | null): string | null {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

function bedroomsLabel(b?: number | null): string | null {
  if (b == null) return null;
  return b === 0 ? "Studio" : `${b} BR`;
}

/**
 * Maps a snagging quotation snapshot onto the Extensions "Classic Professional"
 * quotation template (YallaClassicTemplate), so the snagging PDF shares the exact
 * header, colour theme and layout used everywhere else in Yalla Fix It. The
 * property becomes the Service Address block; scope of work + snagging terms fold
 * into the template's Terms & Conditions section (snagging quotes carry no
 * per-line discounts, so the document renders in "without discount" mode).
 */
export function snaggingQuoteToTemplateData(q: SnaggingQuoteDoc): QuotationData {
  const p = q.property ?? {};

  const location = [p.unit_label, p.building_name, p.community, p.developer_name]
    .filter(Boolean)
    .join(", ");
  const propertyMeta = [
    propertyTypeLabel(p.property_type),
    bedroomsLabel(p.bedrooms),
    p.built_up_area_sqft ? `${p.built_up_area_sqft} sq ft` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const serviceAddress = [location, propertyMeta ? `(${propertyMeta})` : null].filter(Boolean).join(" ");

  // The template renders termsAndConditions as the numbered "Notes" list, so we
  // pass the terms verbatim (each "N-" line becomes a note). Scope of work falls
  // back in only when no terms are configured.
  const notes = q.terms?.trim() || q.scope_of_work?.trim() || "";

  return {
    // Company (sender) — YFI's own details, identical to every other quotation.
    companyName: "Yalla Fix It",
    companyAddress: "Office 102, Building 6, Gold & Diamond Park, Dubai",
    companyWebsite: "https://www.yallafixit.ae",
    totalDiscount: "0",
    totalDiscountType: "Currency",

    // Customer (from the immutable property/client snapshot).
    customerCompanyName: p.client_name ?? "Client",
    customerPhone: p.client_phone ?? undefined,
    customerEmail: p.client_email ?? undefined,
    customerId: p.client_ref ?? undefined,
    serviceAddress: serviceAddress || undefined,

    // Quotation meta.
    quotationNumber: q.quote_number,
    quotationDate: quotationDate(q.sent_at ?? q.created_at),

    // Priced lines (no discounts on snagging quotes).
    lineItems: (q.lines ?? []).map((l) => ({
      description: l.description,
      quantity: l.qty,
      unit: l.unit,
      unitPrice: l.unit_price,
      taxRate: q.tax_rate,
      discountAmount: 0,
    })),

    // Financials taken straight from the snapshot for reproducibility.
    subTotal: q.subtotal,
    taxAmount: q.tax_amount,
    grandTotal: q.total,

    termsAndConditions: notes || undefined,
  };
}
